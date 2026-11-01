import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ContentItem,
  LoaderId,
  ProjectVersion,
  VersionChangeItem,
  VersionChangePlan,
  VersionChangeResult,
  VersionChangeTarget
} from '@shared/types'
import { LOADERS } from '@shared/defaults'
import { paths } from '../paths'
import { log } from '../logger'
import { notify } from '../events'
import { TaskCancelledError, withTask, type Task } from '../tasks'
import { bestVersionFor } from '../providers'
import { resolveLatestLoaderVersion } from '../loaders'
import { downloadFile, HttpError, NetworkError } from './net'
import { getInstance, installGameFiles, persist, syncContentWithDisk, toggleContent, tryGetInstance } from './instances'
import { applyPreparedUpdate, identifyLocalContent, installNewDependencies, type PreparedUpdate } from './content'
import { createBackup, NothingToBackUpError } from './backups'
import { isContentBusy, isCopying, withContentLock } from './contentLock'
import { isRunning, isStarting } from './running'
import { isArchiving, isRestoring } from './restoreLock'
import { isRepairing } from './repairLock'
import { tr } from '@shared/i18n'

/**
 * Moves an instance to another Minecraft version or mod loader.
 *
 * Every mod, resource pack, shader and data pack from Modrinth or CurseForge
 * is looked up again for the new version and replaced by the file made for
 * it. What has no such file is switched off, not deleted, so going back to
 * the old version and switching it on again is still possible.
 *
 * The order keeps a failure harmless for as long as possible: the new game
 * files go into the shared folders first, then every replacement is
 * downloaded to a staging folder, and only when all of that worked is
 * anything in the instance itself touched. The worlds are backed up before
 * that point, since a world opened in another version cannot be taken back.
 */

const logger = log('version-change')

const LOADER_IDS: LoaderId[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt']

/** Lookups and downloads in flight at once, kind to Modrinth's rate limit. */
const LOOKUPS_AT_ONCE = 6
const DOWNLOADS_AT_ONCE = 4

function loaderName(loader: LoaderId): string {
  return LOADERS.find((entry) => entry.id === loader)?.name ?? loader
}

function label(target: VersionChangeTarget): string {
  return target.loader === 'vanilla' ? target.mcVersion : `${target.mcVersion} ${loaderName(target.loader)}`
}

/** The target as it arrived over IPC, checked field by field. */
function checkTarget(raw: VersionChangeTarget): Required<VersionChangeTarget> {
  const mcVersion = typeof raw?.mcVersion === 'string' ? raw.mcVersion.trim() : ''
  if (!mcVersion || mcVersion.length > 64 || !/^[\w.\- ]+$/.test(mcVersion)) {
    throw new Error(tr('Ungültige Minecraft-Version.', 'Invalid Minecraft version.'))
  }
  if (!LOADER_IDS.includes(raw.loader)) {
    throw new Error(tr('Unbekannter Mod-Loader.', 'Unknown mod loader.'))
  }
  const loaderVersion =
    raw.loader === 'vanilla' ? '' : typeof raw.loaderVersion === 'string' ? raw.loaderVersion.trim() : ''
  if (loaderVersion.length > 64 || (loaderVersion && !/^[\w.+\-]+$/.test(loaderVersion))) {
    throw new Error(tr('Ungültige Loader-Version.', 'Invalid loader version.'))
  }
  return { mcVersion, loader: raw.loader, loaderVersion }
}

/** Refuses while anything else is working on the instance or it is in use. */
function assertIdle(id: string): void {
  const instance = getInstance(id)
  if (isRunning(id)) {
    throw new Error(tr('Die Instanz läuft gerade. Beende Minecraft, bevor du die Version änderst.', 'The instance is running. Close Minecraft before you change the version.'))
  }
  if (isStarting(id)) {
    throw new Error(tr('Die Instanz wird gerade gestartet. Warte, bis das abgeschlossen ist.', 'The instance is starting right now. Wait until that is done.'))
  }
  if (instance.installing) {
    throw new Error(tr('Die Instanz wird gerade eingerichtet. Warte, bis das fertig ist.', 'The instance is being set up right now. Wait until that is done.'))
  }
  if (isCopying(id) || isContentBusy(id)) {
    throw new Error(tr('An den Mods dieser Instanz wird gerade gearbeitet. Warte, bis das fertig ist.', 'The mods of this instance are being worked on right now. Wait until that is done.'))
  }
  if (isRestoring(id) || isArchiving(id)) {
    throw new Error(tr('Für diese Instanz läuft gerade eine Sicherung. Warte, bis das fertig ist.', 'A backup is running for this instance right now. Wait until that is done.'))
  }
  if (isRepairing(id)) {
    throw new Error(tr('Diese Instanz wird gerade repariert. Warte, bis das abgeschlossen ist.', 'This instance is being repaired right now. Wait until that is done.'))
  }
}

/** Runs `work` over `list` with at most `limit` calls in flight. */
async function eachLimited<T>(list: T[], limit: number, work: (entry: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) await work(list[next++])
  })
  await Promise.all(lanes)
}

