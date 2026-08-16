import type { LauncherStats, NewsItem } from '@shared/types'
import { fetchJsonCached } from './net'
import { loadInstances } from './instances'
import { totalDiskUsage } from './repair'
import { log } from '../logger'

const logger = log('news')

const NEWS_URL = 'https://launchercontent.mojang.com/news.json'
const IMAGE_BASE = 'https://launchercontent.mojang.com'

interface MojangNews {
  entries: {
    id: string
    title: string
    tag: string
    category: string
    date: string
    text: string
    newsPageLink?: string
    readMoreLink?: string
    playPageImage?: { title?: string; url: string }
    newsType?: string[]
  }[]
}

export async function getNews(limit = 12): Promise<NewsItem[]> {
  try {
    const feed = await fetchJsonCached<MojangNews>(NEWS_URL, 'mojang-news', 60 * 60 * 1000)

    return feed.entries.slice(0, limit).map((entry) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.text,
      imageUrl: entry.playPageImage?.url ? `${IMAGE_BASE}${entry.playPageImage.url}` : undefined,
      url: entry.readMoreLink ?? entry.newsPageLink ?? 'https://www.minecraft.net/article',
      date: entry.date,
      tag: entry.tag || entry.category || 'News'
    }))
  } catch (err) {
    logger.warn('Minecraft-News konnten nicht geladen werden:', err)
    return []
  }
}

export function getStats(): LauncherStats {
  const instances = loadInstances()

  const mostPlayed = instances
    .filter((i) => i.totalPlayMs > 0)
    .sort((a, b) => b.totalPlayMs - a.totalPlayMs)
    .slice(0, 5)
    .map((i) => ({ instanceId: i.id, name: i.name, playMs: i.totalPlayMs }))

  const recentSessions = instances
    .flatMap((instance) =>
      instance.sessions.map((session) => ({
        ...session,
        instanceId: instance.id,
        instanceName: instance.name
      }))
    )
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 10)

  return {
    totalInstances: instances.length,
    totalPlayMs: instances.reduce((sum, i) => sum + i.totalPlayMs, 0),
    totalMods: instances.reduce((sum, i) => sum + i.content.filter((c) => c.type === 'mod').length, 0),
    diskUsageBytes: totalDiskUsage(),
    mostPlayed,
    recentSessions
  }
}
