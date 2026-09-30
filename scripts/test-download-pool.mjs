/**
 * Prueft, dass alle Downloads zusammen die Einstellung "Gleichzeitige
 * Downloads" einhalten, nicht jede Installation fuer sich.
 *
 *   node scripts/test-download-pool.mjs
 *
 * Jeder `downloadAll`-Aufruf oeffnete frueher eigene Verbindungen in der
 * eingestellten Zahl. Fuenf Installationen nebeneinander liefen so mit
 * vierzig Uebertragungen, die sich gegenseitig ausbremsten. Kein Netz noetig:
 * `fetch` wird durch eine langsame Attrappe ersetzt, die mitzaehlt, wie
 * viele Uebertragungen gleichzeitig offen sind.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-pool-'))

const problems = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const LIMIT = 3
const FILE_BYTES = 64

let open = 0
let maxOpen = 0
let started = 0

// Answers every request after a short wait with a body that trickles out, so
// several transfers genuinely overlap.
globalThis.fetch = async (url) => {
  // A Wi-Fi sign-in page answers everything with 200 and HTML.
  if (String(url).includes('/portal/')) {
    return new Response('<html><body>Bitte anmelden</body></html>', { status: 200 })
  }
  started++
  open++
  maxOpen = Math.max(maxOpen, open)
  // One file that takes long, for the "waiting on another install" case.
  await new Promise((resolve) => setTimeout(resolve, String(url).includes('/slow/') ? 2000 : 15))
  let sent = false
  const body = new ReadableStream({
    async pull(controller) {
      if (sent) {
        open--
        controller.close()
        return
      }
      sent = true
      await new Promise((resolve) => setTimeout(resolve, 25))
      controller.enqueue(new Uint8Array(FILE_BYTES))
    }
  })
  return new Response(body, { status: 200 })
}

function fakeTask() {
  const controller = new AbortController()
  const task = {
    cancelled: false,
    signal: controller.signal,
    update() {},
    throwIfCancelled() {
      if (task.cancelled) {
        const err = new Error('cancelled')
        err.name = 'TaskCancelledError'
        throw err
      }
    },
    cancel() {
      task.cancelled = true
      controller.abort()
    }
  }
  return task
}

function items(prefix, count) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.invalid/${prefix}/${i}.bin`,
    path: join(work, 'files', prefix, `${i}.bin`),
    size: FILE_BYTES
  }))
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'launcher.json'), JSON.stringify({ concurrentDownloads: LIMIT }))

  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `const path = ${JSON.stringify(userData)}
     module.exports = {
       app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] },
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/net.ts'))})`)

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

  const { downloadAll } = require(out)

  // --- 1. Two installs at once share one pool ---------------------------
  const a = items('a', 10)
  const b = items('b', 10)
  await Promise.all([downloadAll(a, { task: fakeTask() }), downloadAll(b, { task: fakeTask() })])
  check(started === 20, `20 Uebertragungen erwartet, ${started} gestartet`)
  check(maxOpen <= LIMIT, `hoechstens ${LIMIT} gleichzeitig erwartet, es waren ${maxOpen}`)
  check(maxOpen === LIMIT, `die Grenze sollte ausgeschoepft werden, es waren nur ${maxOpen}`)
  check([...a, ...b].every((item) => existsSync(item.path)), 'nicht alle Dateien liegen auf der Platte')
  console.log(`Zwei Installationen: ${started} Dateien, hoechstens ${maxOpen} gleichzeitig (Grenze ${LIMIT})`)

  // --- 2. A cancel while waiting for a slot gives nothing away ----------
  maxOpen = 0
  started = 0
  const busy = fakeTask()
  const waiting = fakeTask()
  const busyRun = downloadAll(items('c', 6), { task: busy })
  // Starts once the first batch holds every slot, then cancels in the queue.
  await new Promise((resolve) => setTimeout(resolve, 5))
  const waitingRun = downloadAll(items('d', 6), { task: waiting })
  await new Promise((resolve) => setTimeout(resolve, 5))
  waiting.cancel()
  const cancelled = await waitingRun.then(
    () => null,
    (err) => err
  )
  check(cancelled?.name === 'TaskCancelledError', `Abbruch in der Warteschlange erwartet, erhalten: ${cancelled}`)
  await busyRun
  console.log(`Abbruch in der Warteschlange: ${cancelled?.name ?? 'kein Fehler'}`)

  // --- 3. No slot leaked: a full batch still runs at the full limit -----
  maxOpen = 0
  started = 0
  const e = items('e', 9)
  await downloadAll(e, { task: fakeTask() })
  check(started === 9, `9 Uebertragungen erwartet, ${started} gestartet`)
  check(maxOpen === LIMIT, `nach dem Abbruch sollten wieder ${LIMIT} Plaetze frei sein, es waren ${maxOpen}`)
  console.log(`Danach: ${started} Dateien, ${maxOpen} gleichzeitig`)

  // --- 4. Cancel while another install downloads the same file ----------
  const shared = { url: 'https://example.invalid/slow/shared.bin', path: join(work, 'files', 'shared.bin'), size: FILE_BYTES }
  const owner = downloadAll([shared], { task: fakeTask() })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const waiter = fakeTask()
  const waiterRun = downloadAll([shared], { task: waiter })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const cancelAt = Date.now()
  waiter.cancel()
  const waiterErr = await waiterRun.then(
    () => null,
    (err) => err
  )
  const reactedMs = Date.now() - cancelAt
  check(waiterErr?.name === 'TaskCancelledError', `Abbruch beim Warten auf eine fremde Datei erwartet, erhalten: ${waiterErr}`)
  check(reactedMs < 500, `Abbruch sollte sofort greifen, dauerte ${reactedMs} ms`)
  await owner
  check(existsSync(shared.path), 'die gemeinsame Datei fehlt, obwohl die erste Installation weiterlief')
  console.log(`Abbruch beim Warten auf fremden Download: ${waiterErr?.name}, nach ${reactedMs} ms`)

  // --- 5. HTML instead of JSON gives a readable message ------------------
  const { fetchJson } = require(out)
  const htmlErr = await fetchJson('https://api.example.invalid/portal/data.json', undefined, 0).then(
    () => null,
    (err) => err
  )
  check(htmlErr && !/Unexpected token/.test(htmlErr.message), `lesbare Meldung erwartet, erhalten: ${htmlErr?.message}`)
  check(htmlErr && /api\.example\.invalid/.test(htmlErr.message), `Meldung sollte den Server nennen: ${htmlErr?.message}`)
  console.log(`HTML statt JSON: ${htmlErr?.message}`)
} catch (err) {
  problems.push(`Unerwarteter Fehler: ${err?.stack ?? err}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error('\nFEHLER:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\nAlles in Ordnung.')
