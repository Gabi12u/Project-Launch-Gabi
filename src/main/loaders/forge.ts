import AdmZip from 'adm-zip'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { LoaderVersion } from '@shared/types'
import { paths } from '../paths'
import { writeJsonAtomic } from '../store'
import { downloadAll, downloadFile, fetchJsonCached, fetchText } from '../core/net'
import { extractSubtree, readEntryJson, readEntryText } from '../core/archive'
import {
  clientJarPath,
  loadVersionJson,
  mavenToPath,
  resolveLibraries,
  type Library,
  type VersionJson
} from '../core/mojang'
import { resolveJava, requiredJavaMajor } from '../core/java'
import { getSettings } from '../store'
import { log } from '../logger'
import type { Task } from '../tasks'

const logger = log('forge')
const execFileAsync = promisify(execFile)

export type ForgeLikeLoader = 'forge' | 'neoforge'

/* ------------------------------------------------------------------ *
 * Installer profile shapes
 * ------------------------------------------------------------------ */

interface Processor {
  sides?: string[]
  jar: string
  classpath: string[]
  args: string[]
  outputs?: Record<string, string>
}

interface ModernInstallProfile {
  spec: number
  profile: string
  version: string
  minecraft: string
  json: string
  path?: string
  libraries: Library[]
  processors: Processor[]
  data: Record<string, { client: string; server: string }>
}

interface LegacyInstallProfile {
  install: {
    profileName: string
    target: string
    path: string
    version: string
    filePath: string
    minecraft: string
  }
  versionInfo: VersionJson
}

type InstallProfile = ModernInstallProfile | LegacyInstallProfile

function isModern(profile: InstallProfile): profile is ModernInstallProfile {
  return (profile as ModernInstallProfile).processors !== undefined
}

/* ------------------------------------------------------------------ *
 * Version listings
 * ------------------------------------------------------------------ */

const FORGE_MAVEN = 'https://maven.minecraftforge.net'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'

interface ForgePromotions {
  promos: Record<string, string>
}

/**
 * NeoForge versions drop the leading `1.`: Minecraft 1.21.1 maps to the
 * `21.1.x` line. Minecraft 1.20.1 is the exception — it lives under the
 * legacy `net.neoforged:forge` artifact.
 */
function neoforgePrefix(mcVersion: string): string {
  const parts = mcVersion.split('.')
  const minor = parts[1] ?? '0'
  const patch = parts[2] ?? '0'
  return `${minor}.${patch}.`
}

function isNeoforgeLegacy(mcVersion: string): boolean {
  return mcVersion === '1.20.1'
}

