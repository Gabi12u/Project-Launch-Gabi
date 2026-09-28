import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { EVENTS, type AppNotification, type NotificationKind } from '@shared/ipc'

let mainWindow: BrowserWindow | null = null

/**
 * Notifications raised before the main window exists or has finished loading
 * its page, oldest first.
 *
 * `getSettings()` can quarantine a corrupted file and call `notify()` at the
 * very start of `app.whenReady`, long before `createWindow()` has even run.
 * Sending straight through `emit()` at that point reaches no listener at
 * all: the renderer script that would receive it has not executed yet
 * either. Queued here and flushed once the page has actually loaded.
 */
let pendingNotifications: AppNotification[] = []

/** Set once the renderer has had time to register its listeners. */
let rendererListening = false

function flushPendingNotifications(): void {
  rendererListening = true
  if (pendingNotifications.length === 0) return
  const queued = pendingNotifications
  pendingNotifications = []
  for (const payload of queued) emit(EVENTS.notification, payload)
}

/** True once the main window exists and has actually finished loading its page. */
function rendererReady(): boolean {
  return rendererListening && mainWindow !== null && !mainWindow.isDestroyed()
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
  if (!win) return
  // Not `.once()`: a later reload (Ctrl+R in dev, the unresponsive-window
  // recovery) also flips `isLoading()` back to true for a moment, and any
  // notification queued during that window needs its own flush too. Safe to
  // call on every load regardless, since a flush with nothing queued is a
  // no-op and already-sent notifications are removed from the queue as soon
  // as they go out, so nothing is ever delivered twice.
  // The page has loaded here, but React registers its listeners a moment
  // later; the same grace period the boot notices in index.ts wait for.
  win.webContents.on('did-start-loading', () => {
    rendererListening = false
  })
  win.webContents.on('did-finish-load', () => setTimeout(flushPendingNotifications, 1500))
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * Sends an event to every open window, not only the main one.
 *
 * A game's log lines and status updates used to reach the main window alone,
 * which was fine while it was the only window that could ever exist. The
 * separate live-log window opened per launch needs the exact same stream,
 * and each window's own renderer only ever listens for the channels it
 * actually renders, so broadcasting the rest to a window that ignores them
 * costs nothing.
 */
export function emit(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}

export function notify(
  kind: NotificationKind,
  title: string,
  message?: string,
  extra?: Partial<AppNotification>
): void {
  const payload: AppNotification = {
    id: randomUUID(),
    kind,
    title,
    message,
    ...extra
  }
  if (!rendererReady()) {
    pendingNotifications.push(payload)
    return
  }
  emit(EVENTS.notification, payload)
}

/** Asks the renderer to navigate, used by deep links and notifications. */
export function navigate(route: string): void {
  emit(EVENTS.navigate, route)
}
