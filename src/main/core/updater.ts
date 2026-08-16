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

  // Downloading is silent; installing waits for the user to be done playing.
  autoUpdater.autoDownload = getSettings().autoUpdate !== false
  autoUpdater.autoInstallOnAppQuit = true

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
    setStatus({
      state: 'ready',
      version: info.version,
      percent: 100,
      detail: `Version ${info.version} ist bereit.`
    })
    notify(
      'success',
      `Update auf ${info.version} bereit`,
      'Die neue Version wird beim nächsten Beenden installiert. Jetzt neu starten?',
      { route: '/settings?section=updates' }
    )
  })

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    // A failed update check must never look like a broken launcher.
    logger.warn('Update-Prüfung fehlgeschlagen:', message)
    setStatus({ state: 'error', error: message, detail: 'Update-Prüfung fehlgeschlagen.' })
  })

  if (getSettings().autoUpdate !== false) {
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
  checking = true
  try {
    autoUpdater.autoDownload = getSettings().autoUpdate !== false || manual
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
