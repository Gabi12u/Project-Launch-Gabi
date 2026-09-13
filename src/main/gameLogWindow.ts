import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'

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

export function openGameLogWindow(instanceId: string, instanceName: string): void {
  const existing = logWindows.get(instanceId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 720,
    height: 480,
    minWidth: 480,
    minHeight: 300,
    title: `Live-Log: ${instanceName}`,
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
      nodeIntegration: false
    }
  })

  logWindows.set(instanceId, win)
  win.on('closed', () => logWindows.delete(instanceId))

  const query = `?gameLog=${encodeURIComponent(instanceId)}&name=${encodeURIComponent(instanceName)}`
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }
}

export function closeGameLogWindow(instanceId: string): void {
  const win = logWindows.get(instanceId)
  if (win && !win.isDestroyed()) win.close()
}
