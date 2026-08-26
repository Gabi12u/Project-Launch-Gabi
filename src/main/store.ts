import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LAUNCHER_SETTINGS } from '@shared/defaults'
import type { Account, LauncherSettings } from '@shared/types'
import { log } from './logger'

const logger = log('store')

/** Writes through a temp file so a crash mid-write cannot corrupt the config. */
export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true })
  // Unique per call: a shared `<file>.tmp` means two concurrent writers
  // interleave into one temp file and the loser's rename destroys the winner's
  // data — or fails outright on Windows.
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // a leftover temp file is harmless
    }
    throw err
  }
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (err) {
    logger.warn(`Konnte ${file} nicht lesen:`, err)
    return fallback
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
  next.microsoftClientId = textOr(next.microsoftClientId, fallback.microsoftClientId)
  // Not merely cosmetic: registering the hotkey calls `.trim()` on this, so a
  // number in the file threw before a game could ever start.
  next.recordingHotkey = textOr(next.recordingHotkey, fallback.recordingHotkey).trim() || fallback.recordingHotkey
  if (!['low', 'medium', 'high'].includes(next.recordingQuality)) {
    next.recordingQuality = fallback.recordingQuality
  }
  next.lastRunVersion = textOr(next.lastRunVersion, fallback.lastRunVersion)
  next.lastSeenVersion = textOr(next.lastSeenVersion, fallback.lastSeenVersion)

  if (typeof next.dataDirectory !== 'string' || !next.dataDirectory.trim()) {
    next.dataDirectory = join(app.getPath('userData'), 'data')
  }
  return next
}

export function getSettings(): LauncherSettings {
  if (!settings) {
    const raw = readJson<Partial<LauncherSettings>>(settingsFile(), {})
    // A file containing `null`, an array or a bare string parses fine but would
    // produce a settings object with no usable fields.
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    // Merging with the defaults keeps configs from older builds usable.
    settings = sanitize({ ...DEFAULT_LAUNCHER_SETTINGS, ...stored })
  }
  return settings
}

export function saveSettings(patch: Partial<LauncherSettings>): LauncherSettings {
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
  }

  settings = next
  writeJsonAtomic(settingsFile(), next)
  return next
}

export function resetSettings(): LauncherSettings {
  const dataDirectory = getSettings().dataDirectory
  settings = { ...DEFAULT_LAUNCHER_SETTINGS, dataDirectory }
  writeJsonAtomic(settingsFile(), settings)
  return settings
}

/* ------------------------------------------------------------------ *
 * Accounts
 *
 * Refresh tokens live next to the account records. They are stored with
 * Electron's safeStorage when the OS provides encryption.
 * ------------------------------------------------------------------ */

export interface StoredAccount extends Account {
  /** Encrypted (base64) or plain refresh token, see `secure`. */
  refreshToken?: string
  accessToken?: string
  secure?: boolean
}

function accountsFile(): string {
  return join(app.getPath('userData'), 'accounts.json')
}

export function readAccounts(): StoredAccount[] {
  const stored = readJson<StoredAccount[]>(accountsFile(), [])
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
      account.uuid.length > 0
    )
  })
  if (usable.length !== stored.length) {
    logger.warn(`accounts.json: ${stored.length - usable.length} unvollständige Konten übersprungen`)
  }
  return usable
}

export function writeAccounts(accounts: StoredAccount[]): void {
  writeJsonAtomic(accountsFile(), accounts)
}
