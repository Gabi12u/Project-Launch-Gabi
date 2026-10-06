import type {
  ContentDependency,
  ContentType,
  LoaderId,
  ProjectDetails,
  ProjectVersion,
  SearchQuery,
  SearchResultItem
} from '@shared/types'
import { fetchJson as fetchJsonRaw, HttpError } from '../core/net'
import { getSettings } from '../store'
import { log } from '../logger'
import { gameVersionMatches, sameVersionLine } from '../core/gameVersions'
import { tr } from '@shared/i18n'

const logger = log('curseforge')

const API = 'https://api.curseforge.com/v1'

/**
 * The API calls, with a rejected key named as such. CurseForge answers a
 * wrong or revoked key with 401 or 403, which reached the user as a bare
 * "HTTP 403" followed by the whole request address.
 */
async function fetchJson<T>(url: string, init?: RequestInit, retries?: number): Promise<T> {
  try {
    return await fetchJsonRaw<T>(url, init, retries)
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403) && url.startsWith(API)) {
      throw new Error(
        tr(
          'CurseForge hat den API-Schlüssel abgelehnt. Prüfe ihn in den Einstellungen unter Inhalte.',
          'CurseForge rejected the API key. Check it in the settings under Content.'
        ),
        { cause: err }
      )
    }
    throw err
  }
}
const GAME_ID = 432
/**
 * Both the search endpoint and the per-mod file list at `/mods/{id}/files`
 * reject anything larger and silently clamp the rest, confirmed against the
 * live API rather than assumed from the docs.
 */
const CF_MAX_PAGE_SIZE = 50

/** CurseForge class ids for the content types we support. */
const CLASS_ID: Record<ContentType | 'modpack', number> = {
  mod: 6,
  resourcepack: 12,
  shaderpack: 6552,
  datapack: 6945,
  modpack: 4471
}

/** `modLoaderType` values used by the search endpoint. */
const LOADER_TYPE: Record<LoaderId, number> = {
  vanilla: 0,
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

const SORT_FIELD: Record<SearchQuery['sort'], number> = {
  relevance: 1,
  downloads: 6,
  follows: 2,
  updated: 3,
  newest: 11
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      tr('Für CurseForge wird ein API-Schlüssel benötigt. Du kannst ihn kostenlos unter console.curseforge.com erstellen und in den Einstellungen eintragen.', 'CurseForge needs an API key. You can create one for free at console.curseforge.com and enter it in the settings.')
    )
    this.name = 'MissingApiKeyError'
  }
}

export function hasApiKey(): boolean {
  return Boolean(getSettings().curseForgeApiKey.trim())
}

function headers(): Record<string, string> {
  const key = getSettings().curseForgeApiKey.trim()
  if (!key) throw new MissingApiKeyError()
  return { 'x-api-key': key, Accept: 'application/json' }
}

/* ------------------------------------------------------------------ *
 * API shapes
 * ------------------------------------------------------------------ */

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  thumbsUpCount?: number
  dateModified: string
  classId: number
  logo?: { thumbnailUrl: string; url: string }
  links: { websiteUrl: string; sourceUrl?: string; issuesUrl?: string; wikiUrl?: string }
  categories: { id: number; name: string }[]
  authors: { id: number; name: string }[]
  latestFilesIndexes?: { gameVersion: string; modLoader?: number; fileId: number }[]
  screenshots?: { url: string; title?: string }[]
}

interface CfFile {
  id: number
  modId: number
  displayName: string
  fileName: string
  releaseType: 1 | 2 | 3
  fileDate: string
  fileLength: number
  downloadUrl: string | null
  gameVersions: string[]
  hashes: { value: string; algo: number }[]
  dependencies: { modId: number; relationType: number }[]
}

interface CfListResponse<T> {
  data: T[]
  pagination?: { index: number; pageSize: number; resultCount: number; totalCount: number }
}

interface CfSingleResponse<T> {
  data: T
}

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

function toContentType(classId: number): ContentType | 'modpack' {
  switch (classId) {
    case 12:
      return 'resourcepack'
    case 6552:
      return 'shaderpack'
    case 6945:
      return 'datapack'
    case 4471:
      return 'modpack'
    default:
      return 'mod'
  }
}

function loadersOf(mod: CfMod): string[] {
  const found = new Set<string>()
  for (const index of mod.latestFilesIndexes ?? []) {
    switch (index.modLoader) {
      case 1:
        found.add('forge')
        break
      case 4:
        found.add('fabric')
        break
      case 5:
        found.add('quilt')
        break
      case 6:
        found.add('neoforge')
        break
      default:
        break
    }
  }
  return [...found]
}

