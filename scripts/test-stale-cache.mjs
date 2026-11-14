/**
 * Prueft, dass eine Verbindung ohne Antwort nicht minutenlang aufhaelt, wenn
 * ein aelterer gespeicherter Stand bereitliegt.
 *
 *   node scripts/test-stale-cache.mjs
 *
 * Frueher versuchte `fetchJsonCached` es viermal mit je einer Minute
 * Wartezeit, bevor es auf den gespeicherten Stand zurueckgriff, zusammen rund
 * vier Minuten. Kein Netz noetig: `fetch` wird durch eine Attrappe ersetzt,
 * die je nach Fall antwortet, sofort scheitert oder nie antwortet.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-stale-'))

const problems = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const DEADLINE = 600

let mode = 'answer'
let calls = 0
globalThis.fetch = async (_url, init = {}) => {
  calls++
  if (mode === 'answer') {
    return new Response(JSON.stringify({ versions: ['neu'] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (mode === 'refuse') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
  // Takes the connection and never answers, like a hanging line. Only the
  // abort signal ends it, as with real fetch.
  return new Promise((_resolve, reject) => {
    const signal = init.signal
    if (signal?.aborted) reject(signal.reason)
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

// AbortSignal.timeout does not keep Node alive on its own. In the launcher
// the app does; here this does, until the end.
const keepAlive = setInterval(() => {}, 1000)

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  const data = join(work, 'data')
  mkdirSync(userData, { recursive: true })
  mkdirSync(join(data, 'meta'), { recursive: true })
  writeFileSync(join(userData, 'launcher.json'), JSON.stringify({ dataDirectory: data }))

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
    define: { 'process.env.LG_STALE_CACHE_DEADLINE_MS': JSON.stringify(String(DEADLINE)) },
    logLevel: 'error'
  })

  const { fetchJsonCached } = require(out)
  const cacheFile = join(data, 'meta', 'liste.json')
  const valid = (d) => Array.isArray(d?.versions)
  const writeCache = (ageMs, versions) =>
    writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now() - ageMs, data: { versions } }))
  const DAY = 86_400_000

  // --- 1. A fresh copy is used without asking the network ---------------
  writeCache(1000, ['frisch'])
  mode = 'hang'
  calls = 0
  let result = await fetchJsonCached('https://example.invalid/liste.json', 'liste', DAY, valid)
  check(result.versions[0] === 'frisch' && calls === 0, `Frischer Stand: ${JSON.stringify(result)}, ${calls} Abfragen`)

  // --- 2. An old copy and a hanging line: the copy, and quickly ----------
  writeCache(2 * DAY, ['alt'])
  calls = 0
  let started = Date.now()
  result = await fetchJsonCached('https://example.invalid/liste.json', 'liste', DAY, valid)
  let took = Date.now() - started
  check(result.versions[0] === 'alt', `Haengende Leitung mit altem Stand: ${JSON.stringify(result)}`)
  check(calls >= 1, 'Die Leitung wurde gar nicht erst gefragt')
  check(took >= DEADLINE - 50 && took < DEADLINE + 1500, `Haengende Leitung brauchte ${took} ms, erwartet rund ${DEADLINE}`)
  console.log(`Haengende Leitung mit altem Stand: nach ${took} ms auf den alten Stand zurueckgegriffen (${calls} Abfrage)`)

  // --- 3. An old copy and a working line: the new data, saved -----------
  mode = 'answer'
  result = await fetchJsonCached('https://example.invalid/liste.json', 'liste', DAY, valid)
  check(result.versions[0] === 'neu', `Funktionierende Leitung: ${JSON.stringify(result)}`)
  const saved = JSON.parse(readFileSync(cacheFile, 'utf8'))
  check(saved.data.versions[0] === 'neu' && Date.now() - saved.fetchedAt < 60_000, 'Die neuen Daten wurden nicht gespeichert')

  // --- 4. No copy at all: an honest error, not a cancel -------------------
  rmSync(cacheFile)
  mode = 'refuse'
  let failure = null
  try {
    await fetchJsonCached('https://example.invalid/liste.json', 'liste', DAY, valid)
  } catch (err) {
    failure = err
  }
  check(failure && /Verbindung|connection/.test(failure.message), `Ohne Stand und ohne Netz: ${failure?.message ?? 'kein Fehler'}`)
  check(!existsSync(cacheFile), 'Ohne Antwort wurde trotzdem etwas gespeichert')
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
  clearInterval(keepAlive)
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // a locked temp folder is no test failure
  }
}

if (problems.length) {
  console.log('\nPROBLEME:')
  for (const p of problems) console.log(`  - ${p}`)
  console.log('\nERGEBNIS: FEHLGESCHLAGEN')
  process.exit(1)
}
console.log('\nERGEBNIS: BESTANDEN')
