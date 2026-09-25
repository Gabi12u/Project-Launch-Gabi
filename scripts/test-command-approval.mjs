/**
 * Tests the pure parts of commandApproval.ts without touching Electron for
 * real: the javaPath validation that rejects anything but an absolute, local
 * java/javaw path, and the key derivation that decides whether a wrapper or
 * pre-launch command counts as "already approved".
 *
 *   node scripts/test-command-approval.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-command-approval-'))

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
    `const path = ${JSON.stringify(userData)}
     module.exports = {
       app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       dialog: { showMessageBox: async () => ({ response: 1 }) },
       shell: {}, BrowserWindow: class { static getAllWindows() { return [] } },
       ipcMain: { handle() {}, on() {} },
       safeStorage: { isEncryptionAvailable: () => false },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}, nativeTheme: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = require(${JSON.stringify(join(root, 'src/main/core/commandApproval.ts'))})`
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

  const { validateJavaPath, isValidJavaPath, approvalKey, isApproved } = require(out)

  /* ------------------------------------------------------------------ *
   * javaPath validation
   * ------------------------------------------------------------------ */
  for (const p of [
    'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe',
    'C:\\jdk\\bin\\JAVA.EXE'
  ]) {
    check(isValidJavaPath(p), `Erwartungsgemaess gueltiger Pfad wurde abgelehnt: ${p}`)
  }

  const invalid = [
    ['relative/java.exe', 'relativer Pfad'],
    ['\\\\server\\share\\java.exe', 'UNC-Pfad (Backslash)'],
    ['//server/share/java.exe', 'UNC-aehnlicher Pfad (Slash)'],
    ['C:\\Program Files\\Java\\jdk-21\\bin\\notepad.exe', 'falscher Dateiname'],
    ['C:\\Windows\\System32\\cmd.exe', 'komplett anderes Programm']
  ]
  for (const [p, label] of invalid) {
    check(!isValidJavaPath(p), `Sollte abgelehnt werden (${label}), wurde aber akzeptiert: ${p}`)
    let threw = false
    try {
      validateJavaPath(p)
    } catch {
      threw = true
    }
    check(threw, `validateJavaPath wirft nicht fuer (${label}): ${p}`)
  }
  notes.push('javaPath-Validierung: absolute lokale Pfade auf java/javaw akzeptiert (Gross-/Kleinschreibung egal), alles andere abgelehnt.')

  /* ------------------------------------------------------------------ *
   * Key derivation
   * ------------------------------------------------------------------ */
  const base = approvalKey('instance-1', 'wrapper', 'C:\\tools\\wrapper.exe --flag')
  check(base === approvalKey('instance-1', 'wrapper', 'C:\\tools\\wrapper.exe --flag'), 'Gleicher Wert liefert unterschiedliche Schluessel')
  check(base !== approvalKey('instance-2', 'wrapper', 'C:\\tools\\wrapper.exe --flag'), 'Unterschiedliche Instanz liefert denselben Schluessel')
  check(base !== approvalKey('instance-1', 'preLaunch', 'C:\\tools\\wrapper.exe --flag'), 'Unterschiedliche Art (kind) liefert denselben Schluessel')
  check(base !== approvalKey('instance-1', 'wrapper', 'C:\\tools\\wrapper.exe --other-flag'), 'Ein geaenderter Befehl liefert denselben Schluessel')
  // Whitespace at the edges must not change what gets approved: ensureApproved trims before hashing too.
  check(base === approvalKey('instance-1', 'wrapper', '  C:\\tools\\wrapper.exe --flag  '), 'Fuehrende/folgende Leerzeichen aendern den Schluessel')
  notes.push('Schluesselableitung: Instanz, Art und Wert fliessen alle ein, Leerzeichen am Rand werden ignoriert.')

  /* ------------------------------------------------------------------ *
   * isApproved reads only, never prompts, never writes.
   * ------------------------------------------------------------------ */
  check(
    isApproved('instance-1', 'wrapper', 'C:\\tools\\wrapper.exe --flag') === false,
    'Ein nie gespeicherter Wert gilt faelschlich als genehmigt'
  )
  check(isApproved('instance-1', 'wrapper', '') === true, 'Ein leerer Wert sollte nichts zu genehmigen haben')
  notes.push('isApproved liest nur aus der (hier leeren) Genehmigungsdatei, zeigt nie einen Dialog.')
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
