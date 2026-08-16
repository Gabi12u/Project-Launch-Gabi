import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ContentItem, ContentType, Instance, LoaderId, ProjectVersion } from '@shared/types'
import { ensureInstanceLayout, paths, safeJoin } from '../paths'
import { log } from '../logger'
import { withTask, type Task } from '../tasks'
import { downloadAll, downloadFile, type DownloadItem } from './net'
import { extractSubtree, listEntries, readEntryJson, zipFolder } from './archive'
import { createInstance, getInstance, persist, syncContentWithDisk } from './instances'
import { curseforge, getProject, getVersions, modrinth } from '../providers'

const logger = log('modpack')

/* ------------------------------------------------------------------ *
 * Modrinth .mrpack
 * ------------------------------------------------------------------ */

interface MrpackIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: {
    path: string
    hashes: { sha1?: string; sha512?: string }
    env?: { client?: 'required' | 'optional' | 'unsupported'; server?: string }
    downloads: string[]
    fileSize: number
  }[]
  dependencies: Record<string, string>
}

/** Maps `dependencies` keys of a mrpack to our loader ids. */
function loaderFromDependencies(dependencies: Record<string, string>): {
  loader: LoaderId
  loaderVersion: string
  mcVersion: string
} {
  const mcVersion = dependencies['minecraft'] ?? '1.21.11'

  if (dependencies['fabric-loader']) {
    return { loader: 'fabric', loaderVersion: dependencies['fabric-loader'], mcVersion }
  }
  if (dependencies['quilt-loader']) {
    return { loader: 'quilt', loaderVersion: dependencies['quilt-loader'], mcVersion }
  }
  if (dependencies['neoforge']) {
    return { loader: 'neoforge', loaderVersion: dependencies['neoforge'], mcVersion }
  }
  if (dependencies['forge']) {
    return { loader: 'forge', loaderVersion: dependencies['forge'], mcVersion }
  }
  return { loader: 'vanilla', loaderVersion: '', mcVersion }
}

function contentTypeFromPath(path: string): ContentType {
  const lower = path.toLowerCase()
  if (lower.startsWith('mods/')) return 'mod'
  if (lower.startsWith('resourcepacks/')) return 'resourcepack'
  if (lower.startsWith('shaderpacks/')) return 'shaderpack'
  return 'datapack'
}

export async function importMrpack(archivePath: string, nameOverride?: string): Promise<Instance> {
  const index = await readEntryJson<MrpackIndex>(archivePath, 'modrinth.index.json')
  if (!index) {
    throw new Error('Das ist kein gültiges .mrpack-Archiv (modrinth.index.json fehlt).')
  }
  if (!Array.isArray(index.files)) {
    throw new Error('Die Dateiliste im .mrpack fehlt oder ist beschädigt.')
  }

  const { loader, loaderVersion, mcVersion } = loaderFromDependencies(index.dependencies ?? {})
  const name = nameOverride?.trim() || index.name || 'Importiertes Modpack'

  logger.info(`Importiere ${name} (${mcVersion}, ${loader} ${loaderVersion}, ${index.files.length} Dateien)`)

  const instance = await createInstance({
    name,
    mcVersion,
    loader,
    loaderVersion,
    description: index.summary ?? '',
    icon: '📦'
  })

  persist({
    ...getInstance(instance.id),
    source: {
      type: 'mrpack',
      packName: index.name,
      packVersion: index.versionId
    }
  })

  void withTask(`${name} wird importiert`, 'Mod-Dateien werden geladen…', instance.id, async (task) => {
    await installMrpackFiles(instance.id, archivePath, index, task)
  }).catch((err) => {
    logger.error(`Import von ${name} fehlgeschlagen:`, err)
    markImportFailed(instance.id)
  })

  return instance
}

/**
 * The import runs detached from the caller, so a failure has to clear the
 * instance's `installing` flag itself — otherwise the card sits at "wird
 * installiert" forever and the user cannot start or repair it.
 */
function markImportFailed(instanceId: string): void {
  try {
    persist({ ...getInstance(instanceId), installing: false, installed: false })
  } catch (err) {
    logger.warn(`Konnte Importstatus von ${instanceId} nicht zurücksetzen:`, err)
  }
}

