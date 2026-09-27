import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentItem } from '@shared/types'
import { ensureInstanceLayout, paths } from '../paths'
import { getSettings } from '../store'
import { readdir, stat } from 'node:fs/promises'
import { log } from '../logger'
import { TaskCancelledError, withTask } from '../tasks'
import { downloadAll, downloadFile, isSatisfied, sha1File, type DownloadItem } from './net'
import { clientJarPath, installVersion, loadVersionJson, resolveLibraries , type VersionJson } from './mojang'
import { requiredJavaMajor, resolveJava } from './java'
import { getInstance, persist, resolveVersionId, syncContentWithDisk } from './instances'
import { checkUpdates, contentFilePath, removeContent } from './content'
import { isContentBusy, withContentLock } from './contentLock'
import { bestVersionFor } from '../providers'
import { installLoader } from '../loaders'
import { activeVersionIds, isRunning, isStarting } from './running'
import { isRestoring } from './restoreLock'
import { isNativesClaimed } from './launch'
import { clearRepairing, isRepairing, markRepairing } from './repairLock'
import { pushLog } from './instanceLog'
import { ensureJavaPathApproved } from './commandApproval'
import { tr } from '@shared/i18n'

const logger = log('repair')

/**
 * Appends one line to the instance's live log, the same stream the "Logs" tab
 * already reads. A repair used to be visible only as a spinning button and a
 * toast with the final count; this makes each check, warning and fix show up
 * as it happens, in the one viewer that already exists for it, rather than a
 * second one built to duplicate it.
 */
function repairLog(instanceId: string, kind: 'info' | 'check' | 'warning' | 'fix' | 'verify' | 'success' | 'error', text: string): void {
  pushLog({
    instanceId,
    stream: 'launcher',
    level: kind === 'error' ? 'error' : kind === 'warning' ? 'warn' : 'info',
    text: `[${kind.toUpperCase()}] ${text}`,
    time: Date.now()
  })
}

export interface RepairReport {
  instanceId: string
  checkedFiles: number
  repairedFiles: number
  steps: { label: string; status: 'ok' | 'repaired' | 'failed'; detail: string }[]
}

/**
 * Verifies and restores everything an instance needs: folder layout, the
 * version manifest, libraries, assets, the mod loader, managed content files
 * and the Java runtime.
 *
 * The "instance with a repair in progress" marker itself lives in
 * `repairLock.ts`, not here: the renderer's own "wird repariert" flag lives in
 * component state and is lost the moment the user navigates away, which
 * re-enables the button while the run is still going. Two runs then delete
 * and re-download the same paths and both write the instance record at the
 * end, so whichever finishes last silently discards the other's work. Reusing
 * `isRepairing` from `repairLock.ts` also lets `launch.ts`, `instances.ts` and
 * `backups.ts` all see the same marker without importing this file, so a
 * launch, an install, a delete, a duplicate and a restore can each refuse to
 * start on top of a repair without any of them having to import `repair.ts`
 * itself.
 */
/**
 * Lets a cancellation pass straight through a `catch` that would otherwise
 * record it as an ordinary failed step.
 *
 * Every step below reports its own errors instead of throwing, so the repair
 * can still finish the remaining steps after one of them breaks. A
 * cancellation is not "one step broke", though: it is the whole run being
 * asked to stop, and swallowing it here left `runRepair` returning normally,
 * so `withTask` called `task.done()` and the user saw "Fertig" for a repair
 * they had just cancelled.
 */
function rethrowIfCancelled(err: unknown): void {
  if (err instanceof TaskCancelledError) throw err
}

const ZIP_END_MARKER = Buffer.from([0x50, 0x4b, 0x05, 0x06])

/**
 * Whether a jar still ends in a zip directory. Reads only the tail, since a
 * full parse reads the whole file synchronously on the main thread, once per
 * library. A file that cannot be read right now (a scanner holding it) counts
 * as intact, so a brief lock never gets a good file deleted.
 */
