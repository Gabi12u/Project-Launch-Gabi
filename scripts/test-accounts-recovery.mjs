/**
 * Prueft zwei Faelle rund um die gespeicherten Accounts, nur mit
 * erfundenen Konten in einem Testordner.
 *
 *   node scripts/test-accounts-recovery.mjs
 *
 * 1. Eine beschaedigte accounts.json wurde beiseitegelegt, und der Launcher
 *    machte ohne Accounts weiter. Jetzt kommt der letzte geschriebene Stand
 *    zurueck. Ein entferntes Konto darf in der Kopie nicht weiterleben.
 * 2. Ein Klick auf ein gerade entferntes Konto machte das erste Konto der
 *    Datei aktiv, statt das aktive zu lassen.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-accounts-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })
  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `module.exports = {
       app: { getPath: () => ${JSON.stringify(userData)}, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       store: require(${JSON.stringify(join(root, 'src/main/store.ts'))}),
       auth: require(${JSON.stringify(join(root, 'src/main/auth/microsoft.ts'))})
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
  const { store, auth } = require(out)

  const account = (id, name, active) => ({ id, type: 'offline', username: name, uuid: `${id}-uuid`, active })
  const file = join(userData, 'accounts.json')

  // --- 1. Damaged file, the last write comes back -----------------------
  store.writeAccounts([account('a', 'Alpha', true), account('b', 'Beta', false), account('c', 'Gamma', false)])
  store.writeAccounts([account('a', 'Alpha', true), account('c', 'Gamma', false)])
  check(!readFileSync(`${file}.previous`, 'utf8').includes('Beta'), 'Das entfernte Konto steht noch in der Kopie')
  writeFileSync(file, '[{"id":"a", "username": "Alp')
  const recovered = store.readAccounts()
  check(recovered.map((a) => a.id).join(',') === 'a,c', `Nach einer beschädigten Datei: ${JSON.stringify(recovered.map((a) => a.id))}`)
  check(existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).length === 2, 'Die wiederhergestellten Accounts wurden nicht zurückgeschrieben')
  notes.push(`Beschädigte accounts.json: ${recovered.length} Accounts aus der Kopie zurück, das entfernte Konto nicht.`)

  // --- 2. Choosing an account that is gone leaves the active one ---------
  store.writeAccounts([account('a', 'Alpha', false), account('b', 'Beta', true)])
  auth.setActiveAccount('weg')
  const active = store.readAccounts().filter((a) => a.active).map((a) => a.id)
  check(active.join(',') === 'b', `Nach dem Klick auf ein entferntes Konto ist aktiv: ${JSON.stringify(active)}`)
  auth.setActiveAccount('a')
  const switched = store.readAccounts().filter((a) => a.active).map((a) => a.id)
  check(switched.join(',') === 'a', `Normales Umschalten: aktiv ist ${JSON.stringify(switched)}`)
  notes.push('Ein entferntes Konto zu wählen lässt das aktive Konto stehen, normales Umschalten geht weiter.')
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
