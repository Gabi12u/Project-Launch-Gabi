import { mkdirSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { getSettings } from './store'

/**
 * All launcher data lives under one root so it can be moved or backed up in
 * one piece. Assets, libraries and version metadata are shared between
 * instances — only the `.minecraft` game directory is per instance, which is
 * what keeps instances isolated without wasting gigabytes.
 */
export function root(): string {
  return getSettings().dataDirectory
}

export const paths = {
  root,
  meta: () => join(root(), 'meta'),
  assets: () => join(root(), 'assets'),
  assetObjects: () => join(root(), 'assets', 'objects'),
  assetIndexes: () => join(root(), 'assets', 'indexes'),
  libraries: () => join(root(), 'libraries'),
  versions: () => join(root(), 'versions'),
  // `id` can come from an imported modpack or another launcher's own metadata,
  // never checked further than "non-empty" at the call site until now, so
  // `safeJoin` is what actually stops "../../x" from escaping the versions
  // folder instead of `join`, which happily resolves it.
  version: (id: string) => safeJoin(paths.versions(), id),
  natives: (id: string) => join(paths.version(id), 'natives'),
  java: () => join(root(), 'java'),
  instances: () => join(root(), 'instances'),
  instance: (id: string) => join(root(), 'instances', id),
  /** The game directory handed to Minecraft as `--gameDir`. */
  gameDir: (id: string) => join(root(), 'instances', id, 'minecraft'),
  instanceFile: (id: string) => join(root(), 'instances', id, 'instance.json'),
  mods: (id: string) => join(paths.gameDir(id), 'mods'),
  resourcePacks: (id: string) => join(paths.gameDir(id), 'resourcepacks'),
  shaderPacks: (id: string) => join(paths.gameDir(id), 'shaderpacks'),
  saves: (id: string) => join(paths.gameDir(id), 'saves'),
  screenshots: (id: string) => join(paths.gameDir(id), 'screenshots'),
  /**
   * Where the launcher's own clips land.
   *
   * Inside the game directory rather than beside it, so a recording travels
   * with the instance: backups, exports and deletion all already cover this
   * tree, and nothing had to learn about a new folder.
   */
  recordings: (id: string) => join(paths.gameDir(id), 'recordings'),
  config: (id: string) => join(paths.gameDir(id), 'config'),
  backups: () => join(root(), 'backups'),
  instanceBackups: (id: string) => join(root(), 'backups', id),
  cache: () => join(root(), 'cache'),
  icons: (id: string) => join(root(), 'instances', id, 'media')
}

/**
 * Joins a relative path that came from untrusted data (a modpack manifest, an
 * API response) onto a directory, and guarantees the result stays inside it.
 *
 * `join(dir, ...'../../x'.split('/'))` happily escapes, which would let a
 * crafted modpack write anywhere the user can — the Windows autostart folder
 * being the obvious target. Anything suspicious is rejected rather than
 * silently rewritten, so a tampered pack is visible instead of half-installed.
 */
export function safeJoin(root: string, relative: string): string {
  const normalised = relative.replace(/\\/g, '/')

  // A leading separator means the author wrote an absolute path. Stripping it
  // would quietly turn "/etc/passwd" into "<root>/etc/passwd" — not an escape,
  // but not what the archive asked for either, so it is refused.
  if (normalised.startsWith('/')) {
    throw new Error(`Absoluter Pfad im Archiv ist nicht erlaubt: "${relative}"`)
  }

  const parts = normalised.split('/').filter((part) => part.length > 0 && part !== '.')

  if (parts.length === 0) {
    throw new Error(`Ungültiger Pfad im Archiv: "${relative}"`)
  }
  for (const part of parts) {
    if (part === '..') {
      throw new Error(`Pfad zeigt aus dem Zielordner heraus: "${relative}"`)
    }
    // "C:", "\\server" and NTFS alternate data streams.
    if (/^[a-z]:$/i.test(part) || part.includes(':')) {
      throw new Error(`Absoluter Pfad im Archiv ist nicht erlaubt: "${relative}"`)
    }
  }

  const target = join(root, ...parts)
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  // Belt and braces: catches anything the segment checks above missed.
  //
  // `resolve()` already puts a trailing separator on a drive or share root
  // ("D:\") but never on anything deeper ("D:\instances"), so appending one
  // unconditionally doubled it whenever `root` itself was a drive root, and
  // the check below then rejected every single legitimate path underneath.
  // No caller passes a bare drive root as `root` today, so nothing hits this
  // in practice, but a data directory sitting directly on its own drive is a
  // real setup, and the next caller that does pass one would have had every
  // write rejected.
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error(`Pfad zeigt aus dem Zielordner heraus: "${relative}"`)
  }
  return target
}

