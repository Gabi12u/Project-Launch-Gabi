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

/**
 * Ids `duplicateInstance` is currently copying the game folder of.
 *
 * A plain set, not the counter above: `withContentLock` is reentrant on
 * purpose, so two independent callers both taking it just run side by side,
 * which is exactly wrong while a copy is reading the same folder a mutation
 * would write into. Content mutations check this and refuse outright instead
 * of racing the copy.
 */
const copying = new Set<string>()

export function isContentBusy(instanceId: string): boolean {
  return (busy.get(instanceId) ?? 0) > 0 || copying.has(instanceId)
}

export function isCopying(instanceId: string): boolean {
  return copying.has(instanceId)
}

export function markCopying(instanceId: string): void {
  copying.add(instanceId)
}

export function unmarkCopying(instanceId: string): void {
  copying.delete(instanceId)
}

/** Thrown by a content mutation while `duplicateInstance` is still copying this instance's folder. */
export function assertNotCopying(instanceId: string): void {
  if (copying.has(instanceId)) {
    throw new Error('Die Instanz wird gerade kopiert, bitte kurz warten.')
  }
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

/**
 * Serializes operations on one specific content item, keyed by its id.
 *
 * Moved here from `content.ts` so `instances.ts` (which must not import from
 * `content.ts`, a circular import) can use it too, for `toggleContent`.
 *
 * `withContentLock` only signals "something is happening" to code outside
 * this module (launch, repair, folder scans); it is a reentrant counter, not a
 * mutex, on purpose, since a batch operation holds it for the whole run while
 * each step inside takes it again. That leaves nothing to stop two independent
 * calls from interleaving on the very same item, which is exactly what an
 * update and a removal of the same mod did when they overlapped: the file the
 * update had just downloaded and renamed survived the removal it raced
 * against, with no record left pointing at it, and the next folder scan
 * discovered it as a "new" mod, undoing the removal.
 *
 * Keyed by contentId rather than by instance, so it needs no reentrancy of its
 * own: nothing ever calls back into the same contentId while already holding
 * this lock for it. Self-cleaning, so a session with many installs does not
 * grow this map forever.
 */
const itemLocks = new Map<string, Promise<void>>()

export function withItemLock<T>(contentId: string, run: () => Promise<T>): Promise<T> {
  const previous = itemLocks.get(contentId) ?? Promise.resolve()
  const result = previous.then(run, run)
  const marker = result.then(
    () => undefined,
    () => undefined
  )
  itemLocks.set(contentId, marker)
  void marker.finally(() => {
    if (itemLocks.get(contentId) === marker) itemLocks.delete(contentId)
  })
  return result
}
