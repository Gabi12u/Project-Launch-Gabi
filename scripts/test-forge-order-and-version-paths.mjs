/**
 * Prueft zwei Reparaturen gegen echte Daten:
 *
 *   node scripts/test-forge-order-and-version-paths.mjs
 *
 * 1. Die Forge-Versionsliste ist wirklich neueste zuerst sortiert. Forges
 *    maven-metadata.xml ist nicht durchgehend in einer Richtung sortiert, der
 *    Launcher drehte die Rohreihenfolge nur um. Braucht Internet.
 * 2. `paths.version()` weist Versions-IDs zurueck, die aus dem versions-Ordner
 *    ausbrechen, laesst echte Mojang-IDs mit Leerzeichen aber durch.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-forge-order-'))

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
  writeFileSync(
    entry,
    `module.exports = {
       forge: require(${JSON.stringify(join(root, 'src/main/loaders/forge.ts'))}),
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

  const { forge, paths } = require(out)

  // --- 1. Forge order --------------------------------------------------
  // Ids come back as "47.4.23", older ones sometimes as "1.12.2-14.23.5.2864".
  const numbers = (v) => {
    const parts = String(v).split('-')
    const forgePart = parts.length > 1 && parts[0].startsWith('1.') ? parts[1] : parts[0]
    return forgePart.split('.').map((n) => Number(n) || 0)
  }
  const cmp = (a, b) => {
    const pa = numbers(a)
    const pb = numbers(b)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0)
    }
    return 0
  }

  for (const mc of ['1.20.1', '1.12.2']) {
    const list = await forge.listForgeLikeVersions('forge', mc)
    const ids = list.map((v) => (typeof v === 'string' ? v : v.id ?? v.version))
    check(ids.length > 20, `Forge ${mc}: nur ${ids.length} Versionen`)
    let bad = -1
    for (let i = 1; i < ids.length; i++) {
      if (cmp(ids[i - 1], ids[i]) > 0) {
        bad = i
        break
      }
    }
    check(bad === -1, `Forge ${mc}: nicht sortiert an Stelle ${bad} (${ids[bad - 1]} vor ${ids[bad]})`)
    notes.push(`Forge ${mc}: ${ids.length} Versionen, erste ${ids[0]}, letzte ${ids[ids.length - 1]}`)
  }

  // --- 2. Version paths ------------------------------------------------
  for (const good of ['1.21.11', '1.14 Pre-Release 1', '24w14a', 'fabric-loader-0.16.9-1.21.1']) {
    let ok = true
    try {
      paths.paths.version(good)
    } catch {
      ok = false
    }
    check(ok, `Gueltige ID "${good}" wurde abgelehnt`)
  }
  for (const evil of ['..', '../x', '..\\..\\x', 'a/../../b']) {
    let threw = false
    try {
      paths.paths.version(evil)
    } catch {
      threw = true
    }
    check(threw, `Ausbrechende ID "${evil}" wurde NICHT abgelehnt`)
  }
  check(paths.isValidVersionString('1.20.1') && !paths.isValidVersionString('../1.20.1'), 'isValidVersionString falsch')
  notes.push('Versionspfade: gueltige IDs durch, ausbrechende abgelehnt.')
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
