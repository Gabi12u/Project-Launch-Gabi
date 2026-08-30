import { BrowserWindow, app, dialog, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { EVENTS } from '@shared/ipc'
import { initLogger, log } from './logger'
import { ensureRootLayout } from './paths'
import { getSettings } from './store'
import { emit, navigate, notify, setMainWindow, getMainWindow} from './events'
import { registerIpc } from './ipc'
import { launchInstance, stopAll } from './core/launch'
import { adoptRunningFromDisk, pruneAdopted } from './core/running'
import { cleanTempFiles } from './core/repair'
import { loadInstances, tryGetInstance } from './core/instances'
import { checkUpdates } from './core/content'
import { parseDeepLink, parseLaunchArgs, registerProtocol } from './core/shortcuts'
import { announceUpdate, disposeUpdater, initUpdater } from './core/updater'
import { disposeRecording, flushRecording, getRecordingState, initRecording } from './core/recording'
import { reportError } from './core/reports'

/** `app.isPackaged` is the only reliable dev/production signal in Electron. */
const isDev = !app.isPackaged

initLogger(isDev ? 'debug' : 'info')
const logger = log('app')

/** Instance the app was asked to launch through a shortcut or deep link. */
let pendingLaunch: string | null = null

/**
 * A deep link that arrived before there was a window to send it to.
 *
 * `navigate` drops silently when no window exists, and that is reachable in
 * normal use: on macOS a `launchgabi://` URL can start the app cold via
 * `open-url`, and closing the last window there keeps the app alive, so a
 * second link can arrive with nothing to receive it. The launch action already
 * had this treatment through `pendingLaunch`; the other two did not and simply
 * did nothing.
 */
let pendingRoute: string | null = null

/**
 * False until the renderer has had time to subscribe to main-process events.
 *
 * A window object exists the instant `createWindow` returns, long before the
 * page inside it has loaded and attached its listeners. Startup arguments are
 * handled on the very next line, so a shortcut or a `launchgabi://` link that
 * started the launcher cold was acted on against a window that was not
 * listening yet: the navigation went nowhere and the launch progress never
 * reached the interface, leaving the user looking at the home screen while
 * Minecraft started behind it. Anything aimed at the renderer waits for this.
 */
let bootSettled = false

/** Set once a pending recording has been given its chance to finish. */
let quitFlushed = false

/** True once the renderer can be expected to receive what it is sent. */
function rendererReachable(): boolean {
  return bootSettled && getMainWindow() !== null
}

/** Delivers a route now, or remembers it until the renderer can receive it. */
function routeOrQueue(target: string): void {
  if (rendererReachable()) {
    navigate(target)
    return
  }
  pendingRoute = target
  logger.info(`Deep Link ${target} vorgemerkt, die Oberfläche ist noch nicht bereit`)
}

function consumePendingRoute(): void {
  if (!pendingRoute || !rendererReachable()) return
  const target = pendingRoute
  pendingRoute = null
  navigate(target)
}

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
      // The preload only touches `contextBridge` and `ipcRenderer`, so nothing
      // here needs the unsandboxed Node access that turning this off buys —
      // it would only widen the blast radius of a renderer-side compromise.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer loads mod icons straight from Modrinth/CurseForge CDNs.
      webSecurity: true,
      // Chromium throttles timers and rendering in a window the user cannot
      // see, and this window is behind a fullscreen game for the entire length
      // of every recording. The capture, the encoder's slice timer and the
      // handover to the main process all live in that renderer, so the default
      // turned exactly the case this feature exists for into the slowest one.
      backgroundThrottling: false
    }
  })

  setMainWindow(window)

  window.on('ready-to-show', () => {
    if (!getSettings().startMinimized) window.show()
    // A window can also appear long after startup, for instance when the dock
    // icon is clicked on macOS. Any deep link waiting since then is delivered
    // here rather than only by the one-shot timer during boot.
    consumePendingRoute()
    // Same for a launch waiting on a window. On macOS the app stays alive with
    // no window at all, so a shortcut can arrive with nothing to show it.
    void consumePendingLaunch()
  })

  const pushWindowState = (): void => emit(EVENTS.windowState, { maximized: window.isMaximized() })
  window.on('maximize', pushWindowState)
  window.on('unmaximize', pushWindowState)

  window.on('closed', () => setMainWindow(null))

  // External links never open inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      // A machine with no default browser association rejects this, and an
      // unhandled rejection here would take the launcher down over a link click.
      void shell.openExternal(url).catch((err: unknown) => {
        logger.error(`Link konnte nicht geöffnet werden (${url}):`, err)
      })
    }
    return { action: 'deny' }
  })

  const failedToLoad = (err: unknown): void => {
    // A missing or quarantined renderer bundle would otherwise reject silently
    // and leave the user with an invisible window and nothing in the log.
    logger.error('Oberfläche konnte nicht geladen werden:', err)
    dialog.showErrorBox(
      'Launch Gabi konnte nicht starten',
      'Die Programmoberfläche konnte nicht geladen werden. Eine Neuinstallation behebt das in der Regel.'
    )
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL']).catch(failedToLoad)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html')).catch(failedToLoad)
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
  // Without these, any stray rejection or throw anywhere in the main process
  // terminates the launcher outright — taking every running download and the
  // window with it. Logging and carrying on is nearly always the better trade
  // for a desktop app the user has work open in.
  process.on('uncaughtException', (err) => {
    logger.error('Unbehandelter Fehler im Hauptprozess:', err)
    reportError('main:uncaught', err)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('Unbehandelte Promise-Ablehnung im Hauptprozess:', reason)
    reportError('main:rejection', reason)
  })

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
    // Before the instances are read, so their `running` flag reflects a game
    // the previous session left behind rather than claiming nothing is up.
    adoptRunningFromDisk()
    try {
      loadInstances()
      // Only meaningful once the instances are known, hence not up with the
      // adoption itself.
      pruneAdopted((id) => tryGetInstance(id) !== null)
    } catch (err) {
      // The data directory can sit on a disconnected network drive or an
      // unhydrated cloud folder. Starting with an empty list beats dying before
      // a window ever appears, with only a log line to show for it.
      logger.error('Instanzen konnten nicht geladen werden:', err)
    }

    createWindow()
    handleStartupArgs(process.argv)

    // Started right alongside the window rather than after the usual settling
    // delay: an update left pending by the previous session resolves out of the
    // cache in milliseconds, and every second it waits here is a second the
    // user stares at a launcher that is about to restart anyway. The check is
    // one small request and holds nothing up if there is no update.
    initUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // Give the renderer a moment to subscribe before anything is pushed.
    setTimeout(() => {
      bootSettled = true

      // Each step stands alone. These write files and talk to the OS, so any
      // of them can throw on a machine with a locked config or a hostile
      // virus scanner, and an escaping error used to abandon everything
      // scheduled after it for the rest of the session: no recording hotkey,
      // no cleanup, a shortcut launch silently dropped, and nothing on screen
      // to say so.
      try {
        announceUpdate()
      } catch (err) {
        logger.error('Update-Hinweis fehlgeschlagen:', err)
      }
      try {
        // Claims the recording hotkey if a game from the previous session is
        // still up, and wires the listener that follows every later launch.
        initRecording()
      } catch (err) {
        logger.error('Aufnahmefunktion konnte nicht eingerichtet werden:', err)
      }

      // A quit or crash during a download strands its `.part` file, and nothing
      // else ever sweeps the shared library/asset trees where most of them land.
      // Not awaited: this sweeps the shared library and asset trees, and the
      // launcher has no reason to hold anything up for it.
      void cleanTempFiles()
        .then((removed) => {
          if (removed > 0) logger.info(`${removed} unterbrochene Downloads aufgeräumt`)
        })
        .catch((err: unknown) => {
          logger.warn('Aufräumen unterbrochener Downloads fehlgeschlagen:', err)
        })

      void runStartupChecks()
      void consumePendingLaunch()
      consumePendingRoute()
    }, 1200)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    // A recording still has a slice buffered in the renderer's encoder, and
    // closing the file outright threw away the last seconds of it. The quit is
    // held back once, just long enough to ask for that slice.
    if (!quitFlushed && getRecordingState().active) {
      event.preventDefault()
      logger.info('Beenden wartet kurz auf die laufende Aufnahme')
      void flushRecording().finally(() => {
        quitFlushed = true
        app.quit()
      })
      return
    }

    disposeUpdater()
    void disposeRecording()
    // Minecraft keeps running on its own; only stop it if the user asked us to.
    // Killed outright rather than gracefully: the escalation timer inside
    // `stopInstance` would die with this process before it could ever fire.
    if (getSettings().launchBehaviour === 'close') stopAll(true)
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
      if (link.instanceId) routeOrQueue(`/instances/${link.instanceId}`)
      break
    case 'install':
      if (link.projectId) routeOrQueue(`/discover?project=${link.provider}:${link.projectId}`)
      break
    default:
      break
  }
}

/** Starts the instance a shortcut asked for, once the app is ready. */
async function consumePendingLaunch(): Promise<void> {
  // Left pending rather than dropped when the renderer cannot receive yet: the
  // timer during boot calls this again, and by then the progress, the log
  // window and the compatibility dialog all have somewhere to appear.
  if (!pendingLaunch || !app.isReady() || !rendererReachable()) return

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
