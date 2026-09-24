/**
 * Prueft zwei Reparaturen an archive.ts mit echten Dateien auf der Platte:
 *
 *   node scripts/test-backup-symlinks-and-filter.mjs
 *
 * 1. `zipFolder()`s walk folgte bisher jeder Verknuepfung mit `statSync`. Eine
 *    Verknuepfung, die aus dem gesicherten Ordner heraus zeigt, oder eine, die
 *    einen Kreis bildet, konnte die Sicherung entweder kaputt machen oder den
 *    Vorgang endlos rekursieren lassen. `walk()` benutzt jetzt `lstatSync` und
 *    ueberspringt Verknuepfungen, statt ihnen zu folgen, und meldet sie ueber
 *    `onSkipLink`.
 * 2. `extractAllSlowly()` hatte keinen Filter: eine Wiederherstellung entpackte
 *    das ganze Archiv, auch wenn nur bestimmte Ordner geschuetzt werden
 *    sollten. Ein optionales Set von obersten Ordnernamen schraenkt das jetzt
 *    ein.
 *
 * Verknuepfungen auf Ordner brauchen unter Windows normalerweise Adminrechte;
 * der Test benutzt deshalb den Typ 'junction', der das nicht braucht. Schlaegt
 * das trotzdem fehl (z. B. wegen Dateisystem-Einschraenkungen), wird dieser
 * Teil mit einem Hinweis uebersprungen statt den ganzen Testlauf scheitern zu
 * lassen.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-backup-symlinks-'))

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

  const { zipFolder, listEntries, extractAllSlowly } = require(out)

  // Layout: <work>/instance/gameDir/{saves,config}, plus a sibling
  // <work>/outside with a file that must never end up in the archive.
  const gameDir = join(work, 'instance', 'gameDir')
  mkdirSync(join(gameDir, 'saves'), { recursive: true })
  writeFileSync(join(gameDir, 'saves', 'world.dat'), 'echtes Weltspeicher-Substitut')
  mkdirSync(join(gameDir, 'config'), { recursive: true })
  writeFileSync(join(gameDir, 'config', 'options.txt'), 'echte Konfiguration')

  const outsideDir = join(work, 'outside')
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(join(outsideDir, 'secret.txt'), 'darf nicht in die Sicherung')

  // --- Part 1: a symlink pointing outside sourceDir is skipped, not packed --

  const linkPath = join(gameDir, 'saves', 'linked-elsewhere')
  let junctionCreated = false
  try {
    symlinkSync(outsideDir, linkPath, 'junction')
    junctionCreated = true
  } catch (err) {
    notes.push(
      `Verknuepfung (junction) konnte nicht angelegt werden, dieser Teil wird uebersprungen: ${err?.message ?? err}`
    )
  }

  const skipped = []
  const skippedLinks = []
  const zipPath = join(work, 'backup.zip')
  await zipFolder(gameDir, zipPath, {
    include: ['saves', 'config'],
    onSkip: (file, error) => skipped.push({ file, error }),
    onSkipLink: (file) => skippedLinks.push(file)
  })

  const entries = listEntries(zipPath).map((e) => e.name)
  check(
    entries.some((n) => n.includes('world.dat')),
    'Echte Datei saves/world.dat fehlt im Archiv'
  )
  check(
    entries.some((n) => n.includes('options.txt')),
    'Echte Datei config/options.txt fehlt im Archiv'
  )
  check(
    skipped.length === 0,
    `Es wurden unerwartet Dateien als unlesbar gemeldet: ${JSON.stringify(skipped)}`
  )
  notes.push(`Archiv enthaelt ${entries.length} Eintrag/Eintraege ohne die Verknuepfung.`)

  if (junctionCreated) {
    check(
      !entries.some((n) => n.includes('linked-elsewhere') || n.includes('secret.txt')),
      'Die Verknuepfung oder ihr Ziel wurden trotzdem ins Archiv gepackt'
    )
    check(skippedLinks.length === 1, `onSkipLink wurde ${skippedLinks.length} mal statt einmal aufgerufen`)
    if (skippedLinks.length === 1) {
      notes.push(`Verknuepfung korrekt uebersprungen und gemeldet: ${skippedLinks[0]}`)
    }
  } else {
    notes.push('Verknuepfungs-Pruefung ausgelassen, siehe Hinweis oben.')
  }

  // A symlink cycle (a junction pointing back at its own ancestor) must not
  // recurse forever now that walk() never follows one. Only meaningful if
  // junctions work at all on this machine.
  if (junctionCreated) {
    const cycleDir = join(work, 'cycle-instance', 'gameDir')
    mkdirSync(join(cycleDir, 'saves'), { recursive: true })
    writeFileSync(join(cycleDir, 'saves', 'world.dat'), 'noch ein Weltspeicher-Substitut')
    try {
      symlinkSync(cycleDir, join(cycleDir, 'saves', 'back-to-self'), 'junction')
      const cycleZip = join(work, 'cycle.zip')
      const start = Date.now()
      await zipFolder(cycleDir, cycleZip, { include: ['saves'] })
      notes.push(`Verknuepfungs-Kreis lief durch in ${Date.now() - start} ms, statt endlos zu rekursieren.`)
    } catch (err) {
      problems.push(`Verknuepfungs-Kreis hat zipFolder() zum Absturz gebracht: ${err?.stack ?? err}`)
    }
  }

  // --- Part 2: extractAllSlowly() with a filter only writes allowed folders -

  const fullTarget = join(work, 'extract-full')
  await extractAllSlowly(zipPath, fullTarget)
  check(
    existsSync(join(fullTarget, 'saves', 'world.dat')) && existsSync(join(fullTarget, 'config', 'options.txt')),
    'Ohne Filter haette extractAllSlowly() beide Ordner entpacken muessen'
  )
  notes.push('Ohne Filter: beide Ordner wurden wie zuvor entpackt (Verhalten unveraendert).')

  const filteredTarget = join(work, 'extract-filtered')
  await extractAllSlowly(zipPath, filteredTarget, undefined, undefined, new Set(['saves']))
  check(
    existsSync(join(filteredTarget, 'saves', 'world.dat')),
    'Mit Filter ["saves"] fehlt saves/world.dat im Ziel'
  )
  check(
    !existsSync(join(filteredTarget, 'config')),
    'Mit Filter ["saves"] wurde der Ordner config trotzdem entpackt'
  )
  notes.push('Mit Filter ["saves"]: nur saves wurde entpackt, config blieb aussen vor.')
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
