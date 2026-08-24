import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MinecraftVersion } from '@shared/types'
import { paths, safeJoin } from '../paths'
import { writeJsonAtomic } from '../store'
import { downloadAll, downloadFile, fetchJson, fetchJsonCached, type DownloadItem } from './net'
import type { Task } from '../tasks'
import { log } from '../logger'

const logger = log('mojang')

const VERSION_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'
const RESOURCES_BASE = 'https://resources.download.minecraft.net'

/** Asset objects are stored under their sha1, so nothing else is accepted. */
const ASSET_HASH = /^[a-f0-9]{40}$/i

/* ------------------------------------------------------------------ *
 * Mojang JSON shapes
 * ------------------------------------------------------------------ */

export interface Artifact {
  path?: string
  sha1: string
  size: number
  url: string
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; version?: string; arch?: string }
  features?: Record<string, boolean>
}

export interface Library {
  name: string
  downloads?: {
    artifact?: Artifact
    classifiers?: Record<string, Artifact>
  }
  /** Maven repository base used by loader manifests that omit `downloads`. */
  url?: string
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: Rule[]
  /** Forge marks some libraries as client-only. */
  clientreq?: boolean
  serverreq?: boolean
}

export type Argument =
  | string
  | {
      rules?: Rule[]
      value: string | string[]
    }

export interface VersionJson {
  id: string
  inheritsFrom?: string
  type: string
  mainClass: string
  assets?: string
  releaseTime?: string
  time?: string
  minimumLauncherVersion?: number
  assetIndex?: { id: string; sha1: string; size: number; totalSize: number; url: string }
  downloads?: { client?: Artifact; server?: Artifact }
  libraries: Library[]
  arguments?: { game?: Argument[]; jvm?: Argument[] }
  /** Pre-1.13 argument format. */
  minecraftArguments?: string
  javaVersion?: { component: string; majorVersion: number }
  logging?: {
    client?: { argument: string; file: { id: string; sha1: string; size: number; url: string }; type: string }
  }
}

interface VersionManifestJson {
  latest: { release: string; snapshot: string }
  versions: {
    id: string
    type: MinecraftVersion['type']
    url: string
    time: string
    releaseTime: string
    sha1: string
  }[]
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  /** Pre-1.6 versions copy assets into the game folder instead of using the object store. */
  map_to_resources?: boolean
  virtual?: boolean
}

/* ------------------------------------------------------------------ *
 * Platform helpers
 * ------------------------------------------------------------------ */

export function osName(): string {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'osx'
    default:
      return 'linux'
  }
}

export function osArch(): string {
  switch (process.arch) {
    case 'x64':
      return 'x64'
    case 'ia32':
      return 'x86'
    case 'arm64':
      return 'arm64'
    default:
      return process.arch
  }
}

/**
 * Evaluates Mojang's rule list. The last matching rule wins; when the list
 * starts with a `disallow` the default is "allowed", otherwise "denied".
 */
export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules || rules.length === 0) return true

  let allowed = false
  // When every rule is a disallow, the implied default is allow.
  if (rules.every((r) => r.action === 'disallow')) allowed = true

  for (const rule of rules) {
    let matches = true

    if (rule.os) {
      if (rule.os.name && rule.os.name !== osName()) matches = false
      if (rule.os.arch && rule.os.arch !== osArch()) matches = false
      if (rule.os.version) {
        try {
          const release = process.getSystemVersion?.() ?? ''
          if (!new RegExp(rule.os.version).test(release)) matches = false
        } catch {
          // an unparsable regex should not block the launch
        }
      }
    }

    if (rule.features) {
      for (const [key, expected] of Object.entries(rule.features)) {
        if ((features[key] ?? false) !== expected) matches = false
      }
    }

    if (matches) allowed = rule.action === 'allow'
  }

  return allowed
}

