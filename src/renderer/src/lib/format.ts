import type { CSSProperties } from 'react'
import type { LoaderId } from '@shared/types'
import { locale, tr } from '@shared/i18n'

/**
 * Formats a number the way a German reader expects: a comma for the decimal
 * separator instead of the dot toFixed() gives. Rounding behaves the same as
 * toFixed, only the punctuation changes.
 */
export function formatDecimal(value: number, digits: number): string {
  return value.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

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
  // 1023,97 MB would round to "1.024 MB"; show it as the next unit instead.
  if (Math.round(value) >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${formatDecimal(value, value >= 100 ? 0 : decimals)} ${units[unit]}`
}

export function formatNumber(value: number): string {
  // From 999.500 on, the K branch would round to "1.000K".
  if (value >= 999_500) return `${formatDecimal(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${formatDecimal(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return String(value)
}

/** Play time, tuned for the ranges a launcher actually shows. */
export function formatPlayTime(ms: number): string {
  const min = tr('Min', 'min')
  const hr = tr('Std', 'h')
  if (!ms || ms < 60_000) return `< 1 ${min}`
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} ${min}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? `${hours} ${hr} ${rest} ${min}` : `${hours} ${hr}`
  const days = Math.floor(hours / 24)
  return `${days} ${tr('T', 'd')} ${hours % 24} ${hr}`
}

export function formatDuration(ms: number): string {
  // A clock that moved backwards during a recording produced a negative length,
  // which came out of here as "-1:-5 Min".
  const seconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}:${String(minutes % 60).padStart(2, '0')} ${tr('Std', 'h')}`
  return `${minutes}:${String(seconds % 60).padStart(2, '0')} ${tr('Min', 'min')}`
}

export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return tr('nie', 'never')

  const diff = Date.now() - timestamp
  if (diff < 60_000) return tr('gerade eben', 'just now')
  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000)
    return tr(`vor ${minutes} Min`, `${minutes} min ago`)
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000)
    return tr(`vor ${hours} Std`, `${hours} h ago`)
  }
  if (diff < 7 * 86_400_000) {
    const days = Math.floor(diff / 86_400_000)
    return days === 1 ? tr('gestern', 'yesterday') : tr(`vor ${days} Tagen`, `${days} days ago`)
  }

  return new Date(timestamp).toLocaleDateString(locale(), {
    day: '2-digit',
    month: 'short',
    year: diff > 300 * 86_400_000 ? 'numeric' : undefined
  })
}

export function formatDate(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(value: number): string {
  return new Date(value).toLocaleString(locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString(locale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return `${gb % 1 === 0 ? gb : formatDecimal(gb, 1)} GB`
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
  if (hour < 5) return tr('Gute Nacht', 'Good night')
  if (hour < 11) return tr('Guten Morgen', 'Good morning')
  if (hour < 18) return tr('Guten Tag', 'Good afternoon')
  return tr('Guten Abend', 'Good evening')
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

  // Mojang hands out texture links over plain http, and the renderer's
  // Content-Security-Policy only permits images from https. The browser
  // therefore blocked the request outright and the tile stayed empty — with
  // the skin class applied, so not even the initials showed through.
  // textures.minecraft.net serves the identical file over https, and this is
  // done at display time rather than when storing so accounts that were saved
  // before this fix are corrected too, without needing a fresh login.
  const secure = skinUrl.startsWith('http://') ? `https://${skinUrl.slice('http://'.length)}` : skinUrl

  // Quoted, so a URL containing brackets or spaces cannot break out of url().
  return { ['--skin' as string]: `url("${encodeURI(secure)}")` }
}

/**
 * Why mods cannot be changed on this instance right now, or null if they can.
 *
 * One place, because the answer was previously re-derived at every button and
 * they disagreed: some checked only `running`, some checked nothing at all,
 * and none knew about the minutes-long preparation phase after Play or about
 * an update already in flight. The backend refuses in all three cases, so a
 * button that stays bright and clickable is simply lying about it.
 */
export function contentBlockedReason(instance: {
  running?: boolean
  starting?: boolean
  contentBusy?: boolean
}): string | null {
  if (instance.running) return tr('Nicht möglich, solange Minecraft läuft.', 'Not possible while Minecraft is running.')
  if (instance.starting) return tr('Nicht möglich, die Instanz wird gerade gestartet.', 'Not possible, the instance is starting right now.')
  if (instance.contentBusy) return tr('An den Mods wird gerade gearbeitet. Warte, bis das fertig ist.', 'The mods are being worked on right now. Wait until that is done.')
  return null
}
