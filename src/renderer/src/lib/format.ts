import type { CSSProperties } from 'react'
import type { LoaderId } from '@shared/types'

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 ? 0 : decimals)} ${units[unit]}`
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(value)
}

/** Play time, tuned for the ranges a launcher actually shows. */
export function formatPlayTime(ms: number): string {
  if (!ms || ms < 60_000) return '< 1 Min'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? `${hours} Std ${rest} Min` : `${hours} Std`
  const days = Math.floor(hours / 24)
  return `${days} T ${hours % 24} Std`
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}:${String(minutes % 60).padStart(2, '0')} Std`
  return `${minutes}:${String(seconds % 60).padStart(2, '0')} Min`
}

export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return 'nie'

  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'gerade eben'
  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000)
    return `vor ${minutes} Min`
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000)
    return `vor ${hours} Std`
  }
  if (diff < 7 * 86_400_000) {
    const days = Math.floor(diff / 86_400_000)
    return days === 1 ? 'gestern' : `vor ${days} Tagen`
  }

  return new Date(timestamp).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'short',
    year: diff > 300 * 86_400_000 ? 'numeric' : undefined
  })
}

export function formatDate(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(value: number): string {
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return `${gb % 1 === 0 ? gb : gb.toFixed(1)} GB`
  }
  return `${mb} MB`
}

export const LOADER_LABELS: Record<LoaderId, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
}

export function loaderColor(loader: LoaderId): string {
  return `var(--loader-${loader})`
}

/** "Guten Morgen" / "Guten Tag" / "Guten Abend" depending on the clock. */
export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Gute Nacht'
  if (hour < 11) return 'Guten Morgen'
  if (hour < 18) return 'Guten Tag'
  return 'Guten Abend'
}

export function pluralise(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Strips markdown/HTML so provider descriptions fit in a single line. */
export function plainText(value: string, limit = 240): string {
  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

/**
 * Style props that paint an account's own skin as a head tile.
 *
 * Replaces an earlier Crafatar call that carried `default=MHF_Steve`, the
 * 2009 Steve head. That fallback showed up whenever Crafatar had no cached
 * skin for a UUID, which made current accounts look like they had never
 * picked a skin. The launcher already receives the worn skin straight from
 * Mojang at login and on every token renewal, so it does not need a third
 * party for this at all, and no account UUID leaves the machine.
 *
 * Returns null when there is no skin to show, which is the offline-account
 * case; the caller then renders the initials tile as before.
 */
export function skinHeadStyle(skinUrl: string | undefined): CSSProperties | null {
  if (!skinUrl) return null
  // Quoted, so a URL containing brackets or spaces cannot break out of url().
  return { ['--skin' as string]: `url("${encodeURI(skinUrl)}")` }
}
