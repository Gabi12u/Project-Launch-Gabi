/**
 * Marks the instance a repair is currently working on.
 *
 * Its own module for the same reason as `contentLock` and `restoreLock`: the
 * marker is set in `repair.ts`, and several other modules need to read it
 * without importing `repair.ts` itself. `instances.ts` needs it so a delete
 * or a duplicate can refuse to run mid-repair, and `repair.ts` already
 * imports `instances.ts` for `getInstance`/`persist`, so reading the marker
 * back out of `repair.ts` would have closed that cycle. `backups.ts` needs it
 * so a restore does not start on top of a repair, and `repair.ts` already
 * imports `content.ts` for its own content step while `content.ts` imports
 * `backups.ts` for the safety copy it takes before removing anything, so the
 * same problem would show up there too. `launch.ts` reads it as well, for its
 * own long-standing guard against launching into a half-repaired instance.
 *
 * A repair rewrites the client jar, the natives folder, the loader and the
 * mods over a run that can take minutes. Starting, deleting or duplicating
 * the instance, or restoring a backup onto it, while that is only half done
 * reads or removes files out from under it.
 *
 * A plain set, not counted like `contentLock`/`restoreLock`: `repairInstance`
 * already refuses to start a second run for the same id, so there is never a
 * nested hold to survive.
 */
const repairing = new Set<string>()

/** True while a repair is running, so a launch, delete, duplicate or restore can refuse to start on top. */
export function isRepairing(instanceId: string): boolean {
  return repairing.has(instanceId)
}

export function markRepairing(instanceId: string): void {
  repairing.add(instanceId)
}

export function clearRepairing(instanceId: string): void {
  repairing.delete(instanceId)
}
