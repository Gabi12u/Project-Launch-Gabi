import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { EVENTS, type AppNotification, type NotificationKind } from '@shared/ipc'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
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
  emit(EVENTS.notification, payload)
}

/** Asks the renderer to navigate, used by deep links and notifications. */
export function navigate(route: string): void {
  emit(EVENTS.navigate, route)
}
