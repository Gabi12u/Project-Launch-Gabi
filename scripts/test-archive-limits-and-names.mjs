/**
 * Prueft drei der Sicherheitsfunde aus dem Archiv-Durchlauf gegen echte
 * Dateien auf der Platte, nicht nur gegen eine Kopie der Logik:
 *
 *   node scripts/test-archive-limits-and-names.mjs
 *
 * 1. `readEntryJson`/`readEntryText` lasen eine Archiv-Metadatendatei bisher
 *    ohne jede Groessenpruefung ein. Ein winziges .mrpack, dessen
 *    modrinth.index.json auf viele MB aufblaeht, wurde komplett in den
 *    Speicher entpackt, bevor ueberhaupt jemand den Inhalt ansah.
 * 2. `extractSubtree` baute den Zielpfad nur mit `rel.includes('..')` als
 *    Schutz selbst zusammen. Ein Eintrag wie "mods/legit.jar:hidden.exe"
 *    schrieb damit einen NTFS Alternate Data Stream statt der Mod-Datei.
 * 3. `contentFileName` liess ':', reservierte Windows-Geraetenamen und einen
 *    Namen mit Punkt oder Leerzeichen am Ende durch.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-archive-limits-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const AdmZip = require('adm-zip')

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
  writeFileSync(
    entry,
    `module.exports = {
       archive: require(${JSON.stringify(join(root, 'src/main/core/archive.ts'))}),
       paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))})
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

  const { archive, paths } = require(out)

  // --- 1. A metadata entry that declares an absurd size is rejected ----

  const bombPack = join(work, 'bomb.mrpack')
  const zip1 = new AdmZip()
  // Highly repetitive text compresses to a tiny fraction of its real size,
  // exactly what let a 200 KB .mrpack declare a 200 MB modrinth.index.json in
  // the real finding this reproduces. 40 MB is comfortably past the 32 MB cap.
  const bombText = `{"formatVersion":1,"filler":"${'a'.repeat(40 * 1024 * 1024)}"}`
  zip1.addFile('modrinth.index.json', Buffer.from(bombText, 'utf8'))
  zip1.addFile('manifest.json', Buffer.from(JSON.stringify({ ok: true }), 'utf8'))
  zip1.writeZip(bombPack)
  notes.push(`bomb.mrpack: ${require('node:fs').statSync(bombPack).size} Bytes auf der Platte`)

  const bombResult = await archive.readEntryJson(bombPack, 'modrinth.index.json')
  check(bombResult === null, 'Ueberdimensioniertes modrinth.index.json wurde NICHT abgelehnt')
  if (bombResult === null) notes.push('40-MB-Metadateneintrag korrekt abgelehnt (readEntryJson -> null)')

  const legitResult = await archive.readEntryJson(bombPack, 'manifest.json')
  check(
    !!legitResult && legitResult.ok === true,
    'Normale kleine manifest.json im selben Archiv wurde faelschlich mit abgelehnt'
  )

  // --- 2. extractSubtree rejects a ':' entry instead of writing an ADS -

  const goodPack = join(work, 'good.zip')
  const zip2 = new AdmZip()
  zip2.addFile('overrides/config/settings.txt', Buffer.from('ok', 'utf8'))
  zip2.writeZip(goodPack)

  const goodDest = join(work, 'good-out')
  const count = archive.extractSubtree(goodPack, 'overrides', goodDest)
  check(count === 1, `Normaler extractSubtree-Lauf hat ${count} statt 1 Datei entpackt`)
  check(
    existsSync(join(goodDest, 'config', 'settings.txt')),
    'Normaler extractSubtree-Lauf hat die erwartete Datei nicht geschrieben'
  )

  const evilPack = join(work, 'evil.zip')
  const zip3 = new AdmZip()
  zip3.addFile('overrides/mods/legit.jar:hidden.exe', Buffer.from('boese', 'utf8'))
  zip3.writeZip(evilPack)

  const evilDest = join(work, 'evil-out')
  let evilThrew = false
  let evilMessage = ''
  try {
    archive.extractSubtree(evilPack, 'overrides', evilDest)
  } catch (err) {
    evilThrew = true
    evilMessage = String(err?.message ?? err)
  }
  check(evilThrew, '":"-Eintrag in extractSubtree wurde NICHT abgelehnt, haette werfen muessen')
  if (evilThrew) notes.push(`":"-Eintrag korrekt abgelehnt: ${evilMessage}`)

  // Nothing with a literal ':' in its name may exist anywhere under evilDest,
  // whether extractSubtree threw before writing or partway through.
  const leaked = existsSync(evilDest) ? readdirSync(evilDest, { recursive: true }) : []
  check(
    !leaked.some((p) => String(p).includes(':')) && !existsSync(`${join(evilDest, 'mods', 'legit.jar')}:hidden.exe`),
    'Trotz Ablehnung liegt eine Datei mit ":" im Namen auf der Platte'
  )

  // --- 3. contentFileName rejects the dangerous shapes, keeps the rest -

  const rejected = ['a.jar:x', 'CON.jar', 'x.jar ']
  for (const name of rejected) {
    let threw = false
    try {
      paths.contentFileName(name)
    } catch {
      threw = true
    }
    check(threw, `contentFileName("${name}") wurde NICHT abgelehnt`)
  }

  const accepted = ['sodium-fabric-0.5.8.jar', 'Xaeros_Minimap_24.4.0_Fabric_1.21.jar', 'my-datapack.zip']
  for (const name of accepted) {
    let result = null
    let threw = false
    try {
      result = paths.contentFileName(name)
    } catch {
      threw = true
    }
    check(!threw && result === name, `contentFileName("${name}") wurde faelschlich abgelehnt oder veraendert`)
  }
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
