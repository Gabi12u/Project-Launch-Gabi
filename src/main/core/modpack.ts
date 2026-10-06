import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type {
  ContentItem,
  ContentType,
  ImportAnalysis,
  ImportCounts,
  ImportFinding,
  Instance,
  LoaderId,
  ProjectVersion
} from '@shared/types'
import { ensureInstanceLayout, isValidVersionString, paths, safeJoin } from '../paths'
import { log } from '../logger'
import { notify } from '../events'
import { TaskCancelledError, withTask, type Task } from '../tasks'
import { downloadAll, downloadFile, type DownloadItem } from './net'
import { extractSubtree, listEntries, readEntryJson, zipFolder } from './archive'
import { createInstance, deleteInstance, finishImport, getInstance, persist, syncContentWithDisk, waitForInstanceSetup } from './instances'
import { withContentLock } from './contentLock'
import { withArchiving } from './restoreLock'
import { curseforge, getProject, getVersions, modrinth } from '../providers'
import { formatNumber, tr } from '@shared/i18n'

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
  // `minecraft` is mandatory in the mrpack spec. Quietly substituting a
  // hardcoded version produced an instance pinned to something the pack's mods
  // were never built for, which only shows up as a crash at first launch.
  const mcVersion = dependencies['minecraft']
  if (typeof mcVersion !== 'string' || !mcVersion.trim()) {
    throw new Error(
      tr('Im Modpack fehlt die Angabe, für welche Minecraft-Version es gedacht ist. Es wurde nicht importiert.', 'The modpack does not say which Minecraft version it is for. It was not imported.')
    )
  }
  // Both ids end up as path segments (paths.version(), paths.natives()), so a
  // crafted manifest cannot be allowed to smuggle a separator or ".." through.
  if (!isValidVersionString(mcVersion)) {
    throw new Error(tr('Die Minecraft-Version im Modpack ist ungültig.', 'The Minecraft version in the modpack is invalid.'))
  }

  const loaderVersionOf = (key: string): string => {
    const value = dependencies[key]
    if (!isValidVersionString(value)) {
      throw new Error(tr('Die Mod-Loader-Version im Modpack ist ungültig.', 'The mod loader version in the modpack is invalid.'))
    }
    return value
  }

  if (dependencies['fabric-loader']) {
    return { loader: 'fabric', loaderVersion: loaderVersionOf('fabric-loader'), mcVersion }
  }
  if (dependencies['quilt-loader']) {
    return { loader: 'quilt', loaderVersion: loaderVersionOf('quilt-loader'), mcVersion }
  }
  if (dependencies['neoforge']) {
    return { loader: 'neoforge', loaderVersion: loaderVersionOf('neoforge'), mcVersion }
  }
  if (dependencies['forge']) {
    return { loader: 'forge', loaderVersion: loaderVersionOf('forge'), mcVersion }
  }
  return { loader: 'vanilla', loaderVersion: '', mcVersion }
}

/**
 * Pulls the project and version id out of a Modrinth CDN link.
 *
 * They look like `https://cdn.modrinth.com/data/<projectId>/versions/<versionId>/<file>.jar`,
 * which is the only place an mrpack carries them — the index itself lists just
 * paths and hashes.
 */
function modrinthIdsFromUrl(url: string): { projectId: string; versionId: string } | null {
  const match = /cdn\.modrinth\.com\/data\/([A-Za-z0-9]+)\/versions\/([A-Za-z0-9]+)\//.exec(url)
  return match ? { projectId: match[1], versionId: match[2] } : null
}

/**
 * Hosts the Modrinth mrpack spec allows a download url to point at.
 * https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack
 */
const MRPACK_ALLOWED_HOSTS = new Set([
  'cdn.modrinth.com',
  'github.com',
  'raw.githubusercontent.com',
  'gitlab.com'
])

/**
 * Keeps only the download urls the mrpack spec actually allows.
 *
 * `file.downloads` comes straight out of an archive anyone could have built,
 * so nothing stops it from naming an arbitrary host. Without this, importing
 * a crafted .mrpack made the launcher fetch and write to disk from wherever
 * that manifest pointed, under a file name it also chose.
 */
export function filterAllowedMrpackUrls(urls: string[]): string[] {
  return urls.filter((raw) => {
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return false
    }
    return parsed.protocol === 'https:' && MRPACK_ALLOWED_HOSTS.has(parsed.hostname)
  })
}

/**
 * The `overrides/` folder a content type's files are staged under, both when
 * writing an export and when reading one back in.
 *
 * Datapacks fall to the default: `contentDir()` in paths.ts stages an
 * installed datapack directly under the game directory's own `datapacks`
 * folder, not inside a specific world's save, and exporting them there means
 * an import unpacks them straight back into that same staging folder.
 */
function overrideFolderFor(type: ContentType): string {
  switch (type) {
    case 'mod':
      return 'mods'
    case 'resourcepack':
      return 'resourcepacks'
    case 'shaderpack':
      return 'shaderpacks'
    default:
      return 'datapacks'
  }
}

function contentTypeFromPath(path: string): ContentType {
  const lower = path.toLowerCase()
  if (lower.startsWith('mods/')) return 'mod'
  if (lower.startsWith('resourcepacks/')) return 'resourcepack'
  if (lower.startsWith('shaderpacks/')) return 'shaderpack'
  return 'datapack'
}

