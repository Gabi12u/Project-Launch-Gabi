import { app } from 'electron'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { LaunchStatus } from '@shared/types'
import { readJson, writeJsonAtomic } from '../store'
import { log } from '../logger'

const logger = log('running')

export interface RunningGame {
  instanceId: string
  process: ChildProcess
  startedAt: number
  status: LaunchStatus
  /** Resolved version id, so shared per-version files can be left alone. */
  versionId: string
}

/**
 * A game this process did not start — recorded by an earlier run of the
 * launcher and still alive when we came back up.
 *
 * The default launch behaviour deliberately leaves Minecraft running when the
 * launcher is closed, but the registry below only ever lived in memory. After a
 * restart the launcher therefore believed nothing was running and happily
 * started a second JVM against the same world, with both writing `level.dat`.
 * We have no `ChildProcess` for these, only a pid.
 */
export interface AdoptedGame {
  instanceId: string
  pid: number
  startedAt: number
  versionId: string
}

/**
 * Registry of running games. Lives in its own module so the instance store and
 * the launch engine can both reach it without importing each other.
 */
const running = new Map<string, RunningGame>()
const adopted = new Map<string, AdoptedGame>()

function stateFile(): string {
  // userData, not the data directory: this is process state, and it has to
  // survive the user pointing the launcher somewhere else.
  return join(app.getPath('userData'), 'running.json')
}

/** True while the OS still knows this pid. */
function alive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence check without delivering
    // anything to the process.
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists but belongs to someone else, which still counts.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function persist(): void {
  const entries: AdoptedGame[] = [
    ...[...running.values()]
      .filter((game) => typeof game.process.pid === 'number')
      .map((game) => ({
        instanceId: game.instanceId,
        pid: game.process.pid as number,
        startedAt: game.startedAt,
        versionId: game.versionId
      })),
    ...adopted.values()
  ]

  try {
    writeJsonAtomic(stateFile(), entries)
  } catch (err) {
    // Losing this file only costs us the duplicate-launch guard after a
    // restart; it must never take a launch down.
    logger.warn('Laufende Spiele konnten nicht gespeichert werden:', err)
  }
}

/**
 * How long a record from a previous session is trusted.
 *
 * A pid says nothing about *which* process holds it. Once the real game exits
 * without this launcher running to notice, the OS is free to hand that number
 * to something unrelated — and `alive()` then reports "still running" forever,
 * locking the instance out permanently. Failing open after a generous window
 * is the lesser evil: the worst case becomes the behaviour we had before this
 * file existed, while a genuinely forgotten game is caught for a full day.
 */
const ADOPTED_MAX_AGE_MS = 18 * 60 * 60 * 1000

/**
 * Re-reads the games a previous run left behind and keeps the ones still alive.
 *
 * Nothing is ever killed on the strength of this file: a pid can be recycled by
 * an unrelated process, and acting on that would be far worse than the problem
 * it solves. The entries only block a second launch, they age out, and the
 * user can clear one from the UI through the normal stop button.
 */
export function adoptRunningFromDisk(): void {
  const stored = readJson<AdoptedGame[]>(stateFile(), [])
  if (!Array.isArray(stored)) return

  adopted.clear()
  const now = Date.now()
  for (const entry of stored) {
    if (!entry || typeof entry.instanceId !== 'string' || typeof entry.pid !== 'number') continue
    // Fails closed on a missing or unusable timestamp. Requiring a number
    // before applying the age cap meant a hand-edited or older-format entry
    // skipped it entirely and rode purely on `alive(pid)` — which is exactly
    // the recycled-pid case the cap exists to stop.
    if (typeof entry.startedAt !== 'number' || !Number.isFinite(entry.startedAt)) {
      logger.info(`Eintrag für ${entry.instanceId} hat keinen brauchbaren Startzeitpunkt, wird verworfen`)
      continue
    }
    if (now - entry.startedAt > ADOPTED_MAX_AGE_MS) {
      logger.info(`Eintrag für ${entry.instanceId} ist zu alt und wird verworfen`)
      continue
    }
    if (!alive(entry.pid)) continue
    adopted.set(entry.instanceId, entry)
  }

  if (adopted.size > 0) {
    logger.info(`${adopted.size} noch laufende Spiele aus der letzten Sitzung übernommen`)
  }
  persist()
}

export function setRunning(instanceId: string, game: RunningGame): void {
  // This process owns it now, so any record from the previous session is stale.
  adopted.delete(instanceId)
  running.set(instanceId, game)
  persist()
}

export function clearRunning(instanceId: string): void {
  running.delete(instanceId)
  adopted.delete(instanceId)
  persist()
}

export function getRunning(instanceId: string): RunningGame | undefined {
  return running.get(instanceId)
}

/** An instance left running by an earlier session, if any. */
export function getAdopted(instanceId: string): AdoptedGame | undefined {
  return adopted.get(instanceId)
}

export function isRunning(instanceId: string): boolean {
  if (running.has(instanceId)) return true

  const orphan = adopted.get(instanceId)
  if (!orphan) return false
  if (alive(orphan.pid)) return true

  // The game has since been closed, so the instance is free again. Checking
  // lazily here is what makes the guard self-healing without any polling.
  adopted.delete(instanceId)
  persist()
  return false
}

export function listRunning(): RunningGame[] {
  return [...running.values()]
}

/**
 * Version ids currently in use, including adopted games. Callers that clean up
 * files shared per version need this rather than `listRunning()`, which only
 * knows about children of this process.
 */
export function activeVersionIds(): string[] {
  return [
    ...[...running.values()].map((game) => game.versionId),
    ...[...adopted.values()].filter((game) => alive(game.pid)).map((game) => game.versionId)
  ]
}

export function runningCount(): number {
  let count = running.size
  for (const orphan of adopted.values()) {
    if (alive(orphan.pid)) count++
  }
  return count
}
