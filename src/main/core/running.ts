import { app } from 'electron'
import { basename, join } from 'node:path'
import { execFileSync, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { uptime } from 'node:os'
import { paths } from '../paths'
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
  /**
   * File name of the program that was started (javaw.exe, or a wrapper).
   * Missing in entries from older builds.
   */
  image?: string
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

/**
 * File name of the program running under a pid, or null when that cannot be
 * told (gone, or the lookup failed).
 */
function processImage(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000
      })
      const row = /^"([^"]+)","(\d+)"/m.exec(out)
      return row && Number(row[2]) === pid ? row[1] : null
    }
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5000 }).trim()
    return out ? basename(out) : null
  } catch {
    return null
  }
}

/**
 * Whether the pid of an adopted game still belongs to the program that was
 * started then. Null when that cannot be told. A pid is handed to other
 * programs once its own ends, so a living pid alone proves nothing.
 */
export function isSameProgram(game: AdoptedGame): boolean | null {
  const now = processImage(game.pid)
  if (now === null) return null
  if (game.image) return now.toLowerCase() === game.image.toLowerCase()
  return /^javaw?(\.exe)?$/i.test(now)
}

/**
 * When a game that ended while the launcher was closed was last seen alive:
 * the last write to its own log, which Minecraft makes up to the moment it
 * quits. Null when that says nothing believable.
 */
function lastSignOfLife(game: AdoptedGame): number | null {
  try {
    const written = statSync(join(paths.gameDir(game.instanceId), 'logs', 'latest.log')).mtimeMs
    if (written <= game.startedAt || written > Date.now()) return null
    return written
  } catch {
    return null
  }
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
        versionId: game.versionId,
        image: game.process.spawnfile ? basename(game.process.spawnfile) : undefined
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
  const bootedAt = now - uptime() * 1000
  const endedMeanwhile: AdoptedGame[] = []
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
    // A game cannot outlive the computer it ran on, and after a reboot any
    // program may hold that pid. Taken as alive, it locked the instance for
    // up to the age cap above. Windows fast startup keeps the uptime running,
    // which is what the program check covers.
    if (entry.startedAt < bootedAt || !alive(entry.pid) || isSameProgram(entry) === false) {
      endedMeanwhile.push(entry)
      continue
    }
    adopted.set(entry.instanceId, entry)
  }

  if (adopted.size > 0) {
    logger.info(`${adopted.size} noch laufende Spiele aus der letzten Sitzung übernommen`)
    ensureAdoptedCheck()
  }
  persist()

  // Ended while the launcher was closed. Dropped silently, these sessions
  // never reached the play time.
  for (const entry of endedMeanwhile) {
    const endedAt = lastSignOfLife(entry)
    if (endedAt !== null) adoptedEnded(entry, endedAt)
  }
}

/**
 * Drops adopted records whose instance is gone.
 *
 * An instance deleted while its game was still running left an entry nothing
 * could reach: no card in the library, so no stop button, and the record sat
 * there for the full 18 hours holding a version's shared files in use. The
 * check lives here rather than inside `adoptRunningFromDisk` because that runs
 * before the instances are read, and the caller passes the lookup in to keep
 * this module free of an import back into the instance store.
 */
export function pruneAdopted(exists: (instanceId: string) => boolean): void {
  let removed = 0
  for (const instanceId of [...adopted.keys()]) {
    if (exists(instanceId)) continue
    adopted.delete(instanceId)
    removed++
    logger.info(`Übernommener Eintrag für gelöschte Instanz ${instanceId} verworfen`)
  }
  if (removed > 0) {
    persist()
    stopAdoptedCheckIfIdle()
    // The set of playing games just changed, and the recorder decides whether
    // to hold the hotkey from exactly that. Skipping this left the key claimed
    // with nothing running behind it.
    announce()
  }
}

/**
 * Called whenever the set of running games changes.
 *
 * A plain callback list rather than an import the other way round: the
 * recording module needs to know when a game comes up so it can claim its
 * hotkey, but this module has to stay at the bottom of the dependency graph
 * where the instance store and the launch engine can both reach it.
 */
type RunningListener = () => void
const listeners = new Set<RunningListener>()

