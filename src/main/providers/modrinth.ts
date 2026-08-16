import type {
  ContentDependency,
  ContentType,
  LoaderId,
  ProjectDetails,
  ProjectVersion,
  SearchQuery,
  SearchResultItem
} from '@shared/types'
import { fetchJson, fetchJsonCached } from '../core/net'
import { log } from '../logger'

const logger = log('modrinth')
const API = 'https://api.modrinth.com/v2'

/* ------------------------------------------------------------------ *
 * API shapes
 * ------------------------------------------------------------------ */

interface ModrinthSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  categories: string[]
  display_categories?: string[]
  versions: string[]
  downloads: number
  follows: number
  icon_url?: string
  date_modified: string
  project_type: string
  license?: string
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[]
  offset: number
  limit: number
  total_hits: number
}

interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  body: string
  categories: string[]
  loaders: string[]
  game_versions: string[]
  downloads: number
  followers: number
  icon_url?: string
  project_type: string
  license?: { id: string; name: string }
  source_url?: string
  issues_url?: string
  discord_url?: string
  wiki_url?: string
  donation_urls?: { platform: string; url: string }[]
  gallery?: { url: string; title?: string; featured: boolean }[]
  team: string
}

interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  date_published: string
  changelog?: string
  downloads: number
  dependencies: {
    project_id?: string
    version_id?: string
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
  }[]
  files: {
    url: string
    filename: string
    primary: boolean
    size: number
    hashes: { sha1?: string; sha512?: string }
  }[]
}

interface ModrinthTeamMember {
  user: { username: string }
  role: string
}

/* ------------------------------------------------------------------ *
 * Mapping helpers
 * ------------------------------------------------------------------ */

const PROJECT_TYPE: Record<ContentType | 'modpack', string> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shaderpack: 'shader',
  datapack: 'datapack',
  modpack: 'modpack'
}

function toContentType(projectType: string): ContentType | 'modpack' {
  switch (projectType) {
    case 'resourcepack':
      return 'resourcepack'
    case 'shader':
      return 'shaderpack'
    case 'datapack':
      return 'datapack'
    case 'modpack':
      return 'modpack'
    default:
      return 'mod'
  }
}

const SORT_INDEX: Record<SearchQuery['sort'], string> = {
  relevance: 'relevance',
  downloads: 'downloads',
  follows: 'follows',
  updated: 'updated',
  newest: 'newest'
}

function buildFacets(query: SearchQuery): string {
  const facets: string[][] = [[`project_type:${PROJECT_TYPE[query.type]}`]]

  if (query.gameVersion) facets.push([`versions:${query.gameVersion}`])

  // Resource packs and shaders are loader independent; filtering them by
  // loader would return nothing.
  if (query.loader && query.loader !== 'vanilla' && (query.type === 'mod' || query.type === 'modpack')) {
    facets.push([`categories:${query.loader}`])
  }

  for (const category of query.categories ?? []) {
    facets.push([`categories:${category}`])
  }

  return JSON.stringify(facets)
}

function mapHit(hit: ModrinthSearchHit): SearchResultItem {
  const type = toContentType(hit.project_type)
  return {
    provider: 'modrinth',
    projectId: hit.project_id,
    slug: hit.slug,
    name: hit.title,
    summary: hit.description,
    author: hit.author,
    iconUrl: hit.icon_url,
    downloads: hit.downloads,
    follows: hit.follows,
    updatedAt: hit.date_modified,
    categories: hit.display_categories ?? hit.categories,
    gameVersions: hit.versions,
    loaders: hit.categories.filter((c) =>
      ['fabric', 'forge', 'neoforge', 'quilt'].includes(c)
    ),
    pageUrl: `https://modrinth.com/${hit.project_type}/${hit.slug}`,
    type
  }
}

