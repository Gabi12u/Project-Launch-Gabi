/**
 * Prueft, dass options.txt als Ganzes ersetzt wird.
 *
 *   node scripts/test-options-write.mjs
 *
 * Der Launcher passt options.txt an, wenn ein Ressourcenpaket einen neuen
 * Dateinamen bekommt, und bei jedem Start mit eigener Startseite. Bisher
 * wurde die Datei an Ort und Stelle neu geschrieben: Bei voller Platte oder
 * einem Absturz mittendrin blieb sie leer, mit allen Tastenbelegungen und
 * Grafikeinstellungen. Jetzt wird daneben geschrieben und dann getauscht.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-options-'))

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
  // Fails the rename that swaps the new file in, as a full disk or a locked
  // file would make the write fail.
  const fsShim = join(work, 'fs-shim.js')
  writeFileSync(
    fsShim,
    `const real = require('fs')
     module.exports = new Proxy(real, {
       get(target, prop, receiver) {
         if (prop === 'renameSync') {
           return (src, dest) => {
             if (globalThis.__lgFailSwap) { const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e }
             return target.renameSync(src, dest)
           }
         }
         return Reflect.get(target, prop, receiver)
       }
     })`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       packs: require(${JSON.stringify(join(root, 'src/main/core/packSelection.ts'))}),
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
    plugins: [
      {
        name: 'fs',
        setup(build) {
          build.onResolve({ filter: /^node:fs$/ }, () => ({ path: fsShim }))
        }
      }
    ],
    logLevel: 'error'
  })
  const { packs, paths } = require(out)

  const id = 'optionen'
  const gameDir = paths.gameDir(id)
  mkdirSync(gameDir, { recursive: true })
  const options = join(gameDir, 'options.txt')
  const original = ['version:3700', 'fov:0.5', 'key_key.jump:key.keyboard.space', 'resourcePacks:["vanilla","file/alt.zip"]', ''].join('\r\n')
  writeFileSync(options, original)

  // --- 1. A normal rename is written and leaves nothing behind -----------
  packs.renamePackSelection(id, 'resourcepack', 'alt.zip', 'neu.zip')
  const after = readFileSync(options, 'utf8')
  check(after.includes('"file/neu.zip"') && after.includes('key_key.jump:key.keyboard.space'), `Nach dem Umbenennen: ${after}`)
  check(after.includes('\r\n'), 'Die Zeilenenden wurden verändert')
  check(readdirSync(gameDir).length === 1, `Im Spielordner liegt: ${readdirSync(gameDir).join(', ')}`)

  // --- 2. A failed write leaves the old file whole -----------------------
  globalThis.__lgFailSwap = true
  packs.renamePackSelection(id, 'resourcepack', 'neu.zip', 'noch-neuer.zip')
  globalThis.__lgFailSwap = false
  const kept = readFileSync(options, 'utf8')
  check(kept === after, `Nach einem gescheiterten Schreiben: ${JSON.stringify(kept)}`)
  check(readdirSync(gameDir).length === 1, `Nach einem gescheiterten Schreiben liegt im Spielordner: ${readdirSync(gameDir).join(', ')}`)
  notes.push('options.txt: Umbenennen geschrieben, ein gescheitertes Schreiben lässt die alte Datei ganz.')
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
