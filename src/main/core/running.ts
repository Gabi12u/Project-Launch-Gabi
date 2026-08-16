import type { ChildProcess } from 'node:child_process'
import type { LaunchStatus } from '@shared/types'

export interface RunningGame {
  instanceId: string
  process: ChildProcess
  startedAt: number
  status: LaunchStatus
  /** Resolved version id, so shared per-version files can be left alone. */
  versionId: string
}

/**
 * Registry of running games. Lives in its own module so the instance store and
 * the launch engine can both reach it without importing each other.
 */
const running = new Map<string, RunningGame>()

export function setRunning(instanceId: string, game: RunningGame): void {
  running.set(instanceId, game)
}

export function clearRunning(instanceId: string): void {
  running.delete(instanceId)
}

export function getRunning(instanceId: string): RunningGame | undefined {
  return running.get(instanceId)
}

export function isRunning(instanceId: string): boolean {
  return running.has(instanceId)
}

export function listRunning(): RunningGame[] {
  return [...running.values()]
}

export function runningCount(): number {
  return running.size
}
