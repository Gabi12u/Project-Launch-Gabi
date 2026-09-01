/**
 * Imports an instance folder that another launcher created.
 *
 * The modpack importers all take an archive, which leaves no way to bring over
 * an instance that already exists on disk — a Prism/MultiMC folder, a plain
 * `.minecraft`, or one of our own instance folders copied off a backup drive.
 * The file picker cannot even select a folder, so this is its own entry point.
 */

import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { copyFile, mkdir, readdir, readlink, stat, symlink } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

export type SourceFlavour = 'prism' | 'launchgabi' | 'curseforge' | 'gdlauncher' | 'minecraft'

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
 * Reads the Minecraft version a modded profile is built on from its own
 * version JSON (`<versions>/<id>/<id>.json`), the same `inheritsFrom` field
 * `loadVersionJson` in mojang.ts resolves for a normal launch.
 *
 * This is what actually identifies a NeoForge folder: its name alone
 * (`neoforge-21.1.57`) carries no Minecraft version, unlike legacy Forge's
 * `<mcVersion>-forge-<loaderVersion>` layout. Guessing from NeoForge's own
 * version-number scheme would be one more thing to keep in sync with a
 * scheme that has already changed once; the profile just states it outright.
 */
function readInheritsFrom(versionsDir: string, id: string): string | null {
  try {
    const file = join(versionsDir, id, `${id}.json`)
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { inheritsFrom?: unknown }
    return typeof parsed.inheritsFrom === 'string' ? parsed.inheritsFrom : null
  } catch {
    return null
  }
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
    // Modern NeoForge installers name the folder just `neoforge-<version>`,
    // with no Minecraft version in the name at all.
    const neoforge = /^neoforge-([\w.+-]+)$/i.exec(name)
    if (neoforge) {
      const mcVersion = readInheritsFrom(dir, name)
      if (mcVersion) {
        return { mcVersion, loader: 'neoforge', loaderVersion: neoforge[1] }
      }
    }
  }

  const plain = names.filter((name) => /^\d+\.\d+(\.\d+)?$/.test(name)).sort(compareVersionsDesc)
  if (plain.length > 0) {
    return { mcVersion: plain[0], loader: 'vanilla', loaderVersion: '' }
  }
  return null
}

/** Best-effort loader guess from CurseForge/Modrinth's own jar naming conventions. */
function guessLoaderFromMods(modsDir: string): { loader: LoaderId; loaderVersion: string } | null {
  if (!existsSync(modsDir)) return null
  let jars: string[] = []
  try {
    jars = readdirSync(modsDir).filter((f) => f.toLowerCase().endsWith('.jar'))
  } catch {
    return null
  }
  const has = (pattern: RegExp): boolean => jars.some((j) => pattern.test(j))
  // Order matters: Quilt ships fabric-api's own compatibility jar too.
  if (has(/quilt-loader|quilted-fabric-api/i)) return { loader: 'quilt', loaderVersion: '' }
  if (has(/neoforge/i)) return { loader: 'neoforge', loaderVersion: '' }
  if (has(/(^|[-_])forge([-_.]|$)/i)) return { loader: 'forge', loaderVersion: '' }
  if (has(/fabric-api|fabric-loader/i)) return { loader: 'fabric', loaderVersion: '' }
  return null
}

/**
 * Third-party clients like Lunar, Feather and Badlion keep one folder per
 * Minecraft version instead of Mojang's `versions/<id>/` layout, so there is
 * no version JSON to read at all — the folder's own name is the only signal
 * left. None of these clients record the loader anywhere either, so it is
 * guessed from the jar names sitting in `mods/`.
 */
function guessFromFolderName(
  gameDir: string
): { mcVersion: string; loader: LoaderId; loaderVersion: string } | null {
  const name = basename(gameDir)
  if (!/^\d+\.\d+(\.\d+)?$/.test(name)) return null
  const guessedLoader = guessLoaderFromMods(join(gameDir, 'mods'))
  return {
    mcVersion: name,
    loader: guessedLoader?.loader ?? 'vanilla',
    loaderVersion: guessedLoader?.loaderVersion ?? ''
  }
}

