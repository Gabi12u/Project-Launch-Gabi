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
import { tr } from '@shared/i18n'

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
      tr('Die Minecraft-Version konnte nicht aufgelöst werden', 'The Minecraft version could not be resolved'),
      err instanceof Error ? err.message : String(err)
    )
  }

  if (versionId) {
    try {
      const json = await loadVersionJson(versionId)
      if (!json) {
        add(
          'blocker',
          tr(`Die Beschreibung der Version ${versionId} fehlt`, `The description of version ${versionId} is missing`),
          tr('Sie wird beim ersten Start automatisch nachgeladen.', 'It is downloaded automatically on the first start.')
        )
      } else {
        add('ok', tr(`Version ${instance.mcVersion} ist eingerichtet`, `Version ${instance.mcVersion} is set up`))
      }
    } catch (err) {
      add(
        'warn',
        tr(`Die Beschreibung der Version ${versionId} ist nicht lesbar`, `The description of version ${versionId} cannot be read`),
        err instanceof Error ? err.message : String(err)
      )
    }

    if (!jarLooksReal(clientJarPath(versionId))) {
      add(
        'warn',
        tr('Die Spieldatei fehlt noch', 'The game file is still missing'),
        tr('Sie wird beim ersten Start heruntergeladen, das dauert dann etwas länger.', 'It is downloaded on the first start, which then takes a little longer.')
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
        tr(`Für ${instance.loader} ist keine Version hinterlegt`, `No version is set for ${instance.loader}`),
        tr('Der Launcher wählt beim ersten Start die neueste passende aus.', 'The launcher picks the newest matching one on the first start.')
      )
    } else {
      add('ok', tr(`Mod-Loader ${instance.loader} ${instance.loaderVersion} ist eingetragen`, `Mod loader ${instance.loader} ${instance.loaderVersion} is set`))
    }
    if (!hasMods) {
      add(
        'warn',
        tr('Es gibt keinen mods-Ordner', 'There is no mods folder'),
        tr('Der Loader ist eingerichtet, aber es wurden keine Mods übernommen.', 'The loader is set up, but no mods were taken over.')
      )
    }
  }

  /* 3. Are the mods where they belong and recorded? ------------------- */
  try {
    await syncContentWithDisk(instanceId)
    const fresh = getInstance(instanceId)
    const mods = fresh.content.filter((item) => item.type === 'mod')
    if (mods.length > 0) {
      add('ok', tr(`${mods.length} Mods erfasst`, `${mods.length} mods registered`))
      const missing = mods.filter((item) => !existsSync(join(paths.mods(instanceId), item.fileName)))
      if (missing.length > 0) {
        add(
          'warn',
          tr(`${missing.length} eingetragene Mods liegen nicht im Ordner`, `${missing.length} registered mods are not in the folder`),
          missing
            .slice(0, 5)
            .map((item) => item.name)
            .join(', ')
        )
      }
    }
  } catch (err) {
    add('warn', tr('Die Mods konnten nicht erfasst werden', 'The mods could not be registered'), err instanceof Error ? err.message : String(err))
  }

  /* 4. Anything that would stop the launch? --------------------------- */
  try {
    const report = await checkCompatibility(instanceId)
    const errors = report.issues.filter((issue) => issue.severity === 'error')
    const warnings = report.issues.filter((issue) => issue.severity === 'warning')

    for (const issue of errors.slice(0, 5)) add('blocker', issue.title, issue.detail)
    if (errors.length > 5) {
      add(
        'blocker',
        tr(`${errors.length - 5} weitere Probleme`, `${errors.length - 5} more problems`),
        tr('Vollständig unter "Kompatibilität" bei der Instanz.', 'Listed in full under "Compatibility" in the instance.')
      )
    }
    if (warnings.length > 0) {
      add(
        'warn',
        tr(`${warnings.length} Hinweise zur Kompatibilität`, `${warnings.length} compatibility notes`),
        tr('Kein Hindernis für den Start, nachzulesen bei der Instanz.', 'Nothing that blocks the start, see the instance for details.')
      )
    }
    if (errors.length === 0 && warnings.length === 0) {
      add('ok', tr('Keine Kompatibilitätsprobleme gefunden', 'No compatibility problems found'))
    }
  } catch (err) {
    // A failing compatibility check says nothing about the import itself.
    logger.warn(`Kompatibilitätsprüfung nach dem Import von ${instanceId} fehlgeschlagen:`, err)
    add('warn', tr('Die Kompatibilität konnte nicht geprüft werden', 'Compatibility could not be checked'))
  }

  return {
    instanceId,
    checkedAt: Date.now(),
    findings,
    looksStartable: !blocking
  }
}
