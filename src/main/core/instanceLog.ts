import { EVENTS } from '@shared/ipc'
import type { LogLine } from '@shared/types'
import { emit } from '../events'

/**
 * The per-instance live log buffer and its IPC push, pulled out of
 * `launch.ts` into its own module.
 *
 * `repair.ts` needs to append to the same stream a running game writes to, so
 * a repair shows up as live lines in the exact viewer the "Logs" tab already
 * has, instead of a separate one. `launch.ts` already imports `isRepairing`
 * from `repair.ts`, so `repair.ts` importing this back from `launch.ts`
 * would have closed a cycle between the two; this module has no import from
 * either, so both can depend on it without one.
 */

/** Ring buffer of recent output per instance so the UI can show a log tab. */
const logBuffers = new Map<string, LogLine[]>()
const LOG_BUFFER_SIZE = 800

export function pushLog(line: LogLine): void {
  const buffer = logBuffers.get(line.instanceId) ?? []
  buffer.push(line)
  if (buffer.length > LOG_BUFFER_SIZE) buffer.splice(0, buffer.length - LOG_BUFFER_SIZE)
  logBuffers.set(line.instanceId, buffer)
  emit(EVENTS.logLine, line)
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
