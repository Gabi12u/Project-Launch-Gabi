/**
 * Marks instances a repair is currently working on.
 *
 * Its own module for the same reason as `contentLock` and `restoreLock`: the
 * marker is set in `repair.ts`, and `instances.ts` needs to read it too, so a
 * delete or a duplicate can refuse to run mid-repair. `repair.ts` already
 * imports `instances.ts` for `getInstance`, `persist` and friends, so
 * `instances.ts` importing the marker back from `repair.ts` would have closed
 * a cycle between the two. `repair.ts` re-exports `isRepairing`, so its
 * existing consumer (`launch.ts`) sees no difference.
 *
 * A repair rewrites the client jar, the natives folder, the loader and the
 * mods over a run that can take minutes. Deleting or duplicating the instance
 * while that is only half done reads or removes files out from under it, the
 * same way starting the game into it would.
 *
 * A plain set, not counted like `contentLock`/`restoreLock`: `repairInstance`
 * already refuses to start a second run for the same id, so there is never a
 * nested hold to survive.
 */
const repairing = new Set<string>()

export function isRepairing(instanceId: string): boolean {
  return repairing.has(instanceId)
}

export function beginRepair(instanceId: string): void {
  repairing.add(instanceId)
}

export function endRepair(instanceId: string): void {
  repairing.delete(instanceId)
}