/**
 * Looks up every item for the target version. Writes nothing.
 *
 * Two kinds of failure are told apart. No connection, a rate limit or a
 * server error passes, and a single one stops the whole change: counted as
 * "nothing fits", it switched off every mod a busy Modrinth did not answer
 * for while the change went through anyway. A failure that will not pass
 * by retrying, such as a missing CurseForge key, is reported for that item,
 * which is then left exactly as it is, so a pack mostly from Modrinth can
 * still move.
 */
async function lookUp(
  id: string,
  target: Required<VersionChangeTarget>,
  task?: Task
): Promise<{ items: VersionChangeItem[]; versions: Map<string, ProjectVersion> }> {
  const content = getInstance(id).content
  const versions = new Map<string, ProjectVersion>()
  const items: VersionChangeItem[] = content.map((item) => ({
    contentId: item.id,
    name: item.name,
    type: item.type,
    outcome: 'local',
    fromVersion: item.version
  }))

  const pending = items.filter((_, index) => content[index].provider !== 'local' && content[index].projectId)
  let looked = 0
  let answered = 0
  let passing = 0

  // Already made for the target and newer than what was found: a beta the
  // user chose over the latest release is not swapped back to an older file.
  const fitsAlready = (item: ContentItem, candidate: ProjectVersion): boolean =>
    item.gameVersions.includes(target.mcVersion) &&
    (item.type !== 'mod' ||
      item.loaders.includes(target.loader) ||
      (target.loader === 'quilt' && item.loaders.includes('fabric'))) &&
    Boolean(item.releasedAt) &&
    new Date(candidate.releasedAt).getTime() < new Date(item.releasedAt as string).getTime()

  await eachLimited(pending, LOOKUPS_AT_ONCE, async (entry) => {
    task?.throwIfCancelled()
    const item = content.find((c) => c.id === entry.contentId)
    if (!item) return
    if (item.type === 'mod' && target.loader === 'vanilla') {
      entry.outcome = 'disable'
      entry.reason = tr('Vanilla lädt keine Mods.', 'Vanilla does not load mods.')
      answered++
    } else {
      try {
        const candidate = await bestVersionFor(
          item.provider as 'modrinth' | 'curseforge',
          item.projectId as string,
          target.mcVersion,
          target.loader,
          item.type
        )
        answered++
        if (!candidate) {
          entry.outcome = 'disable'
          entry.reason = tr(`Keine Version für ${label(target)}`, `No version for ${label(target)}`)
        } else if (candidate.versionId === item.versionId || fitsAlready(item, candidate)) {
          entry.outcome = 'keep'
        } else {
          entry.outcome = 'update'
          entry.toVersion = candidate.versionNumber
          versions.set(item.id, candidate)
        }
        if ((entry.outcome === 'keep' || entry.outcome === 'update') && item.disabledByVersionChange && !item.enabled) {
          entry.reenable = true
        }
      } catch (err) {
        if (isPassing(err)) passing++
        else answered++
        entry.outcome = 'unchecked'
        entry.reason = err instanceof Error ? err.message : String(err)
        logger.warn(`Versionssuche für ${item.name} fehlgeschlagen:`, err)
      }
    }
    looked++
    task?.update(tr(`Mods und Pakete werden geprüft… ${looked} von ${pending.length}`, `Checking mods and packs… ${looked} of ${pending.length}`), looked / pending.length)
  })

  if (passing > 0) {
    throw new Error(
      answered === 0
        ? tr(
            'Keine Verbindung zu Modrinth oder CurseForge. Prüfe deine Internetverbindung und versuche es erneut.',
            'No connection to Modrinth or CurseForge. Check your internet connection and try again.'
          )
        : tr(
            `Modrinth oder CurseForge hat für ${passing} ${passing === 1 ? 'Eintrag' : 'Einträge'} gerade nicht geantwortet. An der Instanz wurde nichts geändert. Versuche es in ein paar Minuten erneut.`,
            `Modrinth or CurseForge did not answer for ${passing} ${passing === 1 ? 'item' : 'items'} right now. Nothing in the instance was changed. Try again in a few minutes.`
          )
    )
  }
  return { items, versions }
}