function mapMod(mod: CfMod): SearchResultItem {
  return {
    provider: 'curseforge',
    projectId: String(mod.id),
    slug: mod.slug,
    name: mod.name,
    summary: mod.summary,
    author: mod.authors?.[0]?.name ?? '',
    iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url,
    downloads: mod.downloadCount,
    follows: mod.thumbsUpCount,
    updatedAt: mod.dateModified,
    categories: (mod.categories ?? []).map((c) => c.name),
    gameVersions: [...new Set((mod.latestFilesIndexes ?? []).map((i) => i.gameVersion))],
    loaders: loadersOf(mod),
    pageUrl: mod.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`,
    type: toContentType(mod.classId)
  }
}

const RELEASE_TYPE: Record<number, ProjectVersion['releaseType']> = {
  1: 'release',
  2: 'beta',
  3: 'alpha'
}

/**
 * CurseForge's `FileRelationType`, mapped onto the four dependency kinds the
 * shared format knows (mirroring Modrinth's own vocabulary). `Tool` names a
 * related but non-required companion, so it joins `OptionalDependency`.
 * `EmbeddedLibrary` and `Include` both mean the other project's content
 * already ships inside this file, so both become `embedded`.
 */
const DEPENDENCY_TYPE: Record<number, ContentDependency['type']> = {
  1: 'embedded', // EmbeddedLibrary
  2: 'optional', // OptionalDependency
  3: 'required', // RequiredDependency
  4: 'optional', // Tool
  5: 'incompatible', // Incompatible
  6: 'embedded' // Include
}

/** Undated entries sort last rather than jumping to the top as NaN would. */
function time(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

/** CurseForge lists loaders inside `gameVersions` next to the version numbers. */
function splitGameVersions(values: string[]): { games: string[]; loaders: string[] } {
  const loaderNames = ['forge', 'fabric', 'neoforge', 'quilt']
  const games: string[] = []
  const loaders: string[] = []

  for (const value of values) {
    const lower = value.toLowerCase()
    if (loaderNames.includes(lower)) loaders.push(lower)
    else if (/^\d/.test(value)) games.push(value)
  }
  return { games, loaders }
}

/**
 * Some authors disable third-party downloads and the API returns
 * `downloadUrl: null`. The CDN path can still be derived from the file id.
 */
function fallbackDownloadUrl(file: CfFile): string {
  // The CDN splits an id into `floor(id / 1000)` and `id % 1000`. Slicing the
  // first four characters off the string only happens to match that for
  // exactly seven-digit ids, and CurseForge's counter passed eight digits long
  // ago — so every current id produced a guaranteed 404, in precisely the case
  // this fallback exists to rescue.
  const id = Number(file.id)
  const first = Math.floor(id / 1000)
  const second = id % 1000
  return `https://edge.forgecdn.net/files/${first}/${second}/${encodeURIComponent(file.fileName)}`
}

function mapFile(file: CfFile): ProjectVersion {
  const { games, loaders } = splitGameVersions(file.gameVersions ?? [])

  const dependencies: ContentDependency[] = (file.dependencies ?? [])
    .map((dep) => {
      const type = DEPENDENCY_TYPE[dep.relationType]
      return type ? { projectId: String(dep.modId), type } : null
    })
    .filter((d): d is ContentDependency => d !== null)

  return {
    provider: 'curseforge',
    versionId: String(file.id),
    projectId: String(file.modId),
    name: file.displayName,
    versionNumber: file.displayName,
    // An unknown, future value is not taken for a stable release.
    releaseType: RELEASE_TYPE[file.releaseType] ?? 'beta',
    gameVersions: games,
    loaders,
    downloadUrl: file.downloadUrl ?? fallbackDownloadUrl(file),
    fileName: file.fileName,
    sha1: file.hashes?.find((h) => h.algo === 1)?.value,
    size: file.fileLength,
    releasedAt: file.fileDate,
    dependencies
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

function searchParams(query: SearchQuery, modLoaderType?: number): URLSearchParams {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_ID[query.type]),
    searchFilter: query.query,
    sortField: String(SORT_FIELD[query.sort]),
    sortOrder: 'desc',
    index: String(query.offset),
    // The API caps a page at 50. The caller's offset is its own, so a limit
    // above the cap would make it skip forward by more than it received and
    // lose the results in between.
    pageSize: String(Math.min(query.limit, CF_MAX_PAGE_SIZE))
  })

  if (query.gameVersion) params.set('gameVersion', query.gameVersion)
  if (modLoaderType !== undefined) params.set('modLoaderType', String(modLoaderType))
  return params
}

async function runSearch(query: SearchQuery, modLoaderType?: number): Promise<{ mods: CfMod[]; total: number }> {
  const response = await fetchJson<CfListResponse<CfMod>>(
    `${API}/mods/search?${searchParams(query, modLoaderType).toString()}`,
    { headers: headers() }
  )
  // The response shape is cast, never verified, so a changed or partial body
  // would otherwise throw on `.map` and take the whole merged search down
  // rather than just this provider's half of it.
  const data = Array.isArray(response.data) ? response.data : []
  return { mods: data, total: response.pagination?.totalCount ?? data.length }
}

