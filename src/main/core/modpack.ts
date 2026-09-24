import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
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
import { withTask, type Task } from '../tasks'
import { downloadAll, downloadFile, type DownloadItem } from './net'
import { extractSubtree, listEntries, readEntryJson, zipFolder } from './archive'
import { createInstance, getInstance, persist, syncContentWithDisk, waitForInstanceSetup } from './instances'
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
  // `minecraft` is mandatory in the mrpack spec. Quietly substituting a
  // hardcoded version produced an instance pinned to something the pack's mods
  // were never built for, which only shows up as a crash at first launch.
  const mcVersion = dependencies['minecraft']
  if (typeof mcVersion !== 'string' || !mcVersion.trim()) {
    throw new Error(
      'Im Modpack fehlt die Angabe, für welche Minecraft-Version es gedacht ist. ' +
        'Es wurde nicht importiert.'
    )
  }
  // Both ids end up as path segments (paths.version(), paths.natives()), so a
  // crafted manifest cannot be allowed to smuggle a separator or ".." through.
  if (!isValidVersionString(mcVersion)) {
    throw new Error('Die Minecraft-Version im Modpack ist ungültig.')
  }

  const loaderVersionOf = (key: string): string => {
    const value = dependencies[key]
    if (!isValidVersionString(value)) {
      throw new Error('Die Mod-Loader-Version im Modpack ist ungültig.')
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
    const urls = (file.downloads ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0)
    if (urls.length === 0) {
      rejected.push(`${file.path} (kein Download-Link)`)
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
      `Das Modpack enthält ${rejected.length} unzulässige ${
        rejected.length === 1 ? 'Datei' : 'Dateien'
      } und wurde nicht installiert: ${rejected.slice(0, 3).join('; ')}`
    )
  }

  task.span(0, 0.85)
  // Same reasoning as the CurseForge path: one dead CDN link (after its mirrors
  // were tried) should cost the pack that one file, not the whole install.
  const failed: string[] = []
  await downloadAll(downloads, {
    task,
    label: 'Modpack-Dateien',
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
      `${failed.length} ${failed.length === 1 ? 'Datei fehlt' : 'Dateien fehlen'}`,
      `Das Modpack wurde installiert, aber ${failed.slice(0, 3).join(', ')}${
        failed.length > 3 ? ' und weitere' : ''
      } konnten nicht geladen werden.`,
      { route: `/instances/${instanceId}` }
    )
  }

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

  // The base setup (libraries, assets, the client jar) that `createInstance`
  // started in the background may still be running or may have failed by now;
  // marking the instance installed without checking would hide that.
  const baseSetupOk = await waitForInstanceSetup(instanceId)
  if (!baseSetupOk) {
    persist({ ...instance, content: enriched, installing: false, installed: false })
    throw new Error(
      'Minecraft selbst konnte nicht eingerichtet werden. Nutze "Reparieren", um es erneut zu versuchen.'
    )
  }

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
  // Becomes a path segment (paths.version(), paths.natives()) further down,
  // so a crafted manifest cannot be allowed to smuggle a separator or ".." in.
  if (!isValidVersionString(manifest.minecraft.version)) {
    throw new Error('Die Minecraft-Version im Modpack ist ungültig.')
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('Die Dateiliste im CurseForge-Modpack fehlt oder ist beschädigt.')
  }

  const modLoaders = Array.isArray(manifest.minecraft.modLoaders) ? manifest.minecraft.modLoaders : []
  const primary = modLoaders.find((l) => l?.primary) ?? modLoaders[0]

  // An empty list silently produced a vanilla instance that then got filled
  // with Forge/Fabric jars — an import that "succeeded" and crashes at launch,
  // with nothing pointing at the manifest as the cause.
  if (!primary?.id) {
    throw new Error(
      'Das CurseForge-Modpack nennt keinen Mod Loader (manifest.json unvollständig) und wurde nicht importiert.'
    )
  }

  const { loader, loaderVersion } = loaderFromCurseId(primary.id)
  if (loaderVersion && !isValidVersionString(loaderVersion)) {
    throw new Error('Die Mod-Loader-Version im Modpack ist ungültig.')
  }
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

    // Resolve every file id to a download url in batches. Entries without a
    // usable id are dropped here rather than sent along, where a single bad
    // value made the API reject the whole 100-item batch.
    const fileIds = manifest.files
      .map((f) => f?.fileID)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))

    const resolved: ProjectVersion[] = []
    for (let i = 0; i < fileIds.length; i += 100) {
      task.update(`Mods werden aufgelöst (${i}/${fileIds.length})…`, i / Math.max(fileIds.length, 1))
      try {
        resolved.push(...(await curseforge.getFiles(fileIds.slice(i, i + 100))))
      } catch (err) {
        // One rejected batch must not abort an import of several hundred mods;
        // the shortfall is reported below either way.
        logger.warn(`CurseForge-Batch ab ${i} konnte nicht aufgelöst werden:`, err)
      }
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
        `${missing.length} ${missing.length === 1 ? 'Mod fehlt' : 'Mods fehlen'} im Modpack`,
        `${name}: CurseForge konnte ${missing.length} ${missing.length === 1 ? 'Mod' : 'Mods'} nicht laden ` +
          `(Projekt-ID ${ids.join(', ')}${missing.length > 5 ? ` und ${missing.length - 5} weitere` : ''}).`,
        { route: `/instances/${instance.id}` }
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
    // Per file rather than fail-fast: CurseForge lets an author forbid
    // third-party downloads, and the guessed CDN url for such a mod answers
    // 403. One of those used to throw away an otherwise finished install of
    // several hundred mods, with no way to resume — re-importing started over
    // in a brand new instance folder.
    const failed: string[] = []
    await downloadAll(downloads, {
      task,
      label: 'Modpack-Mods',
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
        `${failed.length} ${failed.length === 1 ? 'Mod fehlt' : 'Mods fehlen'}`,
        `${name} wurde installiert, aber ${failed.slice(0, 3).join(', ')}${
          failed.length > 3 ? ' und weitere' : ''
        } konnten nicht geladen werden. Lade sie bei Bedarf von Hand nach.`,
        { route: `/instances/${instance.id}` }
      )
    }

    task.update('Konfigurationen werden entpackt…', 0.9)
    extractSubtree(archivePath, manifest.overrides ?? 'overrides', gameDir)

    await syncContentWithDisk(instance.id)

    const baseSetupOk = await waitForInstanceSetup(instance.id)
    if (!baseSetupOk) {
      persist({ ...getInstance(instance.id), installing: false, installed: false })
      throw new Error(
        'Minecraft selbst konnte nicht eingerichtet werden. Nutze "Reparieren", um es erneut zu versuchen.'
      )
    }

    persist({ ...getInstance(instance.id), installing: false, installed: true })
    task.update('Import abgeschlossen', 1)
  }).catch((err) => {
    logger.error(`Import von ${name} fehlgeschlagen:`, err)
    markImportFailed(instance.id)
  })

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

  for (const entry of entries) {
    const lower = entry.name.toLowerCase().replace(/\\/g, '/')
    const prefix = prefixes.find((candidate) => lower.startsWith(`${candidate}/`))
    if (!prefix) continue
    const rest = lower.slice(prefix.length + 1)
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
    sourceLabel: 'Unbekannt',
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
    return { ...base, findings: [{ level: 'blocker', title: 'Die Datei existiert nicht.' }] }
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
          title: 'Das Archiv konnte nicht gelesen werden',
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
        sourceLabel: 'Modrinth-Modpack',
        findings: [
          {
            level: 'blocker',
            title: 'Die Beschreibung im Modpack ist beschädigt',
            detail: 'Die Datei modrinth.index.json fehlt oder lässt sich nicht lesen.'
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
        title: 'Als Modrinth-Modpack erkannt',
        detail: `Minecraft ${mcVersion}${loader !== 'vanilla' ? `, ${loader} ${loaderVersion}`.trimEnd() : ''}`
      })
    } catch (err) {
      findings.push({
        level: 'blocker',
        title: 'Das Modpack nennt keine Minecraft-Version',
        detail: err instanceof Error ? err.message : undefined
      })
    }

    const counts = addCounts(countMrpackFiles(index.files), countOverrides(archivePath, ['overrides', 'client-overrides']))

    const clientOnly = index.files.filter((file) => file.env?.client === 'unsupported').length
    if (clientOnly > 0) {
      findings.push({
        level: 'warn',
        title: `${clientOnly} Dateien sind nur für Server gedacht`,
        detail: 'Sie werden beim Import übersprungen, so wie es das Modpack vorsieht.'
      })
    }

    return {
      ...base,
      kind: 'mrpack',
      sourceLabel: 'Modrinth-Modpack',
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
        sourceLabel: 'CurseForge-Modpack',
        findings: [
          {
            level: 'blocker',
            title: 'Die Beschreibung im Modpack ist beschädigt',
            detail: 'Die Datei manifest.json fehlt oder lässt sich nicht lesen.'
          }
        ]
      }
    }

    const findings: ImportFinding[] = []
    const mcVersion = manifest.minecraft?.version ?? null
    if (!mcVersion) {
      findings.push({
        level: 'blocker',
        title: 'Das Modpack nennt keine Minecraft-Version',
        detail: 'Die manifest.json ist unvollständig.'
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
          title: `Unbekannter Mod-Loader "${rawName}"`,
          detail: 'Der Loader muss nach dem Import von Hand gesetzt werden.'
        })
      }
    } else {
      findings.push({
        level: 'blocker',
        title: 'Das Modpack nennt keinen Mod-Loader',
        detail: 'Die manifest.json ist unvollständig.'
      })
    }

    if (mcVersion && loader) {
      findings.push({
        level: 'ok',
        title: 'Als CurseForge-Modpack erkannt',
        detail: `Minecraft ${mcVersion}, ${loader} ${loaderVersion}`.trimEnd()
      })
    }

    const listed = Array.isArray(manifest.files) ? manifest.files.length : 0
    const overrideFolder = manifest.overrides ?? 'overrides'
    const counts = addCounts({ ...EMPTY_COUNTS, mods: listed }, countOverrides(archivePath, [overrideFolder.toLowerCase()]))

    if (listed > 0) {
      findings.push({
        level: 'warn',
        title: `${listed} Mods werden beim Import einzeln von CurseForge geladen`,
        detail:
          'CurseForge-Modpacks enthalten die Mods nicht selbst, sondern nur eine Liste. Für den Import ' +
          'wird ein CurseForge-Schlüssel in den Einstellungen und eine Internetverbindung gebraucht.'
      })
    }

    return {
      ...base,
      kind: 'curseforge-zip',
      sourceLabel: 'CurseForge-Modpack',
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
        title: 'Kein bekanntes Modpack-Format',
        detail:
          'Weder eine modrinth.index.json noch eine manifest.json gefunden. Unterstützt werden ' +
          '.mrpack-Dateien und CurseForge-Zips.'
      },
      ...(anyContent
        ? [
            {
              level: 'warn' as const,
              title: 'Es wurden trotzdem Inhalte gefunden',
              detail:
                'Ein Kompatibilitäts-Import kann versucht werden. Minecraft-Version und Loader müssen ' +
                'dabei von Hand gewählt werden.'
            }
          ]
        : [])
    ],
    canImport: false
  }
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
