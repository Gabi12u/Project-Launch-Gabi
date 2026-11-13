/**
 * Prueft, dass ein gerade aus der Cloud geladenes Backup nicht sofort
 * wieder aufgeraeumt wird.
 *
 *   node scripts/test-cloud-download-prune.mjs
 *
 * Eine Instanz behaelt zwei Cloud-Kopien. Sortiert wurde nach dem Datum, an
 * dem die Sicherung urspruenglich entstand. Lud man eine aeltere Sicherung
 * in eine Instanz, die schon zwei neuere Cloud-Kopien hatte, wurde die neue
 * vor dem Einspielen weggeraeumt, und die Wiederherstellung meldete
 * "Sicherung nicht gefunden".
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-cloud-prune-'))

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
       backups: require(${JSON.stringify(join(root, 'src/main/core/backups.ts'))}),
       paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))}).paths
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
  const { backups, paths } = require(out)

  const id = 'wolke'
  mkdirSync(join(paths.gameDir(id), 'saves', 'Welt'), { recursive: true })
  writeFileSync(paths.instanceFile(id), JSON.stringify({ name: id, mcVersion: '1.21.1', loader: 'vanilla', installed: true }))
  writeFileSync(join(paths.gameDir(id), 'saves', 'Welt', 'level.dat'), 'welt')
  const base = await backups.createBackup(id, { includes: ['saves'] })
  const source = join(paths.instanceBackups(id), base.fileName)

  // Three cloud backups, each older than the one before, downloaded in turn.
  for (const createdAt of [3000, 2000, 1000]) {
    const download = join(work, `cloud-${createdAt}.zip`)
    copyFileSync(source, download)
    const entryAdded = await backups.addDownloadedBackup(id, download, { name: `Cloud ${createdAt}`, includes: ['saves'], createdAt })
    const listed = backups.listBackups(id).some((b) => b.id === entryAdded.id)
    const onDisk = existsSync(join(paths.instanceBackups(id), entryAdded.fileName))
    check(listed && onDisk, `Cloud-Backup vom ${createdAt}: in der Liste ${listed}, auf der Platte ${onDisk}`)
    if (listed) {
      try {
        await backups.restoreBackup(id, entryAdded.id)
      } catch (err) {
        problems.push(`Cloud-Backup vom ${createdAt} ließ sich nicht einspielen: ${err.message}`)
      }
    }
  }
  notes.push(`Nach drei Downloads: ${backups.listBackups(id).filter((b) => b.reason === 'cloud').length} Cloud-Kopien in der Liste.`)
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
