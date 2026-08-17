import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { EVENTS } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'
import { emit, notify } from '../events'
import { log } from '../logger'
import { getSettings } from '../store'
import { runningCount } from './running'

const logger = log('updater')

/** Re-check this often while the launcher stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * How long after start a finished download still counts as "was already on
 * disk when we opened".
 *
 * Within this window the update came out of the cache — the check found it
 * ready from a previous session and nothing was transferred — so applying it
 * costs only the installer run. After the window it means the file just
 * finished downloading while the user was working, and pulling the launcher
 * out from under them for that would be rude; it waits for the next start.
 */
const STARTUP_INSTALL_WINDOW_MS = 25_000

const startedAt = Date.now()

let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }
let timer: NodeJS.Timeout | null = null
let checking = false

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch, currentVersion: app.getVersion() }
  emit(EVENTS.updateStatus, status)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/**
 * Updates only work from a packaged build: the metadata that tells the updater
 * where to look is written by electron-builder into the installed app.
 */
function supported(): boolean {
  return app.isPackaged
}

export function initUpdater(): void {
  if (!supported()) {
    setStatus({ state: 'disabled', detail: 'Updates gibt es nur in der installierten Version.' })
    logger.info('Updater im Entwicklungsmodus deaktiviert')
    return
  }

  autoUpdater.logger = {
    info: (...args: unknown[]) => logger.info(...args),
    warn: (...args: unknown[]) => logger.warn(...args),
    error: (...args: unknown[]) => logger.error(...args),
    debug: (...args: unknown[]) => logger.debug(...args)
  }

  const settings = getSettings()

  // Downloading is silent and never blocks the window.
  autoUpdater.autoDownload = settings.autoUpdate !== false

  // The two install moments are mutually exclusive. Installing on quit is
  // invisible — which is exactly what made it impossible to tell whether an
  // update had happened — so when the start-up install is on, the download is
  // deliberately left pending for the next launch, where the user sees it.
  autoUpdater.autoInstallOnAppQuit = settings.autoInstallUpdates === false

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking', detail: 'Suche nach Updates…' })
  })

  autoUpdater.on('update-available', (info) => {
    logger.info(`Update verfügbar: ${info.version}`)
    setStatus({
      state: autoUpdater.autoDownload ? 'downloading' : 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      percent: 0,
      detail: `Version ${info.version} verfügbar`
    })
  })

  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'up-to-date', percent: undefined, detail: 'Launch Gabi ist aktuell.' })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent)),
      bytesPerSecond: progress.bytesPerSecond,
      detail: `Update wird geladen… ${Math.round(progress.percent)}%`
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`Update ${info.version} bereit zur Installation`)

    // Straight from the cache during startup: apply it now and come back up on
    // the new version, which is the whole point of the setting. A game already
    // running vetoes it — restarting the launcher would orphan that process.
    const fromCache = Date.now() - startedAt < STARTUP_INSTALL_WINDOW_MS
    const wanted = getSettings().autoInstallUpdates !== false

    if (fromCache && wanted && runningCount() === 0) {
      logger.info(`Update ${info.version} wird direkt beim Start eingespielt`)
      setStatus({
        state: 'installing',
        version: info.version,
        percent: 100,
        detail: `Version ${info.version} wird installiert…`
      })
      notify('info', `Update auf ${info.version}`, 'Launch Gabi startet gleich neu.')

      // Long enough for the renderer to paint the message, short enough that it
      // still feels like part of starting up.
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(false, true)
        } catch (err) {
          logger.error('Automatische Installation fehlgeschlagen:', err)
          setStatus({ state: 'ready', version: info.version, detail: 'Update wartet auf Neustart.' })
        }
      }, 900)
      return
    }

    setStatus({
      state: 'ready',
      version: info.version,
      percent: 100,
      detail: `Version ${info.version} ist bereit.`
    })
    notify(
      'success',
      `Update auf ${info.version} bereit`,
      'Die neue Version wird beim nächsten Start installiert. Jetzt neu starten?',
      { route: '/settings?section=updates' }
    )
  })

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    // A failed update check must never look like a broken launcher.
    logger.warn('Update-Prüfung fehlgeschlagen:', message)
    setStatus({ state: 'error', error: message, detail: 'Update-Prüfung fehlgeschlagen.' })
  })

  // The check itself is one small request and runs off the main path, so it
  // never delays the window. A pending update from last session resolves inside
  // it almost immediately, which is what makes the start-up install quick.
  if (settings.autoUpdate !== false || settings.autoInstallUpdates !== false) {
    void checkForUpdates(false)
    timer = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS)
    // Nothing should keep the process alive just to poll for updates.
    timer.unref?.()
  }
}