export async function importMrpack(archivePath: string, nameOverride?: string, ownsArchive = false): Promise<Instance> {
  const index = await readEntryJson<MrpackIndex>(archivePath, 'modrinth.index.json')
  if (!index) {
    throw new Error(tr('Das ist kein gültiges .mrpack-Archiv (modrinth.index.json fehlt).', 'This is not a valid .mrpack archive (modrinth.index.json is missing).'))
  }
  if (!Array.isArray(index.files)) {
    throw new Error(tr('Die Dateiliste im .mrpack fehlt oder ist beschädigt.', 'The file list in the .mrpack is missing or damaged.'))
  }

  const { loader, loaderVersion, mcVersion } = loaderFromDependencies(index.dependencies ?? {})
  const name = nameOverride?.trim() || index.name || tr('Importiertes Modpack', 'Imported modpack')

  logger.info(`Importiere ${name} (${mcVersion}, ${loader} ${loaderVersion}, ${index.files.length} Dateien)`)

  const instance = await createInstance({
    name,
    mcVersion,
    loader,
    loaderVersion,
    description: index.summary ?? '',
    icon: '📦'
  }, { importing: true })

  try {
    persist({
      ...getInstance(instance.id),
      source: {
        type: 'mrpack',
        packName: index.name,
        packVersion: index.versionId
      }
    })
  } catch (err) {
    // The task below never starts, so nothing else would release the hold.
    finishImport(instance.id)
    throw err
  }

  // The content lock is held for the whole import, so the reconciler, a launch
  // and a backup all leave the folder alone while the pack is written into it.
  void withTask(tr(`${name} wird importiert`, `Importing ${name}`), tr('Mod-Dateien werden geladen…', 'Downloading mod files…'), instance.id, (task) =>
    withContentLock(instance.id, () => installMrpackFiles(instance.id, archivePath, index, task))
  )
    .catch(async (err) => {
      logger.error(`Import von ${name} fehlgeschlagen:`, err)
      await markImportFailed(instance.id, name, err)
    })
    .finally(() => settleImport(instance.id, archivePath, ownsArchive))

  return instance
}

/**
 * Ends an import's hold on its instance, and deletes a downloaded archive the
 * import was handed. Called only once the import task is completely done:
 * `installModpackFromProvider` used to delete the archive the moment
 * `importModpack` returned, while the task was still about to unpack the
 * pack's configs out of it.
 */
function settleImport(instanceId: string, archivePath: string, ownsArchive: boolean): void {
  finishImport(instanceId)
  if (ownsArchive) removeTransportArchive(archivePath)
}

/** Deletes a downloaded pack archive; it is only a transport step. */
function removeTransportArchive(archivePath: string): void {
  try {
    rmSync(archivePath, { force: true })
  } catch (err) {
    logger.debug(`Zwischendatei ${archivePath} nicht entfernt:`, err)
  }
}

/**
 * The import runs detached from the caller, so a failure has to clear the
 * instance's `installing` flag itself, or delete the instance outright on a
 * cancel, otherwise the card sits at "wird installiert" forever, or a
 * cancelled import passes for a real, finished install.
 */
