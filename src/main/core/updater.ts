import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { EVENTS } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'
import { changelogLocalized } from '@shared/changelogEn'
import { emit, notify } from '../events'
import { log } from '../logger'
import { getSettings, saveSettings } from '../store'
import { runningCount } from './running'
import { startingCount } from './launch'
import { listTasks } from '../tasks'
import { getLanguage, tr } from '@shared/i18n'
import { compareVersions, isPrerelease } from '@shared/versions'
import { betaFeed, channelFile, type BetaFeed } from './beta'

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
/** The version last announced as available, so a periodic check does not repeat it. */
let announcedAvailable: string | null = null
let checking = false

/** How long a download may go without progress before it counts as stuck. */
const DOWNLOAD_STALL_MS = 10 * 60 * 1000
/** The last time a running download showed a sign of life. */
let lastDownloadSign = 0

function setStatus(patch: Partial<UpdateStatus>): void {
  if (patch.state === 'downloading') lastDownloadSign = Date.now()
  status = { ...status, ...patch, currentVersion: app.getVersion() }

  // The patch is merged, so `error` outlived the failure that set it: a check
  // that failed once and then succeeded still carried the old message, and the
  // settings page showed "Launch Gabi ist aktuell" with a red error underneath
  // it. Anything that is no longer an error state has no error to report.
  if (patch.state && patch.state !== 'error' && patch.error === undefined) {
    status = { ...status, error: undefined }
  }

  emit(EVENTS.updateStatus, status)
}

/**
 * Says so when the launcher has come back up on a new version.
 *
 * An update installs itself and relaunches, which from the outside looks like
 * an ordinary restart: nothing tells the user it happened, and the notes about
 * what changed sit in a settings page nobody has a reason to open. This closes
 * that gap once per version, and the toast leads straight to the entry.
 *
 * Deliberately quiet on a first install. `lastRunVersion` is empty then, and
 * greeting a brand new user with "update finished" would be nonsense.
 */
/**
 * True when `next` is a later release than `previous`.
 *
 * Reinstalling an older build is a perfectly ordinary thing to do after a bad
 * release, and comparing only for inequality greeted that with "Update
 * abgeschlossen auf 1.0.11" while the launcher had in fact gone backwards.
 * Betas count as coming before their release: the step from 1.0.25-beta.2 to
 * 1.0.25 is an update, which splitting on dots read the other way round.
 */
function isNewer(next: string, previous: string): boolean {
  return compareVersions(next, previous) > 0
}

