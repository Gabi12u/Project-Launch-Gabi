import { mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
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
  version: (id: string) => join(root(), 'versions', id),
  natives: (id: string) => join(root(), 'versions', id, 'natives'),
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
  if (!resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error(`Pfad zeigt aus dem Zielordner heraus: "${relative}"`)
  }
  return target
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
