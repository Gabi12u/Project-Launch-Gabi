/**
 * Prueft die Umstellung von der alten auf die eigene Microsoft-Anwendungs-ID.
 *
 * Drei Faelle gegen die echte sanitize()-Funktion aus src/main/store.ts,
 * jeweils mit einer frisch geschriebenen launcher.json in einem Temp-Ordner:
 *
 *   1. Frisch installiert (keine Datei): bekommt die neue eigene ID.
 *   2. Bestehende Installation mit der alten Anwendungs-ID: wird umgestellt.
 *   3. Bestehende Installation mit einer selbst gewaehlten ID: bleibt unangetastet.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-clientid-'))

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

  /* 1. Frische Installation, keine launcher.json vorhanden */
  {
    const userData = freshUserData()
    mkdirSync(userData, { recursive: true })
    const { getSettings } = buildFor(userData)
    const settings = getSettings()
    check(
      settings.microsoftClientId === 'ddf22ce8-a28e-4da9-bd5f-f723e77140ce',
      `Frisch: microsoftClientId ist "${settings.microsoftClientId}", erwartet die eigene ID`
    )
    notes.push(`Frische Installation: microsoftClientId = ${settings.microsoftClientId}`)
  }

  /* 2. Bestehende Installation mit der alten Anwendung */
  {
    const userData = freshUserData()
    mkdirSync(userData, { recursive: true })
    writeFileSync(
      join(userData, 'launcher.json'),
      JSON.stringify({ microsoftClientId: '00000000402b5328', onboarded: true })
    )
    const { getSettings } = buildFor(userData)
    const settings = getSettings()
    check(
      settings.microsoftClientId === 'ddf22ce8-a28e-4da9-bd5f-f723e77140ce',
      `Alte ID: microsoftClientId ist "${settings.microsoftClientId}", erwartet die Umstellung auf die eigene ID`
    )
    check(settings.onboarded === true, 'Alte ID: andere Einstellungen sind verloren gegangen')
    notes.push(`Bestand mit alter ID: wurde umgestellt auf ${settings.microsoftClientId}`)
  }

  /* 3. Bestehende Installation mit einer selbst gesetzten ID */
  {
    const userData = freshUserData()
    mkdirSync(userData, { recursive: true })
    writeFileSync(
      join(userData, 'launcher.json'),
      JSON.stringify({ microsoftClientId: 'eigene-test-id-von-hand' })
    )
    const { getSettings } = buildFor(userData)
    const settings = getSettings()
    check(
      settings.microsoftClientId === 'eigene-test-id-von-hand',
      `Eigene ID: wurde ueberschrieben, steht jetzt auf "${settings.microsoftClientId}"`
    )
    notes.push(`Bestand mit selbst gesetzter ID: unangetastet (${settings.microsoftClientId})`)
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
