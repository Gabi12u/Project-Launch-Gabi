/**
 * Prueft, dass eine erledigte Aufgabe der Oberflaeche wirklich mitgeteilt
 * wird, wenn der Hauptprozess sie vergisst.
 *
 *   node scripts/test-task-lifecycle.mjs
 *
 * Vorher sendete `forget()` in src/main/tasks.ts kein Ereignis, also blieb
 * jede erledigte oder fehlgeschlagene Aufgabe fuer immer im Zustand der
 * Oberflaeche stehen. Dieser Test haengt sich wie ein echtes Fenster an
 * `emit()` und wartet auf das echte Timeout, keine simulierte Uhr.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-tasklife-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

async function waitFor(label, condition, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  problems.push(`Zeitueberschreitung: ${label}`)
  return false
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const sent = []
  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `const windows = []
     module.exports = {
       app: { getPath: () => ${JSON.stringify(work)}, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       BrowserWindow: { getAllWindows: () => windows },
       __registerWindow: (w) => windows.push(w),
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       ...require(${JSON.stringify(join(root, 'src/main/tasks.ts'))}),
       ...require(${JSON.stringify(join(root, 'src/main/events.ts'))}),
       ...require('electron')
     }`
  )

  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    logLevel: 'error'
  })

  const { Task, listTasks, setMainWindow, __registerWindow } = require(out)

  // A minimal stand-in for the real window: just enough for `emit()` to
  // believe a renderer is listening, recording every channel and payload it
  // would have sent. `emit()` broadcasts to every window `BrowserWindow.
  // getAllWindows()` returns, so the fake window is registered there rather
  // than only handed to `setMainWindow` (kept too, since other code still
  // reads `getMainWindow()` directly).
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => sent.push({ channel, payload })
    }
  }
  setMainWindow(fakeWindow)
  __registerWindow(fakeWindow)

  /* ------------------------------------------------------------------ *
   * A task that finishes: emits done, then is forgotten a few seconds later.
   * ------------------------------------------------------------------ */
  const task = new Task('Testvorgang', 'laeuft…')
  task.done('Fertig')

  const doneUpdate = sent.find(
    (e) => e.channel === 'evt:task-update' && e.payload.id === task.id && e.payload.state === 'done'
  )
  check(Boolean(doneUpdate), 'Kein "done"-Update ueber evt:task-update gesendet')
  check(listTasks().some((t) => t.id === task.id), 'Aufgabe ist sofort nach done() schon verschwunden')

  notes.push(`Aufgabe ${task.id}: done-Update gesendet, warte jetzt auf das Vergessen (bis zu 9s)…`)

  const forgotten = await waitFor(
    'Aufgabe wird nach done() vergessen und gemeldet',
    () => sent.some((e) => e.channel === 'evt:task-removed' && e.payload === task.id),
    9000
  )

  if (forgotten) {
    check(!listTasks().some((t) => t.id === task.id), 'Aufgabe steckt nach dem Vergessen noch in listTasks()')
    notes.push('evt:task-removed kam an, und die Aufgabe ist aus listTasks() verschwunden.')
  }
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // Aufraeumen ist Nebensache, der Bericht zaehlt.
  }
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
