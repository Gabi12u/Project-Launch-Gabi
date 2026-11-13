/**
 * Prueft das Kopieren beim Import eines Ordners aus einem anderen Launcher.
 *
 *   node scripts/test-folder-import-copy.mjs
 *
 * 1. Eine Ordnerverknuepfung (Junction) auf einen eigenen Oberordner wurde
 *    immer wieder verfolgt, und der Baum kam etwa zwanzigfach an.
 * 2. Schreibgeschuetzte Dateien blieben nach dem Import schreibgeschuetzt.
 * 3. Aus einem echten .minecraft kamen die Java-Laufzeiten und die
 *    Konto-Datei des offiziellen Launchers mit.
 */
import { execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-folder-import-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

/** Every file below `dir`, without following links twice. */
function countFiles(dir) {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) count += countFiles(full)
    else count++
  }
  return count
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
  const out = join(work, 'bundle.cjs')
  const target = join(root, 'src/main/core/instanceFolder.ts')
  await esbuild.build({
    stdin: { contents: `module.exports = require(${JSON.stringify(target)})`, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    plugins: [
      {
        // copyGameFiles is internal; handed out for this test only.
        name: 'expose',
        setup(build) {
          build.onLoad({ filter: /instanceFolder\.ts$/ }, (args) => ({
            contents: `${readFileSync(args.path, 'utf8')}\nexport { copyGameFiles }`,
            loader: 'ts'
          }))
        }
      }
    ],
    logLevel: 'error'
  })
  const { copyGameFiles } = require(out)

  // A .minecraft-like folder.
  const source = join(work, 'quelle')
  mkdirSync(join(source, 'saves', 'Welt'), { recursive: true })
  mkdirSync(join(source, 'mods'), { recursive: true })
  mkdirSync(join(source, 'runtime', 'java-runtime-gamma'), { recursive: true })
  writeFileSync(join(source, 'saves', 'Welt', 'level.dat'), 'welt')
  writeFileSync(join(source, 'mods', 'mod.jar'), 'mod')
  writeFileSync(join(source, 'options.txt'), 'fov:70')
  writeFileSync(join(source, 'runtime', 'java-runtime-gamma', 'java.exe'), 'java')
  writeFileSync(join(source, 'launcher_accounts.json'), '{"accounts":{"geheim":{}}}')
  writeFileSync(join(source, 'launcher_profiles.json'), '{}')
  chmodSync(join(source, 'options.txt'), 0o444)
  let junction = false
  if (process.platform === 'win32') {
    try {
      execSync(`cmd /c mklink /J "${join(source, 'saves', 'schleife')}" "${source}"`, { stdio: 'ignore' })
      junction = true
    } catch {
      notes.push('Junction ließ sich nicht anlegen, dieser Teil entfällt.')
    }
  }

  const dest = join(work, 'ziel')
  const result = await copyGameFiles(source, dest)
  const copied = countFiles(dest)

  // --- 1. The loop is entered at most once ------------------------------
  if (junction) {
    check(copied <= 3, `Junction-Schleife: ${copied} Dateien kopiert statt 3`)
    notes.push(`Junction-Schleife: ${copied} Dateien kopiert, ${result.skippedLinks} Verknüpfung(en) übersprungen.`)
  }
  // --- 2. Read-only becomes writable ------------------------------------
  const options = join(dest, 'options.txt')
  check(existsSync(options) && (statSync(options).mode & 0o200) !== 0, 'options.txt ist nach dem Import schreibgeschützt')
  // --- 3. The official launcher's own files stay behind -----------------
  check(!existsSync(join(dest, 'launcher_accounts.json')), 'Die Konto-Datei des offiziellen Launchers wurde mitkopiert')
  check(!existsSync(join(dest, 'runtime')), 'Die Java-Laufzeiten des offiziellen Launchers wurden mitkopiert')
  check(existsSync(join(dest, 'saves', 'Welt', 'level.dat')) && existsSync(join(dest, 'mods', 'mod.jar')), 'Welt oder Mod fehlen')

  chmodSync(join(source, 'options.txt'), 0o644)
  try {
    chmodSync(options, 0o644)
  } catch {
    // already writable or gone
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
process.exit(problems.length === 0 ? 0 : 1)
