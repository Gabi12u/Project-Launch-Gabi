/**
 * Marks instances whose game folder is being rebuilt from a backup right now.
 *
 * Its own module for the same reason as `contentLock`: the marker is taken in
 * `backups.ts` and read by `launch.ts` and `instances.ts`, and those already
 * import each other in one direction. Putting the registry in `backups.ts`
 * would close that loop.
 *
 * A restore moves the current worlds aside, unpacks an archive over the
 * folder, and moves them back if that fails. During those seconds the folder
 * does not match itself: starting the game into it reads half written worlds,
 * and deleting the instance takes the staging folder with it.
 *
 * Counted rather than a plain set, to match `contentLock` and to survive a
 * nested call without the inner release clearing the outer one.
 */
const busy = new Map<string, number>()

export function isRestoring(instanceId: string): boolean {
  return (busy.get(instanceId) ?? 0) > 0
}

/** Holds the marker for as long as `run` takes, however it ends. */
export async function withRestoreLock<T>(instanceId: string, run: () => Promise<T>): Promise<T> {
  busy.set(instanceId, (busy.get(instanceId) ?? 0) + 1)
  try {
    return await run()
  } finally {
    const left = (busy.get(instanceId) ?? 1) - 1
    if (left > 0) busy.set(instanceId, left)
    else busy.delete(instanceId)
  }
}