/** No connection, a rate limit or a server error: worth trying again shortly. */
function isPassing(err: unknown): boolean {
  if (err instanceof NetworkError) return true
  return err instanceof HttpError && (err.status === 429 || err.status >= 500)
}

/**
 * What a change to `target` would do with each item. Nothing in the game
 * folder changes; only local files Modrinth recognises are recorded as such,
 * the same way the update check records them.
 */
export async function planVersionChange(id: string, raw: VersionChangeTarget): Promise<VersionChangePlan> {
  const target = checkTarget(raw)
  await syncContentWithDisk(id)
  // Files dropped in by hand that Modrinth knows get their matching version
  // too, instead of staying behind on the old one.
  await identifyLocalContent(id)
  const { items } = await lookUp(id, target)
  return { items }
}

export async function changeInstanceVersion(id: string, raw: VersionChangeTarget): Promise<VersionChangeResult> {
  const target = checkTarget(raw)
  assertIdle(id)
  const before = getInstance(id)
  // After an interrupted change the recorded version is a valid target: it
  // lines the half swapped mods up with it again.
  if (
    !before.pendingVersionChange &&
    before.mcVersion === target.mcVersion &&
    before.loader === target.loader &&
    (!target.loaderVersion || before.loaderVersion === target.loaderVersion)
  ) {
    throw new Error(tr('Die Instanz hat diese Version schon.', 'The instance already has this version.'))
  }

  // Taken right after the checks above, with nothing awaited in between. The
  // folder scan used to run first, and for the seconds it took on a big pack
  // a second change, a launch or a repair could still get in.
  return withContentLock(id, async () => {
    // Files added or removed by hand count before anything is decided.
    // Forced, since the scan otherwise waits out the lock held here.
    await syncContentWithDisk(id, { force: true })
    return withTask(
      tr(`${before.name} wechselt auf ${label(target)}`, `${before.name} moves to ${label(target)}`),
      tr('Wird vorbereitet…', 'Preparing…'),
      id,
      (task) => runChange(id, target, task)
    )
  })
}

/** Staging folders of changes running right now, which a sweep leaves alone. */
const liveStaging = new Set<string>()

/**
 * Removes staging folders a change left behind when the launcher was closed
 * or killed mid-download. Nothing else ever cleans them out of the cache.
 */
function sweepStaging(): void {
  try {
    if (!existsSync(paths.cache())) return
    for (const name of readdirSync(paths.cache())) {
      if (!name.startsWith('version-change-') || liveStaging.has(name)) continue
      rmSync(join(paths.cache(), name), { recursive: true, force: true })
    }
  } catch (err) {
    logger.debug('Alte Zwischenordner nicht entfernt:', err)
  }
}