async function markImportFailed(instanceId: string, name: string, err: unknown): Promise<void> {
  if (err instanceof TaskCancelledError) {
    // The background base setup `createInstance` started may still be
    // downloading libraries or installing a loader. Deleting the instance out
    // from under it used to make that setup fail moments later with "Instanz
    // ... existiert nicht"; instances.ts now ends it quietly once the instance
    // is gone, but waiting for it to actually finish first avoids the race
    // rather than only papering over its outcome.
    await waitForInstanceSetup(instanceId)
    // The archive itself was only ever read from, so nothing is lost by
    // starting over.
    try {
      deleteInstance(instanceId)
      return
    } catch (deleteErr) {
      logger.warn(`Abgebrochener Import von ${instanceId} konnte nicht gelöscht werden:`, deleteErr)
      notify(
        'warning',
        tr('Import abgebrochen', 'Import cancelled'),
        tr(
          `"${name}" wurde abgebrochen und ist unvollständig. Lösche die Instanz und importiere sie erneut.`,
          `"${name}" was cancelled and is incomplete. Delete the instance and import it again.`
        ),
        { route: `/instances/${instanceId}` }
      )
    }
  }
  // The base setup may still be running, and it used to mark the instance
  // installed once it finished, after this had already said it is not.
  await waitForInstanceSetup(instanceId)
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
  // Every url this file listed pointed at a host the mrpack spec does not
  // allow. Counted separately from `rejected` below: this is not a crafted
  // path trying to escape the instance folder, just a file this launcher
  // will not fetch, and it should cost the pack that one file, not the
  // whole import.
  const blockedByHost: string[] = []
  for (const file of clientFiles) {
    const rawUrls = (file.downloads ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0)
    const urls = filterAllowedMrpackUrls(rawUrls)
    if (urls.length === 0) {
      if (rawUrls.length > 0) {
        blockedByHost.push(file.path)
      } else {
        rejected.push(tr(`${file.path} (kein Download-Link)`, `${file.path} (no download link)`))
      }
      continue
    }
    try {
      downloads.push({
        url: urls[0],
        // The spec lists further URLs as mirrors precisely so a dead primary
        // link does not sink the file; only the first was ever tried.
        mirrors: urls.slice(1),
        path: safeJoin(gameDir, file.path),
        // Typed as string/number but never checked — a hash emitted as a number
        // reached `sha1.toLowerCase()` deep in the downloader and threw there.
        sha1: typeof file.hashes?.sha1 === 'string' ? file.hashes.sha1 : undefined,
        size: typeof file.fileSize === 'number' ? file.fileSize : undefined
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
      tr(
        `Das Modpack enthält ${rejected.length} unzulässige ${rejected.length === 1 ? 'Datei' : 'Dateien'} und wurde nicht installiert: ${rejected.slice(0, 3).join('; ')}`,
        `The modpack contains ${rejected.length} forbidden ${rejected.length === 1 ? 'file' : 'files'} and was not installed: ${rejected.slice(0, 3).join('; ')}`
      )
    )
  }

  task.span(0, 0.85)
  // Same reasoning as the CurseForge path: one dead CDN link (after its mirrors
  // were tried) should cost the pack that one file, not the whole install.
  const failed: string[] = []
  await downloadAll(downloads, {
    task,
    label: tr('Modpack-Dateien', 'Modpack files'),
    onError: (item, err) => {
      failed.push(basename(item.path))
      logger.warn(`Datei ${basename(item.path)} konnte nicht geladen werden:`, err)
      return 'skip'
    }
  })
  task.span(0, 1)

  if (failed.length > 0) {
    notify(
      'warning',
      tr(
        `${failed.length} ${failed.length === 1 ? 'Datei fehlt' : 'Dateien fehlen'}`,
        `${failed.length} ${failed.length === 1 ? 'file is missing' : 'files are missing'}`
      ),
      tr(
        `Das Modpack wurde installiert, aber ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' und weitere' : ''} konnten nicht geladen werden.`,
        `The modpack was installed, but ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' and more' : ''} could not be downloaded.`
      ),
      { route: `/instances/${instanceId}` }
    )
  }

  if (blockedByHost.length > 0) {
    notify(
      'warning',
      tr(
        `${blockedByHost.length} ${blockedByHost.length === 1 ? 'Datei übersprungen' : 'Dateien übersprungen'}`,
        `${blockedByHost.length} ${blockedByHost.length === 1 ? 'file skipped' : 'files skipped'}`
      ),
      tr(
        `Das Modpack wurde installiert, aber ${blockedByHost.slice(0, 3).join(', ')}${blockedByHost.length > 3 ? ' und weitere' : ''} wurden übersprungen, weil ihre Download-Adresse nicht zu den von Modrinth erlaubten Adressen gehört.`,
        `The modpack was installed, but ${blockedByHost.slice(0, 3).join(', ')}${blockedByHost.length > 3 ? ' and more' : ''} were skipped because their download address is not one Modrinth allows.`
      ),
      { route: `/instances/${instanceId}` }
    )
  }

  // Nothing below here checked cancellation before: a cancel that landed once
  // the downloads had finished was silently ignored, and the import went on to
  // unpack overrides, register content and report itself as finished anyway.
  task.throwIfCancelled()

  // 2. Overrides ------------------------------------------------------
  task.update(tr('Konfigurationen werden entpackt…', 'Unpacking configs…'), 0.9)
  // Slashes evened out the way `extractSubtree` does, or a zip written with
  // backslashes skipped both folders.
  const entryNames = listEntries(archivePath).map((e) => e.name.replace(/\\/g, '/'))
  if (entryNames.some((name) => name.startsWith('overrides/'))) {
    extractSubtree(archivePath, 'overrides', gameDir)
  }
  if (entryNames.some((name) => name.startsWith('client-overrides/'))) {
    extractSubtree(archivePath, 'client-overrides', gameDir)
  }
  task.throwIfCancelled()

  // 3. Register the files as content ----------------------------------
  task.update(tr('Mods werden erfasst…', 'Registering mods…'), 0.95)
  // Forced: the import holds the content lock itself.
  await syncContentWithDisk(instanceId, { force: true })
  task.throwIfCancelled()

  // The base setup (libraries, assets, the client jar) that `createInstance`
  // started in the background may still be running or may have failed by now;
  // marking the instance installed without checking would hide that. Awaited
  // before the instance is read, so a rename during that wait is not undone.
  // Raced against the task's own signal: this wait alone can take minutes, and
  // a cancel must not sit through all of it.
  const baseSetupOk = await waitForInstanceSetup(instanceId, task.signal)
  task.throwIfCancelled()

  const instance = getInstance(instanceId)
  const enriched: ContentItem[] = instance.content.map((item) => {
    // By folder as well as name: a resource pack and a mod can share a file
    // name, and the mod's ids and hash then landed on the resource pack.
    const match = clientFiles.find(
      (f) => basename(f.path) === item.fileName && contentTypeFromPath(f.path) === item.type
    )
    if (!match) return item

    const url = match.downloads?.[0] ?? ''
    const ids = modrinthIdsFromUrl(url)

    return {
      ...item,
      provider: ids ? 'modrinth' : item.provider,
      // Without these two the item is skipped by `checkUpdates` (it filters on
      // `projectId`) and dropped from the slim download list on export, so an
      // imported pack silently never saw updates and re-exported every mod as a
      // bundled binary. The ids sit right there in the CDN path.
      projectId: ids?.projectId ?? item.projectId,
      versionId: ids?.versionId ?? item.versionId,
      sha1: match.hashes?.sha1 ?? item.sha1,
      size: typeof match.fileSize === 'number' ? match.fileSize : item.size,
      type: contentTypeFromPath(match.path)
    }
  })

  if (!baseSetupOk) {
    persist({ ...instance, content: enriched, installing: false, installed: false })
    throw new Error(
      tr('Minecraft selbst konnte nicht eingerichtet werden. Nutze "Reparieren", um es erneut zu versuchen.', 'Minecraft itself could not be set up. Use "Repair" to try again.')
    )
  }

  task.throwIfCancelled()
  persist({ ...instance, content: enriched, installing: false, installed: true })
  task.update(tr('Import abgeschlossen', 'Import finished'), 1)
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

export async function importCurseForgeZip(archivePath: string, nameOverride?: string, ownsArchive = false): Promise<Instance> {
  const manifest = await readEntryJson<CurseManifest>(archivePath, 'manifest.json')
  if (!manifest) {
    throw new Error(tr('Das ist kein gültiges CurseForge-Modpack (manifest.json fehlt).', 'This is not a valid CurseForge modpack (manifest.json is missing).'))
  }

  if (!curseforge.hasApiKey()) {
    throw new Error(
      tr('Für CurseForge-Modpacks wird ein API-Schlüssel benötigt. Trage ihn in den Einstellungen ein.', 'CurseForge modpacks need an API key. Enter it in the settings.')
    )
  }

  // The manifest parsed, which says nothing about it having the right shape.
  if (!manifest.minecraft?.version) {
    throw new Error(tr('Das CurseForge-Modpack nennt keine Minecraft-Version (manifest.json unvollständig).', 'The CurseForge modpack names no Minecraft version (manifest.json is incomplete).'))
  }
  // Becomes a path segment (paths.version(), paths.natives()) further down,
  // so a crafted manifest cannot be allowed to smuggle a separator or ".." in.
  if (!isValidVersionString(manifest.minecraft.version)) {
    throw new Error(tr('Die Minecraft-Version im Modpack ist ungültig.', 'The Minecraft version in the modpack is invalid.'))
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error(tr('Die Dateiliste im CurseForge-Modpack fehlt oder ist beschädigt.', 'The file list in the CurseForge modpack is missing or damaged.'))
  }

  const modLoaders = Array.isArray(manifest.minecraft.modLoaders) ? manifest.minecraft.modLoaders : []
  const primary = modLoaders.find((l) => l?.primary) ?? modLoaders[0]

  // An empty list silently produced a vanilla instance that then got filled
  // with Forge/Fabric jars — an import that "succeeded" and crashes at launch,
  // with nothing pointing at the manifest as the cause.
  if (!primary?.id) {
    throw new Error(
      tr('Das CurseForge-Modpack nennt keinen Mod-Loader (manifest.json unvollständig) und wurde nicht importiert.', 'The CurseForge modpack names no mod loader (manifest.json is incomplete) and was not imported.')
    )
  }

  const { loader, loaderVersion } = loaderFromCurseId(primary.id)
  if (loaderVersion && !isValidVersionString(loaderVersion)) {
    throw new Error(tr('Die Mod-Loader-Version im Modpack ist ungültig.', 'The mod loader version in the modpack is invalid.'))
  }
  const name = nameOverride?.trim() || manifest.name || 'CurseForge Modpack'

  const instance = await createInstance({
    name,
    mcVersion: manifest.minecraft.version,
    loader,
    loaderVersion,
    description: tr(`von ${manifest.author}`, `by ${manifest.author}`),
    icon: '📦'
  }, { importing: true })

  try {
    persist({
      ...getInstance(instance.id),
      source: { type: 'curseforge', packName: manifest.name, packVersion: manifest.version }
    })
  } catch (err) {
    // The task below never starts, so nothing else would release the hold.
    finishImport(instance.id)
    throw err
  }

  // Held for the whole import, like the mrpack one above.
  void withTask(tr(`${name} wird importiert`, `Importing ${name}`), tr('Mods werden aufgelöst…', 'Resolving mods…'), instance.id, (task) => withContentLock(instance.id, async () => {
    const gameDir = paths.gameDir(instance.id)

    // Resolve every file id to a download url in batches. Entries without a
    // usable id are dropped here rather than sent along, where a single bad
    // value made the API reject the whole 100-item batch.
    const fileIds = manifest.files
      .map((f) => f?.fileID)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))

    const resolved: ProjectVersion[] = []
    let failedBatches = 0
    for (let i = 0; i < fileIds.length; i += 100) {
      task.update(tr(`Mods werden aufgelöst (${i}/${fileIds.length})…`, `Resolving mods (${i}/${fileIds.length})…`), i / Math.max(fileIds.length, 1))
      try {
        resolved.push(...(await curseforge.getFiles(fileIds.slice(i, i + 100))))
      } catch (err) {
        // One rejected batch must not abort an import of several hundred mods;
        // the shortfall is reported below either way.
        logger.warn(`CurseForge-Batch ab ${i} konnte nicht aufgelöst werden:`, err)
        failedBatches++
      }
    }

    // Every batch failing is not a pack with a few missing mods, it is
    // CurseForge being out of reach. Carrying on finished the import with an
    // instance that had no mods at all and called it a success.
    if (fileIds.length > 0 && resolved.length === 0 && failedBatches > 0) {
      throw new Error(
        tr(
          'Die Mod-Liste des Modpacks konnte bei CurseForge nicht abgefragt werden. Prüfe die Internetverbindung und importiere das Modpack erneut.',
          'The modpack\'s mod list could not be fetched from CurseForge. Check the internet connection and import the modpack again.'
        )
      )
    }

    if (resolved.length < fileIds.length) {
      // CurseForge silently omits ids it will not serve; without this the
      // instance would be created looking complete but missing mods.
      logger.warn(
        `CurseForge lieferte nur ${resolved.length} von ${fileIds.length} Dateien für ${name}`
      )
      task.update(
        tr(
          fileIds.length - resolved.length === 1
            ? 'Achtung: 1 Mod wurde bei CurseForge nicht gefunden'
            : `Achtung: ${fileIds.length - resolved.length} Mods wurden bei CurseForge nicht gefunden`,
          fileIds.length - resolved.length === 1
            ? 'Warning: 1 mod was not found on CurseForge'
            : `Warning: ${fileIds.length - resolved.length} mods were not found on CurseForge`
        ),
        null
      )

      // `task.update` above is overwritten by the next status line moments
      // later, so without a persistent notification this warning never
      // actually reaches the user.
      const resolvedIds = new Set(resolved.map((v) => Number(v.versionId)))
      const missing = manifest.files.filter(
        (f) => typeof f?.fileID === 'number' && !resolvedIds.has(f.fileID)
      )
      const ids = missing.slice(0, 5).map((f) => f.projectID)
      notify(
        'warning',
        tr(
          `${missing.length} ${missing.length === 1 ? 'Mod fehlt' : 'Mods fehlen'} im Modpack`,
          `${missing.length} ${missing.length === 1 ? 'mod is' : 'mods are'} missing from the modpack`
        ),
        tr(
          `${name}: CurseForge konnte ${missing.length} ${missing.length === 1 ? 'Mod' : 'Mods'} nicht laden ` +
            `(${ids.length === 1 ? 'Projekt-ID' : 'Projekt-IDs'} ${ids.join(', ')}${missing.length > 5 ? ` und ${missing.length - 5} weitere` : ''}).`,
          `${name}: CurseForge could not deliver ${missing.length} ${missing.length === 1 ? 'mod' : 'mods'} ` +
            `(${ids.length === 1 ? 'project ID' : 'project IDs'} ${ids.join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}).`
        ),
        { route: `/instances/${instance.id}` }
      )
    }

    // A manifest also lists resource packs and shaders, and they all went into
    // mods/, where they did nothing and never showed up in the content list.
    // The project's own class decides the folder; an unknown one stays a mod.
    const projectTypes = await curseforge.getProjectTypes(resolved.map((version) => version.projectId))
    const typeOf = (version: ProjectVersion): ContentType => {
      const type = projectTypes.get(version.projectId)
      return type === 'resourcepack' || type === 'shaderpack' || type === 'datapack' ? type : 'mod'
    }

    // `fileName` comes from the API, so it is pinned into its folder rather
    // than trusted as a path.
    const downloads: DownloadItem[] = resolved.map((version) => ({
      url: version.downloadUrl,
      path: safeJoin(join(gameDir, overrideFolderFor(typeOf(version))), basename(version.fileName)),
      sha1: version.sha1,
      size: version.size
    }))

    task.span(0, 0.85)
    // Per file rather than fail-fast: CurseForge lets an author forbid
    // third-party downloads, and the guessed CDN url for such a mod answers
    // 403. One of those used to throw away an otherwise finished install of
    // several hundred mods, with no way to resume — re-importing started over
    // in a brand new instance folder.
    const failed: string[] = []
    await downloadAll(downloads, {
      task,
      label: tr('Modpack-Mods', 'Modpack mods'),
      onError: (item, err) => {
        failed.push(basename(item.path))
        logger.warn(`Mod ${basename(item.path)} konnte nicht geladen werden:`, err)
        return 'skip'
      }
    })
    task.span(0, 1)

    if (failed.length > 0) {
      notify(
        'warning',
        tr(
          `${failed.length} ${failed.length === 1 ? 'Mod fehlt' : 'Mods fehlen'}`,
          `${failed.length} ${failed.length === 1 ? 'mod is missing' : 'mods are missing'}`
        ),
        tr(
          `${name} wurde installiert, aber ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' und weitere' : ''} konnten nicht geladen werden. Lade sie bei Bedarf von Hand nach.`,
          `${name} was installed, but ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' and more' : ''} could not be downloaded. Add them by hand if needed.`
        ),
        { route: `/instances/${instance.id}` }
      )
    }

    // Nothing below here checked cancellation before: a cancel that landed
    // once the downloads had finished was silently ignored, and the import
    // went on to unpack overrides, register content and report itself as
    // finished anyway.
    task.throwIfCancelled()

    task.update(tr('Konfigurationen werden entpackt…', 'Unpacking configs…'), 0.9)
    extractSubtree(archivePath, manifest.overrides ?? 'overrides', gameDir)
    task.throwIfCancelled()

    // Forced: the import holds the content lock itself.
    await syncContentWithDisk(instance.id, { force: true })
    task.throwIfCancelled()

    // The sync only sees files, so every mod came out as local content with
    // no project id: no update checks, and an export bundled each one as a
    // binary. The CurseForge answer above already names project and file.
    const byFileName = new Map(resolved.map((version) => [basename(version.fileName), version]))
    const synced = getInstance(instance.id)
    persist({
      ...synced,
      content: synced.content.map((item) => {
        const version = byFileName.get(item.fileName.replace(/\.disabled$/, ''))
        if (!version || item.type !== typeOf(version)) return item
        return {
          ...item,
          provider: 'curseforge',
          projectId: version.projectId,
          versionId: version.versionId,
          version: version.versionNumber || item.version,
          sha1: version.sha1 ?? item.sha1,
          size: version.size ?? item.size,
          gameVersions: version.gameVersions.length > 0 ? version.gameVersions : item.gameVersions,
          loaders: version.loaders.length > 0 ? version.loaders : item.loaders,
          releasedAt: version.releasedAt || item.releasedAt
        }
      })
    })

    // Raced against the task's own signal: the base setup alone can take
    // minutes, and a cancel here must not sit through all of it.
    const baseSetupOk = await waitForInstanceSetup(instance.id, task.signal)
    task.throwIfCancelled()
    if (!baseSetupOk) {
      persist({ ...getInstance(instance.id), installing: false, installed: false })
      throw new Error(
        tr('Minecraft selbst konnte nicht eingerichtet werden. Nutze "Reparieren", um es erneut zu versuchen.', 'Minecraft itself could not be set up. Use "Repair" to try again.')
      )
    }

    task.throwIfCancelled()
    persist({ ...getInstance(instance.id), installing: false, installed: true })
    task.update(tr('Import abgeschlossen', 'Import finished'), 1)
  }))
    .catch(async (err) => {
      logger.error(`Import von ${name} fehlgeschlagen:`, err)
      await markImportFailed(instance.id, name, err)
    })
    .finally(() => settleImport(instance.id, archivePath, ownsArchive))

  return instance
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

const EMPTY_COUNTS: ImportCounts = {
  mods: 0,
  resourcePacks: 0,
  shaderPacks: 0,
  worlds: 0,
  configs: 0
}

/** Sorts an mrpack's file list into the counts the report shows. */
function countMrpackFiles(files: MrpackIndex['files']): ImportCounts {
  const counts = { ...EMPTY_COUNTS }
  for (const file of files) {
    const lower = (file.path ?? '').toLowerCase()
    if (lower.startsWith('mods/')) counts.mods++
    else if (lower.startsWith('resourcepacks/')) counts.resourcePacks++
    else if (lower.startsWith('shaderpacks/')) counts.shaderPacks++
    else if (lower.startsWith('config/')) counts.configs++
  }
  return counts
}

/** Counts what the `overrides/` tree of an archive would contribute. */
function countOverrides(archivePath: string, prefixes: string[]): ImportCounts {
  const counts = { ...EMPTY_COUNTS }
  let entries: ReturnType<typeof listEntries>
  try {
    entries = listEntries(archivePath)
  } catch {
    return counts
  }

  // The empty prefix stands for "no prefix at all" and cannot be matched by
  // `startsWith('/')` like the others, so it is tried last, as a fallback
  // once none of the real prefixes matched: a plain zip with mods/ and
  // config/ right at its root only ever matches this way.
  const namedPrefixes = prefixes.filter((candidate) => candidate !== '')
  const hasEmptyPrefix = namedPrefixes.length !== prefixes.length

  for (const entry of entries) {
    const lower = entry.name.toLowerCase().replace(/\\/g, '/')
    const prefix = namedPrefixes.find((candidate) => lower.startsWith(`${candidate}/`))
    if (prefix === undefined && !hasEmptyPrefix) continue
    const rest = prefix === undefined ? lower : lower.slice(prefix.length + 1)
    if (rest.startsWith('mods/') && rest.endsWith('.jar')) counts.mods++
    else if (rest.startsWith('resourcepacks/') && rest.includes('.')) counts.resourcePacks++
    else if (rest.startsWith('shaderpacks/') && rest.includes('.')) counts.shaderPacks++
    else if (rest.startsWith('config/')) counts.configs++
    else if (/^saves\/[^/]+\/level\.dat$/.test(rest)) counts.worlds++
  }
  return counts
}

function addCounts(a: ImportCounts, b: ImportCounts): ImportCounts {
  return {
    mods: a.mods + b.mods,
    resourcePacks: a.resourcePacks + b.resourcePacks,
    shaderPacks: a.shaderPacks + b.shaderPacks,
    worlds: a.worlds + b.worlds,
    configs: a.configs + b.configs
  }
}

/**
 * Looks inside a modpack file and reports what an import would find.
 *
 * Same purpose as `analyzeInstanceFolder`: the format detection in
 * `importModpack` below already knows how to tell an mrpack from a CurseForge
 * zip, but its answer only ever surfaced as a finished import or a thrown
 * sentence. This runs the same checks and hands back a report, so a pack whose
 * format is not recognised can still say what it does contain.
 */
export async function analyzeModpackFile(archivePath: string): Promise<ImportAnalysis> {
  const base: ImportAnalysis = {
    path: archivePath,
    kind: 'unknown',
    sourceLabel: tr('Unbekannt', 'Unknown'),
    name: basename(archivePath).replace(/\.(mrpack|zip)$/i, ''),
    mcVersion: null,
    loader: null,
    loaderVersion: '',
    versionGuessed: false,
    counts: { ...EMPTY_COUNTS },
    findings: [],
    estimatedBytes: 0,
    canImport: false
  }

  if (!existsSync(archivePath)) {
    return { ...base, findings: [{ level: 'blocker', title: tr('Die Datei existiert nicht.', 'The file does not exist.') }] }
  }

  try {
    base.estimatedBytes = statSync(archivePath).size
  } catch {
    // Size is decoration here, not a reason to give up on the analysis.
  }

  let entries: { name: string }[] = []
  try {
    entries = listEntries(archivePath)
  } catch (err) {
    return {
      ...base,
      findings: [
        {
          level: 'blocker',
          title: tr('Das Archiv konnte nicht gelesen werden', 'The archive could not be read'),
          detail: err instanceof Error ? err.message : String(err)
        }
      ]
    }
  }

  const names = new Set(entries.map((entry) => entry.name))

  /* Modrinth .mrpack ------------------------------------------------- */
  if (names.has('modrinth.index.json')) {
    const index = await readEntryJson<MrpackIndex>(archivePath, 'modrinth.index.json')
    if (!index || !Array.isArray(index.files)) {
      return {
        ...base,
        kind: 'mrpack',
        sourceLabel: tr('Modrinth-Modpack', 'Modrinth modpack'),
        findings: [
          {
            level: 'blocker',
            title: tr('Die Beschreibung im Modpack ist beschädigt', 'The modpack description is damaged'),
            detail: tr('Die Datei modrinth.index.json fehlt oder lässt sich nicht lesen.', 'The file modrinth.index.json is missing or cannot be read.')
          }
        ]
      }
    }

    const findings: ImportFinding[] = []
    let mcVersion: string | null = null
    let loader: LoaderId | null = null
    let loaderVersion = ''

    try {
      const resolved = loaderFromDependencies(index.dependencies ?? {})
      mcVersion = resolved.mcVersion
      loader = resolved.loader
      loaderVersion = resolved.loaderVersion
      findings.push({
        level: 'ok',
        title: tr('Als Modrinth-Modpack erkannt', 'Recognized as a Modrinth modpack'),
        detail: `Minecraft ${mcVersion}${loader !== 'vanilla' ? `, ${loader} ${loaderVersion}`.trimEnd() : ''}`
      })
    } catch (err) {
      findings.push({
        level: 'blocker',
        title: tr('Das Modpack nennt keine Minecraft-Version', 'The modpack names no Minecraft version'),
        detail: err instanceof Error ? err.message : undefined
      })
    }

    const counts = addCounts(countMrpackFiles(index.files), countOverrides(archivePath, ['overrides', 'client-overrides']))

    const clientOnly = index.files.filter((file) => file.env?.client === 'unsupported').length
    if (clientOnly > 0) {
      findings.push({
        level: 'warn',
        title:
          clientOnly === 1
            ? tr('1 Datei ist nur für Server gedacht', '1 file is meant for servers only')
            : tr(`${clientOnly} Dateien sind nur für Server gedacht`, `${clientOnly} files are meant for servers only`),
        detail: tr('Das wird beim Import übersprungen, so wie es das Modpack vorsieht.', 'This is skipped during import, as the modpack intends.')
      })
    }

    return {
      ...base,
      kind: 'mrpack',
      sourceLabel: tr('Modrinth-Modpack', 'Modrinth modpack'),
      name: index.name?.trim() || base.name,
      mcVersion,
      loader,
      loaderVersion,
      counts,
      findings,
      canImport: mcVersion != null
    }
  }

  /* CurseForge zip --------------------------------------------------- */
  if (names.has('manifest.json')) {
    const manifest = await readEntryJson<CurseManifest>(archivePath, 'manifest.json')
    if (!manifest) {
      return {
        ...base,
        kind: 'curseforge-zip',
        sourceLabel: tr('CurseForge-Modpack', 'CurseForge modpack'),
        findings: [
          {
            level: 'blocker',
            title: tr('Die Beschreibung im Modpack ist beschädigt', 'The modpack description is damaged'),
            detail: tr('Die Datei manifest.json fehlt oder lässt sich nicht lesen.', 'The file manifest.json is missing or cannot be read.')
          }
        ]
      }
    }

    const findings: ImportFinding[] = []
    const mcVersion = manifest.minecraft?.version ?? null
    if (!mcVersion) {
      findings.push({
        level: 'blocker',
        title: tr('Das Modpack nennt keine Minecraft-Version', 'The modpack names no Minecraft version'),
        detail: tr('Die manifest.json ist unvollständig.', 'The manifest.json is incomplete.')
      })
    }

    // The manifest names the loader as a single id like "fabric-0.15.7".
    const loaderId = manifest.minecraft?.modLoaders?.find((entry) => entry.primary)?.id ??
      manifest.minecraft?.modLoaders?.[0]?.id ??
      ''
    let loader: LoaderId | null = null
    let loaderVersion = ''
    if (loaderId) {
      const [rawName, ...rest] = loaderId.split('-')
      const known: LoaderId[] = ['fabric', 'forge', 'neoforge', 'quilt']
      const lower = rawName.toLowerCase()
      loader = known.includes(lower as LoaderId) ? (lower as LoaderId) : null
      loaderVersion = rest.join('-')
      if (!loader) {
        findings.push({
          level: 'warn',
          title: tr(`Unbekannter Mod-Loader "${rawName}"`, `Unknown mod loader "${rawName}"`),
          detail: tr('Der Loader muss nach dem Import von Hand gesetzt werden.', 'The loader has to be set by hand after the import.')
        })
      }
    } else {
      findings.push({
        level: 'blocker',
        title: tr('Das Modpack nennt keinen Mod-Loader', 'The modpack names no mod loader'),
        detail: tr('Die manifest.json ist unvollständig.', 'The manifest.json is incomplete.')
      })
    }

    if (mcVersion && loader) {
      findings.push({
        level: 'ok',
        title: tr('Als CurseForge-Modpack erkannt', 'Recognized as a CurseForge modpack'),
        detail: `Minecraft ${mcVersion}, ${loader} ${loaderVersion}`.trimEnd()
      })
    }

    const listed = Array.isArray(manifest.files) ? manifest.files.length : 0
    const overrideFolder = manifest.overrides ?? 'overrides'
    const counts = addCounts({ ...EMPTY_COUNTS, mods: listed }, countOverrides(archivePath, [overrideFolder.toLowerCase()]))

    if (listed > 0) {
      findings.push({
        level: 'warn',
        title:
          listed === 1
            ? tr('1 Mod wird beim Import von CurseForge geladen', '1 mod is downloaded from CurseForge during import')
            : tr(`${listed} Mods werden beim Import einzeln von CurseForge geladen`, `${listed} mods are downloaded one by one from CurseForge during import`),
        detail: tr(
          'CurseForge-Modpacks enthalten die Mods nicht selbst, sondern nur eine Liste. Für den Import wird ein CurseForge-Schlüssel in den Einstellungen und eine Internetverbindung gebraucht.',
          'CurseForge modpacks do not contain the mods themselves, only a list. Importing needs a CurseForge key in the settings and an internet connection.'
        )
      })
    }

    return {
      ...base,
      kind: 'curseforge-zip',
      sourceLabel: tr('CurseForge-Modpack', 'CurseForge modpack'),
      name: manifest.name?.trim() || base.name,
      mcVersion,
      loader,
      loaderVersion,
      counts,
      findings,
      canImport: mcVersion != null && loader != null
    }
  }

  /* Neither ---------------------------------------------------------- */
  //
  // Not a recognised pack, but an archive that carries a mods folder is still
  // worth offering: the compatibility import treats it as a loose game folder
  // rather than refusing outright.
  const loose = countOverrides(archivePath, ['', '.minecraft', 'minecraft', 'overrides'])
  const anyContent = loose.mods + loose.resourcePacks + loose.shaderPacks + loose.configs > 0

  return {
    ...base,
    counts: loose,
    findings: [
      {
        level: 'blocker',
        title: tr('Kein bekanntes Modpack-Format', 'Not a known modpack format'),
        detail: tr(
          'Weder eine modrinth.index.json noch eine manifest.json gefunden. Unterstützt werden .mrpack-Dateien und CurseForge-Zips.',
          'Found neither a modrinth.index.json nor a manifest.json. Supported are .mrpack files and CurseForge zips.'
        )
      },
      ...(anyContent
        ? [
            {
              level: 'warn' as const,
              title: tr('Es wurden trotzdem Inhalte gefunden', 'Content was found anyway'),
              detail: tr(
                'Ein Kompatibilitäts-Import kann versucht werden. Minecraft-Version und Loader müssen dabei von Hand gewählt werden.',
                'A compatibility import can be tried. Minecraft version and loader have to be chosen by hand.'
              )
            }
          ]
        : [])
    ],
    canImport: false
  }
}

/** Dispatches by file extension / archive content. */
export async function importModpack(
  archivePath: string,
  nameOverride?: string,
  /**
   * Hands the archive over: the import deletes it once its own task is done.
   * Left at false, the archive is the user's own file and stays untouched.
   */
  ownsArchive = false
): Promise<Instance> {
  if (!existsSync(archivePath)) throw new Error(tr('Die Datei existiert nicht.', 'The file does not exist.'))

  const ext = extname(archivePath).toLowerCase()
  if (ext === '.mrpack') return importMrpack(archivePath, nameOverride, ownsArchive)

  const entries = listEntries(archivePath)
  if (entries.some((e) => e.name === 'modrinth.index.json')) {
    return importMrpack(archivePath, nameOverride, ownsArchive)
  }
  if (entries.some((e) => e.name === 'manifest.json')) {
    return importCurseForgeZip(archivePath, nameOverride, ownsArchive)
  }

  throw new Error(tr('Unbekanntes Modpack-Format. Unterstützt werden .mrpack und CurseForge-Zips.', 'Unknown modpack format. Supported are .mrpack and CurseForge zips.'))
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
 * Top-level folders modpacks ship next to `config`. An allowlist on purpose:
 * other folders in a game directory hold the player's own data, and some
 * (Essential's, for one) keep account details a shared pack must never carry.
 */
const PACK_FOLDERS = new Set([
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts',
  'global_packs',
  'globalpacks',
  'openloader',
  'resources',
  'patchouli_books',
  'fancymenu_data',
  'paxi'
])

/**
 * The folders a pack export carries by default. Only `config` used to go
 * along, so scripts (kubejs, scripts), defaultconfigs and similar folders a
 * modpack depends on were missing from the exported file.
 */
function packFolders(gameDir: string): string[] {
  try {
    return readdirSync(gameDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && PACK_FOLDERS.has(entry.name.toLowerCase()))
      .map((entry) => entry.name)
  } catch {
    return ['config']
  }
}

/** Hashes a file already on disk, used when the provider did not supply a sha512. */
function sha512File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/**
 * Writes a Modrinth-compatible `.mrpack`. Mods that came from Modrinth become
 * download entries; everything else is bundled into `overrides/` so the pack
 * stays complete.
 */
export async function exportMrpack(instanceId: string, options: ExportOptions): Promise<string> {
  const instance = getInstance(instanceId)

  // Marked as archiving, so the instance cannot be deleted mid export.
  return withTask(tr(`${instance.name} wird exportiert`, `Exporting ${instance.name}`), tr('Inhalte werden gesammelt…', 'Collecting content…'), instanceId, (task) => withArchiving(instanceId, async () => {
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
      task.throwIfCancelled()
      const folder = overrideFolderFor(item.type)
      const relative = `${folder}/${item.fileName}`

      // Only Modrinth links are guaranteed to be downloadable by other
      // launchers; anything else gets shipped inside the archive.
      if (item.provider === 'modrinth' && item.projectId && item.versionId && item.sha1) {
        try {
          const versions = await modrinth.getVersions(item.projectId)
          const version = versions.find((v) => v.versionId === item.versionId)
          if (version) {
            // Every entry needs both hashes for other launchers to verify the
            // download. Modrinth almost always sends sha512 itself; the rare
            // record without one is hashed from the copy already on disk.
            const sha512 = version.sha512 ?? (await sha512File(join(paths.gameDir(instanceId), relative)))
            files.push({
              path: relative,
              hashes: { sha1: version.sha1, sha512 },
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

    task.update(tr('Archiv wird geschrieben…', 'Writing archive…'), 0.4)

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
      ...new Set([...(options.includeFolders ?? packFolders(gameDir)), ...bundled.map((b) => b.split('/')[0])])
    ].filter((folder) => existsSync(join(gameDir, folder)))

    mkdirSync(join(options.targetFile, '..'), { recursive: true })

    // Bundle only the files that are not resolvable through a download link.
    // By folder and name: matched by name alone, a data pack of your own
    // called like a downloaded resource pack was left out as well, and then
    // missing from the pack without a word.
    const excluded = current.content
      .map((item) => `${overrideFolderFor(item.type)}/${item.fileName}`)
      .filter((path) => files.some((f) => f.path === path))

    const skipped: string[] = []
    const skippedLinks: string[] = []
    await zipFolder(
      gameDir,
      options.targetFile,
      {
        include: overrideFolders,
        // Reported below. Without these a locked file or a link was simply
        // missing from the pack while the export still said it worked.
        onSkip: (file) => skipped.push(file),
        onSkipLink: (file) => skippedLinks.push(file),
        exclude: excluded,
        prefix: 'overrides',
        extraFiles: [{ name: 'modrinth.index.json', content: JSON.stringify(index, null, 2) }],
        // Without it the Cancel button in the task dock reached nothing: the
        // archive was written to the end regardless.
        signal: task.signal
      },
      (done, total) => task.update(tr(`${done} / ${total} Dateien`, `${done} / ${total} files`), 0.4 + (done / Math.max(total, 1)) * 0.6)
    )

    if (skipped.length > 0) {
      const list = skipped.slice(0, 3).join(', ') + (skipped.length > 3 ? tr(' und weitere', ' and more') : '')
      notify(
        'warning',
        tr('Export unvollständig', 'Export incomplete'),
        tr(
          `${skipped.length === 1 ? '1 Datei konnte' : `${skipped.length} Dateien konnten`} nicht gelesen werden und ${skipped.length === 1 ? 'fehlt' : 'fehlen'} im Modpack: ${list}. Schließe das Spiel und Programme, die sie offen halten, und exportiere erneut.`,
          `${skipped.length === 1 ? '1 file' : `${skipped.length} files`} could not be read and ${skipped.length === 1 ? 'is' : 'are'} missing from the modpack: ${list}. Close the game and programs that keep them open, and export again.`
        )
      )
    }
    if (skippedLinks.length > 0) {
      const list = skippedLinks.slice(0, 3).join(', ') + (skippedLinks.length > 3 ? tr(' und weitere', ' and more') : '')
      notify(
        'info',
        tr('Verknüpfungen nicht exportiert', 'Links not exported'),
        tr(`Verknüpfungen lassen sich nicht in ein Modpack packen und fehlen darin: ${list}.`, `Links cannot be packed into a modpack and are missing from it: ${list}.`)
      )
    }

    const size = statSync(options.targetFile).size
    logger.info(
      `${current.name} exportiert nach ${options.targetFile} ` +
        `(${files.length} Links, ${bundled.length} eingebettet, ${(size / 1024 / 1024).toFixed(1)} MB)`
    )

    return options.targetFile
  }))
}

/** Installs a modpack straight from a provider search result. */
export async function installModpackFromProvider(
  provider: 'modrinth' | 'curseforge',
  projectId: string,
  versionId?: string
): Promise<Instance> {
  const project = await getProject(provider, projectId)
  const versions = await getVersions(provider, projectId)

  // Without a chosen version the newest stable release, not simply the
  // newest file, which can be an alpha or a beta.
  const version = versionId
    ? versions.find((v) => v.versionId === versionId)
    : (versions.find((v) => v.releaseType === 'release') ?? versions[0])
  if (!version) throw new Error(tr(`Für ${project.name} wurde keine Version gefunden.`, `No version was found for ${project.name}.`))

  // `fileName` comes from the provider, so it is reduced to a bare name before
  // it becomes part of a path.
  const archive = join(paths.cache(), `${randomUUID()}-${basename(version.fileName)}`)

  await withTask(tr(`${project.name} wird geladen`, `Downloading ${project.name}`), version.versionNumber, undefined, async (task) => {
    let received = 0
    await downloadFile(
      { url: version.downloadUrl, path: archive, sha1: version.sha1 },
      (delta) => {
        received += delta
        const total = version.size ?? 0
        task.update(
          tr(`${formatNumber(received / 1024 / 1024, 1)} MB geladen`, `${formatNumber(received / 1024 / 1024, 1)} MB downloaded`),
          total > 0 ? received / total : null
        )
      },
      3,
      // "Abbrechen" used to reach nothing: the download ran to the end.
      task.signal
    )
  })

  // Handed over to the import, which deletes it once its task is done: the
  // task reads the pack's configs out of it long after `importModpack` has
  // returned. Deleted here only when the import never got that far.
  try {
    return await importModpack(archive, project.name, true)
  } catch (err) {
    removeTransportArchive(archive)
    throw err
  }
}