export function onRunningChanged(listener: RunningListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * True while a call to `announce` is already unwinding.
 *
 * `listAdopted`/`isRunning` call `announce` themselves when they drop a dead
 * pid, and a listener reacting to that announcement is free to call either of
 * them right back (the recording module does exactly this). Without a guard
 * that is unbounded recursion; with it, the re-entrant call simply finds the
 * map already updated and skips straight to returning its now-correct result.
 */
let announcing = false

function announce(): void {
  if (announcing) return
  announcing = true
  try {
    for (const listener of listeners) {
      try {
        listener()
      } catch (err) {
        // A listener that throws must not take a launch or an exit down with it.
        logger.warn('Melder für laufende Spiele ist gescheitert:', err)
      }
    }
  } finally {
    announcing = false
  }
}

/**
 * How often adopted games are checked for liveness while the launcher itself
 * is not touching them.
 *
 * `isRunning` and `listAdopted` only notice a dead pid when something asks,
 * and recording only stops on the announcement they make when that happens.
 * A game closed while nobody was polling therefore left its recording running
 * forever. This sweep is the thing that asks on its own.
 */
const ADOPTED_CHECK_INTERVAL_MS = 5_000

let adoptedCheckTimer: NodeJS.Timeout | null = null

/** Starts the sweep if there is now something for it to watch. */
function ensureAdoptedCheck(): void {
  if (adoptedCheckTimer || adopted.size === 0) return
  adoptedCheckTimer = setInterval(() => listAdopted(), ADOPTED_CHECK_INTERVAL_MS)
  // Must never be the reason the process stays alive.
  adoptedCheckTimer.unref()
}

/** Stops the sweep once there is nothing left adopted to watch. */
function stopAdoptedCheckIfIdle(): void {
  if (adoptedCheckTimer && adopted.size === 0) {
    clearInterval(adoptedCheckTimer)
    adoptedCheckTimer = null
  }
}

/**
 * Instances whose launch has been accepted but has no process yet.
 *
 * Lives here rather than in `launch.ts` because both the launch engine and the
 * instance store need to read it, and those two already import each other in
 * one direction. Putting it in the engine closed that loop, and a circular
 * import is the kind of thing that works in the type checker and then hands
 * you an undefined function at runtime.
 */
const starting = new Set<string>()

export function markStarting(instanceId: string): void {
  starting.add(instanceId)
  announce()
}

export function clearStarting(instanceId: string): void {
  if (starting.delete(instanceId)) announce()
}

/** True while this instance is assembling files but has no process yet. */
export function isStarting(instanceId: string): boolean {
  return starting.has(instanceId)
}

/**
 * How many launches are underway but have not spawned a process yet.
 *
 * The updater needs this on top of `runningCount()`: everything before the
 * spawn can take minutes, during which the running registry is still empty.
 */
export function startingCount(): number {
  return starting.size
}

export function setRunning(instanceId: string, game: RunningGame): void {
  // This process owns it now, so any record from the previous session is stale.
  adopted.delete(instanceId)
  running.set(instanceId, game)
  persist()
  stopAdoptedCheckIfIdle()
  announce()
}

export function clearRunning(instanceId: string): void {
  running.delete(instanceId)
  adopted.delete(instanceId)
  persist()
  stopAdoptedCheckIfIdle()
  announce()
}

export function getRunning(instanceId: string): RunningGame | undefined {
  return running.get(instanceId)
}

/**
 * Instances left running by an earlier session and still alive.
 *
 * Also the liveness check itself: a dead pid found here is dropped from the
 * registry and announced immediately, the same as `isRunning` below, rather
 * than only being filtered out of this one result.
 */
export function listAdopted(): AdoptedGame[] {
  const result: AdoptedGame[] = []
  let removed = false
  for (const instanceId of [...adopted.keys()]) {
    const game = adopted.get(instanceId)
    if (!game) continue
    if (alive(game.pid)) {
      result.push(game)
    } else {
      adopted.delete(instanceId)
      removed = true
      adoptedEnded(game)
    }
  }
  if (removed) {
    persist()
    stopAdoptedCheckIfIdle()
    announce()
  }
  return result
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
  // lazily here is what makes the guard self-healing, on top of the periodic
  // sweep started in `ensureAdoptedCheck`.
  adopted.delete(instanceId)
  adoptedEnded(orphan)
  persist()
  stopAdoptedCheckIfIdle()
  announce()
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

/** Games this launcher session started itself, without adopted ones. */
export function ownRunningCount(): number {
  return running.size
}

type AdoptedEndListener = (game: AdoptedGame, endedAt: number) => void
const adoptedEndListeners = new Set<AdoptedEndListener>()

/**
 * Called when a game adopted from an earlier session is found to have ended.
 * The play time of such a session was never recorded, because only a game
 * this session spawned itself has an exit handler.
 */
export function onAdoptedEnded(listener: AdoptedEndListener): () => void {
  adoptedEndListeners.add(listener)
  return () => adoptedEndListeners.delete(listener)
}

function adoptedEnded(game: AdoptedGame, endedAt = Date.now()): void {
  for (const listener of adoptedEndListeners) {
    try {
      listener(game, endedAt)
    } catch (err) {
      logger.warn(`Ende von ${game.instanceId} konnte nicht verarbeitet werden:`, err)
    }
  }
}

export function runningCount(): number {
  let count = running.size
  for (const orphan of adopted.values()) {
    if (alive(orphan.pid)) count++
  }
  return count
}
