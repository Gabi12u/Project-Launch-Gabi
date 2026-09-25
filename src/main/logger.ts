import { app } from 'electron'
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let stream: WriteStream | null = null
let minLevel: Level = 'info'
let currentDir = ''
let currentStamp = ''
let currentPart = 0
let lastReopenAttempt = 0

/** A single very chatty session had nothing stopping today's file from growing without bound. */
const MAX_FILE_BYTES = 20 * 1024 * 1024

/** After a failed open (full disk, revoked permission), how long to wait before trying again. */
const REOPEN_RETRY_MS = 5000

// Crash reports scrub names and paths before they ever leave the machine
// (see reports.ts). The plain log file never leaves it on its own, but it is
// the one thing a user is likely to open and paste into a support message,
// and on Windows the ordinary paths this logger writes (Java installs, game
// launches, shortcuts) all sit under the home directory and carry the
// Windows username with them. A single fixed replacement of that one known
// prefix is cheap enough for every log line and closes the common case,
// without running the heavier, pattern-based scrub() built for reports.
const HOME = homedir()

function redactHome(text: string): string {
  return HOME ? text.split(HOME).join('~') : text
}

// A minimal, self-contained mirror of the token/email rules in
// core/reports.ts scrub(). Duplicated rather than imported: reports.ts
// itself imports `log` from this very module, so importing back from there
// would be a circular import. Only the cheap, unambiguous patterns run here,
// on every single line; the fuller pass (usernames, UUIDs, XUIDs, IPs) stays
// in scrub(), which only ever runs on the text of an actual error report.
// None of these match an instance-id UUID or a plain version string.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const JWT_RE = /\b(ey[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){0,2})/g
const MS_REFRESH_RE = /\b[M0]\.(?=[A-Za-z0-9._!*-]*[A-Z])[A-Za-z0-9._!*-]{24,}/g
const TOKEN_FIELD_RE = /("?(?:access_?|refresh_?|id_?)token"?\s*[:=]\s*"?)[^"'\s,}]+/gi
const TOKEN_QUERY_RE = /([?&](?:code|access_token|refresh_token|id_token)=)[^&\s"']+/gi
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi

// Exported so the pattern list can be checked directly, the same reasoning
// as `explainInvalidGrant` in auth/microsoft.ts: without this, testing it
// means replaying a real login just to get a line through the logger.
export function redactSecrets(text: string): string {
  return text
    .replace(EMAIL_RE, '<E-Mail>')
    .replace(JWT_RE, '<Token>')
    .replace(MS_REFRESH_RE, '<Token>')
    .replace(TOKEN_FIELD_RE, '$1<Token>')
    .replace(TOKEN_QUERY_RE, '$1<Token>')
    .replace(BEARER_RE, '$1<Token>')
}

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

/** File name for the current day and part, `launcher-2026-09-08.log`, `-part2.log`, ... */
function currentFileName(): string {
  return currentPart === 0 ? `launcher-${currentStamp}.log` : `launcher-${currentStamp}-part${currentPart}.log`
}

function openStream(): void {
  // Log lines can include a raw error body from Microsoft or a file path
  // under the user's own account name, so the file gets the same owner-only
  // permission as the settings and account files.
  const opened = createWriteStream(join(currentDir, currentFileName()), { flags: 'a', mode: 0o600 })
  stream = opened
  // An unhandled 'error' on a stream is a hard throw in Node, so a full disk or
  // a revoked permission would take the whole launcher down over logging.
  // Only this stream is dropped: a late error from yesterday's, already
  // rotated file must not discard the healthy one that replaced it.
  opened.on('error', (err) => {
    if (stream === opened) stream = null
    console.error('Log-Datei konnte nicht geschrieben werden:', err)
    opened.destroy()
  })
}

/** Opens today's log file and prunes anything older than a week. */
export function initLogger(level: Level = 'info'): void {
  minLevel = level
  currentDir = logDir()
  mkdirSync(currentDir, { recursive: true })
  currentStamp = new Date().toISOString().slice(0, 10)
  currentPart = 0
  openStream()

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  try {
    for (const file of readdirSync(currentDir)) {
      if (!file.startsWith('launcher-')) continue
      const full = join(currentDir, file)
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
    }
  } catch {
    // pruning is best effort
  }
}

function write(level: Level, scope: string, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return

  const text = args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')

  const line = `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] [${scope}] ${redactSecrets(redactHome(text))}`

  if (!app.isPackaged) {
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    sink(line)
  }

  if (currentDir) {
    // currentStamp used to be set once in initLogger and never rechecked, so
    // a session still running past midnight kept appending to yesterday's file.
    const today = new Date().toISOString().slice(0, 10)
    if (today !== currentStamp) {
      stream?.end()
      currentStamp = today
      currentPart = 0
      openStream()
    }

    // A stream that failed once (full disk, revoked permission) used to stay
    // null forever. Retried on the next write instead, but throttled so a
    // permanent failure does not reopen (and fail again) on every line.
    if (!stream && Date.now() - lastReopenAttempt >= REOPEN_RETRY_MS) {
      lastReopenAttempt = Date.now()
      openStream()
    }

    // A session left running for a long time, or one chatty enough to matter,
    // used to have nothing capping today's file. Rolling to a new part is
    // cheap and keeps a single file from growing without bound; the part
    // files sit right next to each other and prune on the same weekly sweep.
    if (stream && stream.bytesWritten > MAX_FILE_BYTES) {
      stream.end()
      currentPart += 1
      openStream()
    }
  }

  stream?.write(line + '\n')
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** Returns a logger tagged with the given scope, e.g. `log('launch')`. */
export function log(scope: string): Logger {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a)
  }
}

export function getLogDirectory(): string {
  return logDir()
}