/* ------------------------------------------------------------------ *
 * level.dat
 * ------------------------------------------------------------------ */

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

/** Payload width of the fixed-size tags. */
const FIXED_WIDTH = new Map<number, number>([
  [TAG_BYTE, 1],
  [TAG_SHORT, 2],
  [TAG_INT, 4],
  [TAG_LONG, 8],
  [TAG_FLOAT, 4],
  [TAG_DOUBLE, 8]
])

/** Element width of the three array tags. */
const ARRAY_WIDTH = new Map<number, number>([
  [TAG_BYTE_ARRAY, 1],
  [TAG_INT_ARRAY, 4],
  [TAG_LONG_ARRAY, 8]
])

/** Real level.dat files nest a handful of levels deep at most. */
const MAX_NBT_DEPTH = 64

/** A level.dat is a few kilobytes. This ceiling is already absurdly generous. */
const MAX_LEVEL_DAT_BYTES = 32 * 1024 * 1024

/**
 * Throws unless the `count` bytes starting at `pos` really lie inside `buf`,
 * and returns the offset just past them.
 *
 * Every offset this parser computes goes through here. A level.dat is
 * attacker-controlled in practice — it arrives inside whatever folder the user
 * points the importer at — and its length fields are just numbers in a file.
 * Without this check a single inflated or negative length walks the cursor
 * past the end or backwards, and a cursor that moves backwards is how a
 * crafted file turns the loops below into an infinite one that never throws.
 */
function bounded(buf: Buffer, pos: number, count: number): number {
  if (!Number.isSafeInteger(pos) || !Number.isSafeInteger(count)) {
    throw new Error('NBT: unbrauchbarer Offset')
  }
  if (pos < 0 || count < 0) throw new Error('NBT: negative Länge')
  const end = pos + count
  if (end > buf.length) throw new Error('NBT: Länge zeigt hinter das Dateiende')
  return end
}

/** Advances past one payload of `type` and returns the offset after it. */
function skipPayload(buf: Buffer, pos: number, type: number, depth: number): number {
  if (depth > MAX_NBT_DEPTH) throw new Error('NBT: zu tief verschachtelt')

  const fixed = FIXED_WIDTH.get(type)
  if (fixed !== undefined) return bounded(buf, pos, fixed)

  const width = ARRAY_WIDTH.get(type)
  if (width !== undefined) {
    bounded(buf, pos, 4)
    return bounded(buf, pos + 4, buf.readInt32BE(pos) * width)
  }

  if (type === TAG_STRING) {
    bounded(buf, pos, 2)
    return bounded(buf, pos + 2, buf.readUInt16BE(pos))
  }

  if (type === TAG_LIST) {
    bounded(buf, pos, 5)
    const itemType = buf.readUInt8(pos)
    const count = buf.readInt32BE(pos + 1)
    if (count < 0) throw new Error('NBT: negative Listenlänge')
    const start = pos + 5
    if (count === 0) return start
    if (itemType === TAG_END) throw new Error('NBT: Liste ohne Elementtyp')

    // Fixed-width elements get measured, not walked. Stepping through them one
    // by one reads nothing from the buffer, so a five-byte header claiming two
    // milliarden elements would spin here for minutes without ever tripping a
    // bounds check, freezing the entire launcher.
    const itemWidth = FIXED_WIDTH.get(itemType)
    if (itemWidth !== undefined) return bounded(buf, start, count * itemWidth)

    // Every remaining element type consumes at least one byte, so `bounded`
    // inside the recursion ends this loop well before `count` runs out.
    let p = start
    for (let i = 0; i < count; i++) p = skipPayload(buf, p, itemType, depth + 1)
    return p
  }

  if (type === TAG_COMPOUND) {
    let p = pos
    for (;;) {
      bounded(buf, p, 1)
      const tag = buf.readUInt8(p++)
      if (tag === TAG_END) return p
      bounded(buf, p, 2)
      p = bounded(buf, p + 2, buf.readUInt16BE(p))
      p = skipPayload(buf, p, tag, depth + 1)
    }
  }

  throw new Error('NBT: unbekannter Typ ' + type)
}

