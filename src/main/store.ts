import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { DEFAULT_LAUNCHER_SETTINGS, LEGACY_MICROSOFT_CLIENT_ID } from '@shared/defaults'
import type { Account, LauncherSettings, LaunchBehaviour } from '@shared/types'
import { log } from './logger'
import { notify } from './events'
import { tr } from '@shared/i18n'

const logger = log('store')

/** Writes through a temp file so a crash mid-write cannot corrupt the config. */
export function writeJsonAtomic(
  file: string,
  data: unknown,
  /** Keeps the version being replaced, see `readPreviousJson`. */
  options: { keepPrevious?: boolean } = {}
): void {
  mkdirSync(join(file, '..'), { recursive: true })
  // Unique per call: a shared `<file>.tmp` means two concurrent writers
  // interleave into one temp file and the loser's rename destroys the winner's
  // data — or fails outright on Windows.
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    // Every file this writes lives in the launcher's own data directory and
    // is meaningful only to this one user, accounts and settings included.
    // Without an explicit mode it took whatever the OS default happened to
    // be, which on a shared Linux or macOS machine can leave it readable by
    // every other account on that machine. Windows has no equivalent
    // permission bit, so this is a no-op there, not a regression.
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8')
      // Flushed before the rename. Without it a power cut right after the
      // rename could leave the real name on a file whose content never
      // reached the disk, an empty or garbled one, and that is how an
      // instance came back as a blank vanilla instance.
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (options.keepPrevious) keepPreviousVersion(file)
    renameWithRetry(tmp, file)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // a leftover temp file is harmless
    }
    throw err
  }
}

/**
 * Replaces `file` with `tmp`, waiting out a short lock.
 *
 * On Windows a virus scanner or a sync client like OneDrive opens a freshly
 * written file for a moment, and a rename onto it fails with EPERM, EBUSY or
 * EACCES until it lets go. Giving up on the first try aborted saving an
 * instance or the settings with that raw error. Four tries over about a third
 * of a second cover the usual hold; this runs on the main thread, so it must
 * not wait long, and a lock that lasts longer is reported as one.
 */
function renameWithRetry(tmp: string, file: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      const locked = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!locked) throw err
      if (attempt >= 3) {
        throw new Error(
          tr(
            `${basename(file)} konnte nicht gespeichert werden, weil ein anderes Programm die Datei festhält (zum Beispiel ein Virenscanner oder OneDrive). Versuche es gleich noch einmal.`,
            `${basename(file)} could not be saved because another program is holding the file (a virus scanner or OneDrive, for example). Try again in a moment.`
          )
        )
      }
      sleepSync(50 * 2 ** attempt)
    }
  }
}

/** Blocks the main thread briefly; only used between a few read and rename retries. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export type JsonReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'missing' | 'corrupt' | 'unreadable' }

/**
 * Reads a JSON file and says why when it could not.
 *
 * "unreadable" means the read itself failed (EBUSY, EPERM, EACCES): a virus
 * scanner or a sync client holding the file for a moment. That says nothing
 * about the content, so it is retried a few times and never quarantined.
 * Only "corrupt", a file that was read but does not parse, is set aside.
 * Quarantining the locked case turned a perfectly good instance into an
 * empty one and made the next save overwrite the real file.
 */
export function readJsonResult<T>(file: string, quarantine = false): JsonReadResult<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      if (!existsSync(file)) return { ok: false, reason: 'missing' }
      return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) as T }
    } catch (err) {
      // A file that simply is not there yet (or vanished between the check
      // above and the read, a narrow race) is not corruption, just nothing to read.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { ok: false, reason: 'missing' }
      if (!(err instanceof SyntaxError)) {
        if (attempt < 3) {
          sleepSync(150)
          continue
        }
        logger.warn(`Konnte ${file} nicht lesen, die Datei bleibt unangetastet:`, err)
        return { ok: false, reason: 'unreadable' }
      }
      logger.warn(`Konnte ${file} nicht lesen:`, err)
      if (quarantine) quarantineFile(file)
      return { ok: false, reason: 'corrupt' }
    }
  }
}

/** Where `keepPrevious` puts the last good version of a file. */
function previousFile(file: string): string {
  return `${file}.previous`
}

