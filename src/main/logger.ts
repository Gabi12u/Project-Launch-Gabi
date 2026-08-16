import { app } from 'electron'
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let stream: WriteStream | null = null
let minLevel: Level = 'info'

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

/** Opens today's log file and prunes anything older than a week. */
export function initLogger(level: Level = 'info'): void {
  minLevel = level
  const dir = logDir()
  mkdirSync(dir, { recursive: true })

  const stamp = new Date().toISOString().slice(0, 10)
  stream = createWriteStream(join(dir, `launcher-${stamp}.log`), { flags: 'a' })
  // An unhandled 'error' on a stream is a hard throw in Node, so a full disk or
  // a revoked permission would take the whole launcher down over logging.
  stream.on('error', (err) => {
    const failed = stream
    stream = null
    console.error('Log-Datei konnte nicht geschrieben werden:', err)
    failed?.destroy()
  })

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  try {
    for (const file of readdirSync(dir)) {
      if (!file.startsWith('launcher-')) continue
      const full = join(dir, file)
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

  const line = `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] [${scope}] ${text}`

  if (!app.isPackaged) {
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    sink(line)
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
