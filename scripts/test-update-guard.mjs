/**
 * Prueft, dass "Jetzt suchen" ein bereits fertiges Update nicht mehr
 * verdeckt, indem es die echte Absicherung in checkForUpdates() umgeht.
 *
 *   node scripts/test-update-guard.mjs
 *
 * Vorher galt die Absicherung gegen das erneute Ueberschreiben eines
 * fertigen Updates nur fuer die automatische Hintergrundpruefung, keyed auf
 * `!manual`. Der Knopf in den Einstellungen ruft dieselbe Funktion mit
 * `manual = true` auf und ging deshalb daran vorbei.
 *
 * Treibt den echten Ablauf durch initUpdater() bis zum Zustand "ready",
 * dann wird "Jetzt suchen" simuliert. Das zaehlt echte Aufrufe von
 * autoUpdater.checkForUpdates(), statt nur den Code zu lesen.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-update-guard-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

async function waitFor(label, condition, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  problems.push(`Zeitueberschreitung: ${label}`)
  return false
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })

  const handlers = new Map()
  let checkForUpdatesCalls = 0

  const updaterShimSrc = `
    const handlers = new Map()
    module.exports = {
      autoUpdater: {
        logger: null,
        autoDownload: true,
        autoInstallOnAppQuit: false,
        on(event, fn) { handlers.set(event, fn) },
        // Stands in for a check that immediately finds and finishes
        // downloading an update: fires 'update-downloaded' straight away,
        // exactly like the real library does once a transfer completes.
        checkForUpdates: async () => {
          global.__checkForUpdatesCalls = (global.__checkForUpdatesCalls || 0) + 1
          const handler = handlers.get('update-downloaded')
          if (handler) handler({ version: '9.9.9' })
        },
        downloadUpdate: async () => {},
        quitAndInstall: () => {}
      }
    }
  `
  const updaterShim = join(work, 'electron-updater-shim.js')
  writeFileSync(updaterShim, updaterShimSrc)

  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `const path = ${JSON.stringify(userData)}
     module.exports = {
       app: { getPath: () => path, getVersion: () => '1.0.17', isPackaged: true, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: class {},
       ipcMain: { handle() {}, on() {} },
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
    logLevel: 'error'
  })

  const { initUpdater, checkForUpdates, getUpdateStatus, saveSettings } = require(out)

  // Keeps the flow on the plain "ready, waiting for restart" branch instead
  // of the immediate-install-from-cache one, which would land on
  // 'installing' instead and test nothing relevant here.
  saveSettings({ autoInstallUpdates: false })

  initUpdater()

  const reachedReady = await waitFor(
    'Update erreicht den Zustand "ready" ueber den echten Ablauf',
    () => getUpdateStatus().state === 'ready'
  )

  if (reachedReady) {
    notes.push(`Zustand vor dem manuellen Klick: "${getUpdateStatus().state}"`)
    const callsBefore = global.__checkForUpdatesCalls || 0

    // The button in Settings calls exactly this, with manual = true (its
    // default).
    await checkForUpdates(true)

    const callsAfter = global.__checkForUpdatesCalls || 0
    check(
      callsAfter === callsBefore,
      `"Jetzt suchen" hat autoUpdater.checkForUpdates() erneut aufgerufen (${callsBefore} -> ${callsAfter}), ` +
        'das haette der Schutz verhindern muessen'
    )
    check(
      getUpdateStatus().state === 'ready',
      `Zustand nach "Jetzt suchen" ist "${getUpdateStatus().state}" statt weiter "ready"`
    )
    notes.push(`Zustand nach dem manuellen Klick: "${getUpdateStatus().state}", unveraendert wie erwartet.`)
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
