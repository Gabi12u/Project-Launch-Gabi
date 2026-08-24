import { useSyncExternalStore } from 'react'
import type { AppNotification } from '@shared/ipc'
import { DEFAULT_LAUNCHER_SETTINGS } from '@shared/defaults'
import type {
  Account,
  CompatibilityReport,
  InstanceSummary,
  LauncherSettings,
  LaunchStatus,
  TaskProgress
} from '@shared/types'

/* ------------------------------------------------------------------ *
 * A minimal external store. React subscribes through useSyncExternalStore,
 * so no state library is needed for an app of this size.
 * ------------------------------------------------------------------ */

export interface AppState {
  route: string
  ready: boolean
  settings: LauncherSettings
  instances: InstanceSummary[]
  accounts: Account[]
  tasks: TaskProgress[]
  launchStatus: Record<string, LaunchStatus>
  toasts: AppNotification[]
  maximized: boolean
  /** Set while the modal for creating an instance is open. */
  createOpen: boolean
  /** Set while the Ctrl+K command palette is open. */
  paletteOpen: boolean
  /** Populated when a launch was stopped by compatibility problems. */
  compatGate: { instanceId: string; instanceName: string; report: CompatibilityReport } | null
  /** Instances whose launch is currently being prepared in the UI. */
  starting: string[]
}

const initial: AppState = {
  route: '/home',
  ready: false,
  settings: { ...DEFAULT_LAUNCHER_SETTINGS },
  instances: [],
  accounts: [],
  tasks: [],
  launchStatus: {},
  toasts: [],
  maximized: false,
  createOpen: false,
  paletteOpen: false,
  compatGate: null,
  starting: []
}

let state: AppState = initial
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Subscribes to the whole store; the state object is replaced on every write. */
export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

export function navigate(route: string): void {
  if (state.route === route) return
  setState({ route })
  // Views scroll independently; a fresh route should start at the top.
  requestAnimationFrame(() => {
    document.querySelector('.view')?.scrollTo({ top: 0 })
  })
}

export interface ParsedRoute {
  section: string
  param?: string
  query: URLSearchParams
}

export function parseRoute(route: string): ParsedRoute {
  const [path, search = ''] = route.split('?')
  const segments = path.split('/').filter(Boolean)
  return {
    section: segments[0] ?? 'home',
    param: segments[1],
    query: new URLSearchParams(search)
  }
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

let toastCounter = 0

export function toast(
  kind: AppNotification['kind'],
  title: string,
  message?: string,
  timeout = 5200
): void {
  const item: AppNotification = { id: `t${++toastCounter}`, kind, title, message, timeout }
  setState((current) => ({ toasts: [...current.toasts, item].slice(-4) }))

  if (timeout > 0) {
    setTimeout(() => dismissToast(item.id), timeout)
  }
}

export function pushNotification(notification: AppNotification): void {
  setState((current) => ({ toasts: [...current.toasts, notification].slice(-4) }))
  const timeout = notification.timeout ?? 6500
  if (timeout > 0) setTimeout(() => dismissToast(notification.id), timeout)
}

export function dismissToast(id: string): void {
  setState((current) => ({ toasts: current.toasts.filter((t) => t.id !== id) }))
}

/** Reports a rejected IPC call without every call site repeating the try/catch. */
export function toastError(error: unknown, fallback = 'Es ist ein Fehler aufgetreten'): void {
  const message = error instanceof Error ? error.message : String(error)
  toast('error', fallback, message, 9000)
}

/* ------------------------------------------------------------------ *
 * Data refreshers
 * ------------------------------------------------------------------ */

export async function refreshInstances(): Promise<void> {
  try {
    setState({ instances: await window.gabi.instances.list() })
  } catch (err) {
    toastError(err, 'Instanzen konnten nicht geladen werden')
  }
}

export async function refreshAccounts(): Promise<void> {
  try {
    setState({ accounts: await window.gabi.accounts.list() })
  } catch (err) {
    toastError(err, 'Accounts konnten nicht geladen werden')
  }
}

export async function refreshSettings(): Promise<LauncherSettings> {
  const settings = await window.gabi.settings.get()
  setState({ settings })
  applyTheme(settings)
  return settings
}

/**
 * Saves settings and reports whether it worked.
 *
 * Deliberately does not throw: nearly every caller is a toggle that fires this
 * and forgets it, and a rejection there would surface as an unhandled promise.
 * But swallowing the failure entirely was worse — callers that awaited it read
 * the absence of an exception as success, so a refused save still produced a
 * success message. The boolean lets those few callers tell the difference.
 */
export async function saveSettings(patch: Partial<LauncherSettings>): Promise<boolean> {
  try {
    const settings = await window.gabi.settings.set(patch)
    setState({ settings })
    applyTheme(settings)
    return true
  } catch (err) {
    toastError(err, 'Einstellung konnte nicht gespeichert werden')
    return false
  }
}

/** Writes theme, accent and motion preference onto the document root. */
export function applyTheme(settings: LauncherSettings): void {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'

  const accent = settings.accentColor || '#7c5cff'
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-2', shiftHue(accent, 28))
  root.style.setProperty('--accent-soft', withAlpha(accent, 0.16))
  root.style.setProperty('--accent-line', withAlpha(accent, 0.42))
  root.style.setProperty('--accent-glow', withAlpha(accent, 0.55))
}

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const value = parseInt(full, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Derives the secondary accent so gradients stay in the same colour family. */
function shiftHue(hex: string, degrees: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))

  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }

  h = (h + degrees) % 360

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]

  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`
}
