import { BrowserWindow, app, shell } from 'electron'
import { join } from 'node:path'
import { getLanguage, tr } from '@shared/i18n'
import { getMainWindow } from './events'
import { log } from './logger'

const logger = log('gameLogWindow')

/**
 * The separate live-log window opened for every launch, one per running
 * instance, in the style of a classic launcher console window (Prism
 * Launcher and others) rather than a panel inside the main window.
 *
 * Kept independent of the main window on purpose: the whole point is that it
 * keeps showing the game's output regardless of what the main window does
 * (hidden while playing, closed, whatever `launchBehaviour` says), and
 * closing it never touches the game itself, only the button inside it does.
 *
 * It closes again on its own once the game it belongs to has ended
 * (`closeGameLogWindow`, called from `handleWindowRestore` in launch.ts): the
 * log then keeps living in the ordinary Log tab of the main window instead,
 * so a window nobody is going to reopen does not just sit there.
 */
const logWindows = new Map<string, BrowserWindow>()

/**
 * `webContents.id`s of every open log window, so `ipc.ts` can recognise a
 * request coming from one and hold it to the narrow set of channels
 * `GameLogWindow.tsx` actually calls, the same preload exposes every channel
 * to whichever window loads it.
 */
const logWindowWebContentsIds = new Set<number>()

/** Log windows being closed by the launcher itself rather than by the user. */
const closingByLauncher = new Set<BrowserWindow>()

/**
 * With the launch behaviour "hide" this window is the only one left on
 * screen while the game runs. Closing it by hand must not leave the launcher
 * running with no window at all, so the main window comes back instead.
 */
let quitting = false
let quitHookInstalled = false

function revealMainWindow(): void {
  // Quitting closes every window, this one included, and the main window
  // must not flash back up on the way out.
  if (quitting) return
  // Another game's log window is still open and stands in for the hidden
  // launcher, so that game keeps the screen to itself.
  for (const other of logWindows.values()) {
    if (!other.isDestroyed() && !closingByLauncher.has(other)) return
  }
  showLauncherWindow()
}

/** Shows, restores and focuses the main window, e.g. from the log window's button. */
export function showLauncherWindow(): void {
  const main = getMainWindow()
  if (!main || main.isDestroyed()) return
  if (main.isMinimized()) main.restore()
  if (!main.isVisible()) main.show()
  main.focus()
}

export function hasGameLogWindow(instanceId: string): boolean {
  const win = logWindows.get(instanceId)
  return win !== undefined && !win.isDestroyed() && !closingByLauncher.has(win)
}

export function isGameLogWebContents(webContentsId: number): boolean {
  return logWindowWebContentsIds.has(webContentsId)
}

export function openGameLogWindow(instanceId: string, instanceName: string): void {
  const existing = logWindows.get(instanceId)
  // A window still closing from the previous run of this instance (stop, then
  // straight back to play) is not reused: it goes away a moment later and
  // would leave the new run without a log.
  if (existing && !existing.isDestroyed() && !closingByLauncher.has(existing)) {
    existing.focus()
    return
  }

  if (!quitHookInstalled) {
    quitHookInstalled = true
    app.once('before-quit', () => {
      quitting = true
    })
  }

  const win = new BrowserWindow({
    width: 720,
    height: 480,
    minWidth: 480,
    minHeight: 300,
    title: tr(`Live-Log: ${instanceName}`, `Live log: ${instanceName}`),
    // Frameless like the main window, with its own small titlebar drawn in
    // the renderer (GameLogWindow.tsx): the native title bar and its default
    // File/Edit/View/Window menu looked like a generic Electron window
    // dropped next to the rest of the launcher's own dark, custom chrome.
    frame: false,
    backgroundColor: '#0a0b12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--gabi-lang=${getLanguage()}`]
    }
  })

  logWindows.set(instanceId, win)
  const webContentsId = win.webContents.id
  logWindowWebContentsIds.add(webContentsId)
  win.on('closed', () => {
    // Only drop the entry if it is still this window: a quick close and reopen
    // could otherwise remove the newer one.
    if (logWindows.get(instanceId) === win) logWindows.delete(instanceId)
    logWindowWebContentsIds.delete(webContentsId)
    const byLauncher = closingByLauncher.delete(win)
    if (!byLauncher) revealMainWindow()
  })

  // This window only ever shows its own bundled page. Unlike the main
  // window, it has no legitimate reason to ever navigate anywhere else, so
  // any attempt (a compromised renderer, a stray link) is refused outright.
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // Mirrors the main window's own guard in index.ts: an http(s) link opens in
  // the system browser, everything else (a new window, a javascript: URL) is
  // denied rather than opened inside this frameless little window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url).catch((err: unknown) => {
        logger.error(`Link im Log-Fenster konnte nicht geöffnet werden (${url}):`, err)
      })
    }
    return { action: 'deny' }
  })

  const query = `?gameLog=${encodeURIComponent(instanceId)}&name=${encodeURIComponent(instanceName)}`
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }
}

export function closeGameLogWindow(instanceId: string): void {
  const win = logWindows.get(instanceId)
  if (win && !win.isDestroyed()) {
    closingByLauncher.add(win)
    win.close()
  }
}
