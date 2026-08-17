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

export function getSettings(): LauncherSettings {
  if (!settings) {
    const raw = readJson<Partial<LauncherSettings>>(settingsFile(), {})
    // A file containing `null`, an array or a bare string parses fine but would
    // produce a settings object with no usable fields.
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    // Merging with the defaults keeps configs from older builds usable.
    settings = { ...DEFAULT_LAUNCHER_SETTINGS, ...stored }
    if (!settings.dataDirectory) {
      settings.dataDirectory = join(app.getPath('userData'), 'data')
    }
  }
  return settings
}

export function saveSettings(patch: Partial<LauncherSettings>): LauncherSettings {
  const current = getSettings()
  const next = { ...current, ...patch }

  // The empty-string fallback in `getSettings` only runs on first load, so a
  // cleared text field would otherwise persist `dataDirectory: ''` and every
  // `paths.*()` call would resolve against `process.cwd()` for the rest of the
  // session, scattering instances and backups outside the data directory.
  if (typeof next.dataDirectory !== 'string' || !next.dataDirectory.trim()) {
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
  return stored.filter((account): account is StoredAccount => Boolean(account) && typeof account === 'object')
}

export function writeAccounts(accounts: StoredAccount[]): void {
  writeJsonAtomic(accountsFile(), accounts)
}
