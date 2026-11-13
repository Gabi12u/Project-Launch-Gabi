/**
 * Prueft, dass das Ende des Beta-Programms den Updater mitnimmt.
 *
 *   node scripts/test-beta-leave-updater.mjs
 *
 * Wer das Beta-Programm verliess, waehrend schon eine Beta als Update
 * angeboten oder heruntergeladen war, bekam sie weiter angeboten und konnte
 * sie bis zum Neustart installieren. Der echte Updater laeuft hier gegen
 * Nachbildungen von electron-updater und dem Beta-Modul: Die Beta-Quelle
 * bietet 9.9.9-beta.1 an, GitHub nichts Neueres als die laufende Version.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-beta-leave-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

// GitHub's manifest: nothing newer than the running version.
globalThis.fetch = async () => new Response('version: 1.0.25\n', { status: 200 })

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })

  // electron-updater: the beta feed offers a beta, the normal one nothing.
  const updaterShim = join(work, 'electron-updater-shim.js')
  writeFileSync(
    updaterShim,
    `const handlers = new Map()
     const autoUpdater = {
       logger: null, autoDownload: false, autoInstallOnAppQuit: false, channel: null,
       requestHeaders: null, allowDowngrade: false, allowPrerelease: false, disableDifferentialDownload: false,
       on(event, fn) { handlers.set(event, fn) },
       setFeedURL(options) { globalThis.__feedUrl = options.url ?? options.provider },
       checkForUpdates: async () => {
         globalThis.__checks = (globalThis.__checks || 0) + 1
         if (globalThis.__hold) await globalThis.__hold
         if (autoUpdater.channel === 'beta') handlers.get('update-available')({ version: '9.9.9-beta.1' })
         else handlers.get('update-not-available')({ version: '1.0.25' })
       },
       downloadUpdate: async () => {},
       quitAndInstall: () => { globalThis.__installed = true }
     }
     globalThis.__updaterHandlers = handlers
     module.exports = { autoUpdater }`
  )
  // The beta module: in the programme until the test ends it.
  const betaShim = join(work, 'beta-shim.js')
  writeFileSync(
    betaShim,
    `const listeners = []
     globalThis.__betaIn = true
     globalThis.__endBeta = () => { globalThis.__betaIn = false; for (const l of listeners) l() }
     module.exports = {
       betaFeed: async () => (globalThis.__betaIn ? { version: '9.9.9-beta.1', url: 'https://admin.example.invalid/beta', token: 't' } : null),
       channelFile: (channel) => channel + '.yml',
       onBetaEnded: (listener) => listeners.push(listener)
     }`
  )
  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `module.exports = {
       app: { getPath: () => ${JSON.stringify(userData)}, getVersion: () => '1.0.25', isPackaged: true, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       ...require(${JSON.stringify(join(root, 'src/main/core/updater.ts'))}),
       ...require(${JSON.stringify(join(root, 'src/main/store.ts'))})
     }`
  )
  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim, 'electron-updater': updaterShim },
    plugins: [
      {
        name: 'beta-shim',
        setup(build) {
          build.onResolve({ filter: /^\.\/beta$/ }, () => ({ path: betaShim }))
        }
      }
    ],
    logLevel: 'error'
  })
  const { initUpdater, checkForUpdates, getUpdateStatus, saveSettings, installUpdate } = require(out)
  saveSettings({ autoUpdate: false, autoInstallUpdates: false })
  initUpdater()

  // --- 1. Offered, then the programme ends ------------------------------
  await checkForUpdates(false)
  await settle()
  check(getUpdateStatus().state === 'available' && getUpdateStatus().version === '9.9.9-beta.1', `Vorher: ${JSON.stringify(getUpdateStatus())}`)
  globalThis.__endBeta()
  await settle()
  check(getUpdateStatus().version !== '9.9.9-beta.1', `Nach dem Verlassen wird die Beta weiter angeboten: ${JSON.stringify(getUpdateStatus())}`)
  check(globalThis.__feedUrl === 'github', `Nach dem Verlassen zeigt der Updater auf ${globalThis.__feedUrl}`)
  notes.push(`Angebotene Beta, dann verlassen: Zustand „${getUpdateStatus().state}“, Quelle ${globalThis.__feedUrl}.`)

  // --- 2. Downloaded and ready, then the programme ends -----------------
  globalThis.__betaIn = true
  await checkForUpdates(false)
  await settle()
  globalThis.__updaterHandlers.get('update-downloaded')({ version: '9.9.9-beta.1' })
  check(getUpdateStatus().state === 'ready', `Vorher nicht bereit: ${JSON.stringify(getUpdateStatus())}`)
  globalThis.__endBeta()
  await settle()
  check(getUpdateStatus().state !== 'ready', `Nach dem Verlassen wartet die Beta weiter auf den Neustart: ${JSON.stringify(getUpdateStatus())}`)
  installUpdate()
  check(!globalThis.__installed, 'Nach dem Verlassen wurde die Beta trotzdem installiert')

  // --- 3. Still downloading when the programme ends ---------------------
  globalThis.__betaIn = true
  await checkForUpdates(false)
  await settle()
  globalThis.__updaterHandlers.get('download-progress')({ percent: 40, bytesPerSecond: 1 })
  check(getUpdateStatus().state === 'downloading', `Vorher kein Download: ${JSON.stringify(getUpdateStatus())}`)
  globalThis.__endBeta()
  await settle()
  globalThis.__updaterHandlers.get('update-downloaded')({ version: '9.9.9-beta.1' })
  check(getUpdateStatus().state !== 'ready', `Ein nach dem Verlassen fertiger Beta-Download wartet auf den Neustart: ${JSON.stringify(getUpdateStatus())}`)
  notes.push('Ein laufender Beta-Download wird nach dem Verlassen verworfen.')

  // --- 4. Joining while a check runs: one more check follows -------------
  let release
  globalThis.__hold = new Promise((resolve) => (release = resolve))
  const before = globalThis.__checks
  const running = checkForUpdates(false)
  await settle()
  globalThis.__betaIn = true
  await checkForUpdates(false)
  globalThis.__hold = null
  release()
  await running
  await settle()
  check(globalThis.__checks === before + 2, `Eine Suche während einer laufenden wurde nicht nachgeholt: ${globalThis.__checks - before} statt 2`)
  check(getUpdateStatus().version === '9.9.9-beta.1', `Nach dem Beitritt während einer Suche: ${JSON.stringify(getUpdateStatus())}`)
  notes.push('Beitritt während einer laufenden Suche: die Beta erscheint gleich danach.')
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
process.exit(problems.length === 0 ? 0 : 1)
