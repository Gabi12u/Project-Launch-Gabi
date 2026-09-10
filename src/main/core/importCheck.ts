/**
 * Checks an instance right after it was imported.
 *
 * An import used to end at "files copied": whether the result could actually
 * start was left for the user to find out by pressing Play. The pieces to
 * answer that already exist and are only put together here, so a freshly
 * imported instance says up front what is missing rather than failing later
 * with a stack trace from the game.
 *
 * Everything in here is read-only. A check that repaired what it found would
 * hide exactly the problem it is meant to report.
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ImportCheck, ImportFinding } from '@shared/types'
import { paths } from '../paths'
import { log } from '../logger'
import { getInstance, resolveVersionId, syncContentWithDisk } from './instances'
import { checkCompatibility } from './compat'
import { clientJarPath, loadVersionJson } from './mojang'

const logger = log('import-check')

/** True when a jar exists and is not an empty or obviously truncated file. */
function jarLooksReal(file: string): boolean {
  try {
    // A jar is a zip: four bytes of header plus a central directory. Anything
    // under a kilobyte is a failed download, not a game.
    return existsSync(file) && statSync(file).size > 1024
  } catch {
    return false
  }
}

export async function verifyImportedInstance(instanceId: string): Promise<ImportCheck> {
  const findings: ImportFinding[] = []
  let blocking = false

  const add = (level: ImportFinding['level'], title: string, detail?: string): void => {
    findings.push({ level, title, detail })
    if (level === 'blocker') blocking = true
  }

  const instance = getInstance(instanceId)

  /* 1. Is the version profile there and readable? --------------------- */
  let versionId: string | null = null
  try {
    versionId = await resolveVersionId(instance)
  } catch (err) {
    add(
      'blocker',
      'Die Minecraft-Version konnte nicht aufgelöst werden',
      err instanceof Error ? err.message : String(err)
    )
  }

  if (versionId) {
    try {
      const json = await loadVersionJson(versionId)
      if (!json) {
        add(
          'blocker',
          `Die Beschreibung der Version ${versionId} fehlt`,
          'Sie wird beim ersten Start automatisch nachgeladen.'
        )
      } else {
        add('ok', `Version ${instance.mcVersion} ist eingerichtet`)
      }
    } catch (err) {
      add(
        'warn',
        `Die Beschreibung der Version ${versionId} ist nicht lesbar`,
        err instanceof Error ? err.message : String(err)
      )
    }

    if (!jarLooksReal(clientJarPath(versionId))) {
      add(
        'warn',
        'Die Spieldatei fehlt noch',
        'Sie wird beim ersten Start heruntergeladen, das dauert dann etwas länger.'
      )
    }
  }

  /* 2. Does the loader match what was detected? ----------------------- */
  if (instance.loader !== 'vanilla') {
    const modsDir = paths.mods(instanceId)
    const hasMods = existsSync(modsDir)
    if (!instance.loaderVersion) {
      add(
        'warn',
        `Für ${instance.loader} ist keine Version hinterlegt`,
        'Der Launcher wählt beim ersten Start die neueste passende aus.'
      )
    } else {
      add('ok', `Mod-Loader ${instance.loader} ${instance.loaderVersion} ist eingetragen`)
    }
    if (!hasMods) {
      add('warn', 'Es gibt keinen mods-Ordner', 'Der Loader ist eingerichtet, aber es wurden keine Mods übernommen.')
    }
  }

  /* 3. Are the mods where they belong and recorded? ------------------- */
  try {
    await syncContentWithDisk(instanceId)
    const fresh = getInstance(instanceId)
    const mods = fresh.content.filter((item) => item.type === 'mod')
    if (mods.length > 0) {
      add('ok', `${mods.length} Mods erfasst`)
      const missing = mods.filter((item) => !existsSync(join(paths.mods(instanceId), item.fileName)))
      if (missing.length > 0) {
        add(
          'warn',
          `${missing.length} eingetragene Mods liegen nicht im Ordner`,
          missing
            .slice(0, 5)
            .map((item) => item.name)
            .join(', ')
        )
      }
    }
  } catch (err) {
    add('warn', 'Die Mods konnten nicht erfasst werden', err instanceof Error ? err.message : String(err))
  }

  /* 4. Anything that would stop the launch? --------------------------- */
  try {
    const report = await checkCompatibility(instanceId)
    const errors = report.issues.filter((issue) => issue.severity === 'error')
    const warnings = report.issues.filter((issue) => issue.severity === 'warning')

    for (const issue of errors.slice(0, 5)) add('blocker', issue.title, issue.detail)
    if (errors.length > 5) {
      add('blocker', `${errors.length - 5} weitere Probleme`, 'Vollständig unter "Kompatibilität" bei der Instanz.')
    }
    if (warnings.length > 0) {
      add(
        'warn',
        `${warnings.length} Hinweise zur Kompatibilität`,
        'Kein Hindernis für den Start, nachzulesen bei der Instanz.'
      )
    }
    if (errors.length === 0 && warnings.length === 0) {
      add('ok', 'Keine Kompatibilitätsprobleme gefunden')
    }
  } catch (err) {
    // A failing compatibility check says nothing about the import itself.
    logger.warn(`Kompatibilitätsprüfung nach dem Import von ${instanceId} fehlgeschlagen:`, err)
    add('warn', 'Die Kompatibilität konnte nicht geprüft werden')
  }

  return {
    instanceId,
    checkedAt: Date.now(),
    findings,
    looksStartable: !blocking
  }
}
