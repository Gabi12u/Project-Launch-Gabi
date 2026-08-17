/**
 * Imports an instance folder that another launcher created.
 *
 * The modpack importers all take an archive, which leaves no way to bring over
 * an instance that already exists on disk — a Prism/MultiMC folder, a plain
 * `.minecraft`, or one of our own instance folders copied off a backup drive.
 * The file picker cannot even select a folder, so this is its own entry point.
 */

import { cpSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type { Instance, LoaderId } from '@shared/types'
import { ensureInstanceLayout, paths } from '../paths'
import { log } from '../logger'
import { withTask } from '../tasks'
import { createInstance, getInstance, persist, syncContentWithDisk } from './instances'

const logger = log('folder-import')

/**
 * Directories the launcher manages centrally and shares between instances.
 *
 * Copying another launcher's copies would duplicate gigabytes we either already
 * have or will fetch ourselves, and their layout is keyed differently anyway.
 */
const SKIP_DIRS = new Set([
  'versions',
  'libraries',
  'assets',
  'natives',
  'logs',
  'crash-reports',
  'server-resource-packs',
  '.fabric',
  'realms_persistence'
])

export type SourceFlavour = 'prism' | 'launchgabi' | 'minecraft'

export interface DetectedInstance {
  flavour: SourceFlavour
  name: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string
  /** Absolute path of the folder holding mods/, saves/ and friends. */
  gameDir: string
}

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

/** Reads MultiMC's `instance.cfg`, a flat `key=value` file. */
function readInstanceCfg(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(file)) return out
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at <= 0 || line.trimStart().startsWith('#')) continue
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
  } catch (err) {
    logger.warn(`instance.cfg konnte nicht gelesen werden (${file}):`, err)
  }
  return out
}

/** Maps a Prism/MultiMC component list onto our loader ids. */
function loaderFromComponents(
  components: { uid?: string; version?: string }[]
): { loader: LoaderId; loaderVersion: string; mcVersion: string } {
  const version = (uid: string): string =>
    components.find((c) => c?.uid === uid)?.version?.trim() ?? ''

  const mcVersion = version('net.minecraft')

  // Order matters: a Quilt instance also lists the Fabric API component, and
  // NeoForge instances can carry a legacy Forge entry alongside.
  const candidates: { uid: string; loader: LoaderId }[] = [
    { uid: 'org.quiltmc.quilt-loader', loader: 'quilt' },
    { uid: 'net.neoforged', loader: 'neoforge' },
    { uid: 'net.minecraftforge', loader: 'forge' },
    { uid: 'net.fabricmc.fabric-loader', loader: 'fabric' }
  ]

  for (const candidate of candidates) {
    const found = version(candidate.uid)
    if (found) return { loader: candidate.loader, loaderVersion: found, mcVersion }
  }
  return { loader: 'vanilla', loaderVersion: '', mcVersion }
}