export function disposeUpdater(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/**
 * @param manual `true` when the user pressed the button, which reports
 * "already up to date" instead of staying quiet.
 */
export async function checkForUpdates(manual = true): Promise<UpdateStatus> {
  if (!supported()) {
    const detail = 'Updates gibt es nur in der installierten Version.'
    setStatus({ state: 'disabled', detail })
    if (manual) notify('info', 'Kein Update möglich', detail)
    return status
  }

  // Overlapping checks confuse the state machine and the progress bar.
  if (checking) return status

  // A background poll must not walk over an update that is already downloaded
  // and waiting, or one still downloading — it would flip the state back to
  // "checking" and take the "restart to install" prompt off the screen.
  if (!manual && (status.state === 'ready' || status.state === 'downloading')) {
    return status
  }

  checking = true
  armCheckTimeout()
  try {
    // Deliberately not `|| manual`: pressing "Jetzt suchen" asks us to look for
    // an update, not to download one. Forcing it here made the setting for
    // "download automatically" unobservable and started a transfer on a metered
    // connection the user had explicitly opted out of.
    autoUpdater.autoDownload = getSettings().autoUpdate !== false
    await autoUpdater.checkForUpdates()
    if (manual && status.state === 'up-to-date') {
      notify('info', 'Kein Update verfügbar', `Launch Gabi ${app.getVersion()} ist die neueste Version.`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus({ state: 'error', error: message, detail: 'Update-Prüfung fehlgeschlagen.' })
    if (manual) notify('error', 'Update-Prüfung fehlgeschlagen', message)
  } finally {
    checking = false
  }
  return status
}

/**
 * Releases the `checking` guard if a check never settles.
 *
 * `checkForUpdates` clears the flag in its `finally`, but a request that hangs
 * forever never reaches it — and every later check, manual or scheduled, then
 * returns early with the panel stuck on "Suche nach Updates…" and the button
 * permanently inert.
 */
function armCheckTimeout(): void {
  const guard = setTimeout(() => {
    if (!checking) return
    checking = false
    logger.warn('Update-Prüfung hat nicht geantwortet, Sperre wird gelöst')
    setStatus({
      state: 'error',
      error: 'Zeitüberschreitung',
      detail: 'Die Update-Prüfung hat nicht geantwortet.'
    })
  }, 120_000)
  guard.unref?.()
}

/** Downloads an update that was found while auto-download was off. */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!supported() || status.state !== 'available') return status
  try {
    setStatus({ state: 'downloading', percent: 0 })
    await autoUpdater.downloadUpdate()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus({ state: 'error', error: message })
  }
  return status
}

/**
 * Restarts into the new version. Refuses while a game is running, because
 * quitting the launcher mid-session would cut the log stream and the session
 * bookkeeping for that instance.
 */
export function installUpdate(): void {
  if (!supported() || status.state !== 'ready') return

  if (runningCount() > 0) {
    notify(
      'warning',
      'Update später',
      'Beende erst Minecraft — das Update wird sonst mitten in der Sitzung eingespielt.'
    )
    return
  }

  logger.info('Installiere Update und starte neu')
  // `isSilent: false` shows the installer UI, `isForceRunAfter` reopens the app.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}
