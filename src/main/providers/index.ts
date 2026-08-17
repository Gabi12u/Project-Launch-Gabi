import type {
  ContentType,
  LoaderId,
  ProjectDetails,
  ProjectVersion,
  SearchQuery,
  SearchResponse
} from '@shared/types'
import * as modrinth from './modrinth'
import * as curseforge from './curseforge'
import { log } from '../logger'

const logger = log('providers')

export { modrinth, curseforge }

/**
 * Queries both platforms and merges the results. A failing provider degrades
 * to a warning instead of taking the whole search down.
 */
export async function searchAll(query: SearchQuery): Promise<SearchResponse> {
  const wanted = query.providers.filter((p) => p !== 'local')
  const errors: SearchResponse['errors'] = []

  const results = await Promise.all(
    wanted.map(async (provider) => {
      try {
        if (provider === 'modrinth') return await modrinth.search(query)
        if (provider === 'curseforge') {
          if (!curseforge.hasApiKey()) {
            errors.push({
              provider: 'curseforge',
              message: 'Kein CurseForge-API-Schlüssel hinterlegt.'
            })
            return { items: [], total: 0 }
          }
          return await curseforge.search(query)
        }
        return { items: [], total: 0 }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`${provider}-Suche fehlgeschlagen:`, message)
        errors.push({ provider, message })
        return { items: [], total: 0 }
      }
    })
  )

  const items = results.flatMap((r) => r.items)
  const total = results.reduce((sum, r) => sum + r.total, 0)

  // Each provider sorts its own page correctly, but concatenating them lists
  // all of one platform before any of the other — so a project updated minutes
  // ago can end up below a week-old one. Every sort except relevance therefore
  // gets applied across the merged list; relevance has no comparable score
  // between platforms, so there the lists are interleaved instead.
  const merged =
    wanted.length > 1 && query.sort === 'relevance' ? interleave(results.map((r) => r.items)) : items

  const time = (value?: string): number => {
    const parsed = value ? Date.parse(value) : Number.NaN
    // Undated entries sort last rather than jumping to the top as NaN would.
    return Number.isNaN(parsed) ? 0 : parsed
  }

  switch (query.sort) {
    case 'downloads':
      merged.sort((a, b) => b.downloads - a.downloads)
      break
    case 'follows':
      merged.sort((a, b) => (b.follows ?? 0) - (a.follows ?? 0))
      break
    case 'updated':
    case 'newest':
      merged.sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
      break
    default:
      break
  }

  return { items: merged, total, errors }
}

function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i])
    }
  }
  return out
}

export async function getProject(
  provider: 'modrinth' | 'curseforge',
  projectId: string
): Promise<ProjectDetails> {
  return provider === 'modrinth' ? modrinth.getProject(projectId) : curseforge.getProject(projectId)
}

export async function getVersions(
  provider: 'modrinth' | 'curseforge',
  projectId: string,
  gameVersion?: string,
  loader?: LoaderId
): Promise<ProjectVersion[]> {
  return provider === 'modrinth'
    ? modrinth.getVersions(projectId, gameVersion, loader)
    : curseforge.getVersions(projectId, gameVersion, loader)
}

export async function bestVersionFor(
  provider: 'modrinth' | 'curseforge',
  projectId: string,
  gameVersion: string,
  loader: LoaderId
): Promise<ProjectVersion | null> {
  return provider === 'modrinth'
    ? modrinth.bestVersionFor(projectId, gameVersion, loader)
    : curseforge.bestVersionFor(projectId, gameVersion, loader)
}

export async function getCategories(
  provider: 'modrinth' | 'curseforge',
  type: ContentType | 'modpack'
): Promise<string[]> {
  return provider === 'modrinth'
    ? modrinth.getCategories(type)
    : curseforge.getCategories(type)
}
