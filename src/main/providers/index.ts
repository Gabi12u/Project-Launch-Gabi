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

  // Interleave the providers so neither dominates the first screen, then sort
  // the merged list by relevance proxy (downloads) when the user asked for it.
  const merged =
    wanted.length > 1 && query.sort === 'relevance' ? interleave(results.map((r) => r.items)) : items

  if (query.sort === 'downloads') merged.sort((a, b) => b.downloads - a.downloads)

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