export function announceUpdate(): void {
  const version = app.getVersion()
  const settings = getSettings()
  const previous = settings.lastRunVersion

  if (previous !== version) {
    // Written before the notification rather than after, so a crash while the
    // window paints cannot turn this into a message that returns every start.
    try {
      saveSettings({ lastRunVersion: version })
    } catch (err) {
      // A locked settings file; announced once it can be written again.
      logger.warn('Zuletzt gestartete Version nicht gespeichert:', err)
      return
    }
  }
  if (!previous || previous === version) return
  if (!isNewer(version, previous)) {
    logger.info(`Version gewechselt von ${previous} auf ${version}, kein Update nach vorn`)
    return
  }

  logger.info(`Update abgeschlossen: ${previous} -> ${version}`)
  // A beta has no entry in the list of what is new; it is still being made.
  if (isPrerelease(version)) {
    notify(
      'success',
      tr(`Beta ${version} installiert`, `Beta ${version} installed`),
      tr('Danke fürs Testen! Was dir auffällt, kannst du in den Einstellungen unter Fehlerberichte melden.', 'Thanks for testing! Anything you notice can be reported in the settings under Error reports.'),
      { route: '/settings?section=reports', timeout: 0 }
    )
    return
  }
  const entry = changelogLocalized(getLanguage()).find((release) => release.version === version)
  notify(
    'success',
    tr(`Update abgeschlossen auf ${version}`, `Updated to ${version}`),
    entry
      ? tr(`${entry.headline} Hier klicken, um alle Neuerungen zu sehen.`, `${entry.headline} Click here to see everything that is new.`)
      : tr('Hier klicken, um die Neuerungen zu sehen.', 'Click here to see what is new.'),
    // No timeout: this is the one message worth still being there when the
    // user looks back at the window a minute after starting.
    { route: '/settings?section=changelog', timeout: 0 }
  )
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/* ------------------------------------------------------------------ *
 * Where updates come from
 * ------------------------------------------------------------------ */

/** The newest release on GitHub, from the same manifest the updater reads. */
const STABLE_FEED = 'https://github.com/Gabi12u/Project-Launch-Gabi/releases/latest/download'

/**
 * Which feed the updater was last pointed at. `packaged` is the one written
 * into the installed app, and stays untouched for everyone who never joined
 * the beta programme.
 */
let feed: 'packaged' | 'beta' | 'stable' = 'packaged'

async function stableVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${STABLE_FEED}/${channelFile('latest')}`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    return /^version:\s*['"]?([^'"\s]+)/m.exec(await res.text())?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Points the updater at whichever feed is ahead for this user.
 *
 * Everyone gets the GitHub releases. Someone in the beta programme also has
 * the beta feed on the admin server and gets whichever of the two offers the
 * newer version: a beta while it is ahead of the last release, and the
 * release that follows the betas once it is out. Without that second half a
 * beta tester would sit on the last beta forever.
 */
async function pointFeed(): Promise<void> {
  const beta = await betaFeed().catch((err) => {
    logger.warn('Beta-Programm nicht abgefragt:', err instanceof Error ? err.message : err)
    return null
  })
  if (beta?.version && compareVersions(beta.version, app.getVersion()) > 0) {
    const stable = await stableVersion()
    if (!stable || compareVersions(beta.version, stable) > 0) {
      useBetaFeed(beta)
      return
    }
  }
  useStableFeed()
}

function useBetaFeed(beta: BetaFeed): void {
  if (feed !== 'beta') logger.info('Update-Quelle: Beta-Programm')
  autoUpdater.setFeedURL({ provider: 'generic', url: beta.url })
  feed = 'beta'
  // In this order: setting the channel switches downgrades on as a side
  // effect, and a beta feed that is behind must never take anyone back.
  autoUpdater.channel = 'beta'
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = true
  // The token goes to the admin server and nowhere else.
  autoUpdater.requestHeaders = { 'x-beta-token': beta.token }
  // The small differential download needs the blockmap of the installed
  // version from the same feed, which a beta feed does not keep.
  autoUpdater.disableDifferentialDownload = true
}

function useStableFeed(): void {
  if (feed === 'beta') {
    logger.info('Update-Quelle: GitHub')
    autoUpdater.setFeedURL({ provider: 'github', owner: 'Gabi12u', repo: 'Project-Launch-Gabi' })
    feed = 'stable'
  }
  // Also for a packaged beta build: its own config names the beta channel,
  // which does not exist on GitHub.
  autoUpdater.channel = 'latest'
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.requestHeaders = null
  autoUpdater.disableDifferentialDownload = false
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
    setStatus({ state: 'disabled', detail: tr('Updates gibt es nur in der installierten Version.', 'Updates are only available in the installed version.') })
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

  // Never. This used to be `settings.autoInstallUpdates === false`, which meant
  // switching automatic installation *off* switched on the one install path
  // that gives no sign of itself at all: electron-updater runs the installer
  // during shutdown, past every check in this file, so a game still running was
  // not consulted and the user had asked for the opposite of what happened.
  // Installation now only happens where it is visible, either during start-up
  // just below or from the button in the settings.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking', detail: tr('Suche nach Updates…', 'Checking for updates…') })
  })

  autoUpdater.on('update-available', (info) => {
    logger.info(`Update verfügbar: ${info.version}`)
    // With automatic downloads off this used to change only the status in
    // the settings, so an update was found and announced nowhere.
    if (!autoUpdater.autoDownload && announcedAvailable !== info.version) {
      announcedAvailable = info.version
      notify(
        'info',
        tr(`Update auf ${info.version} verfügbar`, `Update to ${info.version} available`),
        tr('Klicke hier, um es in den Einstellungen herunterzuladen.', 'Click here to download it in the settings.'),
        { route: '/settings?section=updates' }
      )
    }
    setStatus({
      state: autoUpdater.autoDownload ? 'downloading' : 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      percent: 0,
      detail: tr(`Version ${info.version} verfügbar`, `Version ${info.version} available`)
    })
  })

  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'up-to-date', percent: undefined, detail: tr('Launch Gabi ist aktuell.', 'Launch Gabi is up to date.') })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent)),
      bytesPerSecond: progress.bytesPerSecond,
      detail: tr(`Update wird geladen… ${Math.round(progress.percent)}%`, `Downloading update… ${Math.round(progress.percent)}%`)
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`Update ${info.version} bereit zur Installation`)

    // Straight from the cache during startup: apply it now and come back up on
    // the new version, which is the whole point of the setting. A game already
    // running vetoes it — restarting the launcher would orphan that process.
    const fromCache = Date.now() - startedAt < STARTUP_INSTALL_WINDOW_MS
    const wanted = getSettings().autoInstallUpdates !== false

    // `startingCount` matters as much as `runningCount` here: a launch that is
    // still downloading files has no process yet, so the running registry says
    // "nothing is up" while the user is very much waiting for their game.
    // A download, import or backup in progress would be cut off by the
    // restart just the same, and the app's own relaunch already waits for it.
    const busy = runningCount() > 0 || startingCount() > 0 || tasksRunning()

    if (fromCache && wanted && !busy) {
      logger.info(`Update ${info.version} wird direkt beim Start eingespielt`)
      setStatus({
        state: 'installing',
        version: info.version,
        percent: 100,
        detail: tr(`Version ${info.version} wird installiert…`, `Installing version ${info.version}…`)
      })
      notify('info', tr(`Update auf ${info.version}`, `Update to ${info.version}`), tr('Launch Gabi startet gleich neu.', 'Launch Gabi restarts shortly.'))

      // Long enough for the renderer to paint the message, short enough that it
      // still feels like part of starting up.
      setTimeout(() => {
        // Re-checked at the moment it matters. `busy` was read 900 ms ago, and
        // that is easily enough time for someone to hit Play — quitting then
        // would kill the game they just started.
        if (runningCount() > 0 || startingCount() > 0 || tasksRunning()) {
          logger.info('Installation verschoben, es wurde inzwischen ein Spiel oder eine Aufgabe gestartet')
          setStatus({ state: 'ready', version: info.version, detail: tr('Update wartet auf Neustart.', 'Update is waiting for a restart.') })
          return
        }

        try {
          // Silent, emphatically. The NSIS installer is configured with
          // `oneClick: false` and `allowToChangeInstallationDirectory`, so a
          // non-silent run shows the entire first-time setup wizard — target
          // folder and all — on every single update. Users read that as having
          // to reinstall the launcher from scratch.
          autoUpdater.quitAndInstall(true, true)
        } catch (err) {
          logger.error('Automatische Installation fehlgeschlagen:', err)
          setStatus({ state: 'ready', version: info.version, detail: tr('Update wartet auf Neustart.', 'Update is waiting for a restart.') })
        }
      }, 900)
      return
    }

    setStatus({
      state: 'ready',
      version: info.version,
      percent: 100,
      detail: tr(`Version ${info.version} ist bereit.`, `Version ${info.version} is ready.`)
    })
    notify(
      'success',
      tr(`Update auf ${info.version} bereit`, `Update to ${info.version} ready`),
      // It asked "Jetzt neu starten?" with no button to answer; clicking leads
      // to the update settings, where the restart is.
      getSettings().autoInstallUpdates !== false
        ? tr('Die neue Version wird beim nächsten Start installiert. Klicke hier, um sofort neu zu starten.', 'The new version is installed on the next start. Click here to restart right away.')
        : tr('Klicke hier und starte neu, um die neue Version zu installieren.', 'Click here and restart to install the new version.'),
      // No timeout. This announced itself once, faded after a few seconds, and
      // never came back: the periodic check skips itself while an update is
      // already waiting, so someone who was not looking at that moment only
      // found out by opening the settings of their own accord.
      { route: '/settings?section=updates', timeout: 0 }
    )
  })

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    // A failed update check must never look like a broken launcher.
    logger.warn('Update-Prüfung fehlgeschlagen:', message)
    setStatus({ state: 'error', error: message, detail: tr('Update-Prüfung fehlgeschlagen.', 'Update check failed.') })
  })

  // The check itself is one small request and runs off the main path, so it
  // never delays the window. A pending update from last session resolves inside
  // it almost immediately, which is what makes the start-up install quick.
  const wanted = (): boolean => {
    const current = getSettings()
    return current.autoUpdate !== false || current.autoInstallUpdates !== false
  }
  if (wanted()) void checkForUpdates(false)
  // Always running, and asking the settings on every tick: switching
  // automatic updates on during a session used to do nothing until the
  // next start, because the timer was only ever created at boot.
  timer = setInterval(() => {
    if (wanted()) void checkForUpdates(false)
  }, CHECK_INTERVAL_MS)
  // Nothing should keep the process alive just to poll for updates.
  timer.unref?.()
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
    const detail = tr('Updates gibt es nur in der installierten Version.', 'Updates are only available in the installed version.')
    setStatus({ state: 'disabled', detail })
    if (manual) notify('info', tr('Kein Update möglich', 'No update possible'), detail)
    return status
  }

  // Overlapping checks confuse the state machine and the progress bar.
  if (checking) return status

  // No check, automatic or manual, may walk over an update that is already
  // downloaded and waiting, or one still downloading: it would flip the
  // state back to "checking" and take the "restart to install" prompt off
  // the screen. This used to only guard the background poll, keyed on
  // `!manual`; the "Jetzt suchen" button had no such guard at all, so
  // pressing it while an update sat ready could make it, and the restart
  // button with it, disappear, even though the download itself never changed.
  // A download that stopped without an error kept the state at "downloading"
  // for good, and every later check returned right here until a restart.
  if (status.state === 'downloading' && Date.now() - lastDownloadSign > DOWNLOAD_STALL_MS) {
    logger.warn('Update-Download kommt seit Minuten nicht voran, Sperre wird gelöst')
    setStatus({ state: 'idle', percent: undefined })
  }
  if (status.state === 'ready' || status.state === 'downloading') {
    if (manual) {
      notify(
        'info',
        status.state === 'ready' ? tr('Update bereit', 'Update ready') : tr('Update wird heruntergeladen', 'Downloading update'),
        status.state === 'ready'
          ? tr('Ein Update ist bereits heruntergeladen und wartet auf den Neustart.', 'An update is already downloaded and waiting for a restart.')
          : tr('Ein Update wird gerade heruntergeladen.', 'An update is being downloaded right now.')
      )
    }
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
    await pointFeed()
    await autoUpdater.checkForUpdates()
    if (manual && status.state === 'up-to-date') {
      notify(
        'info',
        tr('Kein Update verfügbar', 'No update available'),
        tr(`Launch Gabi ${app.getVersion()} ist die neueste Version.`, `Launch Gabi ${app.getVersion()} is the newest version.`)
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus({ state: 'error', error: message, detail: tr('Update-Prüfung fehlgeschlagen.', 'Update check failed.') })
    if (manual) notify('error', tr('Update-Prüfung fehlgeschlagen', 'Update check failed'), message)
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
      error: tr('Zeitüberschreitung', 'Timed out'),
      detail: tr('Die Update-Prüfung hat nicht geantwortet.', 'The update check did not respond.')
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
      tr('Update später', 'Update later'),
      tr('Beende erst Minecraft, das Update wird sonst mitten in der Sitzung eingespielt.', 'Close Minecraft first, otherwise the update would be installed in the middle of your session.')
    )
    return
  }

  // Same reasoning as the automatic path: a start that is still downloading
  // would be thrown away by the restart.
  if (startingCount() > 0) {
    notify(
      'warning',
      tr('Update später', 'Update later'),
      tr('Ein Spielstart läuft gerade. Warte, bis Minecraft offen ist, dann geht es.', 'A game is starting right now. Wait until Minecraft is open, then it works.')
    )
    return
  }

  if (tasksRunning()) {
    notify(
      'warning',
      tr('Update später', 'Update later'),
      tr('Warte, bis alle Downloads und Aufgaben fertig sind, dann klappt das Update.', 'Wait until all downloads and tasks are finished, then the update works.')
    )
    return
  }

  logger.info('Installiere Update und starte neu')
  // Silent for the same reason as the start-up path above: this installer is
  // an assisted one, so showing its UI walks the user through the full setup
  // wizard again. `isForceRunAfter` brings the launcher back up afterwards.
  setImmediate(() => {
    // Re-checked here, same as the start-up auto-install path: the two checks
    // above ran before this callback was even queued, and a launch started in
    // that gap would otherwise be pulled out from under the player.
    if (runningCount() > 0) {
      notify(
        'warning',
        tr('Update später', 'Update later'),
        tr('Beende erst Minecraft, das Update wird sonst mitten in der Sitzung eingespielt.', 'Close Minecraft first, otherwise the update would be installed in the middle of your session.')
      )
      return
    }
    if (startingCount() > 0) {
      notify(
        'warning',
        tr('Update später', 'Update later'),
        tr('Ein Spielstart läuft gerade. Warte, bis Minecraft offen ist, dann geht es.', 'A game is starting right now. Wait until Minecraft is open, then it works.')
      )
      return
    }
    if (tasksRunning()) {
      notify(
        'warning',
        tr('Update später', 'Update later'),
        tr('Warte, bis alle Downloads und Aufgaben fertig sind, dann klappt das Update.', 'Wait until all downloads and tasks are finished, then the update works.')
      )
      return
    }
    autoUpdater.quitAndInstall(true, true)
  })
}

/** Whether a download, import, backup or similar task is still running. */
function tasksRunning(): boolean {
  return listTasks().some((task) => task.state === 'running')
}
