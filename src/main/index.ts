import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { EVENTS } from '@shared/ipc'
import { initLogger, log } from './logger'
import { ensureRootLayout } from './paths'
import { getSettings } from './store'
import { emit, navigate, notify, setMainWindow } from './events'
import { registerIpc } from './ipc'
import { launchInstance, stopAll } from './core/launch'
import { loadInstances, tryGetInstance } from './core/instances'
import { checkUpdates } from './core/content'
import { parseDeepLink, parseLaunchArgs, registerProtocol } from './core/shortcuts'
import { disposeUpdater, initUpdater } from './core/updater'

/** `app.isPackaged` is the only reliable dev/production signal in Electron. */
const isDev = !app.isPackaged

initLogger(isDev ? 'debug' : 'info')
const logger = log('app')

/** Instance the app was asked to launch through a shortcut or deep link. */
let pendingLaunch: string | null = null

/* ------------------------------------------------------------------ *
 * Single instance
 * ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  // A second start just hands its arguments to the running instance.
  logger.info('Bereits laufende Instanz gefunden, beende diesen Start')
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
    handleStartupArgs(argv)
  })

  bootstrap()
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#0a0b12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer loads mod icons straight from Modrinth/CurseForge CDNs.
      webSecurity: true
    }
  })

  setMainWindow(window)

  window.on('ready-to-show', () => {
    if (!getSettings().startMinimized) window.show()
  })

  const pushWindowState = (): void => emit(EVENTS.windowState, { maximized: window.isMaximized() })
  window.on('maximize', pushWindowState)
  window.on('unmaximize', pushWindowState)

  window.on('closed', () => setMainWindow(null))

  // External links never open inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // F12 opens the devtools in development; Ctrl+R reloads the renderer.
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12' && isDev) window.webContents.toggleDevTools()
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r' && isDev) {
      window.webContents.reload()
    }
  })

  return window
}

/* ------------------------------------------------------------------ *
 * Startup
 * ------------------------------------------------------------------ */

function bootstrap(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  void app.whenReady().then(async () => {
    // Groups the taskbar entry and makes notifications show the app name.
    app.setAppUserModelId('gg.launchgabi.app')
    nativeTheme.themeSource = 'dark'

    try {
      ensureRootLayout()
    } catch (err) {
      logger.error('Datenverzeichnis konnte nicht angelegt werden:', err)
    }

    registerProtocol()
    registerIpc()
    loadInstances()

    createWindow()
    handleStartupArgs(process.argv)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // Give the renderer a moment to subscribe before anything is pushed.
    setTimeout(() => {
      // Starts the background check; failures only ever land in the log.
      initUpdater()
      void runStartupChecks()
      void consumePendingLaunch()
    }, 1200)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    disposeUpdater()
    // Minecraft keeps running on its own; only stop it if the user asked us to.
    if (getSettings().launchBehaviour === 'close') stopAll()
  })
}

/* ------------------------------------------------------------------ *
 * Shortcuts & deep links
 * ------------------------------------------------------------------ */

function handleStartupArgs(argv: string[]): void {
  const intent = parseLaunchArgs(argv)
  if (intent) {
    pendingLaunch = intent.instanceId
    void consumePendingLaunch()
  }

  const url = argv.find((arg) => arg.startsWith('launchgabi://'))
  if (url) handleDeepLink(url)
}

function handleDeepLink(url: string): void {
  const link = parseDeepLink(url)
  logger.info(`Deep Link: ${url} -> ${link.action}`)

  switch (link.action) {
    case 'launch':
      if (link.instanceId) {
        pendingLaunch = link.instanceId
        void consumePendingLaunch()
      }
      break
    case 'instance':
      if (link.instanceId) navigate(`/instances/${link.instanceId}`)
      break
    case 'install':
      if (link.projectId) navigate(`/discover?project=${link.provider}:${link.projectId}`)
      break
    default:
      break
  }
}

/** Starts the instance a shortcut asked for, once the app is ready. */
async function consumePendingLaunch(): Promise<void> {
  if (!pendingLaunch || !app.isReady()) return

  const instanceId = pendingLaunch
  pendingLaunch = null

  const instance = tryGetInstance(instanceId)
  if (!instance) {
    logger.warn(`Verknüpfung zeigt auf unbekannte Instanz ${instanceId}`)
    notify('error', 'Instanz nicht gefunden', `Die Verknüpfung verweist auf "${instanceId}".`)
    return
  }

  navigate(`/instances/${instanceId}`)
  logger.info(`Starte ${instance.name} über Verknüpfung`)

  try {
    await launchInstance({ instanceId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    notify('error', `${instance.name} konnte nicht gestartet werden`, message)
  }
}

/* ------------------------------------------------------------------ *
 * Background checks
 * ------------------------------------------------------------------ */

async function runStartupChecks(): Promise<void> {
  const settings = getSettings()
  if (!settings.checkContentUpdatesOnStart) return

  const instances = loadInstances().filter((i) => i.installed && i.content.length > 0)

  let total = 0
  for (const instance of instances) {
    try {
      const updated = await checkUpdates(instance.id)
      total += updated.content.filter((c) => c.update).length
    } catch (err) {
      logger.debug(`Update-Prüfung für ${instance.name} übersprungen:`, err)
    }
  }

  if (total > 0 && settings.notifyOnUpdates) {
    notify(
      'info',
      `${total} ${total === 1 ? 'Update' : 'Updates'} verfügbar`,
      'Öffne eine Instanz, um sie zu aktualisieren.',
      { route: '/instances' }
    )
  }
}
