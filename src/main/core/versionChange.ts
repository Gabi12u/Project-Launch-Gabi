import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
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
import { downloadFile, NetworkError } from './net'
import { getInstance, installGameFiles, persist, syncContentWithDisk, toggleContent, tryGetInstance } from './instances'
import { applyPreparedUpdate, installNewDependencies, type PreparedUpdate } from './content'
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
 * A lookup that fails is reported per item rather than ending everything, so
 * a missing CurseForge key does not block a change for a pack that is mostly
 * from Modrinth. Only when not a single lookup got an answer is that the
 * connection, and the whole thing stops.
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
  let offline = 0

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
        } else if (candidate.versionId === item.versionId) {
          entry.outcome = 'keep'
        } else {
          entry.outcome = 'update'
          entry.toVersion = candidate.versionNumber
          versions.set(item.id, candidate)
        }
      } catch (err) {
        if (err instanceof NetworkError) offline++
        else answered++
        entry.outcome = 'unchecked'
        entry.reason = err instanceof Error ? err.message : String(err)
        logger.warn(`Versionssuche für ${item.name} fehlgeschlagen:`, err)
      }
    }
    looked++
    task?.update(tr(`Mods werden geprüft… ${looked} von ${pending.length}`, `Checking mods… ${looked} of ${pending.length}`), looked / pending.length)
  })

  if (answered === 0 && offline > 0) {
    throw new Error(
      tr(
        'Keine Verbindung zu Modrinth oder CurseForge. Prüfe deine Internetverbindung und versuche es erneut.',
        'No connection to Modrinth or CurseForge. Check your internet connection and try again.'
      )
    )
  }
  return { items, versions }
}

/** What a change to `target` would do with each item, without changing anything. */
export async function planVersionChange(id: string, raw: VersionChangeTarget): Promise<VersionChangePlan> {
  const target = checkTarget(raw)
  await syncContentWithDisk(id)
  const { items } = await lookUp(id, target)
  return { items }
}

export async function changeInstanceVersion(id: string, raw: VersionChangeTarget): Promise<VersionChangeResult> {
  const target = checkTarget(raw)
  assertIdle(id)
  const before = getInstance(id)
  if (
    before.mcVersion === target.mcVersion &&
    before.loader === target.loader &&
    (!target.loaderVersion || before.loaderVersion === target.loaderVersion)
  ) {
    throw new Error(tr('Die Instanz hat diese Version schon.', 'The instance already has this version.'))
  }

  // Files added or removed by hand count before anything is decided. Done
  // before the lock below, which the folder scan would otherwise wait out.
  await syncContentWithDisk(id)

  return withContentLock(id, () =>
    withTask(
      tr(`${before.name} wechselt auf ${label(target)}`, `${before.name} moves to ${label(target)}`),
      tr('Wird vorbereitet…', 'Preparing…'),
      id,
      (task) => runChange(id, target, task)
    )
  )
}

async function runChange(id: string, target: Required<VersionChangeTarget>, task: Task): Promise<VersionChangeResult> {
  const staging = join(paths.cache(), `version-change-${randomUUID().slice(0, 8)}`)
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

    // 2. A matching file for every item.
    task.span(0.4, 0.5)
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
        logger.warn(`${entry.name} für ${label(game)} nicht geladen:`, err)
        entry.outcome = 'disable'
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
    // moves are left, nothing that waits on the network.
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
        entry.toVersion = undefined
        entry.reason = err instanceof Error ? err.message : String(err)
      }
    }
    for (const entry of items) {
      if (entry.outcome !== 'disable' && entry.outcome !== 'unchecked') continue
      if (!getInstance(id).content.find((c) => c.id === entry.contentId)?.enabled) continue
      try {
        await toggleContent(id, entry.contentId, false)
      } catch (err) {
        logger.warn(`${entry.name} konnte nicht ausgeschaltet werden:`, err)
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

    const switchedOff = items.filter((entry) => entry.outcome === 'disable' || entry.outcome === 'unchecked')
    if (switchedOff.length > 0) {
      notify(
        'warning',
        tr(
          `${switchedOff.length} ${switchedOff.length === 1 ? 'Eintrag wurde' : 'Einträge wurden'} ausgeschaltet`,
          `${switchedOff.length} ${switchedOff.length === 1 ? 'item was' : 'items were'} switched off`
        ),
        tr(
          `Für ${label(game)} gibt es keine passende Version von ${switchedOff.slice(0, 3).map((e) => e.name).join(', ')}${switchedOff.length > 3 ? ' und weiteren' : ''}. Sie bleiben ausgeschaltet in der Instanz.`,
          `There is no matching version of ${switchedOff.slice(0, 3).map((e) => e.name).join(', ')}${switchedOff.length > 3 ? ' and others' : ''} for ${label(game)}. They stay in the instance, switched off.`
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
      // the cache folder is swept with the rest of the cache
    }
    // Cleared on every way out. On a failure before step 6 nothing in the
    // instance changed, it is simply the old version again.
    const left = tryGetInstance(id)
    if (left?.installing) persist({ ...left, installing: false })
  }
}
