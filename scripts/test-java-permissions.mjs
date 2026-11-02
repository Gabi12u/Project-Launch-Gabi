/**
 * Prueft, dass ein altes, vom Launcher geladenes Java seine Ausfuehrrechte
 * zurueckbekommt:
 *
 *   node scripts/test-java-permissions.mjs
 *
 * Vor 1.0.25 blieb beim Entpacken nur bin/java ausfuehrbar. lib/jspawnhelper
 * nicht, und dann scheiterte unter macOS und Linux alles, was aus dem Spiel
 * heraus ein anderes Programm startet ("posix_spawn failed, error: 13").
 *
 * Windows kennt diese Rechte nicht. Das Dateisystem ist deshalb nachgebildet
 * und das Betriebssystem auf Linux gestellt; geprueft wird, welche Dateien mit
 * welchem Modus nachgebessert werden.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-java-perm-'))
const problems = []
const check = (ok, message) => {
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
       safeStorage: { isEncryptionAvailable: () => false }, shell: {}, dialog: {},
       BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} }, Notification: class {}, net: {}
     }`
  )
  // The real fs, with stat and chmod answered from a table for files below
  // the fake runtime; everything else goes to the disk as usual.
  const fsShim = join(work, 'fs-shim.js')
  writeFileSync(
    fsShim,
    `const real = require('fs')
     const fake = () => globalThis.__lgModes
     const own = (p) => fake() && Object.prototype.hasOwnProperty.call(fake(), String(p))
     module.exports = {
       ...real,
       statSync: (p, o) => own(p) ? { isFile: () => true, mode: 0o100000 | fake()[String(p)] } : real.statSync(p, o),
       chmodSync: (p, m) => { if (own(p)) { globalThis.__lgChmod.push([String(p), m]); fake()[String(p)] = m; return } return real.chmodSync(p, m) },
       readdirSync: (p, o) => globalThis.__lgDirs && globalThis.__lgDirs[String(p)] ? globalThis.__lgDirs[String(p)] : real.readdirSync(p, o)
     }`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = { java: require(${JSON.stringify(join(root, 'src/main/core/java.ts'))}), paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))}) }`
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
        // Exactly `node:fs`: an alias would also catch `node:fs/promises`.
        name: 'fake-fs',
        setup(build) {
          build.onResolve({ filter: /^node:fs$/ }, (args) => (args.importer === fsShim ? undefined : { path: fsShim }))
        }
      }
    ],
    logLevel: 'error'
  })

  const { java, paths } = require(out)
  const managed = paths.paths.java()
  const home = join(managed, 'temurin-21', 'jdk-21.0.12+8-jre')
  const exe = join(home, 'bin', 'java')
  const helper = join(home, 'lib', 'jspawnhelper')
  const keytool = join(home, 'bin', 'keytool')

  Object.defineProperty(process, 'platform', { value: 'linux' })
  globalThis.__lgChmod = []
  globalThis.__lgDirs = { [join(home, 'bin')]: ['java', 'keytool'] }
  // As a launcher before 1.0.25 left it: java runs, the rest does not.
  globalThis.__lgModes = { [exe]: 0o755, [helper]: 0o644, [keytool]: 0o644 }

  java.mendManagedRuntime(exe)
  const changed = new Map(globalThis.__lgChmod)
  check(changed.get(helper) === 0o755, `jspawnhelper: ${changed.get(helper)?.toString(8)} statt 755`)
  check(changed.get(keytool) === 0o755, `keytool: ${changed.get(keytool)?.toString(8)} statt 755`)
  check(!changed.has(exe), 'bin/java wurde angefasst, obwohl es schon ausführbar war')

  // A second start changes nothing.
  globalThis.__lgChmod = []
  java.mendManagedRuntime(exe)
  check(globalThis.__lgChmod.length === 0, `Beim zweiten Start erneut geändert: ${JSON.stringify(globalThis.__lgChmod)}`)

  // A Java the user installed is not ours to change.
  const own = `${sep}usr${sep}lib${sep}jvm${sep}java-21${sep}bin${sep}java`
  const ownHelper = `${sep}usr${sep}lib${sep}jvm${sep}java-21${sep}lib${sep}jspawnhelper`
  globalThis.__lgModes[ownHelper] = 0o644
  globalThis.__lgChmod = []
  java.mendManagedRuntime(own)
  check(globalThis.__lgChmod.length === 0, 'Ein selbst installiertes Java wurde geändert')

  // macOS bundles keep it one level deeper; the same rule finds it.
  const macHome = join(managed, 'temurin-21', 'jdk-21.0.12+8-jre', 'Contents', 'Home')
  const macExe = join(macHome, 'bin', 'java')
  const macHelper = join(macHome, 'lib', 'jspawnhelper')
  globalThis.__lgModes[macExe] = 0o755
  globalThis.__lgModes[macHelper] = 0o644
  globalThis.__lgDirs[join(macHome, 'bin')] = ['java']
  globalThis.__lgChmod = []
  java.mendManagedRuntime(macExe)
  check(new Map(globalThis.__lgChmod).get(macHelper) === 0o755, 'macOS: jspawnhelper im Bundle nicht repariert')

  // Windows has no such bits: nothing is touched there.
  Object.defineProperty(process, 'platform', { value: 'win32' })
  globalThis.__lgModes[helper] = 0o644
  globalThis.__lgChmod = []
  java.mendManagedRuntime(exe)
  check(globalThis.__lgChmod.length === 0, 'Unter Windows wurde etwas geändert')
} catch (err) {
  problems.push(`Abbruch: ${err?.stack ?? err}`)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // removed later
  }
}

if (problems.length === 0) console.log('  keine Probleme gefunden')
for (const problem of problems) console.log(`  FEHLER: ${problem}`)
console.log(`\nERGEBNIS: ${problems.length === 0 ? 'BESTANDEN' : `FEHLGESCHLAGEN (${problems.length})`}`)
process.exitCode = problems.length === 0 ? 0 : 1
