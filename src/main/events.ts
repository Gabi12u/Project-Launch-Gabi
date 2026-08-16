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

/** Sends an event to the renderer, silently dropping it while no window exists. */
export function emit(channel: string, payload: unknown): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
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
