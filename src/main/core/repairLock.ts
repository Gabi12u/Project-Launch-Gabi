/**
 * Marks instances a repair is currently rewriting.
 *
 * Its own module for the same reason as `contentLock` and `restoreLock`: the
 * marker is taken in `repair.ts`, read by `launch.ts`, and now also needed by
 * `instances.ts` before an install starts, since install rewrites the exact
 * same libraries, natives and loader files a repair does. `repair.ts` already
 * imports from `instances.ts`, so importing the marker back from `repair.ts`
 * there would close that loop.
 */
const repairing = new Set<string>()

export function isRepairing(instanceId: string): boolean {
  return repairing.has(instanceId)
}

export function markRepairing(instanceId: string): void {
  repairing.add(instanceId)
}

export function clearRepairing(instanceId: string): void {
  repairing.delete(instanceId)
}