/**
 * Reduces a content item's stored file name to a bare file name before it is
 * joined into a mods/resourcepacks/shaderpacks/datapacks folder.
 *
 * A `ContentItem.fileName` is meant to be exactly that, a bare name, but it
 * starts life as a provider's own string or a value that reached
 * `instance.content` through whatever wrote it, and nothing enforces the
 * shape at the type level once it round-trips through IPC. Originally only
 * enforced where a mod is installed or updated; `core/instances.ts`'s own
 * enable/disable toggle joined the stored name straight in without this,
 * the one content write path that did not go through `core/content.ts` at
 * all. Shared here instead of duplicated, since both files need the exact
 * same rule and neither may import the other without a cycle.
 */
export function contentFileName(fileName: string): string {
  const safe = basename(fileName.replace(/\\/g, '/'))
  if (!safe || safe === '.' || safe === '..') {
    throw new Error(`Ungültiger Dateiname: "${fileName}"`)
  }
  return safe
}

/** Joins a stored file name into a content folder, pinned to it. */
export function contentPath(dir: string, fileName: string): string {
  return join(dir, contentFileName(fileName))
}

/**
 * Strips a loader version id down to a safe set of characters before it is
 * used as both a path segment and a file name (`<id>.json`).
 *
 * The id comes from external metadata (a Fabric/Quilt meta server, a Forge
 * installer's own profile) and was previously joined straight into
 * `paths.version()`, which does no checking of its own. Everything outside
 * letters, digits, dot, hyphen and underscore is dropped rather than escaped,
 * so a crafted id cannot smuggle in a path separator. Dots stay allowed since
 * real ids rely on them ("1.20.1", "fabric-loader-0.15.7-1.20.1"), but a
 * result of just "." or ".." is rejected too, since either would resolve to
 * the versions folder itself or its parent once joined.
 */
/**
 * Names Windows refuses to create as a file or a directory, in any casing and
 * regardless of extension. Shared with `core/instances.ts`, which hit this
 * for instance names first ("Con" failed at `mkdirSync` with a raw fs error
 * before it was ever persisted); `sanitizeVersionId` below needed the exact
 * same guard for the same reason, against a different source of untrusted
 * text.
 */
export const RESERVED_WINDOWS_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

export function sanitizeVersionId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]/g, '')
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'version'
  // A Fabric/Quilt meta server or a Forge installer profile is exactly the
  // kind of source `RESERVED_WINDOWS_NAMES` was written for elsewhere in
  // this project, external text with no reason to expect it, and this
  // function's own sanitizing left it untouched: none of these words contain
  // characters the regex above strips. A version id of "con" would fail
  // `mkdirSync` on Windows with a raw filesystem error instead of the clear
  // messages the rest of this install path gives for every other failure.
  if (RESERVED_WINDOWS_NAMES.has(cleaned.toLowerCase())) return `${cleaned}-version`
  return cleaned
}

/**
 * True for a Minecraft/loader version string safe to carry verbatim into
 * `paths.version()`/`paths.natives()`, as it arrives from an imported
 * modpack manifest or another launcher's own metadata rather than from
 * Mojang.
 *
 * Unlike `sanitizeVersionId` above, nothing here is stripped: real Mojang ids
 * contain spaces and dots ("1.14 Pre-Release 1", "1.20-pre1"), so mangling
 * them would silently point the instance at the wrong folder. Only what would
 * make an unsafe path segment or hide control characters is refused, so an
 * import can fail with a clear reason up front instead of leaving a mangled
 * or half-escaped folder behind.
 */
export function isValidVersionString(value: string): boolean {
  if (typeof value !== 'string' || !value || value === '.' || value.length > 64) return false
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/** Content folder for a content type inside an instance. */
export function contentDir(instanceId: string, type: string): string {
  switch (type) {
    case 'mod':
      return paths.mods(instanceId)
    case 'resourcepack':
      return paths.resourcePacks(instanceId)
    case 'shaderpack':
      return paths.shaderPacks(instanceId)
    case 'datapack':
      // Data packs are per world; the staging folder holds packs the user
      // installed globally so they can be copied into a world.
      return join(paths.gameDir(instanceId), 'datapacks')
    default:
      return paths.gameDir(instanceId)
  }
}

export function ensureRootLayout(): void {
  for (const dir of [
    paths.meta(),
    paths.assetObjects(),
    paths.assetIndexes(),
    paths.libraries(),
    paths.versions(),
    paths.java(),
    paths.instances(),
    paths.backups(),
    paths.cache()
  ]) {
    mkdirSync(dir, { recursive: true })
  }
}

export function ensureInstanceLayout(id: string): void {
  for (const dir of [
    paths.instance(id),
    paths.gameDir(id),
    paths.mods(id),
    paths.resourcePacks(id),
    paths.shaderPacks(id),
    paths.saves(id),
    paths.screenshots(id),
    paths.instanceBackups(id),
    paths.icons(id),
    join(paths.gameDir(id), 'datapacks')
  ]) {
    mkdirSync(dir, { recursive: true })
  }
}
