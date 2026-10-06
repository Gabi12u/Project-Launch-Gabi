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

/** Whether a restore is running for any instance at all. */
export function anyRestoring(): boolean {
  return busy.size > 0
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

/**
 * Marks instances being read into an archive right now: a backup or a
 * modpack export. Both only read, so they block nothing else, but deleting
 * the instance underneath them carried on zipping a half deleted folder and
 * saved the result as if it were complete. Kept here, next to the restore
 * marker, because it is the same kind of whole folder work.
 */
const archiving = new Map<string, number>()

export function isArchiving(instanceId: string): boolean {
  return (archiving.get(instanceId) ?? 0) > 0
}

/** Whether a backup or an export is running for any instance at all. */
export function anyArchiving(): boolean {
  return archiving.size > 0
}

/** Holds the archive marker for as long as `run` takes, however it ends. */
export async function withArchiving<T>(instanceId: string, run: () => Promise<T>): Promise<T> {
  archiving.set(instanceId, (archiving.get(instanceId) ?? 0) + 1)
  try {
    return await run()
  } finally {
    const left = (archiving.get(instanceId) ?? 1) - 1
    if (left > 0) archiving.set(instanceId, left)
    else archiving.delete(instanceId)
  }
}
