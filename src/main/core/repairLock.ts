/**
 * Marks the instance a repair is currently working on.
 *
 * Its own module for the same reason as `restoreLock` and `contentLock`: the
 * marker is set in `repair.ts` and needs to be read by `backups.ts` (a restore
 * must not start on top of a repair, any more than the other way round). But
 * `repair.ts` already imports `content.ts` for its own content step, and
 * `content.ts` imports `backups.ts` for the safety copy it takes before
 * removing anything. Reading the marker straight out of `repair.ts` would
 * close that loop.
 *
 * A plain set, not counted like the other two: `repairInstance` refuses a
 * second run for the same instance outright rather than letting one repair
 * nest inside another, so there is nothing here for an inner call to leave
 * behind for an outer one.
 */
const repairing = new Set<string>()

/** True while a repair is running, so a launch or a restore can refuse to start on top. */
export function isRepairing(instanceId: string): boolean {
  return repairing.has(instanceId)
}

export function markRepairing(instanceId: string): void {
  repairing.add(instanceId)
}

export function clearRepairing(instanceId: string): void {
  repairing.delete(instanceId)
}
