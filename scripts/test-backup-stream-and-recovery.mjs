/**
 * Prueft zwei Reparaturen rund um Sicherungen, mit echten Dateien auf der Platte:
 *
 *   node scripts/test-backup-stream-and-recovery.mjs
 *
 * 1. `zipFolder()` in archive.ts baute frueher das ganze Archiv im Speicher auf
 *    (jede Datei per `readFile`, am Ende `zip.toBuffer()`), was bei einer
 *    mehrere Gigabyte grossen Welt den Launcher einfrieren oder abstuerzen
 *    lassen konnte. Es packt jetzt per `yazl` direkt von der Platte in eine
 *    Zwischendatei und benennt sie erst beim Erfolg um. Dieser Test packt einen
 *    Ordner mit ein paar kleinen Dateien und einer rund 50 MB grossen Datei und
 *    prueft, dass `adm-zip` (die Bibliothek, mit der ueberall sonst in diesem
 *    Projekt entpackt wird) das Ergebnis vollstaendig und unveraendert liest.
 * 2. Eine Wiederherstellung raeumt die vorhandenen Ordner beiseite, bevor sie
 *    das Archiv entpackt (siehe backups.ts). Stirbt der Prozess dazwischen,
 *    blieben die beiseite geraeumten Ordner bisher unbemerkt liegen. Es wird
 *    jetzt vorher ein Journal geschrieben, und `recoverInterruptedRestores()`
 *    macht eine so unterbrochene Wiederherstellung beim naechsten Start
 *    rueckgaengig. Dieser Test baut genau die Ordnerlage nach, die eine
 *    abgestuerzte Wiederherstellung hinterlassen wuerde, und prueft, dass der
 *    urspruengliche Stand danach wieder da ist.
 * 3. `recoverOneInterruptedRestore` raeumte den halb entpackten Ordner frueher
 *    per `rmSync` weg, bevor der geparkte Originalordner zurueckbenannt wurde.
 *    Schlug genau dieses Zurueckbenennen fehl, war der halb entpackte Rest
 *    schon geloescht und nichts kam zurueck. Jetzt wird er nur beiseite
 *    geschoben und erst nach Erfolg entfernt. Ein `fs`-Ersatz laesst genau
 *    dieses eine Zurueckbenennen fehlschlagen, ohne echte Dateirechte zu
 *    manipulieren, und prueft, dass danach beides noch da ist: der halb
 *    entpackte Rest (zurueckgeschoben statt verloren) und die geparkte
 *    Originalsicherung (nie angefasst).
 */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-backup-stream-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
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

  // `backups.ts` reaches, through `instances.ts`, most of the main process
  // (loaders, mojang metadata, content). None of that is exercised by the one
  // function this test calls, but it all has to *load* under the shim above,
  // the same way it does when the real app starts.
  const entryArchive = join(work, 'entry-archive.js')
  writeFileSync(entryArchive, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/archive.ts'))})`)
  const entryBackups = join(work, 'entry-backups.js')
  writeFileSync(entryBackups, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/backups.ts'))})`)

  // Used only by part 3 below, to make exactly one `renameSync` call fail
  // (via `globalThis.__lgFailRenameTo`) without touching real file permissions,
  // which differ too much between machines to rely on for a repeatable test.
  // Everything else passes straight through to the real `fs`.
  const fsShim = join(work, 'fs-shim.js')
  writeFileSync(
    fsShim,
    `const real = require('fs')
     module.exports = new Proxy(real, {
       get(target, prop, receiver) {
         if (prop === 'renameSync') {
           return function renameSync(src, dest) {
             if (globalThis.__lgFailRenameTo && dest === globalThis.__lgFailRenameTo) {
               globalThis.__lgFailRenameTo = null
               const err = new Error('Simulierter Fehler fuer den Test')
               err.code = 'EPERM'
               throw err
             }
             return target.renameSync(src, dest)
           }
         }
         return Reflect.get(target, prop, receiver)
       }
     })`
  )
  // esbuild's `alias` also rewrites subpath imports of an aliased specifier
  // (`node:fs/promises` starts with `node:fs`), which would otherwise resolve
  // to `fs-shim.js/promises` and fail. Instances.ts et al. use the promise API
  // too, so it needs its own pass-through alias back to the real module.
  const fsPromisesShim = join(work, 'fs-promises-shim.js')
  writeFileSync(fsPromisesShim, `module.exports = require('fs/promises')`)

  const outArchive = join(work, 'archive.cjs')
  const outBackups = join(work, 'backups.cjs')
  const buildOptions = {
    bundle: true,
    format: 'cjs',
    platform: 'node',
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    logLevel: 'error'
  }
  await esbuild.build({ ...buildOptions, entryPoints: [entryArchive], outfile: outArchive })
  // `backups.ts` imports from 'node:fs' specifically; only that exact
  // specifier is redirected, so the shim (which itself requires plain 'fs')
  // cannot alias into itself.
  await esbuild.build({
    ...buildOptions,
    alias: { ...buildOptions.alias, 'node:fs': fsShim, 'node:fs/promises': fsPromisesShim },
    entryPoints: [entryBackups],
    outfile: outBackups
  })

  const { zipFolder, extractAllSlowly, listEntries } = require(outArchive)
  const { recoverInterruptedRestores, failedRestoreRecoveries } = require(outBackups)

  /* ================================================================ *
   * Part 1: streaming zipFolder() with a large file
   * ================================================================ */

  const sourceDir = join(work, 'zip-source')
  mkdirSync(join(sourceDir, 'saves'), { recursive: true })
  writeFileSync(join(sourceDir, 'saves', 'level.dat'), 'ein kleines Weltspeicher-Substitut')
  mkdirSync(join(sourceDir, 'config'), { recursive: true })
  writeFileSync(join(sourceDir, 'config', 'options.txt'), 'echte Konfiguration')

  // ~50 MB, written in chunks rather than one big Buffer.alloc/readFile call,
  // the same way the streaming zipFolder() itself never holds it all at once.
  const bigFile = join(sourceDir, 'saves', 'region-big.mca')
  const chunk = Buffer.alloc(1024 * 1024)
  for (let i = 0; i < chunk.length; i++) chunk[i] = i % 256
  {
    const { openSync, writeSync, closeSync } = await import('node:fs')
    const fd = openSync(bigFile, 'w')
    try {
      for (let i = 0; i < 50; i++) {
        // Slightly different per chunk so a shuffled or truncated result
        // would not accidentally still match.
        chunk[0] = i
        writeSync(fd, chunk)
      }
    } finally {
      closeSync(fd)
    }
  }
  const originalHash = sha256(bigFile)
  const originalSize = readFileSync(bigFile).length

  const zipPath = join(work, 'stream.zip')
  const skipped = []
  const count = await zipFolder(sourceDir, zipPath, {
    include: ['saves', 'config'],
    onSkip: (file, error) => skipped.push({ file, error })
  })

  check(existsSync(zipPath), 'zipFolder() hat keine Zieldatei erzeugt')
  check(skipped.length === 0, `Unerwartet uebersprungene Dateien: ${JSON.stringify(skipped)}`)
  check(count === 3, `zipFolder() meldet ${count} Dateien statt 3`)
  notes.push(`zipFolder() hat ${count} Dateien gepackt, Archivgroesse ${(readFileSync(zipPath).length / 1024 / 1024).toFixed(1)} MB.`)

  const entries = listEntries(zipPath)
  check(entries.length === 3, `adm-zip listet ${entries.length} Eintraege statt 3`)
  const bigEntry = entries.find((e) => e.name.endsWith('region-big.mca'))
  check(Boolean(bigEntry), 'Die grosse Datei fehlt im Archiv laut adm-zip')
  check(
    bigEntry != null && bigEntry.size === originalSize,
    `adm-zip meldet Groesse ${bigEntry?.size} statt ${originalSize} fuer die grosse Datei`
  )

  const extractDir = join(work, 'stream-extract')
  await extractAllSlowly(zipPath, extractDir)
  const extractedBig = join(extractDir, 'saves', 'region-big.mca')
  check(existsSync(extractedBig), 'Die grosse Datei wurde nicht entpackt')
  if (existsSync(extractedBig)) {
    const extractedHash = sha256(extractedBig)
    check(extractedHash === originalHash, 'Inhalt der grossen Datei stimmt nach Packen/Entpacken nicht ueberein')
    notes.push('Grosse Datei (~50 MB): Inhalt nach Packen und Entpacken durch adm-zip identisch (SHA-256).')
  }
  check(
    existsSync(join(extractDir, 'saves', 'level.dat')) && existsSync(join(extractDir, 'config', 'options.txt')),
    'Die kleinen Dateien fehlen nach dem Entpacken'
  )

  /* ================================================================ *
   * Part 2: recoverInterruptedRestores() undoes a crashed restore
   * ================================================================ */

  const instanceId = 'test-instance'
  const dataDir = join(userData, 'data')
  const gameDir = join(dataDir, 'instances', instanceId, 'minecraft')
  const backupsDir = join(dataDir, 'backups', instanceId)
  const staging = join(backupsDir, 'restore-crashtest')

  // The parked original, exactly as a real restore would have left it after
  // successfully renaming `saves` aside but before extraction finished.
  mkdirSync(join(staging, 'saves'), { recursive: true })
  writeFileSync(join(staging, 'saves', 'world.dat'), 'URSPRUENGLICHER WELTSTAND')

  // The half written extraction target sitting where the original used to be.
  mkdirSync(join(gameDir, 'saves'), { recursive: true })
  writeFileSync(join(gameDir, 'saves', 'world.dat'), 'HALB ENTPACKTER MUELL')
  writeFileSync(join(gameDir, 'saves', 'partial-region.mca'), 'nur teilweise geschrieben')

  // `config` never existed before this restore, so the journal lists it as a
  // new key; the interrupted extraction already created some of it.
  mkdirSync(join(gameDir, 'config'), { recursive: true })
  writeFileSync(join(gameDir, 'config', 'options.txt'), 'von der abgebrochenen Wiederherstellung angelegt')

  writeFileSync(
    join(staging, 'journal.json'),
    JSON.stringify({
      moved: [{ key: 'saves', from: join(gameDir, 'saves'), to: join(staging, 'saves') }],
      newKeys: ['config']
    })
  )

  check(existsSync(staging), 'Testaufbau fehlgeschlagen: Staging-Ordner fehlt vor dem Aufruf')

  recoverInterruptedRestores()

  check(
    existsSync(join(gameDir, 'saves', 'world.dat')) &&
      readFileSync(join(gameDir, 'saves', 'world.dat'), 'utf8') === 'URSPRUENGLICHER WELTSTAND',
    'saves/world.dat ist nach recoverInterruptedRestores() nicht der urspruengliche Stand'
  )
  check(
    !existsSync(join(gameDir, 'saves', 'partial-region.mca')),
    'Der halb entpackte Rest in saves/ wurde nicht entfernt'
  )
  check(!existsSync(join(gameDir, 'config')), 'Der neu angelegte config-Ordner wurde nicht entfernt')
  check(!existsSync(staging), 'Der Staging-Ordner wurde nicht aufgeraeumt')
  notes.push('recoverInterruptedRestores(): urspruenglicher Weltstand zurueckgeholt, Reste und Staging-Ordner entfernt.')

  // A second call with nothing left to recover must be a harmless no-op.
  recoverInterruptedRestores()
  check(existsSync(join(gameDir, 'saves', 'world.dat')), 'Ein zweiter Aufruf ohne Staging-Ordner hat etwas kaputt gemacht')
  notes.push('Zweiter Aufruf ohne unterbrochene Wiederherstellung: keine Wirkung, kein Fehler.')

  /* ================================================================ *
   * Part 3: a failed rename-back during recovery must not lose data
   * ================================================================ */

  const instanceId2 = 'test-instance-renamefail'
  const gameDir2 = join(dataDir, 'instances', instanceId2, 'minecraft')
  const backupsDir2 = join(dataDir, 'backups', instanceId2)
  const staging2 = join(backupsDir2, 'restore-crashtest')

  // The parked original, never to be touched by this scenario.
  mkdirSync(join(staging2, 'saves'), { recursive: true })
  writeFileSync(join(staging2, 'saves', 'world.dat'), 'URSPRUENGLICHER WELTSTAND 2')

  // The half written extraction target, exactly as part 2's, sitting where
  // the original used to be.
  mkdirSync(join(gameDir2, 'saves'), { recursive: true })
  writeFileSync(join(gameDir2, 'saves', 'world.dat'), 'HALB ENTPACKTER MUELL 2')

  writeFileSync(
    join(staging2, 'journal.json'),
    JSON.stringify({
      moved: [{ key: 'saves', from: join(gameDir2, 'saves'), to: join(staging2, 'saves') }],
      newKeys: []
    })
  )

  // Makes the rename that would put the parked original back fail exactly
  // once, the same way a locked file or a denied permission would on a real
  // machine, without needing either.
  globalThis.__lgFailRenameTo = join(gameDir2, 'saves')

  const result3 = recoverInterruptedRestores()
  globalThis.__lgFailRenameTo = null

  check(
    !result3.includes(instanceId2),
    'recoverInterruptedRestores() meldet die fehlgeschlagene Instanz faelschlich als erledigt'
  )
  check(
    existsSync(join(gameDir2, 'saves', 'world.dat')) &&
      readFileSync(join(gameDir2, 'saves', 'world.dat'), 'utf8') === 'HALB ENTPACKTER MUELL 2',
    'Der halb entpackte Rest wurde nach dem fehlgeschlagenen Zurueckbenennen nicht zurueckgeschoben'
  )
  check(
    existsSync(join(staging2, 'saves', 'world.dat')) &&
      readFileSync(join(staging2, 'saves', 'world.dat'), 'utf8') === 'URSPRUENGLICHER WELTSTAND 2',
    'Die geparkte Originalsicherung wurde beim fehlgeschlagenen Versuch angetastet'
  )
  check(existsSync(join(staging2, 'journal.json')), 'Das Journal wurde trotz fehlgeschlagener Wiederherstellung entfernt')
  check(
    failedRestoreRecoveries().some((f) => f.instanceId === instanceId2 && f.staging === staging2),
    'failedRestoreRecoveries() meldet die fehlgeschlagene Wiederherstellung nicht'
  )
  notes.push(
    'Fehlgeschlagenes Zurueckbenennen beim Wiederherstellen: weder der halb entpackte Rest noch die ' +
      'geparkte Originalsicherung gingen verloren, und die fehlgeschlagene Instanz wird gemeldet.'
  )
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