export function mapVersion(version: ModrinthVersion): ProjectVersion | null {
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  if (!file) return null

  const dependencies: ContentDependency[] = version.dependencies
    .filter((d) => d.project_id)
    .map((d) => ({
      projectId: d.project_id as string,
      versionId: d.version_id ?? undefined,
      type: d.dependency_type
    }))

  return {
    provider: 'modrinth',
    versionId: version.id,
    projectId: version.project_id,
    name: version.name,
    versionNumber: version.version_number,
    releaseType: version.version_type,
    gameVersions: version.game_versions,
    loaders: version.loaders,
    downloadUrl: file.url,
    fileName: file.filename,
    sha1: file.hashes.sha1,
    size: file.size,
    releasedAt: version.date_published,
    changelog: version.changelog,
    dependencies
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export async function search(query: SearchQuery): Promise<{ items: SearchResultItem[]; total: number }> {
  const params = new URLSearchParams({
    query: query.query,
    facets: buildFacets(query),
    index: SORT_INDEX[query.sort],
    offset: String(query.offset),
    limit: String(query.limit)
  })

  const response = await fetchJson<ModrinthSearchResponse>(`${API}/search?${params.toString()}`)
  return { items: response.hits.map(mapHit), total: response.total_hits }
}

export async function getProject(projectId: string): Promise<ProjectDetails> {
  const project = await fetchJson<ModrinthProject>(`${API}/project/${projectId}`)

  let author = ''
  try {
    const team = await fetchJsonCached<ModrinthTeamMember[]>(
      `${API}/team/${project.team}/members`,
      `modrinth-team-${project.team}`,
      6 * 60 * 60 * 1000
    )
    author = team.find((m) => m.role === 'Owner')?.user.username ?? team[0]?.user.username ?? ''
  } catch {
    // author is cosmetic
  }

  const versions = await getVersions(projectId)

  return {
    provider: 'modrinth',
    projectId: project.id,
    slug: project.slug,
    name: project.title,
    summary: project.description,
    description: project.body,
    author,
    iconUrl: project.icon_url,
    downloads: project.downloads,
    follows: project.followers,
    categories: project.categories,
    gameVersions: project.game_versions,
    loaders: project.loaders,
    pageUrl: `https://modrinth.com/${project.project_type}/${project.slug}`,
    type: toContentType(project.project_type),
    gallery: (project.gallery ?? []).map((g) => ({ url: g.url, title: g.title })),
    license: project.license?.name ?? project.license?.id,
    sourceUrl: project.source_url,
    issuesUrl: project.issues_url,
    discordUrl: project.discord_url,
    wikiUrl: project.wiki_url,
    donationUrls: project.donation_urls,
    versions
  }
}

export async function getVersions(
  projectId: string,
  gameVersion?: string,
  loader?: LoaderId
): Promise<ProjectVersion[]> {
  const params = new URLSearchParams()
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  if (loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]))

  const suffix = params.toString() ? `?${params.toString()}` : ''
  const versions = await fetchJson<ModrinthVersion[]>(`${API}/project/${projectId}/version${suffix}`)

  return versions
    .map(mapVersion)
    .filter((v): v is ProjectVersion => v !== null)
    .sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime())
}

/**
 * Picks the newest version that fits the instance. Falls back to a version
 * matching only the loader so a mod that lists `1.21` still resolves for
 * `1.21.1` when the author has not updated the metadata yet.
 */
export async function bestVersionFor(
  projectId: string,
  gameVersion: string,
  loader: LoaderId
): Promise<ProjectVersion | null> {
  const all = await getVersions(projectId)

  const loaderOk = (v: ProjectVersion): boolean =>
    loader === 'vanilla' || v.loaders.length === 0 || v.loaders.includes(loader)

  const exact = all.filter((v) => v.gameVersions.includes(gameVersion) && loaderOk(v))
  if (exact.length > 0) {
    return exact.find((v) => v.releaseType === 'release') ?? exact[0]
  }

  // Same major.minor line, e.g. 1.21.x
  const line = gameVersion.split('.').slice(0, 2).join('.')
  const nearby = all.filter(
    (v) => loaderOk(v) && v.gameVersions.some((g) => g === line || g.startsWith(`${line}.`))
  )
  if (nearby.length > 0) return nearby[0]

  return null
}

/** Looks a file up by hash — used to identify manually added jars. */
export async function lookupByHash(sha1: string): Promise<ProjectVersion | null> {
  try {
    const version = await fetchJson<ModrinthVersion>(`${API}/version_file/${sha1}?algorithm=sha1`)
    return mapVersion(version)
  } catch {
    return null
  }
}

export async function getCategories(type: ContentType | 'modpack'): Promise<string[]> {
  try {
    const categories = await fetchJsonCached<{ name: string; project_type: string }[]>(
      `${API}/tag/category`,
      'modrinth-categories',
      24 * 60 * 60 * 1000
    )
    const wanted = PROJECT_TYPE[type]
    return categories
      .filter((c) => c.project_type === wanted)
      .map((c) => c.name)
      .filter((name) => !['fabric', 'forge', 'neoforge', 'quilt'].includes(name))
  } catch (err) {
    logger.warn('Kategorien konnten nicht geladen werden:', err)
    return []
  }
}
