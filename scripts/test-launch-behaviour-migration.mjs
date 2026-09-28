/**
 * Prueft die einmalige Umstellung des Startverhaltens von "keep" auf "hide".
 *
 * Gegen die echte getSettings()-Funktion aus src/main/store.ts, jeweils mit
 * einer frisch geschriebenen launcher.json in einem Temp-Ordner.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-behaviour-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

function freshUserData() {
  const dir = mkdtempSync(join(work, 'user-'))
  return dir
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  function buildFor(userData) {
    const shim = join(work, `shim-${Math.random().toString(36).slice(2)}.js`)
    writeFileSync(
      shim,
      `const path = ${JSON.stringify(userData)}
       module.exports = {
         app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
         safeStorage: { isEncryptionAvailable: () => false },
         shell: {}, dialog: {}, BrowserWindow: class {},
         ipcMain: { handle() {}, on() {} },
         desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
       }`
    )
    const entry = join(work, `entry-${Math.random().toString(36).slice(2)}.js`)
    writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/store.ts'))})`)
    const out = join(work, `bundle-${Math.random().toString(36).slice(2)}.cjs`)
    esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: out,
      alias: { '@shared': join(root, 'src/shared'), electron: shim },
      logLevel: 'error'
    })
    return require(out)
  }

  /* 1. Frische Installation: neuer Standard, nichts umzustellen */
  {
    const userData = freshUserData()
    const { getSettings, takeInstanceBehaviourMigration } = buildFor(userData)
    const settings = getSettings()
    check(settings.launchBehaviour === 'hide', `Frisch: launchBehaviour ist "${settings.launchBehaviour}", erwartet hide`)
    check(takeInstanceBehaviourMigration() === false, 'Frisch: Instanzen sollten nicht umgestellt werden')
    notes.push(`Frische Installation: launchBehaviour = ${settings.launchBehaviour}`)
  }

  /* 2. Bestand mit dem alten Standard "keep": wird einmal umgestellt */
  {
    const userData = freshUserData()
    const file = join(userData, 'launcher.json')
    writeFileSync(file, JSON.stringify({ launchBehaviour: 'keep', onboarded: true }))
    const { getSettings, takeInstanceBehaviourMigration } = buildFor(userData)
    const settings = getSettings()
    check(settings.launchBehaviour === 'hide', `Alt keep: steht auf "${settings.launchBehaviour}", erwartet hide`)
    check(settings.onboarded === true, 'Alt keep: andere Einstellungen sind verloren gegangen')
    check(takeInstanceBehaviourMigration() === true, 'Alt keep: Instanzen wurden nicht zur Umstellung vorgemerkt')
    check(takeInstanceBehaviourMigration() === false, 'Alt keep: Vormerkung wurde nicht zurueckgesetzt')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    check(saved.launchBehaviourDefaultApplied === true && saved.launchBehaviour === 'hide', 'Alt keep: Umstellung wurde nicht gespeichert')
    notes.push(`Bestand mit keep: umgestellt auf ${settings.launchBehaviour}`)
  }

  /* 3. Nach der Umstellung bewusst wieder "keep" gewaehlt: bleibt so */
  {
    const userData = freshUserData()
    writeFileSync(
      join(userData, 'launcher.json'),
      JSON.stringify({ launchBehaviour: 'keep', launchBehaviourDefaultApplied: true })
    )
    const { getSettings, takeInstanceBehaviourMigration } = buildFor(userData)
    const settings = getSettings()
    check(settings.launchBehaviour === 'keep', `Bewusst keep: wurde ueberschrieben zu "${settings.launchBehaviour}"`)
    check(takeInstanceBehaviourMigration() === false, 'Bewusst keep: Instanzen sollten nicht umgestellt werden')
    notes.push(`Bewusst gewaehltes keep: unangetastet (${settings.launchBehaviour})`)
  }

  /* 4. Bestand mit "minimieren": Wahl bleibt, nur die Markierung kommt dazu */
  {
    const userData = freshUserData()
    writeFileSync(join(userData, 'launcher.json'), JSON.stringify({ launchBehaviour: 'close' }))
    const { getSettings } = buildFor(userData)
    const settings = getSettings()
    check(settings.launchBehaviour === 'close', `Alt close: wurde geaendert zu "${settings.launchBehaviour}"`)
    notes.push(`Bestand mit close: unangetastet (${settings.launchBehaviour})`)
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
