import { EVENTS } from '@shared/ipc'
import type { LogLine } from '@shared/types'
import { emit } from '../events'

/**
 * The per-instance live log buffer and its IPC push, pulled out of
 * `launch.ts` into its own module.
 *
 * `repair.ts` needs to append to the same stream a running game writes to, so
 * a repair shows up as live lines in the exact viewer the "Logs" tab already
 * has, instead of a separate one. `repair.ts` importing this straight from
 * `launch.ts` would have created a cycle between the two, which already share
 * several other markers this way (see `repairLock.ts`); this module has no
 * import from either, so both can depend on it without one.
 */

/** Ring buffer of recent output per instance so the UI can show a log tab. */
const logBuffers = new Map<string, LogLine[]>()
const LOG_BUFFER_SIZE = 800

/**
 * Lines waiting for the next batch. A heavily modded game can print thousands
 * of lines a second while loading textures; sending each one on its own made
 * both windows redraw their whole log for every line, until they stopped
 * responding and the main window was reloaded as if it had crashed.
 */
let pending: LogLine[] = []
let flushTimer: NodeJS.Timeout | null = null
const FLUSH_MS = 100
/** More than a view keeps anyway (1200 lines); older ones in a burst are only in the buffer. */
const MAX_BATCH = 1200

function flushLogs(): void {
  flushTimer = null
  if (pending.length === 0) return
  const batch = pending.length > MAX_BATCH ? pending.slice(-MAX_BATCH) : pending
  pending = []
  emit(EVENTS.logLines, batch)
}

export function pushLog(line: LogLine): void {
  const buffer = logBuffers.get(line.instanceId) ?? []
  buffer.push(line)
  if (buffer.length > LOG_BUFFER_SIZE) buffer.splice(0, buffer.length - LOG_BUFFER_SIZE)
  logBuffers.set(line.instanceId, buffer)
  pending.push(line)
  if (!flushTimer) flushTimer = setTimeout(flushLogs, FLUSH_MS)
}

export function getLogBuffer(instanceId: string): LogLine[] {
  return logBuffers.get(instanceId) ?? []
}

/**
 * Drops an instance's log buffer.
 *
 * Nothing evicted these before, so every id ever launched kept up to 800 lines
 * for the life of the process — and a new instance that reused a freed slug
 * would open its "Log" tab on the previous one's output. Called from the IPC
 * layer rather than from `instances.ts`, which cannot import this module
 * without creating a cycle.
 */
export function dropLogBuffer(instanceId: string): void {
  logBuffers.delete(instanceId)
}
