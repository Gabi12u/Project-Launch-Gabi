/**
 * Prueft den Export einer Instanz als .mrpack.
 *
 *   node scripts/test-export-mrpack.mjs
 *
 * Zwei Fehler, die hier nicht mehr vorkommen duerfen:
 * 1. Eine Instanz, deren erste Einrichtung nie eine Loader-Version
 *    festgelegt hatte, wurde mit "fabric-loader": "" exportiert. Andere
 *    Launcher lehnen das ab, und dieser hier auch, als Modpack mit
 *    unbekanntem Mod-Loader.
 * 2. Das eigene Startseiten-Paket des Launchers ging im Export mit.
 *
 * Loader-Abfrage und Anbieter sind ersetzt, es braucht kein Netz.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-export-'))

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
    `module.exports = {
       app: { getPath: () => ${JSON.stringify(userData)}, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )
  const loadersStub = join(work, 'loaders.js')
  writeFileSync(
    loadersStub,
    `module.exports = {
       listLoaderVersions: async () => [{ version: '0.16.10', stable: true }],
       resolveLatestLoaderVersion: async () => '0.16.10',
       installLoader: async () => { throw new Error('nicht im Test') }
     }`
  )
  const providersStub = join(work, 'providers.js')
  writeFileSync(
    providersStub,
    `const none = async () => { throw new Error('kein Netz im Test') }
     module.exports = {
       bestVersionFor: async () => null, getVersions: async () => [], getProject: none,
       modrinth: { getProject: none, getVersions: async () => [], lookupByHash: async () => null,
         lookupByHashes: async (hashes) => ({ found: new Map(), answered: new Set(hashes) }), projectBasics: async () => new Map() },
       curseforge: { getProject: none }
     }`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       modpack: require(${JSON.stringify(join(root, 'src/main/core/modpack.ts'))}),
       instances: require(${JSON.stringify(join(root, 'src/main/core/instances.ts'))}),
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
        name: 'stubs',
        setup(build) {
          build.onResolve({ filter: /^\.\.\/loaders$/ }, () => ({ path: loadersStub }))
          build.onResolve({ filter: /^\.\.\/providers$/ }, () => ({ path: providersStub }))
        }
      }
    ],
    logLevel: 'error'
  })
  const { modpack, instances, paths } = require(out)

  // A Fabric instance without a loader build, with the launcher's own start
  // screen pack and a resource pack of the player's own.
  const id = 'export'
  mkdirSync(paths.resourcePacks(id), { recursive: true })
  writeFileSync(
    paths.instanceFile(id),
    JSON.stringify({ name: 'Export', mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '', installed: true, content: [] })
  )
  const pack = new AdmZip()
  pack.addFile('pack.mcmeta', Buffer.from('{"pack":{"pack_format":34,"description":"x"}}'))
  writeFileSync(join(paths.resourcePacks(id), 'LaunchGabi-Startbildschirm.zip'), pack.toBuffer())
  writeFileSync(join(paths.resourcePacks(id), 'LaunchGabi-Startbildschirm.zip.activated'), '')
  writeFileSync(join(paths.resourcePacks(id), 'Eigenes-Paket.zip'), pack.toBuffer())
  instances.loadInstances(true)

  const target = join(work, 'export.mrpack')
  await modpack.exportMrpack(id, { targetFile: target })
  const zip = new AdmZip(target)
  const index = JSON.parse(zip.readAsText('modrinth.index.json'))
  const names = zip.getEntries().map((e) => e.entryName)

  check(index.dependencies['fabric-loader'] === '0.16.10', `Loader-Version im Export: ${JSON.stringify(index.dependencies)}`)
  check(instances.getInstance(id).loaderVersion === '0.16.10', `Die Instanz hat danach die Loader-Version „${instances.getInstance(id).loaderVersion}“`)
  check(!names.some((n) => n.includes('LaunchGabi-Startbildschirm')), `Das Startseiten-Paket ist im Export: ${names.join(', ')}`)
  check(names.includes('overrides/resourcepacks/Eigenes-Paket.zip'), `Das eigene Paket fehlt im Export: ${names.join(', ')}`)
  notes.push(`Export: ${JSON.stringify(index.dependencies)}, ${names.length} Einträge, ohne Startseiten-Paket.`)

  // And the export is importable again.
  const analysis = await modpack.analyzeModpackFile(target)
  check(analysis.canImport !== false, `Der eigene Export lässt sich nicht wieder importieren: ${JSON.stringify(analysis.blockers ?? analysis)}`)
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