export async function search(query: SearchQuery): Promise<{ items: SearchResultItem[]; total: number }> {
  // Modpacks are filtered by loader too, matching what the Modrinth provider
  // does. Restricting this to `mod` meant a search filtered to Fabric returned
  // every CurseForge modpack regardless of loader, while the Modrinth half of
  // the same result list was filtered correctly.
  // Shaders, resource packs and data packs have no loader on CurseForge, so
  // filtering them by one returned next to nothing, the same reason the
  // Modrinth provider leaves the loader facet out for them.
  const loaderApplies = query.type === 'mod' || query.type === 'modpack'
  if (loaderApplies && query.loader === 'quilt') {
    // Quilt runs Fabric mods, so a Quilt search must also surface Fabric-only
    // projects. The search endpoint has no OR filter for loaders, so this
    // runs two requests and merges them, deduplicating by mod id.
    const [quilt, fabric] = await Promise.all([
      runSearch(query, LOADER_TYPE.quilt),
      runSearch(query, LOADER_TYPE.fabric)
    ])
    const seen = new Set<number>()
    const merged: CfMod[] = []
    for (const mod of [...quilt.mods, ...fabric.mods]) {
      if (seen.has(mod.id)) continue
      seen.add(mod.id)
      merged.push(mod)
    }
    // Both underlying lists paginate independently at the same offset, so a
    // mod that supports both loaders can sit at different ranks in each one:
    // deduplicated out of this page because the other list already carried
    // it, then still reappearing once its own list's offset catches up to it
    // on a later page. Nothing at this level can align the two offsets
    // without buffering across calls, so `total` stays a safe upper bound
    // (the true number of unique mods is at most the sum of both lists) and
    // the renderer is what actually ends "Mehr laden": it dedupes accumulated
    // pages by project id and stops once a page adds nothing new.
    return { items: merged.map(mapMod), total: quilt.total + fabric.total }
  }

  const modLoaderType =
    loaderApplies && query.loader && query.loader !== 'vanilla' ? LOADER_TYPE[query.loader] : undefined
  const { mods, total } = await runSearch(query, modLoaderType)
  return { items: mods.map(mapMod), total }
}

export async function getProject(projectId: string): Promise<ProjectDetails> {
  const mod = await fetchJson<CfSingleResponse<CfMod>>(`${API}/mods/${projectId}`, {
    headers: headers()
  })

  let description = ''
  try {
    const html = await fetchJson<CfSingleResponse<string>>(`${API}/mods/${projectId}/description`, {
      headers: headers()
    })
    description = html.data
  } catch {
    description = mod.data.summary
  }

  const versions = await getVersions(projectId)
  const base = mapMod(mod.data)

  return {
    ...base,
    description,
    gallery: (mod.data.screenshots ?? []).map((s) => ({ url: s.url, title: s.title })),
    sourceUrl: mod.data.links?.sourceUrl ?? undefined,
    issuesUrl: mod.data.links?.issuesUrl ?? undefined,
    wikiUrl: mod.data.links?.wikiUrl ?? undefined,
    versions
  }
}

export async function getVersions(
  projectId: string,
  gameVersion?: string,
  loader?: LoaderId
): Promise<ProjectVersion[]> {
  // Paged rather than one shot: a mod that has supported Minecraft for years
  // carries hundreds of files, and taking only the first page silently hid the
  // exact-version match further down — `bestVersionFor` then either installed a
  // near miss or claimed no version existed at all.
  // This endpoint caps a page at the same 50 as the search endpoint, so
  // CF_MAX_PAGE_SIZE is reused here rather than a second number that could
  // drift out of sync with it.
  const PAGE = CF_MAX_PAGE_SIZE
  const MAX_PAGES = 15 // 15 * 50 = 750 files, comfortably more than any real project has

  const files: CfFile[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ index: String(page * PAGE), pageSize: String(PAGE) })
    if (gameVersion) params.set('gameVersion', gameVersion)
    if (loader && loader !== 'vanilla') params.set('modLoaderType', String(LOADER_TYPE[loader]))

    const response = await fetchJson<CfListResponse<CfFile>>(
      `${API}/mods/${projectId}/files?${params.toString()}`,
      { headers: headers() }
    )

    const batch = Array.isArray(response.data) ? response.data : []
    files.push(...batch)

    const total = response.pagination?.totalCount
    if (batch.length < PAGE) break
    if (typeof total === 'number' && files.length >= total) break
  }

  return files.map(mapFile).sort((a, b) => time(b.releasedAt) - time(a.releasedAt))
}

