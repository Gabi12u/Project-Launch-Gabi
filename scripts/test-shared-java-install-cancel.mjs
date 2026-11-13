/**
 * Prueft die Absicherung, dass der Abbruch einer von mehreren Instanzen, die
 * sich eine Java-Installation teilen, wirklich sofort fuer genau diese eine
 * Instanz greift, und die anderen unberuehrt laesst.
 *
 *   node scripts/test-shared-java-install-cancel.mjs
 *
 * Kein echter Download noetig, um das zu pruefen: der eigentliche Fehler lag
 * ausschliesslich in der Nebenlaeufigkeits-Logik selbst (welches Signal wen
 * abbricht), nicht im Herunterladen. Wortgleich aus src/main/core/java.ts
 * uebernommen, mit einem gefaketen, verzoegerten "Download" statt eines
 * echten.
 */

class TaskCancelledError extends Error {
  constructor() {
    super('Vorgang abgebrochen')
    this.name = 'TaskCancelledError'
  }
}

// Wortgleich aus src/main/core/java.ts.
function waitForSharedInstall(entry, task) {
  if (!task?.signal) return entry.promise
  const signal = task.signal
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      entry.listeners.delete(task)
      if (entry.listeners.size === 0) entry.controller.abort()
      reject(new TaskCancelledError())
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort)
    entry.promise.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

const installing = new Map()

// Wortgleich im Ablauf mit installJava aus src/main/core/java.ts.
function installJava(major, task, fakeInstallOnce) {
  const running = installing.get(major)
  if (running && !running.controller.signal.aborted) {
    if (task) running.listeners.add(task)
    return waitForSharedInstall(running, task)
  }

  const listeners = new Set()
  if (task) listeners.add(task)
  const controller = new AbortController()

  const shared = {
    update: () => {},
    get signal() {
      return controller.signal
    }
  }

  const entry = { listeners, controller }
  const started = running
    ? running.promise
        .then(() => undefined, () => undefined)
        .then(() => {
          if (controller.signal.aborted) throw new TaskCancelledError()
          return fakeInstallOnce(shared)
        })
    : fakeInstallOnce(shared)
  entry.promise = started.finally(() => {
    if (installing.get(major) === entry) installing.delete(major)
  })
  installing.set(major, entry)
  return waitForSharedInstall(entry, task)
}

function makeTask() {
  const controller = new AbortController()
  return { signal: controller.signal, cancel: () => controller.abort() }
}

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

/* ------------------------------------------------------------------ *
 * A fake, slow "download" that fails if the shared signal aborts, and
 * resolves after a delay otherwise. Stands in for installJavaOnce.
 * ------------------------------------------------------------------ */
function fakeInstallOnce(shared, ms = 200) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ major: 21, version: 'fake' }), ms)
    shared.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new TaskCancelledError())
    })
  })
}

/* ------------------------------------------------------------------ *
 * 1. Two instances share one install. The second cancels immediately.
 *    Its own wait must reject right away, the first must still succeed,
 *    and the shared download must keep running (not aborted).
 * ------------------------------------------------------------------ */
{
  const taskA = makeTask()
  const taskB = makeTask()

  const resultA = installJava(21, taskA, (shared) => fakeInstallOnce(shared, 150))
  const resultB = installJava(21, taskB, () => {
    throw new Error('should not start a second install, must join the first')
  })

  taskB.cancel()

  let bRejectedWith = null
  try {
    await resultB
  } catch (err) {
    bRejectedWith = err
  }
  check(bRejectedWith instanceof TaskCancelledError, 'Der Abbruch von Instanz B hat nicht sofort mit TaskCancelledError abgelehnt')

  const a = await resultA
  check(a && a.version === 'fake', 'Instanz A hat die geteilte Installation nicht trotzdem erfolgreich erhalten')
  notes.push('Zwei Instanzen teilen sich eine Installation: Abbruch der zweiten wirkt sofort nur auf sie, die erste bekommt trotzdem ihr Ergebnis.')
}

/* ------------------------------------------------------------------ *
 * 2. A single caller cancelling, with nobody else waiting, must actually
 *    abort the shared download (the pre-fix, single-caller behaviour).
 * ------------------------------------------------------------------ */
{
  installing.clear()
  const task = makeTask()
  let sharedSignalAborted = false

  const result = installJava(22, task, (shared) => {
    shared.signal.addEventListener('abort', () => {
      sharedSignalAborted = true
    })
    return fakeInstallOnce(shared, 200)
  })

  task.cancel()
  try {
    await result
  } catch {
    // expected
  }
  await new Promise((r) => setTimeout(r, 10))

  check(sharedSignalAborted, 'Einziger Aufrufer bricht ab, aber die geteilte Installation wurde nicht tatsaechlich abgebrochen')
  notes.push('Ein einzelner Aufrufer ohne Mitwartende: Abbruch stoppt die Installation wirklich (wie vor der Aenderung).')
}

/* ------------------------------------------------------------------ *
 * 3. Cancelled while unpacking, then tried again at once. The cancelled
 *    run is still busy with the same folder for a moment; the new one
 *    must only start once it is over, never side by side with it.
 * ------------------------------------------------------------------ */
{
  installing.clear()
  let busy = 0
  let overlapped = false
  // Unpacking does not look at the signal until it is done.
  const slowUnpack = () =>
    new Promise((resolve) => {
      busy++
      if (busy > 1) overlapped = true
      setTimeout(() => {
        busy--
        resolve({ major: 17, version: 'fake' })
      }, 120)
    })
  const first = makeTask()
  const firstResult = installJava(17, first, slowUnpack).catch(() => undefined)
  await new Promise((r) => setTimeout(r, 20))
  first.cancel()
  const second = await installJava(17, makeTask(), slowUnpack)
  await firstResult
  check(!overlapped, 'Nach einem Abbruch lief die neue Installation gleichzeitig mit der abgebrochenen im selben Ordner')
  check(second && second.version === 'fake', 'Die neue Installation nach dem Abbruch kam nicht an')
  notes.push('Abbruch beim Entpacken und sofort neu: die neue Installation wartet, bis die alte vorbei ist.')
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
