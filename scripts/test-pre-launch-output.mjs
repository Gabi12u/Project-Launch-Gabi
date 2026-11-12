/**
 * Prueft den "Befehl vor dem Start" mit viel Ausgabe:
 *
 *   node scripts/test-pre-launch-output.mjs
 *
 * runPreLaunch() startete den Befehl mit Pipes fuer stdout und stderr, las
 * sie aber nie. Nach einigen Kilobyte Ausgabe war die Pipe voll, der Befehl
 * blieb beim naechsten Schreiben stehen und der Spielstart hing fuenf Minuten,
 * bis die Zeitgrenze ihn beendete. Jetzt wird die Ausgabe in das Spielprotokoll
 * gelesen, und ein Befehl, der auf eine Eingabe wartet, bekommt sofort keine.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-prelaunch-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

/** Resolves with the outcome, or 'haengt' when it takes longer than `ms`. */
function within(promise, ms) {
  return Promise.race([
    promise.then(
      () => 'ok',
      (err) => `fehler: ${err?.message ?? err}`
    ),
    new Promise((resolve) => setTimeout(() => resolve('haengt'), ms).unref())
  ])
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })

  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `const path = ${JSON.stringify(userData)}
     class BrowserWindowShim { static getAllWindows() { return [] } }
     module.exports = {
       app: {
         getPath: () => path,
         getAppPath: () => ${JSON.stringify(root)},
         getVersion: () => '0.0.0-test',
         isPackaged: false,
         getName: () => 'launch-gabi'
       },
       BrowserWindow: BrowserWindowShim,
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/launch.ts'))})`)
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
  const { runPreLaunch, getLogBuffer } = require(out)
  check(typeof runPreLaunch === 'function', 'runPreLaunch wurde nicht exportiert')

  const task = { signal: new AbortController().signal, cancelled: false }
  const node = `"${process.execPath}"`

  // About 4 MB on stdout and some on stderr, far beyond any pipe buffer, in
  // few enough lines that the log (it keeps the last 800) holds them all.
  const flood = join(work, 'flood.js')
  writeFileSync(
    flood,
    `const line = 'x'.repeat(9999) + '\\n'
     for (let i = 0; i < 400; i++) process.stdout.write(line)
     for (let i = 0; i < 50; i++) process.stderr.write('y'.repeat(9999) + '\\n')
     process.stdout.write('ENDE DER AUSGABE\\n')`
  )
  const floodResult = await within(
    runPreLaunch({ id: 'flut', settings: { preLaunchCommand: `${node} "${flood}"` } }, work, task),
    30_000
  )
  check(floodResult === 'ok', `Befehl mit viel Ausgabe: ${floodResult}`)
  // The pipe is read after the exit too; give the last chunk a moment.
  await new Promise((resolve) => setTimeout(resolve, 300))
  const lines = getLogBuffer('flut')
  check(
    lines.some((l) => l.text.includes('ENDE DER AUSGABE')),
    `Die Ausgabe des Befehls fehlt im Spielprotokoll (${lines.length} Zeilen)`
  )
  check(
    lines.some((l) => l.stream === 'launcher' && /Befehl vor dem Start|pre-launch command/i.test(l.text)),
    'Das Spielprotokoll sagt nicht, dass der Befehl vor dem Start laeuft'
  )
  check(!lines.some((l) => l.text.includes(flood)), 'Der Befehl selbst steht im Spielprotokoll')
  notes.push(`Befehl mit etwa 4 MB Ausgabe: ${floodResult}, ${lines.length} Zeilen im Protokoll.`)

  // A command that waits for an answer gets an empty input and goes on.
  const ask = join(work, 'ask.js')
  writeFileSync(
    ask,
    `process.stdin.resume()
     process.stdin.on('end', () => { console.log('keine Eingabe'); process.exit(0) })`
  )
  const askResult = await within(
    runPreLaunch({ id: 'frage', settings: { preLaunchCommand: `${node} "${ask}"` } }, work, task),
    30_000
  )
  check(askResult === 'ok', `Befehl, der auf eine Eingabe wartet: ${askResult}`)
  notes.push(`Befehl, der auf eine Eingabe wartet: ${askResult}.`)

  // A failing command still fails.
  const fail = join(work, 'fail.js')
  writeFileSync(fail, `console.error('kaputt'); process.exit(3)`)
  const failResult = await within(
    runPreLaunch({ id: 'kaputt', settings: { preLaunchCommand: `${node} "${fail}"` } }, work, task),
    30_000
  )
  check(/fehler: .*3/.test(failResult), `Ein fehlschlagender Befehl: ${failResult}`)
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // best effort cleanup
  }
}

console.log('\n=== Beobachtungen ===')
for (const note of notes) console.log(`  - ${note}`)
console.log('\n=== Probleme ===')
if (problems.length === 0) console.log('  keine')
else for (const problem of problems) console.log(`  X ${problem}`)

console.log(`\nERGEBNIS: ${problems.length === 0 ? 'BESTANDEN' : `FEHLGESCHLAGEN (${problems.length})`}`)
process.exitCode = problems.length === 0 ? 0 : 1
// A hung command from the old code would keep the process alive.
setTimeout(() => process.exit(process.exitCode), 500).unref()