/**
 * Copies the current version aside before it is replaced, but only while it
 * still reads: a damaged file must never push out the last good copy.
 */
function keepPreviousVersion(file: string): void {
  try {
    if (!existsSync(file)) return
    const text = readFileSync(file, 'utf8')
    JSON.parse(text)
    writeFileSync(previousFile(file), text, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Only a safety net; the write itself goes ahead.
  }
}

/**
 * The last good version of a file written with `keepPrevious`, for when the
 * file itself turned out damaged. Null when there is none that reads.
 */
export function readPreviousJson<T>(file: string): T | null {
  const result = readJsonResult<T>(previousFile(file), false)
  if (!result.ok) return null
  logger.warn(`${basename(file)} war beschädigt, der vorherige Stand wird verwendet`)
  return result.value
}

export function readJson<T>(file: string, fallback: T, quarantine = false): T {
  const result = readJsonResult<T>(file, quarantine)
  return result.ok ? result.value : fallback
}

function quarantineFile(file: string): void {
  // Left in place, a file that fails to parse (bad JSON, a truncated write
  // that escaped writeJsonAtomic, hand editing) fails the exact same way on
  // every future read, forever. Moved aside once instead, best effort, so
  // the fallback takes over cleanly and the next write starts a fresh file
  // rather than tripping over the broken one again and again.
  try {
    const corrupted = `${file}.corrupt-${Date.now()}`
    renameSync(file, corrupted)
    notify(
      'warning',
      tr('Datei beschädigt', 'File damaged'),
      tr(
        `Die Datei ${basename(file)} war beschädigt und wurde als ${basename(corrupted)} beiseitegelegt.`,
        `The file ${basename(file)} was damaged and was set aside as ${basename(corrupted)}.`
      )
    )
  } catch (renameErr) {
    logger.warn(`Konnte ${file} nicht beiseitelegen:`, renameErr)
  }
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function settingsFile(): string {
  return join(app.getPath('userData'), 'launcher.json')
}

let settings: LauncherSettings | null = null

/** Turns anything into a usable number, or falls back if it cannot. */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  // `Number(null)`, `Number('')` and `Number(false)` are all 0, which would
  // pass the finite check and then clamp to the minimum. A missing value is
  // not a request for the smallest one, so these go to the default instead.
  if (value === null || value === undefined || typeof value === 'boolean') return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback

  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** Every value `ThemeId` allows, kept here since it is a type and not a runtime list. */
const THEME_IDS = [
  'midnight', 'nebula', 'abyss', 'aurora', 'cobalt', 'indigo', 'violet', 'prism',
  'orchid', 'dusk', 'sunset', 'ember', 'rust', 'moss', 'fern', 'pine', 'lagoon', 'slate'
]

/**
 * Brings a stored settings file back into the shape the rest of the launcher
 * takes for granted.
 *
 * `launcher.json` is a plain file that can be hand-edited, restored from a
 * backup or synced between machines, so a string can end up where a number
 * belongs. Every field below is used further on without another check, and the
 * damage was quiet rather than loud: a non-numeric backup count compared false
 * against every limit and deleted all automatic backups at once, a non-numeric
 * download count produced an empty worker pool that reported success without
 * transferring anything, and a non-string data directory threw inside `join()`
 * before the window ever appeared.
 */
function sanitize(input: LauncherSettings): LauncherSettings {
  const next: LauncherSettings = { ...input }
  const fallback = DEFAULT_LAUNCHER_SETTINGS

  next.defaultMemoryMb = clampNumber(next.defaultMemoryMb, fallback.defaultMemoryMb, 512, 65536)
  next.concurrentDownloads = clampNumber(next.concurrentDownloads, fallback.concurrentDownloads, 1, 32)
  next.downloadThrottleKbps = clampNumber(next.downloadThrottleKbps, fallback.downloadThrottleKbps, 0, 1_000_000)
  next.automaticBackupKeep = clampNumber(next.automaticBackupKeep, fallback.automaticBackupKeep, 1, 200)
  // A non-numeric value here reached `setTimeout` as NaN, which Chromium reads
  // as zero: the recording would have ended the instant it began.
  next.recordingMaxMinutes = clampNumber(next.recordingMaxMinutes, fallback.recordingMaxMinutes, 1, 240)

  next.defaultJvmArgs = textOr(next.defaultJvmArgs, fallback.defaultJvmArgs)
  next.accentColor = textOr(next.accentColor, fallback.accentColor)
  next.curseForgeApiKey = textOr(next.curseForgeApiKey, fallback.curseForgeApiKey)
  // The move off the old official client id happens in getSettings.
  // Trimmed, and an empty field means the default. A trailing space from
  // pasting picked the wrong sign-in system, and an empty value left no way
  // to sign in at all, although a hint told users to clear the field.
  next.microsoftClientId = textOr(next.microsoftClientId, fallback.microsoftClientId).trim() || fallback.microsoftClientId
  // Not merely cosmetic: registering the hotkey calls `.trim()` on this, so a
  // number in the file threw before a game could ever start.
  next.recordingHotkey = textOr(next.recordingHotkey, fallback.recordingHotkey).trim() || fallback.recordingHotkey
  if (!['low', 'medium', 'high'].includes(next.recordingQuality)) {
    next.recordingQuality = fallback.recordingQuality
  }
  if (!['unset', 'on', 'off'].includes(next.crashReports)) {
    // Falls back to "not asked" rather than to "yes": a file we cannot read
    // must never be taken as consent.
    next.crashReports = fallback.crashReports
  }
  // Same reasoning as crashReports: "not asked" is not "yes".
  if (!['unset', 'on', 'off'].includes(next.customStartScreen)) {
    next.customStartScreen = fallback.customStartScreen
  }
  if (!['keep', 'hide', 'close'].includes(next.launchBehaviour)) {
    next.launchBehaviour = fallback.launchBehaviour
  }
  if (!['de', 'en'].includes(next.language)) {
    next.language = fallback.language
  }
  if (!THEME_IDS.includes(next.theme)) {
    next.theme = fallback.theme
  }
  if (!['top', 'side'].includes(next.navPosition)) {
    next.navPosition = fallback.navPosition
  }
  next.reduceMotion = typeof next.reduceMotion === 'boolean' ? next.reduceMotion : fallback.reduceMotion
  next.bootIntro = typeof next.bootIntro === 'boolean' ? next.bootIntro : fallback.bootIntro
  next.javaAutoManage = typeof next.javaAutoManage === 'boolean' ? next.javaAutoManage : fallback.javaAutoManage
  next.launchBehaviourDefaultApplied =
    typeof next.launchBehaviourDefaultApplied === 'boolean'
      ? next.launchBehaviourDefaultApplied
      : fallback.launchBehaviourDefaultApplied
  next.lastRunVersion = textOr(next.lastRunVersion, fallback.lastRunVersion)
  next.lastSeenVersion = textOr(next.lastSeenVersion, fallback.lastSeenVersion)

  if (typeof next.dataDirectory !== 'string' || !next.dataDirectory.trim()) {
    next.dataDirectory = join(app.getPath('userData'), 'data')
  }
  return next
}

let instanceBehaviourMigrationFrom: LaunchBehaviour | null = null

/**
 * The global launch behaviour as it was before `getSettings` moved an
 * existing install onto the new default, handed out exactly once so the
 * caller can move the instances along too. Null when nothing is pending.
 */
export function takeInstanceBehaviourMigration(): LaunchBehaviour | null {
  const from = instanceBehaviourMigrationFrom
  instanceBehaviourMigrationFrom = null
  return from
}

/**
 * Set when the settings file was locked at startup. The launcher then runs
 * on the defaults for now, and nothing may write them back over the real
 * file: that wiped a custom data folder, keys and every other choice the
 * moment the first ordinary save came along, a few seconds after start.
 */
let settingsUnreadable = false

/** Reads the settings file, waiting a little longer for a lock than other reads do. */
function readSettingsFile(): JsonReadResult<Partial<LauncherSettings>> {
  let result = readJsonResult<Partial<LauncherSettings>>(settingsFile(), true)
  // Startup is the one place a short wait costs nothing visible, and this
  // file decides where every instance lives.
  for (let attempt = 0; attempt < 6 && !result.ok && result.reason === 'unreadable'; attempt++) {
    sleepSync(250)
    result = readJsonResult<Partial<LauncherSettings>>(settingsFile(), true)
  }
  // Damaged rather than missing: the last good version still knows the data
  // folder and everything else. Starting from scratch instead ran the first
  // setup again and pointed the launcher at the default data folder, where
  // the user's instances were not.
  if (!result.ok && result.reason === 'corrupt') {
    const previous = readPreviousJson<Partial<LauncherSettings>>(settingsFile())
    if (previous) return { ok: true, value: previous }
  }
  return result
}

/** Whether the settings file was locked at startup and is not written to yet. */
export function isSettingsUnreadable(): boolean {
  return settingsUnreadable
}

export function getSettings(): LauncherSettings {
  if (!settings) {
    const result = readSettingsFile()
    settingsUnreadable = !result.ok && result.reason === 'unreadable'
    if (settingsUnreadable) {
      logger.error('launcher.json ist gesperrt, der Launcher läuft vorerst mit den Voreinstellungen')
    }
    // Locked rather than new: whoever has a settings file has been through
    // the first-run setup, which would otherwise start over and then fail to
    // save. The notice itself comes from index.ts, once the language is set.
    const raw = result.ok ? result.value : settingsUnreadable ? { onboarded: true } : {}
    // A file containing `null`, an array or a bare string parses fine but would
    // produce a settings object with no usable fields.
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    // Merging with the defaults keeps configs from older builds usable.
    // A brand-new install follows the system language; anyone who already has
    // settings keeps German unless they chose otherwise.
    const firstRun = Object.keys(stored).length === 0
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale
    const language = firstRun && !/^de\b/i.test(systemLocale) ? 'en' : DEFAULT_LAUNCHER_SETTINGS.language
    // A plain default merge never overwrites a value already on disk, and
    // every settings file ever written carried the old official client id
    // explicitly, not as a gap the defaults could fill. Anyone who still has
    // exactly that value, meaning they never chose one of their own, is moved
    // onto our own registration here. Already signed in accounts keep
    // refreshing under the client id they logged in with (`microsoft.ts`,
    // `issuerClientId`). Only when reading from disk, not on every save:
    // someone typing the old id into the field on purpose keeps it.
    const migrated =
      stored.microsoftClientId === LEGACY_MICROSOFT_CLIENT_ID
        ? { ...stored, microsoftClientId: DEFAULT_LAUNCHER_SETTINGS.microsoftClientId }
        : stored
    settings = sanitize({ ...DEFAULT_LAUNCHER_SETTINGS, language, ...migrated })
    // The launch behaviour default moved from "keep" to "hide" (the main
    // window steps aside for the game and its live-log window). "keep" was
    // the old default nearly everyone still has without ever choosing it, so
    // it moves along once. Anything picked afterwards is left alone. Only
    // held in memory here: index.ts writes it together with the marker once
    // the instances were moved along as well, so a start that fails halfway
    // tries again with the original value still on disk.
    if (!firstRun && stored.launchBehaviourDefaultApplied !== true) {
      instanceBehaviourMigrationFrom = settings.launchBehaviour
      if (settings.launchBehaviour === 'keep') settings.launchBehaviour = 'hide'
      settings.launchBehaviourDefaultApplied = false
    }
  }
  return settings
}

/**
 * Makes sure a chosen data directory can actually be used before anything
 * commits to it.
 *
 * `existsSync` says nothing about whether it can be written to (a read-only
 * network share, a path inside a folder Windows itself protects), and finding
 * that out only after the directory was already saved and `ensureRootLayout`
 * had run against it left the launcher pointed at a folder it could not use,
 * with every instance looking as if it had vanished.
 */
function assertDirectoryUsable(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.launchgabi-write-test-${process.pid}-${randomUUID().slice(0, 8)}`)
    writeFileSync(probe, 'ok', 'utf8')
    unlinkSync(probe)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(tr(`Der gewählte Ordner kann nicht verwendet werden: ${reason}`, `The chosen folder cannot be used: ${reason}`))
  }
}

export function saveSettings(patch: Partial<LauncherSettings>): LauncherSettings {
  if (settingsUnreadable) {
    // Read again: only once the real file is back may anything be written.
    const again = readJsonResult<Partial<LauncherSettings>>(settingsFile(), true)
    if (!again.ok && again.reason === 'unreadable') {
      throw new Error(
        tr(
          'Die Einstellungsdatei ist gerade gesperrt. Starte den Launcher neu und versuche es dann noch einmal.',
          'The settings file is locked right now. Restart the launcher and then try again.'
        )
      )
    }
    settingsUnreadable = false
    settings = null
  }
  const current = getSettings()
  const next = sanitize({ ...current, ...patch })

  // Sanitising would put the default path back, which is not what a cleared
  // text field should mean: every `paths.*()` call would resolve somewhere
  // else for the rest of the session, scattering instances and backups.
  // Keeping the previous path is the answer that loses nothing.
  const wanted = { ...current, ...patch }.dataDirectory
  if (typeof wanted !== 'string' || !wanted.trim()) {
    logger.warn('Leeres Datenverzeichnis abgelehnt, bisheriger Pfad bleibt bestehen')
    next.dataDirectory = current.dataDirectory
  } else if (next.dataDirectory !== current.dataDirectory) {
    // Throws before anything below runs, so a folder that cannot be used
    // never reaches disk or the in-memory settings, and the caller (the
    // `settingsSet` IPC handler) never reaches `ensureRootLayout()` for it.
    assertDirectoryUsable(next.dataDirectory)
  }

  // Written before the module variable is updated: writeJsonAtomic is
  // synchronous and can throw (a locked or read-only settings file), and a
  // caller that catches that error expects the running settings to be
  // whatever they were before this call. Assigning first would have shown
  // the new values everywhere in the app while the file on disk still held
  // the old ones.
  writeJsonAtomic(settingsFile(), next, { keepPrevious: true })
  settings = next
  return next
}

export function resetSettings(): LauncherSettings {
  if (settingsUnreadable) saveSettings({})
  const { dataDirectory, language, onboarded, crashReports, customStartScreen, curseForgeApiKey } = getSettings()
  // The language is kept like the data folder: switching it needs a restart,
  // and a reset offers none, so it would silently flip on the next start.
  // The first-run setup, the answers to its consent questions and the
  // CurseForge key are not preferences: resetting them sent the user
  // through the whole setup again and deleted a key they had to look up.
  const next = {
    ...DEFAULT_LAUNCHER_SETTINGS,
    dataDirectory,
    language,
    onboarded,
    crashReports,
    customStartScreen,
    curseForgeApiKey
  }
  // Same ordering as saveSettings, and for the same reason.
  writeJsonAtomic(settingsFile(), next, { keepPrevious: true })
  settings = next
  return next
}

/* ------------------------------------------------------------------ *
 * Accounts
 *
 * Refresh tokens live next to the account records. They are stored with
 * Electron's safeStorage when the OS provides encryption.
 * ------------------------------------------------------------------ */

export interface StoredAccount extends Account {
  /** Encrypted (base64) or plain refresh token, see `refreshSecure`/`secure`. */
  refreshToken?: string
  accessToken?: string
  /**
   * Legacy single flag from before `accessToken` and `refreshToken` tracked
   * their own encryption state separately. Still written (mirroring
   * `accessSecure`) so older code reading only this field keeps working, and
   * still read as the fallback for either token on an account saved before
   * this field existed.
   */
  secure?: boolean
  /** Whether `accessToken` is encrypted. Falls back to `secure` when absent. */
  accessSecure?: boolean
  /**
   * Whether `refreshToken` is encrypted.
   *
   * A device-code grant does not always return a fresh refresh token, so a
   * kept-over one can be older than the access token saved next to it in the
   * same write; this is what lets it keep its own, possibly different, flag
   * instead of inheriting the access token's. Falls back to `secure` when
   * absent.
   */
  refreshSecure?: boolean
  /**
   * The Microsoft application id that issued `refreshToken`.
   *
   * Missing on an account stored before this field existed, in which case a
   * refresh falls back to whatever is currently configured — exactly the
   * old behaviour, and correct for the common case where nobody ever
   * touches that setting. Once present, a refresh keeps using this value
   * instead of the live setting, because the two describe different Microsoft
   * systems (login.live.com vs. Azure AD) and a refresh token from one is
   * rejected outright by the other. Changing the setting, or resetting it,
   * used to send every later refresh to the wrong one and fail forever with
   * an unexplained HTTP 400, for this account only.
   */
  issuerClientId?: string
}

function accountsFile(): string {
  return join(app.getPath('userData'), 'accounts.json')
}

/**
 * Set once a dropped-account notification has been shown.
 *
 * `readAccounts` runs on nearly every auth call (see `auth/microsoft.ts`),
 * and the file on disk still holds the same damaged entries on every one of
 * those calls until something else rewrites it. Without this, a single
 * corrupted account produced the same toast over and over for the rest of
 * the session instead of once.
 */
let accountDropNotified = false

/** The accounts as last read or written, for callers that must not fail. */
let lastAccounts: StoredAccount[] = []

export function readAccounts(): StoredAccount[] {
  const result = readJsonResult<StoredAccount[]>(accountsFile(), true)
  // Never "no accounts" for a file that is merely locked. Every caller writes
  // its result back over the whole file, so an empty list here deleted every
  // account the moment a virus scanner or OneDrive held the file during a
  // save. Throwing stops that write; a missing or corrupt file still reads
  // as empty, the corrupt one having been set aside first.
  if (!result.ok && result.reason === 'unreadable') {
    throw new Error(
      tr(
        'Die Datei mit den Accounts ist gerade von einem anderen Programm gesperrt, zum Beispiel einem Virenscanner oder OneDrive. Versuche es gleich noch einmal.',
        'The file with the accounts is locked by another program right now, such as a virus scanner or OneDrive. Try again in a moment.'
      )
    )
  }
  const stored = result.ok ? result.value : []
  // A hand-edited or truncated file can parse as valid JSON of the wrong shape;
  // every caller iterates the result, so anything but an array must not escape.
  if (!Array.isArray(stored)) {
    logger.warn('accounts.json enthält kein Array, wird ignoriert')
    return []
  }
  const usable = stored.filter((account): account is StoredAccount => {
    if (!account || typeof account !== 'object') return false
    // An entry without these is not merely incomplete, it breaks the launch
    // arguments: the UUID and name go straight into Minecraft's command line,
    // and the id is how every other part of the launcher addresses the account.
    return (
      typeof account.id === 'string' &&
      account.id.length > 0 &&
      typeof account.username === 'string' &&
      account.username.length > 0 &&
      typeof account.uuid === 'string' &&
      account.uuid.length > 0 &&
      // Anything else is a value no part of the launcher knows how to launch
      // with; the type decides between two entirely different login flows.
      (account.type === 'microsoft' || account.type === 'offline')
    )
  })
  if (usable.length !== stored.length) {
    const dropped = stored.length - usable.length
    logger.warn(`accounts.json: ${dropped} unvollständige Konten übersprungen`)
    if (!accountDropNotified) {
      accountDropNotified = true
      // The next save writes only the usable entries, so the dropped ones
      // would be gone for good. Copied aside once first, best effort.
      try {
        copyFileSync(accountsFile(), `${accountsFile()}.damaged-${Date.now()}`)
      } catch (err) {
        logger.warn('Kopie der beschädigten accounts.json nicht angelegt:', err)
      }
      notify(
        'warning',
        tr('Account beschädigt', 'Account damaged'),
        dropped === 1
          ? tr('Ein gespeicherter Account war beschädigt und wurde entfernt. Eine Kopie der alten Datei liegt im Launcher-Ordner.', 'A saved account was damaged and has been removed. A copy of the old file is in the launcher folder.')
          : tr(`${dropped} gespeicherte Accounts waren beschädigt und wurden entfernt. Eine Kopie der alten Datei liegt im Launcher-Ordner.`, `${dropped} saved accounts were damaged and have been removed. A copy of the old file is in the launcher folder.`)
      )
    }
  }
  lastAccounts = usable
  return usable
}

export function writeAccounts(accounts: StoredAccount[]): void {
  writeJsonAtomic(accountsFile(), accounts)
  lastAccounts = accounts
}

/**
 * The accounts, or the last known ones while the file is locked.
 *
 * For callers that only look, never write, and must not fail on a lock:
 * the report scrubber still has to know the player names to hide them.
 */
export function accountsSnapshot(): StoredAccount[] {
  try {
    return readAccounts()
  } catch {
    return lastAccounts
  }
}
