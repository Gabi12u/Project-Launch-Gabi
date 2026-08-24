import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureInstanceLayout, paths } from '../paths'
import { getSettings } from '../store'
import { log } from '../logger'
import { withTask } from '../tasks'
import { downloadAll, downloadFile, isSatisfied, sha1File, type DownloadItem } from './net'
import { clientJarPath, installVersion, loadVersionJson, resolveLibraries , type VersionJson } from './mojang'
import { requiredJavaMajor, resolveJava } from './java'
import { getInstance, persist, resolveVersionId, syncContentWithDisk } from './instances'
import { contentFilePath } from './content'
import { bestVersionFor } from '../providers'
import { installLoader } from '../loaders'
import { activeVersionIds, isRunning } from './running'

const logger = log('repair')

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
 */
/**
 * Instances with a repair in progress.
 *
 * The renderer's own "wird repariert" flag lives in component state and is
 * lost the moment the user navigates away, which re-enables the button while
 * the run is still going. Two runs then delete and re-download the same paths
 * and both write the instance record at the end, so whichever finishes last
 * silently discards the other's work.
 */
const repairing = new Set<string>()

/** True while a repair is running, so a launch can refuse to start on top. */
export function isRepairing(instanceId: string): boolean {
  return repairing.has(instanceId)
}

export async function repairInstance(instanceId: string): Promise<RepairReport> {
  if (isRunning(instanceId)) {
    throw new Error('Die Instanz läuft gerade. Beende Minecraft, bevor du sie reparierst.')
  }

  if (repairing.has(instanceId)) {
    throw new Error('Diese Instanz wird bereits repariert. Warte, bis das abgeschlossen ist.')
  }

  const instance = getInstance(instanceId)

  // The install started in the background at creation time downloads the very
  // files this would verify and delete, and both write the instance record at
  // the end — the loser's `installed` flag then describes the other one's work.
  if (instance.installing) {
    throw new Error('Diese Instanz wird gerade eingerichtet. Warte, bis das abgeschlossen ist.')
  }

  repairing.add(instanceId)
  try {
    return await runRepair(instanceId, instance)
  } finally {
    repairing.delete(instanceId)
  }
}