/** Follows `path` through nested compounds and returns the string it ends on. */
function nbtString(buf: Buffer, pos: number, path: string[], depth = 0): string | null {
  if (depth > MAX_NBT_DEPTH) throw new Error('NBT: zu tief verschachtelt')

  let p = pos
  for (;;) {
    bounded(buf, p, 1)
    const type = buf.readUInt8(p++)
    if (type === TAG_END) return null

    bounded(buf, p, 2)
    const nameLength = buf.readUInt16BE(p)
    p += 2
    const nameEnd = bounded(buf, p, nameLength)
    const name = buf.toString('utf8', p, nameEnd)
    p = nameEnd

    if (name === path[0]) {
      if (path.length === 1) {
        if (type !== TAG_STRING) return null
        bounded(buf, p, 2)
        const length = buf.readUInt16BE(p)
        return buf.toString('utf8', p + 2, bounded(buf, p + 2, length))
      }
      if (type !== TAG_COMPOUND) return null
      return nbtString(buf, p, path.slice(1), depth + 1)
    }

    p = skipPayload(buf, p, type, depth + 1)
  }
}

/**
 * Pulls the Minecraft version out of a world's `level.dat`.
 *
 * Every world Minecraft has saved since 1.9 records the version that wrote it,
 * which makes this the one signal that does not depend on a launcher's own
 * bookkeeping. Whatever created the folder, if it was ever played there is a
 * world here that states the version outright.
 */
function readLevelDatVersion(file: string): string | null {
  try {
    const raw = readFileSync(file)

    // Almost always gzipped, but a hand-edited level.dat can be plain NBT.
    let buf: Buffer
    try {
      // Capped, so a gzip bomb sitting in saves/ cannot eat all memory before
      // the parser gets a chance to reject it.
      buf = gunzipSync(raw, { maxOutputLength: MAX_LEVEL_DAT_BYTES })
    } catch {
      if (raw.length > MAX_LEVEL_DAT_BYTES) return null
      buf = raw
    }

    let p = 0
    bounded(buf, p, 1)
    if (buf.readUInt8(p++) !== TAG_COMPOUND) return null
    bounded(buf, p, 2)
    p = bounded(buf, p + 2, buf.readUInt16BE(p))

    const name = nbtString(buf, p, ['Data', 'Version', 'Name'])
    // Snapshots ("23w31a") and release candidates are of no use here, since
    // the launcher only installs proper releases.
    return name && /^\d+\.\d+(\.\d+)?$/.test(name) ? name : null
  } catch {
    // A corrupt or hostile world simply yields no version; the caller falls
    // back to its other detection paths.
    return null
  }
}