/** `net.fabricmc:fabric-loader:0.17.2` -> `net/fabricmc/fabric-loader/0.17.2/fabric-loader-0.17.2.jar` */
export function mavenToPath(name: string, classifierOverride?: string): string {
  const [coords, ...rest] = name.split('@')
  const extension = rest[0] ?? 'jar'
  const parts = coords.split(':')
  const [group, artifact, version] = parts
  const classifier = classifierOverride ?? parts[3]

  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.${extension}`
    : `${artifact}-${version}.${extension}`

  return [...group.split('.'), artifact, version, fileName].join('/')
}

/** Native classifier for this platform, e.g. `natives-windows`. */
export function nativeClassifier(library: Library): string | null {
  if (!library.natives) return null
  const key = library.natives[osName()]
  if (!key) return null
  return key.replace('${arch}', process.arch === 'ia32' ? '32' : '64')
}

/* ------------------------------------------------------------------ *
 * Version manifest
 * ------------------------------------------------------------------ */

export async function getVersionManifest(forceRefresh = false): Promise<VersionManifestJson> {
  return fetchJsonCached<VersionManifestJson>(
    VERSION_MANIFEST,
    'version_manifest_v2',
    forceRefresh ? 0 : 60 * 60 * 1000
  )
}

export async function listMinecraftVersions(includeSnapshots: boolean): Promise<MinecraftVersion[]> {
  const manifest = await getVersionManifest()
  return manifest.versions
    .filter((v) => includeSnapshots || v.type === 'release')
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url }))
}

export async function getLatestRelease(): Promise<string> {
  return (await getVersionManifest()).latest.release
}

/**
 * Loads a version JSON, downloading it into the shared versions folder on
 * first use. `inheritsFrom` chains (used by every mod loader) are resolved and
 * merged here so callers always see one flat version definition.
 */
export async function loadVersionJson(
  versionId: string,
  /** Ids already on the inheritance chain, used to break cycles. */
  seen: ReadonlySet<string> = new Set()
): Promise<VersionJson> {
  // A loader manifest that inherits from itself (or from something that leads
  // back to it) would otherwise recurse until the main process dies with a
  // stack overflow rather than a usable error.
  if (seen.has(versionId)) {
    throw new Error(
      `Zirkuläre inheritsFrom-Kette in der Versionsdefinition: ${[...seen, versionId].join(' -> ')}`
    )
  }
  if (seen.size > 16) {
    throw new Error(`inheritsFrom-Kette ist zu tief verschachtelt (${[...seen].join(' -> ')})`)
  }

  const file = join(paths.version(versionId), `${versionId}.json`)

  let json: VersionJson
  if (existsSync(file)) {
    json = JSON.parse(await readFile(file, 'utf8')) as VersionJson
  } else {
    const manifest = await getVersionManifest()
    const entry = manifest.versions.find((v) => v.id === versionId)
    if (!entry) throw new Error(`Minecraft-Version ${versionId} ist unbekannt`)
    json = await fetchJson<VersionJson>(entry.url)
    writeJsonAtomic(file, json)
  }

  if (json.inheritsFrom) {
    const parent = await loadVersionJson(json.inheritsFrom, new Set([...seen, versionId]))
    return mergeVersions(parent, json)
  }
  return json
}

/** Merges a loader version JSON on top of the vanilla version it inherits from. */
export function mergeVersions(parent: VersionJson, child: VersionJson): VersionJson {
  const merged: VersionJson = {
    ...parent,
    ...child,
    // The child's libraries take precedence and are searched first so a loader
    // can override a vanilla library with a patched build.
    libraries: [...(child.libraries ?? []), ...(parent.libraries ?? [])],
    downloads: { ...parent.downloads, ...child.downloads },
    assetIndex: child.assetIndex ?? parent.assetIndex,
    assets: child.assets ?? parent.assets,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    logging: child.logging ?? parent.logging,
    mainClass: child.mainClass || parent.mainClass
  }

  if (parent.arguments || child.arguments) {
    // A legacy parent carries its game arguments as one string. Without this
    // the modern list would contain only the loader's additions and every
    // vanilla argument (--username, --gameDir, --accessToken, …) would be
    // dropped, because `launch.ts` prefers `arguments.game` when it exists.
    const inheritedGame =
      !parent.arguments && parent.minecraftArguments
        ? parent.minecraftArguments.split(/\s+/).filter(Boolean)
        : (parent.arguments?.game ?? [])

    merged.arguments = {
      game: [...inheritedGame, ...(child.arguments?.game ?? [])],
      jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])]
    }
    // The merged list is authoritative now; leaving the legacy string in place
    // would make the two disagree.
    delete merged.minecraftArguments
  }

  // A 1.12-era parent uses the legacy string form; keep it unless the child
  // already provides the modern array form.
  if (!merged.arguments && (child.minecraftArguments || parent.minecraftArguments)) {
    merged.minecraftArguments = child.minecraftArguments ?? parent.minecraftArguments
  }

  delete merged.inheritsFrom
  return merged
}

/* ------------------------------------------------------------------ *
 * Resolving downloads
 * ------------------------------------------------------------------ */

export interface ResolvedLibrary {
  library: Library
  /** Absolute path in the shared libraries folder. */
  path: string
  download?: DownloadItem
  /** Set for libraries that must be extracted into the natives folder. */
  native: boolean
  excludes: string[]
}

/**
 * Builds the download URL for a library that ships no `downloads` block.
 *
 * These entries carry neither sha1 nor size, so `fetchToFile` has nothing to
 * verify the response against and writes whatever the server hands back — into
 * a jar that then lands on the classpath. TLS is the only guarantee left, so a
 * plain-http maven is upgraded rather than trusted, and anything that is not
 * http(s) at all is refused.
 */
function mavenUrl(base: string, relative: string): string {
  const url = `${base.replace(/\/$/, '')}/${relative}`

  if (/^https:\/\//i.test(url)) return url
  if (/^http:\/\//i.test(url)) {
    logger.warn(`Bibliothek ohne Prüfsumme wird über HTTPS statt HTTP geladen: ${url}`)
    return url.replace(/^http:\/\//i, 'https://')
  }
  throw new Error(`Bibliothek verweist auf ein unerwartetes Protokoll: ${url}`)
}

export function resolveLibraries(version: VersionJson): ResolvedLibrary[] {
  const resolved: ResolvedLibrary[] = []
  const seen = new Set<string>()
  const seenArtifacts = new Set<string>()

  /** Turns one artifact into a resolved entry, skipping duplicates. */
  const add = (
    library: Library,
    artifact: Artifact | undefined,
    classifier: string | null,
    native: boolean
  ): void => {
    const relative = artifact?.path ?? mavenToPath(library.name, classifier ?? undefined)
    // `relative` comes out of a downloaded manifest, and for modded instances
    // that is a loader's install profile rather than Mojang's own JSON. Pinning
    // it into the libraries folder stops a crafted entry such as
    // "../../../autostart/evil.jar" from writing wherever it likes.
    const absolute = safeJoin(paths.libraries(), relative)

    const key = `${relative}|${classifier ?? ''}`
    if (seen.has(key)) return
    seen.add(key)

    // The key above contains the version, so a loader pinning its own build of
    // a library vanilla also ships (a bumped asm or guava, say) produced two
    // separate entries and both landed on the classpath. Which one won was
    // then down to ordering alone, and any class present in both could bind to
    // the wrong version or crash the JVM outright. Collapsing on
    // group:artifact keeps the first, and children are resolved first
    // precisely so their override is the one that survives.
    const coords = library.name.split(':')
    if (coords.length >= 2) {
      // The fourth maven segment is a classifier, and that is how versions
      // since 1.19 ship their natives: as a separate entry named
      // `org.lwjgl:lwjgl:3.3.3:natives-windows`, with no `natives` block, so
      // it reaches this function with `classifier === null`. Keying on
      // group:artifact alone therefore made the natives entry look like a
      // duplicate of the plain jar and dropped whichever came second.
      //
      // Those jars belong on the classpath, because LWJGL 3 unpacks lwjgl.dll
      // out of them itself. Losing one killed the launch outright with
      // "Failed to locate library: lwjgl.dll".
      const mavenClassifier = coords.length >= 4 ? coords[3] : ''
      const artifactKey = `${coords[0]}:${coords[1]}|${classifier ?? mavenClassifier}`
      if (seenArtifacts.has(artifactKey)) return
      seenArtifacts.add(artifactKey)
    }

    let download: DownloadItem | undefined
    if (artifact?.url) {
      download = { url: artifact.url, path: absolute, sha1: artifact.sha1, size: artifact.size }
    } else if (library.url) {
      download = { url: mavenUrl(library.url, relative), path: absolute }
    } else if (!artifact) {
      // Forge installers place some libraries on disk themselves; if they are
      // still missing, Mojang's maven mirror is the best guess.
      download = { url: mavenUrl('https://libraries.minecraft.net', relative), path: absolute }
    }

    resolved.push({
      library,
      path: absolute,
      download,
      native,
      excludes: library.extract?.exclude ?? []
    })
  }

  for (const library of version.libraries ?? []) {
    if (!rulesAllow(library.rules)) continue
    if (library.clientreq === false) continue

    const classifier = nativeClassifier(library)

    // Modern versions ship natives as ordinary artifacts guarded by rules;
    // only the legacy `natives` map needs the classifier lookup.
    if (classifier) {
      add(library, library.downloads?.classifiers?.[classifier], classifier, true)

      // Pre-1.17 libraries such as `com.mojang:text2speech` carry a natives
      // classifier *and* a normal jar that belongs on the classpath. Resolving
      // only the classifier used to drop the main jar, so 1.12-1.16 died at
      // startup with NoClassDefFoundError.
      if (library.downloads?.artifact) {
        add(library, library.downloads.artifact, null, false)
      }
    } else {
      add(library, library.downloads?.artifact, null, false)
    }
  }

  return resolved
}

export function clientJarPath(versionId: string): string {
  return join(paths.version(versionId), `${versionId}.jar`)
}

/**
 * Downloads everything a version needs: client jar, libraries, log config and
 * the asset objects. Reports into `task` if given.
 */
export async function installVersion(
  version: VersionJson,
  clientVersionId: string,
  task?: Task
): Promise<void> {
  const items: DownloadItem[] = []

  const client = version.downloads?.client
  if (client) {
    items.push({
      url: client.url,
      path: clientJarPath(clientVersionId),
      sha1: client.sha1,
      size: client.size
    })
  }

  for (const lib of resolveLibraries(version)) {
    if (lib.download) items.push(lib.download)
  }

  if (version.logging?.client?.file) {
    const file = version.logging.client.file
    items.push({
      url: file.url,
      path: join(paths.assets(), 'log_configs', file.id),
      sha1: file.sha1,
      size: file.size
    })
  }

  // `within` nests, so this keeps whatever slice the caller reserved for us
  // instead of taking over the whole bar.
  if (task) {
    await task.within(0, 0.35, () => downloadAll(items, { task, label: 'Minecraft-Dateien' }))
    await task.within(0.35, 1, () => installAssets(version, task))
  } else {
    await downloadAll(items, { label: 'Minecraft-Dateien' })
    await installAssets(version)
  }
}

export async function installAssets(version: VersionJson, task?: Task): Promise<void> {
  if (!version.assetIndex) return

  const indexFile = join(paths.assetIndexes(), `${version.assetIndex.id}.json`)
  await downloadFile({
    url: version.assetIndex.url,
    path: indexFile,
    sha1: version.assetIndex.sha1,
    size: version.assetIndex.size
  })

  const index = JSON.parse(await readFile(indexFile, 'utf8')) as AssetIndex
  const objects = Object.values(index.objects ?? {})

  const items: DownloadItem[] = objects.map((obj) => {
    // The hash is both the URL and the file name on disk, so a crafted index
    // could otherwise steer the write out of the objects folder.
    if (!ASSET_HASH.test(obj.hash)) {
      throw new Error(`Ungültiger Asset-Hash im Index "${version.assetIndex?.id}": "${obj.hash}"`)
    }
    return {
      url: `${RESOURCES_BASE}/${obj.hash.slice(0, 2)}/${obj.hash}`,
      path: join(paths.assetObjects(), obj.hash.slice(0, 2), obj.hash),
      sha1: obj.hash,
      size: obj.size
    }
  })

  await downloadAll(items, { task, label: 'Spiel-Assets' })
  logger.info(`Assets für Index ${version.assetIndex.id} vollständig (${objects.length} Objekte)`)
}

/** Legacy versions expect a flat `virtual/legacy` asset tree. */
export async function buildVirtualAssets(version: VersionJson, targetDir: string): Promise<void> {
  if (!version.assetIndex) return
  const indexFile = join(paths.assetIndexes(), `${version.assetIndex.id}.json`)
  if (!existsSync(indexFile)) return

  const index = JSON.parse(await readFile(indexFile, 'utf8')) as AssetIndex
  if (!index.virtual && !index.map_to_resources) return

  for (const [name, obj] of Object.entries(index.objects ?? {})) {
    if (!ASSET_HASH.test(obj.hash)) continue
    const source = join(paths.assetObjects(), obj.hash.slice(0, 2), obj.hash)
    // `name` is an index key, so it is pinned into the virtual tree the same
    // way modpack overrides are.
    const dest = safeJoin(targetDir, name)
    if (!existsSync(source) || existsSync(dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(source, dest)
  }
}