async function runRepair(
  instanceId: string,
  instance: ReturnType<typeof getInstance>
): Promise<RepairReport> {
  return withTask(`${instance.name} wird repariert`, 'Prüfung startet…', instanceId, async (task) => {
    const report: RepairReport = {
      instanceId,
      checkedFiles: 0,
      repairedFiles: 0,
      steps: []
    }

    const step = (label: string, status: 'ok' | 'repaired' | 'failed', detail: string): void => {
      report.steps.push({ label, status, detail })
      logger.info(`[${status}] ${label}: ${detail}`)
    }

    // 1. Folder layout ------------------------------------------------
    task.update('Ordnerstruktur wird geprüft…', 0.02)
    const missingFolders = [paths.gameDir(instanceId), paths.mods(instanceId), paths.saves(instanceId)].filter(
      (dir) => !existsSync(dir)
    )
    ensureInstanceLayout(instanceId)
    step(
      'Ordnerstruktur',
      missingFolders.length > 0 ? 'repaired' : 'ok',
      missingFolders.length > 0 ? `${missingFolders.length} Ordner neu angelegt` : 'Vollständig'
    )

    // 2. Mod loader ---------------------------------------------------
    task.update('Mod Loader wird geprüft…', 0.08)
    let versionId: string
    try {
      versionId = await resolveVersionId(instance)
      const versionFile = join(paths.version(versionId), `${versionId}.json`)

      if (!existsSync(versionFile) && instance.loader !== 'vanilla') {
        task.update('Mod Loader wird neu installiert…', 0.1)
        versionId = await installLoader(instance.loader, instance.mcVersion, instance.loaderVersion, task)
        step('Mod Loader', 'repaired', `${instance.loader} neu installiert`)
      } else {
        step('Mod Loader', 'ok', instance.loader === 'vanilla' ? 'Vanilla' : `${instance.loader} vorhanden`)
      }
    } catch (err) {
      // Reported and returned, not rethrown. Throwing here discarded the whole
      // report including the steps that had already succeeded, so the user saw
      // a bare error toast instead of "folder layout fine, loader broken".
      // Everything below needs a resolved version, so this is the end of the
      // line either way.
      step('Mod Loader', 'failed', err instanceof Error ? err.message : String(err))
      return report
    }

    // 3. Minecraft files ----------------------------------------------
    task.update('Minecraft-Dateien werden geprüft…', 0.15)

    let versionJson: VersionJson
    try {
      // Only its existence was checked above. A truncated or half-written
      // version JSON passed that check and then blew up here with a raw
      // SyntaxError, taking the entire repair down with it.
      versionJson = await loadVersionJson(versionId)
    } catch (err) {
      step(
        'Minecraft & Bibliotheken',
        'failed',
        `Die Versionsdatei ${versionId}.json ist unbrauchbar: ` +
          (err instanceof Error ? err.message : String(err))
      )
      return report
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
    const versionInUse = (): boolean => activeVersionIds().includes(versionId)

    if (versionInUse()) {
      step(
        'Minecraft & Bibliotheken',
        'failed',
        'Übersprungen: eine andere Instanz mit derselben Version läuft gerade.'
      )
    } else {
      let broken = 0
      for (const item of items) {
        report.checkedFiles++
        if (!(await isSatisfied(item))) broken++
      }

      // Deliberately no rmSync beforehand. downloadAll verifies each file
      // itself and only fetches the ones that fail, and it writes through a
      // temp file it renames into place — so a broken file is replaced, never
      // merely removed. Deleting first meant an interrupted batch left the
      // client jar gone for good, which is exactly the failure mode the
      // content step was already fixed for.
      try {
        task.span(0.15, 0.55)
        await downloadAll(items, { task, label: 'Beschädigte Dateien' })
        report.repairedFiles += broken
        step(
          'Minecraft & Bibliotheken',
          broken > 0 ? 'repaired' : 'ok',
          broken > 0
            ? `${broken} von ${items.length} Dateien erneuert`
            : `${items.length} Dateien in Ordnung`
        )
      } catch (err) {
        // Reported, not thrown: assets, mods and Java can still be checked and
        // the user gets a report saying which part failed.
        step(
          'Minecraft & Bibliotheken',
          'failed',
          err instanceof Error ? err.message : String(err)
        )
      } finally {
        task.span(0, 1)
      }
    }

    // 4. Assets --------------------------------------------------------
    task.update('Assets werden geprüft…', 0.6)
    if (versionInUse()) {
      // installVersion re-fetches the client jar and every library alongside
      // the assets, the same shared files step 3 stands down from. Skipping
      // that check here would have written them under a running game anyway.
      step('Spiel-Assets', 'failed', 'Übersprungen: eine andere Instanz mit derselben Version läuft gerade.')
    } else {
      task.span(0.6, 0.8)
      try {
        await installVersion(versionJson, instance.mcVersion, task)
        step('Spiel-Assets', 'ok', 'Vollständig')
      } catch (err) {
        step('Spiel-Assets', 'failed', err instanceof Error ? err.message : String(err))
      } finally {
        task.span(0, 1)
      }
    }

    // 5. Natives -------------------------------------------------------
    task.update('Natives werden erneuert…', 0.82)
    if (versionInUse()) {
      step('Natives', 'failed', 'Übersprungen: eine andere Instanz mit derselben Version läuft gerade.')
    } else {
      rmSync(paths.natives(versionId), { recursive: true, force: true })
      mkdirSync(paths.natives(versionId), { recursive: true })
      step('Natives', 'repaired', 'Werden beim nächsten Start neu entpackt')
    }

    // 6. Content files -------------------------------------------------
    task.update('Mods werden geprüft…', 0.86)
    await syncContentWithDisk(instanceId)
    const current = getInstance(instanceId)

    let restored = 0
    let removed = 0
    const failed: string[] = []
    const survivors = [...current.content]

    for (const item of current.content) {
      const file = contentFilePath(instanceId, item)
      report.checkedFiles++

      const missing = !existsSync(file)
      let corrupt = false
      if (!missing && item.sha1) {
        try {
          corrupt = (await sha1File(file)) !== item.sha1.toLowerCase()
        } catch {
          corrupt = true
        }
      }

      if (!missing && !corrupt) continue

      if (item.provider === 'local' || !item.projectId) {
        if (missing) {
          survivors.splice(survivors.indexOf(item), 1)
          removed++
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
        if (!version) continue

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

          await downloadFile({
            url: version.downloadUrl,
            path: target,
            sha1: version.sha1,
            size: version.size
          })

          if (movedAside) rmSync(aside, { force: true })

          const index = survivors.indexOf(item)
          survivors[index] = {
            ...item,
            fileName: version.fileName,
            sha1: version.sha1,
            size: version.size
          }
          restored++
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
        // Counted, not just logged: a mod the repair could not restore has to
        // show up in the report, otherwise the user is told everything is fine
        // while a mod is still broken.
        failed.push(item.name)
        logger.warn(`${item.name} konnte nicht wiederhergestellt werden:`, err)
      }
    }

    persist({ ...getInstance(instanceId), content: survivors })
    report.repairedFiles += restored

    const changed = restored > 0 || removed > 0
    step(
      'Mods & Inhalte',
      failed.length > 0 ? 'failed' : changed ? 'repaired' : 'ok',
      failed.length > 0
        ? `${restored} neu geladen, ${removed} verwaiste Einträge entfernt, ` +
          `${failed.length} fehlgeschlagen: ${failed.slice(0, 3).join(', ')}` +
          (failed.length > 3 ? ' und weitere' : '')
        : changed
          ? `${restored} neu geladen, ${removed} verwaiste Einträge entfernt`
          : `${current.content.length} Dateien in Ordnung`
    )

    // 7. Java ----------------------------------------------------------
    task.update('Java wird geprüft…', 0.95)
    try {
      const major = instance.settings.javaMajorOverride ?? requiredJavaMajor(versionJson, instance.mcVersion)
      const java = await resolveJava({
        explicitPath: instance.settings.javaPath || undefined,
        major,
        autoManage: getSettings().javaAutoManage,
        task
      })
      step('Java', 'ok', `Java ${java.major} (${java.version})`)
    } catch (err) {
      step('Java', 'failed', err instanceof Error ? err.message : String(err))
    }

    // 8. Corrupt logs / crash leftovers --------------------------------
    task.update('Aufräumen…', 0.99)
    // Was performed but never reported: the function ran eight steps and the
    // report only ever listed seven, so the user never learned whether
    // anything was swept up or whether the sweep itself failed.
    try {
      const swept = cleanTempFiles(instanceId)
      step(
        'Aufräumen',
        swept > 0 ? 'repaired' : 'ok',
        swept > 0
          ? `${swept} ${swept === 1 ? 'unterbrochener Download' : 'unterbrochene Downloads'} entfernt`
          : 'Keine Reste gefunden'
      )
    } catch (err) {
      step('Aufräumen', 'failed', err instanceof Error ? err.message : String(err))
    }

    persist({ ...getInstance(instanceId), installed: true })

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

export function cleanTempFiles(instanceId?: string): number {
  const roots = [paths.libraries(), paths.assets(), paths.versions(), paths.cache()]
  if (instanceId) roots.unshift(paths.gameDir(instanceId))
  const cutoff = Date.now() - TEMP_MIN_AGE_MS

  let removed = 0
  const stack = [...roots]

  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir || !existsSync(dir)) continue

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (entry.name.endsWith('.part') || entry.name.endsWith('.tmp')) {
          try {
            if (statSync(full).mtimeMs > cutoff) continue
            rmSync(full, { force: true })
            removed++
          } catch {
            // Vanished on its own, or a download still holds it open.
          }
        }
      }
    } catch {
      // unreadable directory
    }
  }
  return removed
}

/** Disk usage of the whole launcher data folder, for the settings screen. */
export function totalDiskUsage(): number {
  let total = 0
  const stack = [paths.root()]

  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir || !existsSync(dir)) continue

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
        } else {
          try {
            total += statSync(full).size
          } catch {
            // file vanished mid-walk
          }
        }
      }
    } catch {
      // unreadable directory
    }
  }
  return total
}
