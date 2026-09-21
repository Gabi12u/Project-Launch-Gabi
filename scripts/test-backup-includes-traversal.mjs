/**
 * Prueft, dass die Ordnerliste beim Packen einer Sicherung nicht mehr aus
 * dem Instanzordner ausbrechen kann.
 *
 *   node scripts/test-backup-includes-traversal.mjs
 *
 * `zipFolder()`s `include`-Liste wurde bisher mit einem rohen `join()` an
 * `sourceDir` gehaengt. Ein Eintrag mit "../"-Anteilen liess sich damit auf
 * einen beliebigen Ordner ausserhalb der Instanz richten, der dann mit in
 * die Sicherung gepackt wurde. `createBackupUnlocked`/`restoreBackupUnlocked`
 * in backups.ts filtern die Liste inzwischen zusaetzlich auf die sechs
 * bekannten Ordnernamen; dieser Test prueft die tiefere, gemeinsame Stelle
 * in `zipFolder()` selbst direkt, mit echten Dateien auf der Platte, nicht
 * nur gegen eine Kopie der Logik.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-backup-traversal-'))

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
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] },
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/archive.ts'))})`)

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

  const { zipFolder, listEntries } = require(out)

  // Layout: <work>/instance/<gameDir with 'saves'> and, as a sibling outside
  // the instance entirely, <work>/secret/credentials.txt — standing in for
  // anything a real attacker would actually want out of a user's machine.
  const gameDir = join(work, 'instance', 'gameDir')
  mkdirSync(join(gameDir, 'saves'), { recursive: true })
  writeFileSync(join(gameDir, 'saves', 'world.dat'), 'ein echtes Weltspeicher-Bytes-Substitut')

  const secretDir = join(work, 'secret')
  mkdirSync(secretDir, { recursive: true })
  writeFileSync(join(secretDir, 'credentials.txt'), 'geheim, darf nicht in die Sicherung')

  // --- Part 1: a legitimate include still works -----------------------

  const legit = join(work, 'legit.zip')
  await zipFolder(gameDir, legit, { include: ['saves'] })
  const legitEntries = listEntries(legit).map((e) => e.name)
  check(
    legitEntries.some((n) => n.includes('world.dat')),
    'Legitimer include ("saves") hat die erwartete Datei nicht gepackt'
  )
  notes.push(`Normaler Fall: ${legitEntries.length} Eintrag/Einträge gepackt, world.dat dabei.`)

  // --- Part 2: a traversal attempt is rejected, not silently packed ----

  const relative = join('..', '..', 'secret')
  const evilZip = join(work, 'evil.zip')
  let traversalThrew = false
  let traversalMessage = ''
  try {
    await zipFolder(gameDir, evilZip, { include: [relative] })
  } catch (err) {
    traversalThrew = true
    traversalMessage = String(err?.message ?? err)
  }
  check(traversalThrew, `include: ["${relative}"] wurde NICHT abgelehnt, hätte werfen müssen`)
  if (traversalThrew) {
    notes.push(`Traversal-Versuch korrekt abgelehnt: ${traversalMessage}`)
  }

  // Absolute path escape, the other classic form.
  const evilZip2 = join(work, 'evil2.zip')
  let absoluteThrew = false
  try {
    await zipFolder(gameDir, evilZip2, { include: [secretDir] })
  } catch (err) {
    absoluteThrew = true
    notes.push(`Absoluter-Pfad-Versuch korrekt abgelehnt: ${err?.message ?? err}`)
  }
  check(absoluteThrew, `include: ["${secretDir}"] (absoluter Pfad) wurde NICHT abgelehnt`)
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
