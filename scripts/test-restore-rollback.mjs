/**
 * Prueft das Zurueckdrehen einer gescheiterten Wiederherstellung und den
 * Umgang mit leeren Sicherungen, mit echten Dateien auf der Platte:
 *
 *   node scripts/test-restore-rollback.mjs
 *
 * 1. Scheiterte beim Einspielen einer Sicherung das Beiseitelegen eines
 *    Ordners (unter Windows reicht ein Explorer-Fenster darin), loeschte das
 *    Zurueckdrehen genau die Originalordner, die es schuetzen sollte: Es hielt
 *    alles, was nicht beiseitegelegt war, fuer neu hinzugekommen. Ein
 *    `fs`-Ersatz laesst das Beiseitelegen von saves fehlschlagen, danach
 *    muessen saves und config unveraendert da sein.
 * 2. Eine Instanz mit leerem saves-Ordner ergab eine leere Sicherung, die als
 *    Erfolg galt. Jetzt kommt `NothingToBackUpError`, und es bleibt keine
 *    Datei liegen.
 * 3. Der Abbruch durch den Nutzer kommt als `TaskCancelledError` an, wenn
 *    alles zurueckgedreht werden konnte, nicht als Fehlermeldung.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-restore-rollback-'))

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

  // Fails exactly the renames `globalThis.__lgFailRename` picks, everything
  // else goes straight to the real `fs`.
  const fsShim = join(work, 'fs-shim.js')
  writeFileSync(
    fsShim,
    `const real = require('fs')
     module.exports = new Proxy(real, {
       get(target, prop, receiver) {
         if (prop === 'renameSync') {
           return function renameSync(src, dest) {
             if (globalThis.__lgFailRename && globalThis.__lgFailRename(String(src), String(dest))) {
               const err = new Error('Simulierte Sperre fuer den Test')
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
  const fsPromisesShim = join(work, 'fs-promises-shim.js')
  writeFileSync(fsPromisesShim, `module.exports = require('fs/promises')`)

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       backups: require(${JSON.stringify(join(root, 'src/main/core/backups.ts'))}),
       paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))}),
       tasks: require(${JSON.stringify(join(root, 'src/main/tasks.ts'))})
     }`
  )
  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: {
      '@shared': join(root, 'src/shared'),
      electron: shim,
      'node:fs': fsShim,
      'node:fs/promises': fsPromisesShim
    },
    logLevel: 'error'
  })

  const { backups, paths, tasks } = require(out)

  function makeInstance(id) {
    mkdirSync(paths.paths.instance(id), { recursive: true })
    writeFileSync(
      paths.paths.instanceFile(id),
      JSON.stringify({ name: id, mcVersion: '1.21.1', loader: 'vanilla', installed: true })
    )
    const gameDir = paths.paths.gameDir(id)
    mkdirSync(gameDir, { recursive: true })
    return gameDir
  }

  // Both before the first call: the instance list is read once and cached.
  const gameDir = makeInstance('rollback')
  const emptyDir = makeInstance('leer')

  // --- 1. A failed rename must not delete the originals ----------------
  mkdirSync(join(gameDir, 'saves', 'Welt'), { recursive: true })
  mkdirSync(join(gameDir, 'config'), { recursive: true })
  writeFileSync(join(gameDir, 'saves', 'Welt', 'level.dat'), 'STAND DER SICHERUNG')
  writeFileSync(join(gameDir, 'config', 'options.txt'), 'KONFIG DER SICHERUNG')

  const backup = await backups.createBackup('rollback', { includes: ['saves', 'config'] })
  check(Boolean(backup?.id), 'Sicherung wurde nicht angelegt')

  writeFileSync(join(gameDir, 'saves', 'Welt', 'level.dat'), 'AKTUELLER STAND')
  writeFileSync(join(gameDir, 'config', 'options.txt'), 'AKTUELLE KONFIG')

  // Setting saves aside into the staging folder fails, as with Explorer open in it.
  globalThis.__lgFailRename = (src, dest) => /restore-[^\\/]+[\\/]saves$/.test(dest)
  let message = ''
  try {
    await backups.restoreBackup('rollback', backup.id)
    problems.push('Wiederherstellung meldete Erfolg trotz gesperrtem Ordner')
  } catch (err) {
    message = err instanceof Error ? err.message : String(err)
  } finally {
    globalThis.__lgFailRename = null
  }
  notes.push(`Meldung: ${message.slice(0, 140)}`)

  const savesFile = join(gameDir, 'saves', 'Welt', 'level.dat')
  const configFile = join(gameDir, 'config', 'options.txt')
  check(existsSync(savesFile), 'saves wurde beim Zurueckdrehen geloescht')
  check(existsSync(configFile), 'config wurde beim Zurueckdrehen geloescht')
  if (existsSync(savesFile)) check(readFileSync(savesFile, 'utf8') === 'AKTUELLER STAND', 'saves hat nicht mehr den aktuellen Stand')
  if (existsSync(configFile)) check(readFileSync(configFile, 'utf8') === 'AKTUELLE KONFIG', 'config hat nicht mehr den aktuellen Stand')
  check(/zurückgeholt|brought back/.test(message), 'Meldung sagt nicht, dass der vorherige Stand zurueck ist')

  // --- 2. An empty backup is refused, nothing stays behind --------------
  mkdirSync(join(emptyDir, 'saves'), { recursive: true })
  let emptyError = null
  try {
    await backups.createBackup('leer', { includes: ['saves'], reason: 'automatic' })
  } catch (err) {
    emptyError = err
  }
  check(emptyError instanceof backups.NothingToBackUpError, `Leere Sicherung: ${emptyError ? emptyError.message : 'kein Fehler'}`)
  const emptyBackupDir = paths.paths.instanceBackups('leer')
  const leftovers = existsSync(emptyBackupDir) ? readdirSync(emptyBackupDir).filter((f) => f.endsWith('.zip')) : []
  check(leftovers.length === 0, `Leere Sicherung hinterliess ${leftovers.length} Datei(en)`)
  check(backups.listBackups('leer').length === 0, 'Leere Sicherung steht in der Liste')

  // --- 3. A cancel that was fully rolled back stays a cancel ------------
  writeFileSync(join(gameDir, 'saves', 'Welt', 'level.dat'), 'VOR DEM ABBRUCH')
  let cancelError = null
  const running = backups.restoreBackup('rollback', backup.id).catch((err) => {
    cancelError = err
  })
  // Cancel as soon as the restore task shows up.
  for (let i = 0; i < 200 && !cancelError; i++) {
    const task = tasks.listTasks().find((t) => t.instanceId === 'rollback' && t.state === 'running')
    if (task) {
      tasks.cancelTask(task.id)
      break
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  await running
  if (cancelError) {
    notes.push(`Abbruch: ${cancelError.name}: ${cancelError.message.slice(0, 100)}`)
    check(
      cancelError instanceof tasks.TaskCancelledError || /abgebrochen|cancelled/i.test(cancelError.message),
      `Abbruch kam als Fehler an: ${cancelError.message}`
    )
  } else {
    notes.push('Wiederherstellung war fertig, bevor der Abbruch ankam (kein Fehler, Test 3 ohne Aussage)')
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