async function installMrpackFiles(
  instanceId: string,
  archivePath: string,
  index: MrpackIndex,
  task: Task
): Promise<void> {
  const gameDir = paths.gameDir(instanceId)
  ensureInstanceLayout(instanceId)

  // 1. Downloadable files -------------------------------------------
  const clientFiles = (index.files ?? []).filter((f) => f?.env?.client !== 'unsupported')

  // `file.path` and the download urls come out of an archive that may have been
  // built by anyone, so neither is trusted here.
  const downloads: DownloadItem[] = []
  const rejected: string[] = []
  for (const file of clientFiles) {
    const url = file.downloads?.[0]
    if (!url) {
      rejected.push(`${file.path} (kein Download-Link)`)
      continue
    }
    try {
      downloads.push({
        url,
        path: safeJoin(gameDir, file.path),
        sha1: file.hashes?.sha1,
        size: file.fileSize
      })
    } catch (err) {
      rejected.push(`${file.path} (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  if (rejected.length > 0) {
    // Refusing outright: a pack that tries to write outside its own folder is
    // not a pack with a typo, and a half-installed one hides the problem.
    logger.error(`Modpack enthält unzulässige Einträge: ${rejected.join(', ')}`)
    throw new Error(
      `Das Modpack enthält ${rejected.length} unzulässige ${
        rejected.length === 1 ? 'Datei' : 'Dateien'
      } und wurde nicht installiert: ${rejected.slice(0, 3).join('; ')}`
    )
  }

  task.span(0, 0.85)
  await downloadAll(downloads, { task, label: 'Modpack-Dateien' })
  task.span(0, 1)

  // 2. Overrides ------------------------------------------------------
  task.update('Konfigurationen werden entpackt…', 0.9)
  const entries = listEntries(archivePath)
  if (entries.some((e) => e.name.startsWith('overrides/'))) {
    extractSubtree(archivePath, 'overrides', gameDir)
  }
  if (entries.some((e) => e.name.startsWith('client-overrides/'))) {
    extractSubtree(archivePath, 'client-overrides', gameDir)
  }

  // 3. Register the files as content ----------------------------------
  task.update('Mods werden erfasst…', 0.95)
  await syncContentWithDisk(instanceId)

  const instance = getInstance(instanceId)
  const enriched: ContentItem[] = instance.content.map((item) => {
    const match = clientFiles.find((f) => basename(f.path) === item.fileName)
    if (!match) return item
    return {
      ...item,
      // Modrinth CDN links carry the project and version id in the path.
      provider: match.downloads[0]?.includes('modrinth') ? 'modrinth' : item.provider,
      sha1: match.hashes.sha1 ?? item.sha1,
      size: match.fileSize,
      type: contentTypeFromPath(match.path)
    }
  })

  persist({ ...instance, content: enriched, installing: false, installed: true })
  task.update('Import abgeschlossen', 1)
  logger.info(`Modpack in ${instanceId} importiert`)
}

/* ------------------------------------------------------------------ *
 * CurseForge zip
 * ------------------------------------------------------------------ */

interface CurseManifest {
  minecraft: {
    version: string
    modLoaders: { id: string; primary: boolean }[]
  }
  name: string
  version: string
  author: string
  files: { projectID: number; fileID: number; required: boolean }[]
  overrides?: string
}

function loaderFromCurseId(id: string): { loader: LoaderId; loaderVersion: string } {
  const [name, ...rest] = id.split('-')
  const version = rest.join('-')
  switch (name.toLowerCase()) {
    case 'fabric':
      return { loader: 'fabric', loaderVersion: version }
    case 'quilt':
      return { loader: 'quilt', loaderVersion: version }
    case 'neoforge':
      return { loader: 'neoforge', loaderVersion: version }
    case 'forge':
      return { loader: 'forge', loaderVersion: version }
    default:
      return { loader: 'vanilla', loaderVersion: '' }
  }
}

export async function importCurseForgeZip(archivePath: string, nameOverride?: string): Promise<Instance> {
  const manifest = await readEntryJson<CurseManifest>(archivePath, 'manifest.json')
  if (!manifest) {
    throw new Error('Das ist kein gültiges CurseForge-Modpack (manifest.json fehlt).')
  }

  if (!curseforge.hasApiKey()) {
    throw new Error(
      'Für CurseForge-Modpacks wird ein API-Schlüssel benötigt. Trage ihn in den Einstellungen ein.'
    )
  }

  // The manifest parsed, which says nothing about it having the right shape.
  if (!manifest.minecraft?.version) {
    throw new Error('Das CurseForge-Modpack nennt keine Minecraft-Version (manifest.json unvollständig).')
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('Die Dateiliste im CurseForge-Modpack fehlt oder ist beschädigt.')
  }

  const modLoaders = manifest.minecraft.modLoaders ?? []
  const primary = modLoaders.find((l) => l.primary) ?? modLoaders[0]
  const { loader, loaderVersion } = loaderFromCurseId(primary?.id ?? '')
  const name = nameOverride?.trim() || manifest.name || 'CurseForge Modpack'

  const instance = await createInstance({
    name,
    mcVersion: manifest.minecraft.version,
    loader,
    loaderVersion,
    description: `von ${manifest.author}`,
    icon: '📦'
  })

  persist({
    ...getInstance(instance.id),
    source: { type: 'curseforge', packName: manifest.name, packVersion: manifest.version }
  })

  void withTask(`${name} wird importiert`, 'Mods werden aufgelöst…', instance.id, async (task) => {
    const gameDir = paths.gameDir(instance.id)

    // Resolve every file id to a download url in batches.
    const fileIds = manifest.files.map((f) => f.fileID)
    const resolved: ProjectVersion[] = []
    for (let i = 0; i < fileIds.length; i += 100) {
      task.update(`Mods werden aufgelöst (${i}/${fileIds.length})…`, i / Math.max(fileIds.length, 1))
      resolved.push(...(await curseforge.getFiles(fileIds.slice(i, i + 100))))
    }

    if (resolved.length < fileIds.length) {
      // CurseForge silently omits ids it will not serve; without this the
      // instance would be created looking complete but missing mods.
      logger.warn(
        `CurseForge lieferte nur ${resolved.length} von ${fileIds.length} Dateien für ${name}`
      )
      task.update(
        `Achtung: ${fileIds.length - resolved.length} Mods konnten nicht aufgelöst werden`,
        null
      )
    }

    // `fileName` comes from the API, so it is pinned into the mods folder
    // rather than trusted as a path.
    const downloads: DownloadItem[] = resolved.map((version) => ({
      url: version.downloadUrl,
      path: safeJoin(join(gameDir, 'mods'), basename(version.fileName)),
      sha1: version.sha1,
      size: version.size
    }))

    task.span(0, 0.85)
    await downloadAll(downloads, { task, label: 'Modpack-Mods' })
    task.span(0, 1)

    task.update('Konfigurationen werden entpackt…', 0.9)
    extractSubtree(archivePath, manifest.overrides ?? 'overrides', gameDir)

    await syncContentWithDisk(instance.id)
    persist({ ...getInstance(instance.id), installing: false, installed: true })
    task.update('Import abgeschlossen', 1)
  }).catch((err) => {
    logger.error(`Import von ${name} fehlgeschlagen:`, err)
    markImportFailed(instance.id)
  })

  return instance
}

/** Dispatches by file extension / archive content. */
export async function importModpack(archivePath: string, nameOverride?: string): Promise<Instance> {
  if (!existsSync(archivePath)) throw new Error('Die Datei existiert nicht.')

  const ext = extname(archivePath).toLowerCase()
  if (ext === '.mrpack') return importMrpack(archivePath, nameOverride)

  const entries = listEntries(archivePath)
  if (entries.some((e) => e.name === 'modrinth.index.json')) {
    return importMrpack(archivePath, nameOverride)
  }
  if (entries.some((e) => e.name === 'manifest.json')) {
    return importCurseForgeZip(archivePath, nameOverride)
  }

  throw new Error('Unbekanntes Modpack-Format. Unterstützt werden .mrpack und CurseForge-Zips.')
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export interface ExportOptions {
  targetFile: string
  versionId?: string
  /** Extra folders from the game directory to bundle as overrides. */
  includeFolders?: string[]
}

/**
 * Writes a Modrinth-compatible `.mrpack`. Mods that came from Modrinth become
 * download entries; everything else is bundled into `overrides/` so the pack
 * stays complete.
 */
export async function exportMrpack(instanceId: string, options: ExportOptions): Promise<string> {
  const instance = getInstance(instanceId)

  return withTask(`${instance.name} wird exportiert`, 'Inhalte werden gesammelt…', instanceId, async (task) => {
    await syncContentWithDisk(instanceId)
    const current = getInstance(instanceId)

    const dependencies: Record<string, string> = { minecraft: current.mcVersion }
    switch (current.loader) {
      case 'fabric':
        dependencies['fabric-loader'] = current.loaderVersion
        break
      case 'quilt':
        dependencies['quilt-loader'] = current.loaderVersion
        break
      case 'neoforge':
        dependencies['neoforge'] = current.loaderVersion
        break
      case 'forge':
        dependencies['forge'] = current.loaderVersion
        break
      default:
        break
    }

    const files: MrpackIndex['files'] = []
    const bundled: string[] = []

    for (const item of current.content) {
      if (item.type === 'datapack') continue

      const folder =
        item.type === 'mod' ? 'mods' : item.type === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'
      const relative = `${folder}/${item.fileName}`

      // Only Modrinth links are guaranteed to be downloadable by other
      // launchers; anything else gets shipped inside the archive.
      if (item.provider === 'modrinth' && item.projectId && item.versionId && item.sha1) {
        try {
          const versions = await modrinth.getVersions(item.projectId)
          const version = versions.find((v) => v.versionId === item.versionId)
          if (version) {
            files.push({
              path: relative,
              hashes: { sha1: version.sha1 },
              env: { client: 'required', server: 'optional' },
              downloads: [version.downloadUrl],
              fileSize: version.size ?? 0
            })
            continue
          }
        } catch {
          // fall through to bundling
        }
      }

      bundled.push(relative)
    }

    task.update('Archiv wird geschrieben…', 0.4)

    const index: MrpackIndex = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: new Date().toISOString().slice(0, 10),
      name: current.name,
      summary: current.description || undefined,
      files,
      dependencies
    }

    const gameDir = paths.gameDir(instanceId)
    const overrideFolders = [
      ...new Set([...(options.includeFolders ?? ['config']), ...bundled.map((b) => b.split('/')[0])])
    ].filter((folder) => existsSync(join(gameDir, folder)))

    mkdirSync(join(options.targetFile, '..'), { recursive: true })

    // Bundle only the files that are not resolvable through a download link.
    const excluded = current.content
      .filter((item) => files.some((f) => basename(f.path) === item.fileName))
      .map((item) => {
        const folder =
          item.type === 'mod' ? 'mods' : item.type === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'
        return `${folder}/${item.fileName}`
      })

    await zipFolder(
      gameDir,
      options.targetFile,
      {
        include: overrideFolders,
        exclude: excluded,
        prefix: 'overrides',
        extraFiles: [{ name: 'modrinth.index.json', content: JSON.stringify(index, null, 2) }]
      },
      (done, total) => task.update(`${done} / ${total} Dateien`, 0.4 + (done / Math.max(total, 1)) * 0.6)
    )

    const size = statSync(options.targetFile).size
    logger.info(
      `${current.name} exportiert nach ${options.targetFile} ` +
        `(${files.length} Links, ${bundled.length} eingebettet, ${(size / 1024 / 1024).toFixed(1)} MB)`
    )

    return options.targetFile
  })
}

/** Installs a modpack straight from a provider search result. */
export async function installModpackFromProvider(
  provider: 'modrinth' | 'curseforge',
  projectId: string,
  versionId?: string
): Promise<Instance> {
  const project = await getProject(provider, projectId)
  const versions = await getVersions(provider, projectId)

  const version = versionId ? versions.find((v) => v.versionId === versionId) : versions[0]
  if (!version) throw new Error(`Für ${project.name} wurde keine Version gefunden.`)

  // `fileName` comes from the provider, so it is reduced to a bare name before
  // it becomes part of a path.
  const archive = join(paths.cache(), `${randomUUID()}-${basename(version.fileName)}`)

  await withTask(`${project.name} wird geladen`, version.versionNumber, undefined, async (task) => {
    let received = 0
    await downloadFile(
      { url: version.downloadUrl, path: archive, sha1: version.sha1 },
      (delta) => {
        received += delta
        const total = version.size ?? 0
        task.update(
          `${(received / 1024 / 1024).toFixed(1)} MB geladen`,
          total > 0 ? received / total : null
        )
      },
      3,
      undefined
    )
  })

  try {
    return await importModpack(archive, project.name)
  } finally {
    // The archive is only a transport step; keeping it would grow the cache by
    // the full pack size on every install.
    try {
      rmSync(archive, { force: true })
    } catch (err) {
      logger.debug(`Zwischendatei ${archive} nicht entfernt:`, err)
    }
  }
}