/**
 * Among a set of already loader-matching candidates, keeps only the ones that
 * declare Quilt itself when at least one does. Quilt also runs Fabric mods,
 * so both stay in `loaderOk`, but a native Quilt build should still win over
 * a Fabric-only one when both exist.
 */
function preferNativeQuilt(versions: ProjectVersion[], loader: LoaderId): ProjectVersion[] {
  if (loader !== 'quilt') return versions
  const native = versions.filter((v) => v.loaders.includes('quilt'))
  return native.length > 0 ? native : versions
}

export async function bestVersionFor(
  projectId: string,
  gameVersion: string,
  loader: LoaderId,
  type: ContentType = 'mod'
): Promise<ProjectVersion | null> {
  const all = await getVersions(projectId)

  // Only mods are tied to a mod loader. Resource packs list "minecraft",
  // shaders "iris" or "optifine" and data packs "datapack" as their loader,
  // so the filter found nothing for them in any modded instance, and
  // "Installieren" failed while updates never showed up.
  const loaderOk = (v: ProjectVersion): boolean =>
    type !== 'mod' ||
    loader === 'vanilla' ||
    v.loaders.length === 0 ||
    v.loaders.includes(loader) ||
    (loader === 'quilt' && v.loaders.includes('fabric'))

  const exact = preferNativeQuilt(
    all.filter((v) => v.gameVersions.includes(gameVersion) && loaderOk(v)),
    loader
  )
  if (exact.length > 0) return exact.find((v) => v.releaseType === 'release') ?? exact[0]

  // The same rule as the Modrinth provider: a hotfix of the same release for
  // mods and data packs, the whole line only for resource packs and shaders.
  const close = (g: string): boolean =>
    type === 'resourcepack' || type === 'shaderpack' ? sameVersionLine(gameVersion, g) : gameVersionMatches(gameVersion, g)
  const nearby = preferNativeQuilt(
    all.filter((v) => loaderOk(v) && v.gameVersions.some(close)),
    loader
  )
  return (nearby.find((v) => v.releaseType === 'release') ?? nearby[0]) ?? null
}

export async function getFile(projectId: string, fileId: string): Promise<ProjectVersion | null> {
  try {
    const response = await fetchJson<CfSingleResponse<CfFile>>(
      `${API}/mods/${projectId}/files/${fileId}`,
      { headers: headers() }
    )
    return mapFile(response.data)
  } catch (err) {
    logger.warn(`Datei ${fileId} von Projekt ${projectId} nicht abrufbar:`, err)
    return null
  }
}

/** Bulk lookup used when installing a CurseForge modpack manifest. */
export async function getFiles(fileIds: number[]): Promise<ProjectVersion[]> {
  if (fileIds.length === 0) return []

  const response = await fetchJson<CfListResponse<CfFile>>(`${API}/mods/files`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds })
  })
  // Same guard the search and version endpoints in this file already carry.
  if (!Array.isArray(response?.data)) {
    logger.warn('Unerwartete Antwort bei der Sammelabfrage von Dateien')
    return []
  }
  return response.data.map(mapFile)
}

/**
 * The content type of each project, by project id, for a modpack manifest.
 * A manifest lists files only, and a file does not say whether it is a mod,
 * a resource pack or a shader. Missing entries mean "unknown"; the caller
 * then treats the file as a mod, as before.
 */
export async function getProjectTypes(projectIds: string[]): Promise<Map<string, ContentType | 'modpack'>> {
  const types = new Map<string, ContentType | 'modpack'>()
  const ids = [...new Set(projectIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const response = await fetchJson<CfListResponse<{ id: number; classId: number }>>(`${API}/mods`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ modIds: ids.slice(i, i + 100) })
      })
      if (!Array.isArray(response?.data)) continue
      for (const mod of response.data) {
        if (typeof mod?.id === 'number' && typeof mod.classId === 'number') types.set(String(mod.id), toContentType(mod.classId))
      }
    } catch (err) {
      logger.warn('Projektarten für den Modpack-Import nicht abrufbar:', err)
    }
  }
  return types
}

export async function getCategories(type: ContentType | 'modpack'): Promise<string[]> {
  try {
    const response = await fetchJson<CfListResponse<{ id: number; name: string; classId: number }>>(
      `${API}/categories?gameId=${GAME_ID}&classId=${CLASS_ID[type]}`,
      { headers: headers() }
    )
    return response.data.map((c) => c.name)
  } catch (err) {
    // A missing key is not a fetch failure: `headers()` throws it before any
    // request goes out. Swallowing it here to a bare empty list, unlike the
    // explicit, actionable check `searchAll` already does for the same case,
    // left CurseForge's category filter looking empty with no explanation
    // for exactly the same reason.
    if (err instanceof MissingApiKeyError) throw err
    return []
  }
}