/** Sorts `1.20.1` above `1.9.4`, which a plain string compare gets wrong. */
function compareVersionsDesc(a: string, b: string): number {
  const parts = (value: string): number[] => value.split('.').map((p) => Number(p) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Last resort for a bare `.minecraft`: the folder names under `versions/` are
 * the only record of what this installation was ever run as.
 */
function guessFromVersionsFolder(
  gameDir: string
): { mcVersion: string; loader: LoaderId; loaderVersion: string } | null {
  const dir = join(gameDir, 'versions')
  if (!existsSync(dir)) return null

  let names: string[] = []
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }

  // A modded id is more informative than a plain one, so it wins.
  for (const name of names) {
    const fabric = /^(fabric|quilt)-loader-([\w.+-]+?)-(\d+\.\d+(?:\.\d+)?)$/i.exec(name)
    if (fabric) {
      return {
        mcVersion: fabric[3],
        loader: fabric[1].toLowerCase() === 'quilt' ? 'quilt' : 'fabric',
        loaderVersion: fabric[2]
      }
    }
    const forge = /^(\d+\.\d+(?:\.\d+)?)-(neoforge|forge)-([\w.+-]+)$/i.exec(name)
    if (forge) {
      return {
        mcVersion: forge[1],
        loader: forge[2].toLowerCase() === 'neoforge' ? 'neoforge' : 'forge',
        loaderVersion: forge[3]
      }
    }
  }

  const plain = names.filter((name) => /^\d+\.\d+(\.\d+)?$/.test(name)).sort(compareVersionsDesc)
  if (plain.length > 0) {
    return { mcVersion: plain[0], loader: 'vanilla', loaderVersion: '' }
  }
  return null
}

/** True when this folder looks like a game directory rather than a wrapper. */
function looksLikeGameDir(dir: string): boolean {
  return ['mods', 'saves', 'config', 'resourcepacks', 'options.txt'].some((entry) =>
    existsSync(join(dir, entry))
  )
}

export function detectInstanceFolder(sourceDir: string): DetectedInstance {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error('Der gewählte Pfad ist kein Ordner.')
  }

  const folderName = basename(sourceDir) || 'Importierte Instanz'

  // 1. Prism / MultiMC / PolyMC ---------------------------------------
  const packFile = join(sourceDir, 'mmc-pack.json')
  if (existsSync(packFile)) {
    let components: { uid?: string; version?: string }[] = []
    try {
      const parsed = JSON.parse(readFileSync(packFile, 'utf8')) as { components?: unknown }
      components = Array.isArray(parsed.components)
        ? (parsed.components as { uid?: string; version?: string }[])
        : []
    } catch (err) {
      throw new Error(
        `Die mmc-pack.json in diesem Ordner ist beschädigt und konnte nicht gelesen werden. (${
          err instanceof Error ? err.message : String(err)
        })`
      )
    }

    const { loader, loaderVersion, mcVersion } = loaderFromComponents(components)
    if (!mcVersion) {
      throw new Error('In der mmc-pack.json fehlt die Minecraft-Version, der Ordner wurde nicht importiert.')
    }

    // MultiMC wrote "minecraft", Prism writes ".minecraft".
    const gameDir = ['.minecraft', 'minecraft']
      .map((name) => join(sourceDir, name))
      .find((path) => existsSync(path))

    if (!gameDir) {
      throw new Error('Im Instanz-Ordner fehlt der Unterordner ".minecraft".')
    }

    const cfg = readInstanceCfg(join(sourceDir, 'instance.cfg'))
    return {
      flavour: 'prism',
      name: cfg['name']?.trim() || folderName,
      mcVersion,
      loader,
      loaderVersion,
      gameDir
    }
  }

  // 2. One of our own instance folders --------------------------------
  const ownFile = join(sourceDir, 'instance.json')
  if (existsSync(ownFile)) {
    try {
      const parsed = JSON.parse(readFileSync(ownFile, 'utf8')) as Partial<Instance>
      const gameDir = join(sourceDir, 'minecraft')
      if (!existsSync(gameDir)) {
        throw new Error('Im Instanz-Ordner fehlt der Unterordner "minecraft".')
      }
      if (!parsed.mcVersion) {
        throw new Error('In der instance.json fehlt die Minecraft-Version.')
      }
      return {
        flavour: 'launchgabi',
        name: parsed.name?.trim() || folderName,
        mcVersion: parsed.mcVersion,
        loader: (parsed.loader ?? 'vanilla') as LoaderId,
        loaderVersion: parsed.loaderVersion ?? '',
        gameDir
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Im Instanz-Ordner')) throw err
      if (err instanceof Error && err.message.startsWith('In der instance.json')) throw err
      throw new Error(
        `Die instance.json in diesem Ordner ist beschädigt. (${
          err instanceof Error ? err.message : String(err)
        })`
      )
    }
  }

  // 3. A bare game directory ------------------------------------------
  const gameDir = looksLikeGameDir(sourceDir)
    ? sourceDir
    : ['.minecraft', 'minecraft']
        .map((name) => join(sourceDir, name))
        .find((path) => existsSync(path) && looksLikeGameDir(path))

  if (!gameDir) {
    throw new Error(
      'In diesem Ordner wurde keine Instanz erkannt. Erwartet wird ein Prism-/MultiMC-Ordner, ' +
        'ein Launch-Gabi-Ordner oder ein ".minecraft"-Ordner mit mods/ oder saves/.'
    )
  }

  const guessed = guessFromVersionsFolder(gameDir)
  if (!guessed) {
    throw new Error(
      'Die Minecraft-Version dieses Ordners konnte nicht ermittelt werden. Lege die Instanz von Hand ' +
        'an und kopiere die Dateien anschließend über "Ordner öffnen" hinein.'
    )
  }

  return {
    flavour: 'minecraft',
    name: folderName === '.minecraft' ? 'Importiertes Minecraft' : folderName,
    mcVersion: guessed.mcVersion,
    loader: guessed.loader,
    loaderVersion: guessed.loaderVersion,
    gameDir
  }
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

function copyGameFiles(from: string, to: string): number {
  let files = 0
  cpSync(from, to, {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = relative(from, source)
      // The root itself, always copied.
      if (!rel) return true

      const top = rel.split(sep)[0].toLowerCase()
      if (SKIP_DIRS.has(top)) return false

      try {
        if (!statSync(source).isDirectory()) files++
      } catch {
        // A file that vanished mid-copy is not worth failing over.
      }
      return true
    }
  })
  return files
}

/**
 * Creates an instance from a folder another launcher wrote.
 *
 * The record is created first so the card shows up immediately; the copy then
 * runs as a task, exactly like the modpack importers.
 */
export async function importInstanceFolder(
  sourceDir: string,
  nameOverride?: string
): Promise<Instance> {
  const detected = detectInstanceFolder(sourceDir)
  const name = nameOverride?.trim() || detected.name

  logger.info(
    `Importiere Ordner (${detected.flavour}) "${name}": ${detected.mcVersion}, ` +
      `${detected.loader} ${detected.loaderVersion || '-'}`
  )

  const instance = await createInstance({
    name,
    mcVersion: detected.mcVersion,
    loader: detected.loader,
    loaderVersion: detected.loaderVersion,
    description:
      detected.flavour === 'prism'
        ? 'Aus Prism/MultiMC übernommen'
        : detected.flavour === 'launchgabi'
          ? 'Aus einem Launch-Gabi-Ordner übernommen'
          : 'Aus einem .minecraft-Ordner übernommen',
    icon: '📥'
  })

  void withTask(`${name} wird importiert`, 'Dateien werden kopiert…', instance.id, async (task) => {
    ensureInstanceLayout(instance.id)
    const target = paths.gameDir(instance.id)

    task.update('Welten, Mods und Konfigurationen werden kopiert…', null)
    const copied = copyGameFiles(detected.gameDir, target)
    logger.info(`${copied} Dateien nach ${instance.id} kopiert`)

    task.update('Mods werden erfasst…', 0.9)
    await syncContentWithDisk(instance.id)

    persist({ ...getInstance(instance.id), installing: false, installed: true })
    task.update(`Import abgeschlossen (${copied} Dateien)`, 1)
  }).catch((err) => {
    logger.error(`Ordner-Import von ${name} fehlgeschlagen:`, err)
    try {
      persist({ ...getInstance(instance.id), installing: false, installed: false })
    } catch (persistErr) {
      logger.warn(`Importstatus von ${instance.id} nicht zurückgesetzt:`, persistErr)
    }
  })

  return instance
}