/** Reads the version from the most recently played world in `saves/`. */
function readVersionFromSaves(gameDir: string): string | null {
  const saves = join(gameDir, 'saves')
  if (!existsSync(saves)) return null

  let worlds: string[] = []
  try {
    worlds = readdirSync(saves, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }

  // Newest first: an old world left over from a previous version would
  // otherwise pin the instance to a version its owner stopped using.
  const files = worlds
    .map((world) => {
      const file = join(saves, world, 'level.dat')
      try {
        return { file, modified: statSync(file).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { file: string; modified: number } => entry !== null)
    .sort((a, b) => b.modified - a.modified)

  for (const entry of files) {
    const version = readLevelDatVersion(entry.file)
    if (version) return version
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Other launchers
 * ------------------------------------------------------------------ */

interface LauncherRead {
  name?: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string
}

/**
 * Reads CurseForge's `minecraftinstance.json`.
 *
 * The app keeps the game files directly in the instance folder with no
 * `versions/` of its own, so without this file nothing in the folder names a
 * version at all.
 */
function readCurseForgeInstance(dir: string): LauncherRead | null {
  const file = join(dir, 'minecraftinstance.json')
  if (!existsSync(file)) return null

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      name?: unknown
      gameVersion?: unknown
      baseModLoader?: { name?: unknown; minecraftVersion?: unknown; forgeVersion?: unknown } | null
    }

    const base = parsed.baseModLoader ?? {}
    const mcVersion =
      (typeof base.minecraftVersion === 'string' && base.minecraftVersion) ||
      (typeof parsed.gameVersion === 'string' && parsed.gameVersion) ||
      ''
    if (!mcVersion) return null

    // "forge-47.2.20", "neoforge-21.1.57", "fabric-0.15.3-1.20.1".
    let loader: LoaderId = 'vanilla'
    let loaderVersion = ''
    const raw = typeof base.name === 'string' ? base.name : ''
    const match = /^(neoforge|forge|fabric|quilt)-(.+)$/i.exec(raw)
    if (match) {
      loader = match[1].toLowerCase() as LoaderId
      const tail = match[2]
      // Fabric repeats the Minecraft version at the end, Forge does not.
      loaderVersion =
        typeof base.forgeVersion === 'string' && base.forgeVersion
          ? base.forgeVersion
          : tail.endsWith('-' + mcVersion)
            ? tail.slice(0, -(mcVersion.length + 1))
            : tail
    }

    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      mcVersion,
      loader,
      loaderVersion
    }
  } catch (err) {
    logger.warn('minecraftinstance.json konnte nicht gelesen werden (' + file + '):', err)
    return null
  }
}

/**
 * Reads GDLauncher's `config.json`.
 *
 * `config.json` is far too common a name to trust on its own, so this only
 * accepts a file that actually carries GDLauncher's loader block.
 */
function readGdLauncherConfig(dir: string): LauncherRead | null {
  const file = join(dir, 'config.json')
  if (!existsSync(file)) return null

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      loader?: { loaderType?: unknown; mcVersion?: unknown; loaderVersion?: unknown } | null
    }
    const block = parsed.loader
    if (!block || typeof block.mcVersion !== 'string' || !block.mcVersion) return null

    const type = typeof block.loaderType === 'string' ? block.loaderType.toLowerCase() : ''
    const known: LoaderId[] = ['fabric', 'forge', 'neoforge', 'quilt']
    return {
      mcVersion: block.mcVersion,
      loader: known.includes(type as LoaderId) ? (type as LoaderId) : 'vanilla',
      loaderVersion: typeof block.loaderVersion === 'string' ? block.loaderVersion : ''
    }
  } catch {
    return null
  }
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
  //
  // `instance.json` is not ours alone: ATLauncher and others use the same
  // name with an entirely different shape. A file that does not carry our
  // fields therefore falls through to the checks below instead of aborting
  // the whole import, which used to make those folders impossible to bring
  // over at all.
  const ownFile = join(sourceDir, 'instance.json')
  if (existsSync(ownFile)) {
    let parsed: Partial<Instance> | null = null
    try {
      parsed = JSON.parse(readFileSync(ownFile, 'utf8')) as Partial<Instance>
    } catch (err) {
      logger.warn(`instance.json konnte nicht gelesen werden (${ownFile}):`, err)
    }

    const gameDir = join(sourceDir, 'minecraft')
    if (parsed && parsed.mcVersion && existsSync(gameDir)) {
      return {
        flavour: 'launchgabi',
        name: parsed.name?.trim() || folderName,
        mcVersion: parsed.mcVersion,
        loader: (parsed.loader ?? 'vanilla') as LoaderId,
        loaderVersion: parsed.loaderVersion ?? '',
        gameDir
      }
    }
  }

  // 2b. CurseForge and GDLauncher --------------------------------------
  //
  // Both keep the game files straight in the instance folder, so the folder
  // itself is the game directory and their own metadata file is the only
  // thing naming a version.
  const external: { read: LauncherRead | null; flavour: SourceFlavour; note: string }[] = [
    { read: readCurseForgeInstance(sourceDir), flavour: 'curseforge', note: 'CurseForge' },
    { read: readGdLauncherConfig(sourceDir), flavour: 'gdlauncher', note: 'GDLauncher' }
  ]
  for (const candidate of external) {
    if (!candidate.read) continue
    return {
      flavour: candidate.flavour,
      name: candidate.read.name?.trim() || folderName,
      mcVersion: candidate.read.mcVersion,
      loader: candidate.read.loader,
      loaderVersion: candidate.read.loaderVersion,
      gameDir: sourceDir
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

  // The saved worlds are the last resort, and the only one that works no
  // matter which launcher built the folder or what it is called: Minecraft
  // itself stamps the version into every level.dat it writes.
  let guessed = guessFromVersionsFolder(gameDir) ?? guessFromFolderName(gameDir)
  if (!guessed) {
    const fromSaves = readVersionFromSaves(gameDir)
    if (fromSaves) {
      const loader = guessLoaderFromMods(join(gameDir, 'mods'))
      guessed = {
        mcVersion: fromSaves,
        loader: loader?.loader ?? 'vanilla',
        loaderVersion: loader?.loaderVersion ?? ''
      }
      logger.info(`Version ${fromSaves} aus einer gespeicherten Welt gelesen`)
    }
  }

  if (!guessed) {
    throw new Error(
      'Die Minecraft-Version dieses Ordners konnte nicht ermittelt werden. Das passiert, wenn der ' +
        'Ordner weder einen "versions"-Unterordner noch eine gespeicherte Welt enthält. Lege die ' +
        'Instanz von Hand an und kopiere die Dateien anschließend über "Ordner öffnen" hinein.'
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

/**
 * Copies a foreign instance folder across, a file at a time.
 *
 * This used `cpSync`, which copies a whole tree in one blocking call. The
 * folders it is pointed at are exactly the large ones — an existing
 * `.minecraft` or Prism instance, world saves and all — so importing a
 * long-played setup froze the entire launcher for as long as the copy took,
 * with no window, no progress and nothing to cancel. Awaiting per file gives
 * the interface room to breathe and lets the task report as it goes.
 */
async function copyGameFiles(
  from: string,
  to: string,
  onFile?: (count: number) => void,
  /** Throws to abort, so the caller can raise its own cancellation error. */
  checkCancelled?: () => void
): Promise<{ files: number; skippedLinks: number }> {
  let files = 0
  let skippedLinks = 0
  let lastReport = Date.now()
  const stack: string[] = ['']

  while (stack.length > 0) {
    const rel = stack.pop()
    if (rel === undefined) continue

    const source = rel ? join(from, rel) : from
    let entries: Dirent[]
    try {
      entries = await readdir(source, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      // Checked per entry so a cancel lands within one file instead of after
      // the whole folder. The button used to go through with nothing reading
      // it, and the import carried on and reported success.
      checkCancelled?.()

      const childRel = rel ? join(rel, entry.name) : entry.name
      // Only the top level is filtered, exactly as before: these are the
      // directories the launcher manages centrally and shares between
      // instances, so bringing a second copy across would waste gigabytes.
      if (!rel && SKIP_DIRS.has(entry.name.toLowerCase())) continue

      const target = join(to, childRel)

      if (entry.isSymbolicLink()) {
        const linkSource = join(from, childRel)
        let raw: string | null = null
        try {
          raw = await readlink(linkSource)
        } catch {
          continue
        }

        // Resolved the same way the OS would follow it: relative to the
        // link's own folder, or as-is if absolute. `extractLink` in
        // archive.ts already does this for tar.gz entries; this walk skipped
        // it entirely and recreated whatever a source folder's links pointed
        // to, no matter where that was. A folder import is exactly the
        // untrusted-input case that check exists for: a link to `/etc/shadow`
        // or an SSH key would otherwise land inside the instance unchanged,
        // and `zipFolder` follows links when it later backs the instance up.
        const sourceRoot = resolve(from)
        const resolvedTarget = isAbsolute(raw) ? resolve(raw) : resolve(dirname(linkSource), raw)
        const contained = resolvedTarget === sourceRoot || resolvedTarget.startsWith(sourceRoot + sep)

        if (!contained) {
          skippedLinks++
          continue
        }

        // Re-expressed for the new location rather than reused verbatim: `to`
        // sits at a different depth than `from`, so a relative target that
        // was correct in the source folder can point somewhere else entirely
        // once copied straight across.
        const newTarget = join(to, relative(sourceRoot, resolvedTarget))
        const newRelative = relative(dirname(target), newTarget)

        try {
          await mkdir(join(target, '..'), { recursive: true })
          await symlink(newRelative, target)
          files++
        } catch {
          // Windows hands out symlink permission sparingly. The target already
          // passed the containment check above, so recreating its actual
          // content here is exactly as safe as the link would have been.
          try {
            const kind = await stat(linkSource)
            if (kind.isDirectory()) {
              // Handed to the main loop as an ordinary folder instead of
              // copied here directly: copying a symlinked directory's target
              // through `copyFile` throws EISDIR, which the old fallback
              // caught and discarded, dropping the whole subtree with no
              // error and no log entry.
              await mkdir(target, { recursive: true })
              stack.push(childRel)
            } else {
              await mkdir(join(target, '..'), { recursive: true })
              await copyFile(linkSource, target)
              files++
            }
          } catch {
            // A broken link, or a target that vanished mid-import.
          }
        }
        continue
      }

      if (entry.isDirectory()) {
        await mkdir(target, { recursive: true })
        stack.push(childRel)
        continue
      }

      try {
        await mkdir(join(target, '..'), { recursive: true })
        await copyFile(join(from, childRel), target)
        files++
      } catch {
        // A file that vanished mid-copy, or one the OS will not hand over, is
        // not worth failing the whole import over.
      }

      // Reported on time rather than every 200th file. An import of a hundred
      // files finished without ever showing a number, which reads as a frozen
      // dialog when those hundred files are large.
      if (Date.now() - lastReport >= 250) {
        onFile?.(files)
        lastReport = Date.now()
      }
    }
  }
  return { files, skippedLinks }
}

const FLAVOUR_LABELS: Record<SourceFlavour, string> = {
  prism: 'Aus Prism/MultiMC übernommen',
  launchgabi: 'Aus einem Launch-Gabi-Ordner übernommen',
  curseforge: 'Aus der CurseForge-App übernommen',
  gdlauncher: 'Aus GDLauncher übernommen',
  minecraft: 'Aus einem Minecraft-Ordner übernommen'
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
    description: FLAVOUR_LABELS[detected.flavour],
    icon: '📥'
  })

  void withTask(`${name} wird importiert`, 'Dateien werden kopiert…', instance.id, async (task) => {
    ensureInstanceLayout(instance.id)
    const target = paths.gameDir(instance.id)

    task.update('Welten, Mods und Konfigurationen werden kopiert…', null)
    const { files: copied, skippedLinks } = await copyGameFiles(
      detected.gameDir,
      target,
      (n) => task.update(`${n} Dateien kopiert…`, null),
      () => task.throwIfCancelled()
    )
    logger.info(
      `${copied} Dateien nach ${instance.id} kopiert` +
        (skippedLinks > 0 ? `, ${skippedLinks} Verknüpfung(en) außerhalb des Ordners übersprungen` : '')
    )

    task.update('Mods werden erfasst…', 0.9)
    await syncContentWithDisk(instance.id)

    persist({ ...getInstance(instance.id), installing: false, installed: true })
    task.update(
      `Import abgeschlossen (${copied} ${copied === 1 ? 'Datei' : 'Dateien'})` +
        (skippedLinks > 0
          ? `, ${skippedLinks} ${skippedLinks === 1 ? 'Verknüpfung zeigte' : 'Verknüpfungen zeigten'} nach ` +
            `außerhalb des Ordners und wurde${skippedLinks === 1 ? '' : 'n'} übersprungen`
          : ''),
      1
    )
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