async function listForgeVersions(mcVersion: string): Promise<LoaderVersion[]> {
  const xml = await fetchText(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`)
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])

  let recommended: string | undefined
  let latest: string | undefined
  try {
    const promos = await fetchJsonCached<ForgePromotions>(
      'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
      'forge-promotions',
      60 * 60 * 1000
    )
    recommended = promos.promos[`${mcVersion}-recommended`]
    latest = promos.promos[`${mcVersion}-latest`]
  } catch {
    // promotions are a nicety, not a requirement
  }

  const prefix = `${mcVersion}-`
  return all
    .filter((v) => v.startsWith(prefix))
    .map((v) => v.slice(prefix.length))
    // Some old entries carry a trailing branch suffix such as "-1.20.1".
    .map((v) => v.split('-')[0])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .reverse()
    .map((version) => ({
      version,
      gameVersion: mcVersion,
      stable: version === recommended || (!recommended && version === latest),
      recommended: version === recommended
    }))
}

async function listNeoforgeVersions(mcVersion: string): Promise<LoaderVersion[]> {
  if (isNeoforgeLegacy(mcVersion)) {
    const data = await fetchJsonCached<{ versions: string[] }>(
      'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge',
      'neoforge-legacy-versions',
      30 * 60 * 1000
    )
    const prefix = `${mcVersion}-`
    return data.versions
      .filter((v) => v.startsWith(prefix))
      .reverse()
      .map((version, index) => ({
        version,
        gameVersion: mcVersion,
        stable: !version.includes('beta'),
        recommended: index === 0
      }))
  }

  const data = await fetchJsonCached<{ versions: string[] }>(
    'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
    'neoforge-versions',
    30 * 60 * 1000
  )

  const prefix = neoforgePrefix(mcVersion)
  return data.versions
    .filter((v) => v.startsWith(prefix))
    .reverse()
    .map((version, index) => ({
      version,
      gameVersion: mcVersion,
      stable: !version.includes('beta'),
      recommended: index === 0
    }))
}

export async function listForgeLikeVersions(
  loader: ForgeLikeLoader,
  mcVersion: string
): Promise<LoaderVersion[]> {
  try {
    return loader === 'forge'
      ? await listForgeVersions(mcVersion)
      : await listNeoforgeVersions(mcVersion)
  } catch (err) {
    logger.warn(`Keine ${loader}-Versionen für ${mcVersion}:`, err)
    return []
  }
}

function installerUrl(loader: ForgeLikeLoader, mcVersion: string, version: string): string {
  if (loader === 'forge') {
    const full = `${mcVersion}-${version}`
    return `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
  }
  if (isNeoforgeLegacy(mcVersion)) {
    return `${NEOFORGE_MAVEN}/net/neoforged/forge/${version}/forge-${version}-installer.jar`
  }
  return `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
}

/* ------------------------------------------------------------------ *
 * Installation
 * ------------------------------------------------------------------ */

function libraryPath(coords: string): string {
  return join(paths.libraries(), ...mavenToPath(coords).split('/'))
}

/** Resolves `[net.example:artifact:1.0]` style arguments to absolute paths. */
function resolveArgument(
  raw: string,
  data: Record<string, string>
): string {
  let value = raw

  if (value.startsWith('[') && value.endsWith(']')) {
    return libraryPath(value.slice(1, -1))
  }

  value = value.replace(/\{([A-Z0-9_]+)\}/g, (match, key: string) => {
    const replacement = data[key]
    if (replacement === undefined) return match
    return replacement
  })

  return value
}

async function mainClassOf(jarPath: string): Promise<string> {
  const manifest = await readEntryText(jarPath, 'META-INF/MANIFEST.MF')
  if (!manifest) throw new Error(`Kein Manifest in ${jarPath}`)
  // Manifest lines wrap at 72 bytes with a leading space on continuations.
  const unfolded = manifest.replace(/\r\n[ ]/g, '').replace(/\n[ ]/g, '')
  const match = /Main-Class:\s*(.+)/.exec(unfolded)
  if (!match) throw new Error(`Keine Main-Class in ${jarPath}`)
  return match[1].trim()
}

/**
 * Installs Forge or NeoForge. Both use the same installer format: a jar that
 * carries the version JSON plus a list of "processors" which patch the vanilla
 * client jar. We run those processors ourselves instead of shelling out to the
 * graphical installer.
 */
export async function installForgeLike(
  loader: ForgeLikeLoader,
  mcVersion: string,
  loaderVersion: string,
  task?: Task
): Promise<string> {
  const label = loader === 'forge' ? 'Forge' : 'NeoForge'
  task?.update(`${label} ${loaderVersion} wird geladen…`, null)

  const url = installerUrl(loader, mcVersion, loaderVersion)
  const installer = join(paths.cache(), `${loader}-${mcVersion}-${loaderVersion}-installer.jar`)

  await downloadFile({ url, path: installer, trustExisting: true })

  const profile = await readEntryJson<InstallProfile>(installer, 'install_profile.json')
  if (!profile) throw new Error(`${label}-Installer enthält kein install_profile.json`)

  if (!isModern(profile)) {
    return installLegacyForge(profile, installer, mcVersion, task)
  }

  // 1. Version JSON --------------------------------------------------
  const jsonEntry = (profile.json ?? '/version.json').replace(/^\//, '')
  const versionJson = await readEntryJson<VersionJson>(installer, jsonEntry)
  if (!versionJson) throw new Error(`${label}-Installer enthält kein ${jsonEntry}`)

  const versionId = versionJson.id ?? profile.version
  versionJson.id = versionId
  writeJsonAtomic(join(paths.version(versionId), `${versionId}.json`), versionJson)

  // 2. The vanilla client jar is the input for every patcher ----------
  task?.update('Basis-Minecraft wird vorbereitet…', null)
  const vanilla = await loadVersionJson(mcVersion)
  const vanillaJar = clientJarPath(mcVersion)
  if (vanilla.downloads?.client && !existsSync(vanillaJar)) {
    await downloadFile({
      url: vanilla.downloads.client.url,
      path: vanillaJar,
      sha1: vanilla.downloads.client.sha1,
      size: vanilla.downloads.client.size
    })
  }

  // 3. Libraries: the installer's own plus the ones the game needs ----
  task?.update(`${label}-Bibliotheken werden geladen…`, null)
  const installerLibs = resolveLibraries({ ...versionJson, libraries: profile.libraries ?? [] })
  const gameLibs = resolveLibraries(versionJson)

  await downloadAll(
    [...installerLibs, ...gameLibs].map((l) => l.download).filter((d): d is NonNullable<typeof d> => Boolean(d)),
    { task, label: `${label}-Bibliotheken` }
  )

  // Installers embed jars (the universal and sometimes patched client) in a
  // `maven/` tree that is expected to end up in the libraries folder.
  extractSubtree(installer, 'maven', paths.libraries())

  // 4. Data table ----------------------------------------------------
  const workDir = join(paths.cache(), `${loader}-${loaderVersion}-work`)
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })

  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(profile.data ?? {})) {
    let raw = value.client
    if (!raw) continue

    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = libraryPath(raw.slice(1, -1))
    } else if (raw.startsWith("'") && raw.endsWith("'")) {
      data[key] = raw.slice(1, -1)
    } else if (raw.startsWith('/')) {
      // A path inside the installer jar: extract it and point at the copy.
      const entry = raw.slice(1)
      const target = join(workDir, ...entry.split('/'))
      const extracted = extractSubtree(installer, entry.split('/').slice(0, -1).join('/'), join(workDir, ...entry.split('/').slice(0, -1)))
      if (extracted === 0) {
        // Single file rather than a subtree.
        const zip = new AdmZip(installer)
        const zipEntry = zip.getEntry(entry)
        if (zipEntry) {
          mkdirSync(join(target, '..'), { recursive: true })
          writeFileSync(target, zipEntry.getData())
        }
      }
      data[key] = target
    } else {
      raw = raw.trim()
      data[key] = raw
    }
  }

  data.MINECRAFT_JAR = vanillaJar
  data.MINECRAFT_VERSION = mcVersion
  data.ROOT = paths.root()
  data.INSTALLER = installer
  data.LIBRARY_DIR = paths.libraries()
  data.SIDE = 'client'

  // 5. Run the processors --------------------------------------------
  const processors = (profile.processors ?? []).filter(
    (p) => !p.sides || p.sides.includes('client')
  )

  if (processors.length > 0) {
    const javaMajor = requiredJavaMajor(versionJson, mcVersion)
    const java = await resolveJava({
      major: javaMajor,
      autoManage: getSettings().javaAutoManage,
      task
    })

    for (let i = 0; i < processors.length; i++) {
      task?.throwIfCancelled()
      const processor = processors[i]
      task?.update(
        `${label} wird installiert · Schritt ${i + 1}/${processors.length}`,
        (i + 1) / processors.length
      )

      const jar = libraryPath(processor.jar)
      if (!existsSync(jar)) throw new Error(`Prozessor-Jar fehlt: ${processor.jar}`)

      const classpath = [...processor.classpath.map(libraryPath), jar]
      const args = processor.args.map((arg) => resolveArgument(arg, data))
      const mainClass = await mainClassOf(jar)

      logger.debug(`Prozessor ${mainClass} mit ${args.length} Argumenten`)

      try {
        const { stdout, stderr } = await execFileAsync(
          java.path,
          ['-cp', classpath.join(process.platform === 'win32' ? ';' : ':'), mainClass, ...args],
          { cwd: paths.root(), timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }
        )
        logger.debug(`Prozessor ${mainClass} ok`, stdout.slice(-400), stderr.slice(-400))
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new Error(`${label}-Installationsschritt ${i + 1} fehlgeschlagen: ${detail}`)
      }
    }
  }

  rmSync(workDir, { recursive: true, force: true })
  logger.info(`${label} ${loaderVersion} für ${mcVersion} installiert als ${versionId}`)
  return versionId
}

/**
 * Forge 1.12.2 and older ship the finished version JSON plus a universal jar
 * inside the installer — no processors involved.
 */
async function installLegacyForge(
  profile: LegacyInstallProfile,
  installer: string,
  mcVersion: string,
  task?: Task
): Promise<string> {
  task?.update('Forge (Legacy) wird installiert…', null)

  const versionJson = profile.versionInfo
  const versionId = versionJson.id ?? `${mcVersion}-forge-${profile.install.version}`
  versionJson.id = versionId
  if (!versionJson.inheritsFrom) versionJson.inheritsFrom = mcVersion

  writeJsonAtomic(join(paths.version(versionId), `${versionId}.json`), versionJson)

  // Copy the embedded universal jar to its maven coordinates.
  const target = libraryPath(profile.install.path)
  const zip = new AdmZip(installer)
  const entry = zip.getEntry(profile.install.filePath)
  if (entry) {
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, entry.getData())
  } else {
    logger.warn(`Universal-Jar ${profile.install.filePath} nicht im Installer gefunden`)
  }

  const libs = resolveLibraries(versionJson)
  await downloadAll(
    libs.map((l) => l.download).filter((d): d is NonNullable<typeof d> => Boolean(d)),
    { task, label: 'Forge-Bibliotheken' }
  )

  logger.info(`Forge (Legacy) installiert als ${versionId}`)
  return versionId
}

export async function resolveLatestForgeLike(
  loader: ForgeLikeLoader,
  mcVersion: string
): Promise<string> {
  const versions = await listForgeLikeVersions(loader, mcVersion)
  const best = versions.find((v) => v.recommended) ?? versions.find((v) => v.stable) ?? versions[0]
  if (!best) {
    throw new Error(`Für Minecraft ${mcVersion} gibt es keine ${loader}-Version`)
  }
  return best.version
}

/** Used by the version picker to grey out loaders without a build. */
export async function forgeLikeSupports(
  loader: ForgeLikeLoader,
  mcVersion: string
): Promise<boolean> {
  return (await listForgeLikeVersions(loader, mcVersion)).length > 0
}
