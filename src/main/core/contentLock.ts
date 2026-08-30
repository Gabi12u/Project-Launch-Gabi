/**
 * Marks instances whose content folder is being rewritten right now.
 *
 * Its own module on purpose. The lock is taken in `content.ts`, respected by
 * `instances.ts` (which must not reconcile a folder mid-rewrite) and by
 * `launch.ts` (which must not start a game into one), and those three already
 * import each other in one direction. Putting the registry in any of them
 * would close that loop.
 *
 * Counted rather than a plain set, because the batch operations hold it across
 * a whole run while each step inside takes it again. With a set the inner
 * release would clear the outer one and leave the rest of the batch
 * unprotected.
 */
const busy = new Map<string, number>()

export function isContentBusy(instanceId: string): boolean {
  return (busy.get(instanceId) ?? 0) > 0
}

/** Holds the marker for as long as `run` takes, however it ends. */
export async function withContentLock<T>(instanceId: string, run: () => Promise<T>): Promise<T> {
  busy.set(instanceId, (busy.get(instanceId) ?? 0) + 1)
  try {
    return await run()
  } finally {
    const left = (busy.get(instanceId) ?? 1) - 1
    if (left > 0) busy.set(instanceId, left)
    else busy.delete(instanceId)
  }
}