async function runChange(id: string, target: Required<VersionChangeTarget>, task: Task): Promise<VersionChangeResult> {
  sweepStaging()
  const stagingName = `version-change-${randomUUID().slice(0, 8)}`
  const staging = join(paths.cache(), stagingName)
  liveStaging.add(stagingName)
  // Shown as being set up, so Play stays disabled until the change is through.
  persist({ ...getInstance(id), installing: true })

  try {
    // 1. Game files for the new version, in the shared folders only.
    let loaderVersion = target.loaderVersion
    if (target.loader !== 'vanilla' && !loaderVersion) {
      task.update(tr('Loader-Version wird ermittelt…', 'Determining loader version…'), null)
      loaderVersion = await resolveLatestLoaderVersion(target.loader, target.mcVersion)
    }
    const game = { ...target, loaderVersion }
    task.span(0, 0.4)
    await installGameFiles(game, task)

    // 2. A matching file for every item, local files Modrinth knows included.
    task.span(0.4, 0.5)
    task.update(tr('Lokale Dateien werden erkannt…', 'Recognising local files…'), null)
    await identifyLocalContent(id)
    const { items, versions } = await lookUp(id, game, task)

    // 3. The worlds, before anything opens them in another version.
    task.span(0.5, 0.55)
    task.update(tr('Welten werden gesichert…', 'Backing up worlds…'), null)
    try {
      await createBackup(id, {
        name: tr(`Vor dem Wechsel auf ${label(game)}`, `Before moving to ${label(game)}`),
        reason: 'pre-update',
        includes: ['saves']
      })
    } catch (err) {
      if (!(err instanceof NothingToBackUpError)) throw err
    }

    // 4. Every replacement downloaded and checked before the first swap.
    task.span(0.55, 0.95)
    mkdirSync(staging, { recursive: true })
    const prepared = new Map<string, PreparedUpdate>()
    const toFetch = items.filter((entry) => entry.outcome === 'update')
    let fetched = 0
    await eachLimited(toFetch, DOWNLOADS_AT_ONCE, async (entry) => {
      task.throwIfCancelled()
      const version = versions.get(entry.contentId) as ProjectVersion
      const file = join(staging, entry.contentId)
      try {
        await downloadFile({ url: version.downloadUrl, path: file, sha1: version.sha1, size: version.size }, undefined, 3, task.signal)
        prepared.set(entry.contentId, { file, version })
      } catch (err) {
        if (err instanceof TaskCancelledError || task.signal.aborted) throw err
        // Nothing in the instance has changed yet, so a failure that passes
        // stops here rather than leaving this one mod switched off.
        if (isPassing(err)) {
          throw new Error(
            tr(
              `${entry.name} ließ sich gerade nicht herunterladen. An der Instanz wurde nichts geändert. Versuche es gleich noch einmal.`,
              `${entry.name} could not be downloaded right now. Nothing in the instance was changed. Try again in a moment.`
            ),
            { cause: err }
          )
        }
        logger.warn(`${entry.name} für ${label(game)} nicht geladen:`, err)
        entry.outcome = 'disable'
        entry.reenable = false
        entry.toVersion = undefined
        entry.reason = tr(
          `Download fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          `Download failed: ${err instanceof Error ? err.message : String(err)}`
        )
      }
      fetched++
      task.update(tr(`Mods werden geladen… ${fetched} von ${toFetch.length}`, `Downloading mods… ${fetched} of ${toFetch.length}`), fetched / toFetch.length)
    })
    task.throwIfCancelled()

    // 5. From here on the change goes through to the end. Only local file
    // moves are left, nothing that waits on the network. Noted first: cut off
    // in the middle (the launcher closed, the PC went off), the instance
    // holds mods for both versions, and the next start has to say so instead
    // of launching the old version with half of them swapped.
    persist({ ...getInstance(id), pendingVersionChange: game })
    task.span(0.95, 1)
    task.update(tr('Mods werden ausgetauscht…', 'Swapping mods…'), null)
    for (const entry of items) {
      const ready = prepared.get(entry.contentId)
      if (entry.outcome !== 'update' || !ready) continue
      try {
        if (!(await applyPreparedUpdate(id, entry.contentId, ready))) entry.outcome = 'keep'
      } catch (err) {
        logger.warn(`${entry.name} konnte nicht ausgetauscht werden:`, err)
        entry.outcome = 'disable'
        entry.reenable = false
        entry.toVersion = undefined
        entry.reason = err instanceof Error ? err.message : String(err)
      }
    }
    // Switched off is only what nothing fits. An item that could not be
    // checked is left exactly as it is.
    const switchedOff: VersionChangeItem[] = []
    const stuckOn: VersionChangeItem[] = []
    for (const entry of items) {
      if (entry.outcome !== 'disable') continue
      if (!getInstance(id).content.find((c) => c.id === entry.contentId)?.enabled) continue
      try {
        await toggleContent(id, entry.contentId, false)
        switchedOff.push(entry)
      } catch (err) {
        logger.warn(`${entry.name} konnte nicht ausgeschaltet werden:`, err)
        stuckOn.push(entry)
      }
    }
    // Remembered, so going back to a version they fit switches them on again.
    if (switchedOff.length > 0) {
      const off = new Set(switchedOff.map((entry) => entry.contentId))
      const current = getInstance(id)
      persist({
        ...current,
        content: current.content.map((item) => (off.has(item.id) ? { ...item, disabledByVersionChange: true } : item))
      })
    }
    // Switched off by an earlier change and fitting again now.
    for (const entry of items) {
      if (!entry.reenable || (entry.outcome !== 'keep' && entry.outcome !== 'update')) continue
      if (getInstance(id).content.find((c) => c.id === entry.contentId)?.enabled !== false) continue
      try {
        await toggleContent(id, entry.contentId, true)
      } catch (err) {
        logger.warn(`${entry.name} konnte nicht wieder eingeschaltet werden:`, err)
        entry.reenable = false
      }
    }

    // 6. The instance now is the new version. Update markers belonged to the
    // old one and are dropped.
    const now = getInstance(id)
    persist({
      ...now,
      mcVersion: game.mcVersion,
      loader: game.loader,
      loaderVersion: game.loaderVersion,
      installing: false,
      installed: true,
      pendingVersionChange: undefined,
      content: now.content.map((item) => ({ ...item, update: null }))
    })
    logger.info(`${now.name} auf ${label(game)} umgestellt`)

    // 7. A version made for the new game can need something the old one did
    // not, a different library for another loader most of all.
    for (const entry of items) {
      if (entry.outcome !== 'update') continue
      const item = getInstance(id).content.find((c) => c.id === entry.contentId)
      if (item) await installNewDependencies(id, item)
    }

    const names = (list: VersionChangeItem[], more: string): string =>
      list.slice(0, 3).map((e) => e.name).join(', ') + (list.length > 3 ? more : '')
    if (switchedOff.length > 0) {
      notify(
        'warning',
        tr(
          `${switchedOff.length} ${switchedOff.length === 1 ? 'Eintrag wurde' : 'Einträge wurden'} ausgeschaltet`,
          `${switchedOff.length} ${switchedOff.length === 1 ? 'item was' : 'items were'} switched off`
        ),
        tr(
          `Für ${label(game)} gibt es keine passende Version von ${names(switchedOff, ' und weiteren')}. Sie bleiben ausgeschaltet in der Instanz und gehen wieder an, wenn du auf eine Version wechselst, zu der sie passen.`,
          `There is no matching version of ${names(switchedOff, ' and others')} for ${label(game)}. They stay in the instance, switched off, and come back on when you change to a version they fit.`
        ),
        { route: `/instances/${id}?tab=content` }
      )
    }
    if (stuckOn.length > 0) {
      notify(
        'error',
        tr(
          `${stuckOn.length} ${stuckOn.length === 1 ? 'Eintrag ließ' : 'Einträge ließen'} sich nicht ausschalten`,
          `${stuckOn.length} ${stuckOn.length === 1 ? 'item' : 'items'} could not be switched off`
        ),
        tr(
          `${names(stuckOn, ' und weitere')} ${stuckOn.length === 1 ? 'passt' : 'passen'} nicht zu ${label(game)}, ${stuckOn.length === 1 ? 'ist' : 'sind'} aber noch eingeschaltet. Schalte sie unter Installiert selbst aus.`,
          `${names(stuckOn, ' and others')} ${stuckOn.length === 1 ? 'does' : 'do'} not fit ${label(game)} but ${stuckOn.length === 1 ? 'is' : 'are'} still switched on. Switch ${stuckOn.length === 1 ? 'it' : 'them'} off under Installed yourself.`
        ),
        { route: `/instances/${id}?tab=content` }
      )
    }
    const unchecked = items.filter((entry) => entry.outcome === 'unchecked')
    if (unchecked.length > 0) {
      notify(
        'warning',
        tr(
          `${unchecked.length} ${unchecked.length === 1 ? 'Eintrag konnte' : 'Einträge konnten'} nicht geprüft werden`,
          `${unchecked.length} ${unchecked.length === 1 ? 'item' : 'items'} could not be checked`
        ),
        tr(
          `${names(unchecked, ' und weitere')} ${unchecked.length === 1 ? 'bleibt' : 'bleiben'} unverändert. ${unchecked[0].reason ?? ''}`,
          `${names(unchecked, ' and others')} ${unchecked.length === 1 ? 'stays' : 'stay'} unchanged. ${unchecked[0].reason ?? ''}`
        ),
        { route: `/instances/${id}?tab=content` }
      )
    }

    task.update(tr(`Jetzt auf ${label(game)}`, `Now on ${label(game)}`), 1)
    return { ...game, items }
  } finally {
    try {
      rmSync(staging, { recursive: true, force: true })
    } catch {
      // swept by the next change
    }
    liveStaging.delete(stagingName)
    // Cleared on every way out. On a failure before step 6 nothing in the
    // instance changed, it is simply the old version again.
    const left = tryGetInstance(id)
    if (left?.installing) persist({ ...left, installing: false })
  }
}
