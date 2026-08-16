import type {
  ContentDependency,
  ContentType,
  LoaderId,
  ProjectDetails,
  ProjectVersion,
  SearchQuery,
  SearchResultItem
} from '@shared/types'
import { fetchJson } from '../core/net'
import { getSettings } from '../store'
import { log } from '../logger'

const logger = log('curseforge')

const API = 'https://api.curseforge.com/v1'
const GAME_ID = 432

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
      'Für CurseForge wird ein API-Schlüssel benötigt. Du kannst ihn kostenlos unter ' +
        'console.curseforge.com erstellen und in den Einstellungen eintragen.'
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
  const id = String(file.id)
  const first = id.slice(0, 4)
  const second = String(Number(id.slice(4)))
  return `https://edge.forgecdn.net/files/${first}/${second}/${encodeURIComponent(file.fileName)}`
}

function mapFile(file: CfFile): ProjectVersion {
  const { games, loaders } = splitGameVersions(file.gameVersions ?? [])

  const dependencies: ContentDependency[] = (file.dependencies ?? [])
    .map((dep) => {
      // 3 = required, 2 = optional, 5 = incompatible, 6 = included
      const type =
        dep.relationType === 3
          ? 'required'
          : dep.relationType === 2
            ? 'optional'
            : dep.relationType === 5
              ? 'incompatible'
              : dep.relationType === 6
                ? 'embedded'
                : null
      return type ? { projectId: String(dep.modId), type } : null
    })
    .filter((d): d is ContentDependency => d !== null)

  return {
    provider: 'curseforge',
    versionId: String(file.id),
    projectId: String(file.modId),
    name: file.displayName,
    versionNumber: file.displayName,
    releaseType: RELEASE_TYPE[file.releaseType] ?? 'release',
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

export async function search(query: SearchQuery): Promise<{ items: SearchResultItem[]; total: number }> {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_ID[query.type]),
    searchFilter: query.query,
    sortField: String(SORT_FIELD[query.sort]),
    sortOrder: 'desc',
    index: String(query.offset),
    pageSize: String(Math.min(query.limit, 50))
  })

  if (query.gameVersion) params.set('gameVersion', query.gameVersion)
  if (query.loader && query.loader !== 'vanilla' && query.type === 'mod') {
    params.set('modLoaderType', String(LOADER_TYPE[query.loader]))
  }

  const response = await fetchJson<CfListResponse<CfMod>>(`${API}/mods/search?${params.toString()}`, {
    headers: headers()
  })

  return {
    items: response.data.map(mapMod),
    total: response.pagination?.totalCount ?? response.data.length
  }
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
  const params = new URLSearchParams({ pageSize: '200' })
  if (gameVersion) params.set('gameVersion', gameVersion)
  if (loader && loader !== 'vanilla') params.set('modLoaderType', String(LOADER_TYPE[loader]))

  const response = await fetchJson<CfListResponse<CfFile>>(
    `${API}/mods/${projectId}/files?${params.toString()}`,
    { headers: headers() }
  )

  return response.data
    .map(mapFile)
    .sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime())
}

export async function bestVersionFor(
  projectId: string,
  gameVersion: string,
  loader: LoaderId
): Promise<ProjectVersion | null> {
  const all = await getVersions(projectId)

  const loaderOk = (v: ProjectVersion): boolean =>
    loader === 'vanilla' || v.loaders.length === 0 || v.loaders.includes(loader)

  const exact = all.filter((v) => v.gameVersions.includes(gameVersion) && loaderOk(v))
  if (exact.length > 0) return exact.find((v) => v.releaseType === 'release') ?? exact[0]

  const line = gameVersion.split('.').slice(0, 2).join('.')
  const nearby = all.filter(
    (v) => loaderOk(v) && v.gameVersions.some((g) => g === line || g.startsWith(`${line}.`))
  )
  return nearby[0] ?? null
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
  return response.data.map(mapFile)
}

export async function getCategories(type: ContentType | 'modpack'): Promise<string[]> {
  try {
    const response = await fetchJson<CfListResponse<{ id: number; name: string; classId: number }>>(
      `${API}/categories?gameId=${GAME_ID}&classId=${CLASS_ID[type]}`,
      { headers: headers() }
    )
    return response.data.map((c) => c.name)
  } catch {
    return []
  }
}
