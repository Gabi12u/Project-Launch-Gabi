/**
 * When the computer was asleep (standby or hibernation) during this launcher
 * session.
 *
 * A session's play time is the time between start and exit. A laptop that
 * went into standby with the game open counted the whole night as played,
 * since the game process simply survives the sleep.
 */
import { powerMonitor } from 'electron'

/** Finished naps of this session, oldest first. */
const naps: { from: number; to: number }[] = []
/** When the current nap began, while asleep. */
let asleepSince: number | null = null

/** Starts noting standby and hibernation. Needs the app to be ready. */
export function watchSleep(): void {
  powerMonitor.on('suspend', () => {
    asleepSince = Date.now()
  })
  powerMonitor.on('resume', () => {
    if (asleepSince === null) return
    naps.push({ from: asleepSince, to: Date.now() })
    asleepSince = null
    if (naps.length > 100) naps.splice(0, naps.length - 100)
  })
}

/** How long the computer slept between two points in time. */
export function sleptBetween(start: number, end: number): number {
  const all = asleepSince === null ? naps : [...naps, { from: asleepSince, to: end }]
  let total = 0
  for (const nap of all) {
    const from = Math.max(nap.from, start)
    const to = Math.min(nap.to, end)
    if (to > from) total += to - from
  }
  return total
}