function jarLooksIntact(file: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    if (size < 22) return false
    const length = Math.min(size, 65_557)
    const tail = Buffer.alloc(length)
    readSync(fd, tail, 0, length, size - length)
    return tail.lastIndexOf(ZIP_END_MARKER) !== -1
  } catch {
    return true
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * True when a content entry still looks exactly as it did when the repair
 * started.
 *
 * Only the fields the repair itself would change. A `false` here means
 * something else rewrote the entry while we were downloading, and the repair
 * then keeps its hands off that one rather than reverting someone's install.
 */
function unchanged(before: ContentItem, now: ContentItem): boolean {
  return (
    before.fileName === now.fileName &&
    before.sha1 === now.sha1 &&
    before.version === now.version &&
    before.enabled === now.enabled
  )
}

/**
 * Every entry beyond the one to keep, for every project installed more than
 * once in the same instance.
 *
 * Exported on its own because what counts as "the same mod twice" and which
 * copy survives is exactly the part worth pinning down with a direct test:
 * this decides which files get deleted from someone's disk, and a mistake
 * here (keeping the old file, dropping the new one) is not something a
 * reader would notice from `runRepair` alone.
 *
 * Local, hand-added files are left out entirely. Two unrelated jars a user
 * dropped in by hand can share nothing to key on but a guess, and a wrong
 * guess there deletes something the automated case never touches.
 */
export function findDuplicateContent(content: ContentItem[]): ContentItem[] {
  const groups = new Map<string, ContentItem[]>()
  for (const item of content) {
    if (!item.projectId) continue
    const key = `${item.type}|${item.provider}|${item.projectId}`
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }

  const stale: ContentItem[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // Newest install kept, on the assumption that whichever mod update
    // landed most recently is the one the user actually meant to end up with.
    stale.push(...[...group].sort((a, b) => b.installedAt - a.installedAt).slice(1))
  }
  return stale
}

export async function repairInstance(instanceId: string): Promise<RepairReport> {
  if (isRunning(instanceId)) {
    throw new Error(tr('Die Instanz läuft gerade. Beende Minecraft, bevor du sie reparierst.', 'The instance is running. Close Minecraft before you repair it.'))
  }
  // Mirrors the guard `launchInstance` has against `isRepairing`: a launch can
  // still be downloading files or installing Java when `isRunning` is false,
  // and repairing the same folder underneath it is what this closes.
  if (isStarting(instanceId)) {
    throw new Error(tr('Die Instanz wird gerade gestartet. Warte, bis das abgeschlossen ist.', 'The instance is starting right now. Wait until that is done.'))
  }

  // The other half of the guard `restoreBackupUnlocked` has against a repair:
  // both rewrite the same subfolders (saves, config, possibly mods), and a
  // restore moves worlds aside and unpacks an archive over them for as long as
  // `isRestoring` is set.
  if (isRestoring(instanceId)) {
    throw new Error(
      tr('Für diese Instanz wird gerade eine Sicherung eingespielt. Warte, bis das abgeschlossen ist.', 'A backup is being restored for this instance right now. Wait until that is done.')
    )
  }

  if (isRepairing(instanceId)) {
    throw new Error(tr('Diese Instanz wird bereits repariert. Warte, bis das abgeschlossen ist.', 'This instance is already being repaired. Wait until that is done.'))
  }

  // The mirror of the guard `launch.ts` grew: a repair rebuilds the same mods
  // folder an install or update is writing into, and both end by persisting
  // the content list. Whoever finished second used to decide what survived.
  if (isContentBusy(instanceId)) {
    throw new Error(
      tr('An den Mods dieser Instanz wird gerade gearbeitet. Warte, bis das abgeschlossen ist.', 'The mods of this instance are being worked on right now. Wait until that is done.')
    )
  }

  const instance = getInstance(instanceId)

  // The install started in the background at creation time downloads the very
  // files this would verify and delete, and both write the instance record at
  // the end — the loser's `installed` flag then describes the other one's work.
  if (instance.installing) {
    throw new Error(tr('Diese Instanz wird gerade eingerichtet. Warte, bis das abgeschlossen ist.', 'This instance is being set up right now. Wait until that is done.'))
  }

  markRepairing(instanceId)
  try {
    return await runRepair(instanceId, instance)
  } finally {
    clearRepairing(instanceId)
  }
}

async function runRepair(
  instanceId: string,
  instance: ReturnType<typeof getInstance>
): Promise<RepairReport> {
  return withTask(tr(`${instance.name} wird repariert`, `Repairing ${instance.name}`), tr('Prüfung startet…', 'Starting check…'), instanceId, async (task) => {
    const report: RepairReport = {
      instanceId,
      checkedFiles: 0,
      repairedFiles: 0,
      steps: []
    }

    const step = (label: string, status: 'ok' | 'repaired' | 'failed', detail: string): void => {
      report.steps.push({ label, status, detail })
      logger.info(`[${status}] ${label}: ${detail}`)
      repairLog(
        instanceId,
        status === 'ok' ? 'success' : status === 'repaired' ? 'fix' : 'error',
        `${label}: ${detail}`
      )
    }

    repairLog(instanceId, 'info', tr(`Starte Reparatur der Instanz "${instance.name}"`, `Starting repair of instance "${instance.name}"`))

    // 1. Folder layout ------------------------------------------------
    task.update(tr('Ordnerstruktur wird geprüft…', 'Checking folder structure…'), 0.02)
    repairLog(instanceId, 'check', tr('Überprüfe Ordnerstruktur', 'Checking folder structure'))
    const missingFolders = [paths.gameDir(instanceId), paths.mods(instanceId), paths.saves(instanceId)].filter(
      (dir) => !existsSync(dir)
    )
    try {
      ensureInstanceLayout(instanceId)
      step(
        tr('Ordnerstruktur', 'Folder structure'),
        missingFolders.length > 0 ? 'repaired' : 'ok',
        missingFolders.length > 0
          ? tr(`${missingFolders.length} Ordner neu angelegt`, `${missingFolders.length} folders created`)
          : tr('Vollständig', 'Complete')
      )
    } catch (err) {
      rethrowIfCancelled(err)
      step(tr('Ordnerstruktur', 'Folder structure'), 'failed', err instanceof Error ? err.message : String(err))
    }

    // 2. Mod loader ---------------------------------------------------
    task.update(tr('Mod Loader wird geprüft…', 'Checking mod loader…'), 0.08)
    repairLog(
      instanceId,
      'check',
      tr(
        `Überprüfe Loader (${instance.loader === 'vanilla' ? 'Vanilla' : instance.loader}) für Minecraft ${instance.mcVersion}`,
        `Checking loader (${instance.loader === 'vanilla' ? 'Vanilla' : instance.loader}) for Minecraft ${instance.mcVersion}`
      )
    )
    let versionId: string
    try {
      versionId = await resolveVersionId(instance)
      const versionFile = join(paths.version(versionId), `${versionId}.json`)

      if (!existsSync(versionFile) && instance.loader !== 'vanilla') {
        repairLog(instanceId, 'warning', tr(`${instance.loader}-Profil fehlt oder ist unvollständig`, `${instance.loader} profile is missing or incomplete`))
        task.update(tr('Mod Loader wird neu installiert…', 'Reinstalling mod loader…'), 0.1)
        repairLog(instanceId, 'fix', tr(`Installiere ${instance.loader} neu`, `Reinstalling ${instance.loader}`))
        versionId = await installLoader(instance.loader, instance.mcVersion, instance.loaderVersion, task)
        step(tr('Mod Loader', 'Mod loader'), 'repaired', tr(`${instance.loader} neu installiert`, `${instance.loader} reinstalled`))
      } else {
        step(tr('Mod Loader', 'Mod loader'), 'ok', instance.loader === 'vanilla' ? 'Vanilla' : tr(`${instance.loader} vorhanden`, `${instance.loader} present`))
      }
    } catch (err) {
      // Reported and returned, not rethrown. Throwing here discarded the whole
      // report including the steps that had already succeeded, so the user saw
      // a bare error toast instead of "folder layout fine, loader broken".
      // Everything below needs a resolved version, so this is the end of the
      // line either way. A cancellation is the one exception: it must end the
      // whole task as cancelled, not as a failed "Mod Loader" step.
      rethrowIfCancelled(err)
      step(tr('Mod Loader', 'Mod loader'), 'failed', err instanceof Error ? err.message : String(err))
      return report
    }

    // 3. Minecraft files ----------------------------------------------
    task.update(tr('Minecraft-Dateien werden geprüft…', 'Checking Minecraft files…'), 0.15)
    repairLog(instanceId, 'check', tr(`Überprüfe Minecraft-Version: ${instance.mcVersion}`, `Checking Minecraft version: ${instance.mcVersion}`))

    let versionJson: VersionJson
    let versionJsonRebuilt = false
    try {
      // Only its existence was checked above. A truncated or half-written
      // version JSON passed that check and then blew up here with a raw
      // SyntaxError, taking the entire repair down with it.
      versionJson = await loadVersionJson(versionId)
    } catch (err) {
      rethrowIfCancelled(err)
      if (!(err instanceof SyntaxError)) {
        step(
          tr('Minecraft & Bibliotheken', 'Minecraft & libraries'),
          'failed',
          tr(`Die Versionsdatei ${versionId}.json ist unbrauchbar: `, `The version file ${versionId}.json is unusable: `) +
            (err instanceof Error ? err.message : String(err))
        )
        return report
      }

      // Present but corrupt, not missing, so step 2's existence check let it
      // through. Removing it and rebuilding once recovers the same way a
      // missing file already does, instead of failing the whole repair over
      // damage a plain reinstall would fix without anyone noticing.
      repairLog(instanceId, 'warning', tr(`Versionsdatei ${versionId}.json ist beschädigt`, `Version file ${versionId}.json is damaged`))
      // Rebuilding reruns the loader installer, which rewrites shared library
      // jars; a running instance on the same version has those open.
      if (activeVersionIds().includes(versionId) || isNativesClaimed(versionId)) {
        step(
          tr('Minecraft & Bibliotheken', 'Minecraft & libraries'),
          'failed',
          tr(
            `Die Versionsdatei ${versionId}.json ist beschädigt. Sie wird nicht neu erstellt, solange eine andere Instanz mit derselben Version läuft. Beende sie und starte die Reparatur erneut.`,
            `The version file ${versionId}.json is damaged. It is not rebuilt while another instance with the same version is running. Close it and start the repair again.`
          )
        )
        return report
      }
      try {
        rmSync(join(paths.version(versionId), `${versionId}.json`), { force: true })
        if (instance.loader !== 'vanilla') {
          versionId = await installLoader(instance.loader, instance.mcVersion, instance.loaderVersion, task)
        }
        versionJson = await loadVersionJson(versionId)
        versionJsonRebuilt = true
      } catch (retryErr) {
        rethrowIfCancelled(retryErr)
        step(
          tr('Minecraft & Bibliotheken', 'Minecraft & libraries'),
          'failed',
          tr(
            `Die Versionsdatei ${versionId}.json war beschädigt und konnte nicht neu erstellt werden: `,
            `The version file ${versionId}.json was damaged and could not be rebuilt: `
          ) +
            (retryErr instanceof Error ? retryErr.message : String(retryErr))
        )
        return report
      }
    }

    const items: DownloadItem[] = []
    const client = versionJson.downloads?.client
    if (client) {
      items.push({
        url: client.url,
        path: clientJarPath(instance.mcVersion),
        sha1: client.sha1,
        size: client.size
      })
    }
    for (const library of resolveLibraries(versionJson)) {
      if (library.download) items.push(library.download)
    }

    // The client jar, the libraries and the natives folder belong to the
    // *version*, not to this instance — a second instance on the same version
    // may have them open right now. Deleting and re-fetching them underneath a
    // running game pulls loaded jars and DLLs away mid-session, so those steps
    // stand down rather than break someone else's session.
    // Re-read at each point of use rather than captured once. The download
    // steps between here and the natives can run for minutes, and an instance
    // started in that window would otherwise still look idle.
    //
    // `activeVersionIds()` alone is not enough: it only fills in once
    // `launchInstance` reaches `setRunning`, but `launch.ts` claims a version's
    // natives folder (`claimNatives`) far earlier, before it even extracts
    // into it. An instance still in that window looks idle here and had its
    // shared natives folder wiped out from under it by this very step.
    // `isNativesClaimed` covers that gap the same way `nativesClaims` covers
    // it for a second launch of the same version.
    const versionInUse = (): boolean => activeVersionIds().includes(versionId) || isNativesClaimed(versionId)

    const rebuiltNote = versionJsonRebuilt
      ? tr(`Versionsdatei ${versionId}.json war beschädigt und wurde neu erstellt. `, `Version file ${versionId}.json was damaged and has been rebuilt. `)
      : ''

    if (versionInUse()) {
      step(
        tr('Minecraft & Bibliotheken', 'Minecraft & libraries'),
        versionJsonRebuilt ? 'repaired' : 'failed',
        rebuiltNote + tr('Übersprungen: eine andere Instanz mit derselben Version läuft gerade.', 'Skipped: another instance with the same version is running right now.')
      )
    } else {
      // Items without a hash have nothing `isSatisfied` can verify but existence, so a
      // library jar corrupted after being written (e.g. cut off mid-extraction of
      // something else in the same folder) would otherwise pass every check below. A
      // jar that does not even open as a zip is removed here so the download loop
      // treats it like a missing file instead of trusting it as-is.
      for (const item of items) {
        if (item.sha1 || !item.path.toLowerCase().endsWith('.jar') || !existsSync(item.path)) continue
        if (!jarLooksIntact(item.path)) rmSync(item.path, { force: true })
      }

      let broken = 0
      for (const item of items) {
        report.checkedFiles++
        if (!(await isSatisfied(item))) broken++
      }

      if (broken > 0) {
        repairLog(instanceId, 'warning', tr(`${broken} von ${items.length} Dateien fehlen oder sind beschädigt`, `${broken} of ${items.length} files are missing or damaged`))
        repairLog(instanceId, 'fix', tr('Lade fehlende oder beschädigte Dateien erneut', 'Downloading missing or damaged files again'))
      }

      // Deliberately no rmSync beforehand. downloadAll verifies each file
      // itself and only fetches the ones that fail, and it writes through a
      // temp file it renames into place — so a broken file is replaced, never
      // merely removed. Deleting first meant an interrupted batch left the
      // client jar gone for good, which is exactly the failure mode the
      // content step was already fixed for.
      try {
        task.span(0.15, 0.55)
        await downloadAll(items, { task, label: tr('Beschädigte Dateien', 'Damaged files') })
        report.repairedFiles += broken
        step(
          tr('Minecraft & Bibliotheken', 'Minecraft & libraries'),
          broken > 0 || versionJsonRebuilt ? 'repaired' : 'ok',
          rebuiltNote +
            (broken > 0
              ? tr(`${broken} von ${items.length} Dateien erneuert`, `${broken} of ${items.length} files replaced`)
              : tr(`${items.length} Dateien in Ordnung`, `${items.length} files OK`))
        )
      } catch (err) {
        // Reported, not thrown: assets, mods and Java can still be checked and
        // the user gets a report saying which part failed. A cancellation is
        // the exception, it must end the whole task, not just this step.
        rethrowIfCancelled(err)
        step(
          tr('Minecraft & Bibliotheken', 'Minecraft & libraries'),
          'failed',
          rebuiltNote + (err instanceof Error ? err.message : String(err))
        )
      } finally {
        task.span(0, 1)
      }
    }

    // 4. Assets --------------------------------------------------------
    task.update(tr('Assets werden geprüft…', 'Checking assets…'), 0.6)
    repairLog(instanceId, 'check', tr('Überprüfe Spiel-Assets', 'Checking game assets'))
    if (versionInUse()) {
      // installVersion re-fetches the client jar and every library alongside
      // the assets, the same shared files step 3 stands down from. Skipping
      // that check here would have written them under a running game anyway.
      step(tr('Spiel-Assets', 'Game assets'), 'failed', tr('Übersprungen: eine andere Instanz mit derselben Version läuft gerade.', 'Skipped: another instance with the same version is running right now.'))
    } else {
      task.span(0.6, 0.8)
      try {
        await installVersion(versionJson, instance.mcVersion, task)
        step(tr('Spiel-Assets', 'Game assets'), 'ok', tr('Vollständig', 'Complete'))
      } catch (err) {
        rethrowIfCancelled(err)
        step(tr('Spiel-Assets', 'Game assets'), 'failed', err instanceof Error ? err.message : String(err))
      } finally {
        task.span(0, 1)
      }
    }

    // 5. Natives -------------------------------------------------------
    task.throwIfCancelled()
    task.update(tr('Natives werden erneuert…', 'Renewing natives…'), 0.82)
    repairLog(instanceId, 'check', tr('Überprüfe native Bibliotheken', 'Checking native libraries'))
    if (versionInUse()) {
      step('Natives', 'failed', tr('Übersprungen: eine andere Instanz mit derselben Version läuft gerade.', 'Skipped: another instance with the same version is running right now.'))
    } else {
      try {
        rmSync(paths.natives(versionId), { recursive: true, force: true })
        mkdirSync(paths.natives(versionId), { recursive: true })
        step('Natives', 'repaired', tr('Werden beim nächsten Start neu entpackt', 'Unpacked again on the next start'))
      } catch (err) {
        rethrowIfCancelled(err)
        step('Natives', 'failed', err instanceof Error ? err.message : String(err))
      }
    }

    // 6. Content files -------------------------------------------------
    task.throwIfCancelled()
    task.update(tr('Mods werden geprüft…', 'Checking mods…'), 0.86)

    let restored = 0
    let removed = 0
    let duplicatesRemoved = 0
    let incompatible = 0
    let contentCount = 0
    const failed: string[] = []
    // Set when the step's own bookkeeping (the disk sync or the final save)
    // breaks, as opposed to a single mod, so the "report, do not throw" rule
    // still holds and steps 7 and 8 still run afterwards.
    let contentStepError: string | undefined

    // Held for the whole step, the same marker `content.ts` takes for its own
    // work. Repair rewrites the same folder and the same record, and it was
    // the one path that never announced itself: the disk reconciler counted a
    // half downloaded replacement as an unknown extra mod, a launch could
    // start into the folder mid rewrite, and the mod buttons stayed enabled.
    await withContentLock(instanceId, async () => {
      try {
        await syncContentWithDisk(instanceId)
      } catch (err) {
        rethrowIfCancelled(err)
        contentStepError = tr(
          `Abgleich mit dem Dateisystem fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          `Syncing with the file system failed: ${err instanceof Error ? err.message : String(err)}`
        )
        return
      }

      // Two records for the same project, one of them stale. This is the
      // shape the old race in `removeContent` left behind: an update
      // downloaded the new file and wrote its record, a disk scan landed in
      // the gap before the old file was gone and registered it as a second,
      // unrelated mod. That race is closed now, but a folder it already hit
      // still carries the leftover, so repair cleans up after it here rather
      // than leaving it for the user to notice and sort out by hand.
      // Resolved before anything below takes its own snapshot of the list, so
      // the rest of this step only ever sees the deduplicated set.
      for (const item of findDuplicateContent(getInstance(instanceId).content)) {
        task.throwIfCancelled()
        try {
          await removeContent(instanceId, item.id)
          duplicatesRemoved++
          logger.info(`Doppelten Mod ${item.name} (${item.fileName}) entfernt`)
        } catch (err) {
          rethrowIfCancelled(err)
          logger.warn(`Doppelter Mod ${item.name} konnte nicht entfernt werden:`, err)
        }
      }

      const current = getInstance(instanceId)
      const survivors = [...current.content]
      contentCount = current.content.length
      repairLog(instanceId, 'check', tr(`Analysiere ${contentCount} installierte Mods`, `Analyzing ${contentCount} installed mods`))
      // What the list looked like before the downloads below, which take
      // seconds to minutes. Used at the end to tell our own changes apart from
      // someone else's.
      const before = new Map(current.content.map((item) => [item.id, item]))

      for (const item of current.content) {
        task.throwIfCancelled()
        const file = contentFilePath(instanceId, item)
        report.checkedFiles++

        const missing = !existsSync(file)
        let corrupt = false
        if (!missing) {
          if (item.sha1) {
            try {
              corrupt = (await sha1File(file)) !== item.sha1.toLowerCase()
            } catch {
              corrupt = true
            }
          } else if (item.size !== undefined) {
            // No hash to check, but a known size: a mismatch is still a plain
            // signal something went wrong, usually an interrupted write.
            try {
              corrupt = statSync(file).size !== item.size
            } catch {
              corrupt = true
            }
          }
          // Neither check above rules out a jar that silently truncated at a
          // point that happens to match its expected size. Anything ending in
          // .jar without a hash gets one more look: it must at least open as
          // a zip.
          if (!corrupt && !item.sha1 && file.toLowerCase().endsWith('.jar')) {
            corrupt = !jarLooksIntact(file)
          }
        }

        if (!missing && !corrupt) continue

        repairLog(
          instanceId,
          'warning',
          tr(
            `${item.name} ${missing ? 'fehlt' : 'scheint beschädigt zu sein'} (${item.fileName})`,
            `${item.name} ${missing ? 'is missing' : 'seems to be damaged'} (${item.fileName})`
          )
        )

        if (item.provider === 'local' || !item.projectId) {
          if (missing) {
            survivors.splice(survivors.indexOf(item), 1)
            removed++
            repairLog(
              instanceId,
              'fix',
              tr(`${item.name} ist eine lokale Datei ohne bekannte Quelle, Eintrag entfernt`, `${item.name} is a local file with no known source, entry removed`)
            )
          } else {
            // Present but corrupt, with no known source to re-download from:
            // there is nothing here that can be fixed automatically. This
            // used to fall straight through to the next item, counted
            // nowhere, so the file stayed broken on disk while the final
            // report still had no reason to say anything had gone wrong.
            failed.push(item.name)
            repairLog(
              instanceId,
              'warning',
              tr(
                `${item.name} ist eine lokale Datei ohne bekannte Quelle und lässt sich nicht automatisch reparieren`,
                `${item.name} is a local file with no known source and cannot be repaired automatically`
              )
            )
          }
          continue
        }

        try {
          const version = await bestVersionFor(
            item.provider as 'modrinth' | 'curseforge',
            item.projectId,
            current.mcVersion,
            current.loader
          )
          if (!version) {
            // Not silently skipped: a mod nobody publishes a matching build for
            // (wrong Minecraft version, wrong loader, or pulled entirely) is
            // exactly the "offensichtlich inkompatibel" case this is meant to
            // surface, not something to quietly leave broken with no reason
            // given.
            incompatible++
            repairLog(
              instanceId,
              'warning',
              tr(
                `Keine passende Version von ${item.name} für Minecraft ${current.mcVersion} (${current.loader}) gefunden`,
                `No matching version of ${item.name} found for Minecraft ${current.mcVersion} (${current.loader})`
              )
            )
            continue
          }

          repairLog(
            instanceId,
            'check',
            tr(
              `Ersatz für ${item.name} passt zu Minecraft ${current.mcVersion} und ${current.loader}: Version ${version.versionNumber}`,
              `Replacement for ${item.name} fits Minecraft ${current.mcVersion} and ${current.loader}: version ${version.versionNumber}`
            )
          )

          const target = contentFilePath(instanceId, { ...item, fileName: version.fileName })
          const aside = `${file}.repair-${process.pid}`
          let movedAside = false

          try {
            // Moved aside instead of deleted. The previous order removed the file
            // first and only logged on failure, so a network drop between the two
            // left the mod gone from disk while content.json still listed it as
            // installed. Now the original is only dropped once its replacement is
            // safely written, and comes back if anything goes wrong.
            if (existsSync(file)) {
              renameSync(file, aside)
              movedAside = true
            }

            repairLog(instanceId, 'fix', tr(`Lade ${version.fileName}`, `Downloading ${version.fileName}`))
            await downloadFile(
              {
                url: version.downloadUrl,
                path: target,
                sha1: version.sha1,
                size: version.size
              },
              undefined,
              3,
              task.signal
            )

            // downloadFile already refuses to finish on a hash mismatch, so this
            // is a second, independent look rather than the only one — the
            // point is for the log to say plainly that the new file was
            // checked, not just that a download call returned.
            repairLog(instanceId, 'verify', tr(`Überprüfe ${version.fileName}`, `Checking ${version.fileName}`))
            if (!existsSync(target)) {
              throw new Error(tr(`${version.fileName} fehlt nach dem Download`, `${version.fileName} is missing after the download`))
            }
            const actualHash = await sha1File(target)
            if (version.sha1 && actualHash.toLowerCase() !== version.sha1.toLowerCase()) {
              throw new Error(tr(`${version.fileName} hat nach dem Download eine falsche Prüfsumme`, `${version.fileName} has a wrong checksum after the download`))
            }

            if (movedAside) rmSync(aside, { force: true })

            const index = survivors.indexOf(item)
            survivors[index] = {
              ...item,
              fileName: version.fileName,
              sha1: version.sha1,
              size: version.size
            }
            restored++
            repairLog(instanceId, 'success', tr(`${version.fileName} erfolgreich repariert`, `${version.fileName} repaired successfully`))
          } catch (err) {
            if (movedAside && !existsSync(file)) {
              try {
                renameSync(aside, file)
              } catch (restoreErr) {
                logger.error(`${item.name} konnte nicht zurueckgelegt werden:`, restoreErr)
              }
            }
            throw err
          }
        } catch (err) {
          // A cancellation must end the whole task, not count as one more
          // mod the repair failed to restore.
          rethrowIfCancelled(err)
          // Counted, not just logged: a mod the repair could not restore has to
          // show up in the report, otherwise the user is told everything is fine
          // while a mod is still broken.
          failed.push(item.name)
          const message = err instanceof Error ? err.message : String(err)
          logger.warn(`${item.name} konnte nicht wiederhergestellt werden:`, err)
          repairLog(instanceId, 'error', tr(`${item.name} konnte nicht repariert werden: ${message}`, `${item.name} could not be repaired: ${message}`))
        }
      }

      // Merged into the current list, not written over it. This used to
      // persist `survivors` wholesale, so a mod installed while the repair was
      // downloading lost its entry the moment the repair finished: the file
      // stayed on disk and came back later as an unknown local mod with no
      // provider and no version. Entries someone else touched in the meantime
      // are left exactly as they are; only untouched ones follow our decision.
      const decided = new Map(survivors.map((item) => [item.id, item]))
      const latest = getInstance(instanceId)
      const merged: ContentItem[] = []

      for (const item of latest.content) {
        const original = before.get(item.id)
        // Added or changed by someone else while we worked: not ours to judge.
        if (!original || !unchanged(original, item)) {
          merged.push(item)
          continue
        }
        const decision = decided.get(item.id)
        // Absent from `survivors` means the repair dropped it as orphaned.
        if (decision) merged.push(decision)
      }

      try {
        persist({ ...latest, content: merged })
      } catch (err) {
        rethrowIfCancelled(err)
        contentStepError = tr(
          `Änderungen konnten nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
          `Changes could not be saved: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    })
    report.repairedFiles += restored

    // Refreshed after the restoration above has already settled, so this
    // reads the repaired list rather than racing its own persist against it.
    let outdated = 0
    try {
      const withUpdates = await checkUpdates(instanceId)
      outdated = withUpdates.content.filter((c) => c.update).length
    } catch (err) {
      logger.warn(`Update-Prüfung während der Reparatur übersprungen:`, err)
    }

    if (contentStepError) {
      step(tr('Mods & Inhalte', 'Mods & content'), 'failed', contentStepError)
    } else {
      const changed = restored > 0 || removed > 0 || duplicatesRemoved > 0
      const unresolved = failed.length > 0 || incompatible > 0
      const parts = [
        ...(duplicatesRemoved > 0 ? [tr(`${duplicatesRemoved} doppelt installierte entfernt`, `${duplicatesRemoved} duplicates removed`)] : []),
        tr(`${restored} neu geladen`, `${restored} downloaded again`),
        tr(`${removed} verwaiste Einträge entfernt`, `${removed} orphaned entries removed`),
        ...(incompatible > 0
          ? [tr(`${incompatible} inkompatibel (keine passende Version gefunden)`, `${incompatible} incompatible (no matching version found)`)]
          : []),
        ...(outdated > 0
          ? [
              tr(
                `${outdated} ${outdated === 1 ? 'veraltete Mod' : 'veraltete Mods'} gefunden`,
                `${outdated} ${outdated === 1 ? 'outdated mod' : 'outdated mods'} found`
              )
            ]
          : [])
      ]
      step(
        tr('Mods & Inhalte', 'Mods & content'),
        unresolved ? 'failed' : changed ? 'repaired' : 'ok',
        failed.length > 0
          ? tr(
              `${parts.join(', ')}, ${failed.length} fehlgeschlagen: ${failed.slice(0, 3).join(', ')}` + (failed.length > 3 ? ' und weitere' : ''),
              `${parts.join(', ')}, ${failed.length} failed: ${failed.slice(0, 3).join(', ')}` + (failed.length > 3 ? ' and more' : '')
            )
          : changed || unresolved
            ? parts.join(', ')
            : outdated > 0
              ? tr(`${contentCount} Dateien in Ordnung, ${parts[parts.length - 1]}`, `${contentCount} files OK, ${parts[parts.length - 1]}`)
              : tr(`${contentCount} Dateien in Ordnung`, `${contentCount} files OK`)
      )
    }

    // 7. Java ----------------------------------------------------------
    task.update(tr('Java wird geprüft…', 'Checking Java…'), 0.95)
    repairLog(instanceId, 'check', tr('Überprüfe Java', 'Checking Java'))
    try {
      // Re-read rather than the `instance` captured at the very start of this
      // function: a repair can run for minutes, and `instance.settings` is
      // otherwise unguarded against being changed while it is in progress
      // (`updateInstance` checks no repair lock). A Java path or version
      // override changed mid-repair was checked against the value it had
      // when the repair began, not the one actually saved, and could report
      // "Java fine" for a setting that was never really checked.
      const current = getInstance(instanceId)
      const major = current.settings.javaMajorOverride ?? requiredJavaMajor(versionJson, current.mcVersion)
      const explicitJavaPath = current.settings.javaPath || undefined
      if (explicitJavaPath) {
        await ensureJavaPathApproved(instanceId, current.name, explicitJavaPath)
      }
      const java = await resolveJava({
        explicitPath: explicitJavaPath,
        major,
        autoManage: getSettings().javaAutoManage,
        task,
        instanceId: current.id
      })
      step('Java', 'ok', `Java ${java.major} (${java.version})`)
    } catch (err) {
      rethrowIfCancelled(err)
      step('Java', 'failed', err instanceof Error ? err.message : String(err))
    }

    // 8. Corrupt logs / crash leftovers --------------------------------
    task.throwIfCancelled()
    task.update(tr('Aufräumen…', 'Cleaning up…'), 0.99)
    // Was performed but never reported: the function ran eight steps and the
    // report only ever listed seven, so the user never learned whether
    // anything was swept up or whether the sweep itself failed.
    try {
      const swept = await cleanTempFiles(instanceId)
      step(
        tr('Aufräumen', 'Cleanup'),
        swept > 0 ? 'repaired' : 'ok',
        swept > 0
          ? tr(
              `${swept} ${swept === 1 ? 'unterbrochener Download' : 'unterbrochene Downloads'} entfernt`,
              `${swept} ${swept === 1 ? 'interrupted download' : 'interrupted downloads'} removed`
            )
          : tr('Keine Reste gefunden', 'No leftovers found')
      )
    } catch (err) {
      rethrowIfCancelled(err)
      step(tr('Aufräumen', 'Cleanup'), 'failed', err instanceof Error ? err.message : String(err))
    }

    // Computed before the write below, not after: this used to persist
    // `installed: true` unconditionally and only check for a failed step
    // afterwards, purely to decide which log line to print. A repair that
    // hit a real failure, a network drop mid-download, unresolvable assets,
    // Java not found, was then marked fully installed anyway, contradicting
    // its own report. Left unchanged rather than forced to `false`: a repair
    // with one failed step does not mean an instance that installed cleanly
    // before is now uninstalled.
    const anyFailed = report.steps.some((s) => s.status === 'failed')
    persist({ ...getInstance(instanceId), installed: anyFailed ? getInstance(instanceId).installed : true })
    repairLog(
      instanceId,
      anyFailed ? 'warning' : 'success',
      anyFailed
        ? tr('Einige Probleme konnten nicht automatisch behoben werden', 'Some problems could not be fixed automatically')
        : tr('Reparatur erfolgreich', 'Repair successful')
    )

    task.update('Reparatur abgeschlossen', 1)
    return report
  })
}

/**
 * Removes leftovers from interrupted downloads and crashed sessions.
 *
 * The shared folders are swept too, not just the instance's own: `fetchToFile`
 * writes its `.part` files next to the destination, and the bulk of those
 * destinations are the shared libraries, assets and version trees. Quitting or
 * crashing mid-install used to strand them there with no code path — automatic
 * or manual — that would ever remove them.
 */
/**
 * Age below which a temp file is assumed to belong to a download still running.
 *
 * These trees are shared between every instance, so this sweep can run while
 * another instance is mid-install. Deleting a `.part` file out from under an
 * active transfer makes its final rename fail with ENOENT — a repair of one
 * instance breaking the install of a completely different one. Anything this
 * old is from a process that is long gone.
 */
const TEMP_MIN_AGE_MS = 30 * 60 * 1000

export async function cleanTempFiles(instanceId?: string): Promise<number> {
  const roots = [paths.libraries(), paths.assets(), paths.versions(), paths.cache()]
  if (instanceId) roots.unshift(paths.gameDir(instanceId))
  const cutoff = Date.now() - TEMP_MIN_AGE_MS

  let removed = 0
  const stack = [...roots]

  // Same reasoning as `totalDiskUsage`: this walks the shared library, asset
  // and version trees, and it runs unprompted about a second after every
  // single start of the launcher. Synchronously, that was a freeze on the way
  // in for anyone with a well-used data folder.
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue

    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (entry.name.endsWith('.part') || entry.name.endsWith('.tmp')) {
          try {
            if ((await stat(full)).mtimeMs > cutoff) continue
            rmSync(full, { force: true })
            removed++
          } catch {
            // Vanished on its own, or a download still holds it open.
          }
        }
      }
    } catch {
      // unreadable or missing directory
    }
  }
  return removed
}

/** Disk usage of the whole launcher data folder, for the settings screen. */
export async function totalDiskUsage(): Promise<number> {
  let total = 0
  const stack = [paths.root()]

  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue

    try {
      // Asynchronous on purpose, and the difference is not cosmetic. The
      // synchronous version walked every instance, every shared library and
      // the whole asset tree — tens of thousands of files for one Minecraft
      // version alone — without letting the event loop breathe once. The whole
      // window froze, and this runs on the home screen after every session, so
      // it was not a rare event. Each await here is a chance for the interface
      // to stay alive.
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
        } else {
          try {
            total += (await stat(full)).size
          } catch {
            // file vanished mid-walk
          }
        }
      }
    } catch {
      // unreadable or missing directory
    }
  }
  return total
}
