/**
 * Prueft, dass von Hand abgelegte Mods nicht mehr fuer immer "Lokal" bleiben:
 *
 *   node scripts/test-local-content.mjs
 *
 * Der Fall aus der Praxis: Eine Instanz steht nach "Version aendern" auf
 * 26.2, im Mod-Ordner liegt aber noch ein von Hand abgelegter Mod fuer
 * 1.21.11. Der Launcher kannte fuer ihn keine Quelle, also kein Update, kein
 * Austausch beim Versionswechsel und keine Reparatur.
 *
 * 1. Die Update-Pruefung erkennt den Mod ueber seine Pruefsumme bei Modrinth,
 *    macht ihn zu einem normalen Eintrag und zeigt das Update fuer 26.2.
 *    Eine Datei, die Modrinth nicht kennt, bleibt lokal und wird nicht bei
 *    jeder Pruefung erneut nachgefragt, erst wenn sie sich aendert.
 * 2. "Version aendern" tauscht einen erkannten lokalen Mod mit aus.
 * 3. "Reparieren" tauscht einen Mod fuer eine andere Minecraft-Version
 *    gegen die passende aus, auch einen, der vorher lokal war.
 * 4. Ohne Antwort von Modrinth bleibt alles, wie es ist.
 *
 * Minecraft, Java, der Mod-Loader und Modrinth sind ersetzt, Dateien,
 * Pruefsummen und Downloads sind echt.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-local-content-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const sha1 = (text) => createHash('sha1').update(text).digest('hex')

// What the stand-in download server hands out, by path.
const served = new Map()
const base = 'https://cdn.test.invalid'
globalThis.fetch = async (url) => {
  const body = served.get(new URL(String(url)).pathname)
  if (body === undefined) return new Response('nicht da', { status: 404 })
  return new Response(body, { status: 200, headers: { 'content-length': String(Buffer.byteLength(body)) } })
}

/** A small but real jar: a recognised file is checked as a zip by the repair. */
function jarBytes(text) {
  const AdmZip = createRequire(import.meta.url)('adm-zip')
  const zip = new AdmZip()
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'testmod', name: text, version: '1.0' })))
  return zip.toBuffer()
}

function version(projectId, versionId, fileName, gameVersions, released) {
  const body = jarBytes(versionId)
  served.set(`/${fileName}`, body)
  return {
    provider: 'modrinth',
    versionId,
    projectId,
    name: versionId,
    versionNumber: versionId,
    releaseType: 'release',
    gameVersions,
    loaders: ['fabric'],
    downloadUrl: `${base}/${fileName}`,
    fileName,
    sha1: sha1(body),
    size: Buffer.byteLength(body),
    releasedAt: released,
    dependencies: []
  }
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

  const stub = (name, code) => {
    const file = join(work, `${name}.js`)
    writeFileSync(file, code)
    return file
  }
  const loadersStub = stub(
    'loaders',
    `module.exports = {
       resolveLatestLoaderVersion: async () => '0.16.9',
       installLoader: async (loader, mc, build) => loader === 'vanilla' ? mc : loader + '-' + build + '-' + mc,
       listLoaderVersions: async () => [],
       availableLoaders: async () => ['vanilla']
     }`
  )
  const mojangStub = stub(
    'mojang',
    `module.exports = {
       loadVersionJson: async (id) => ({ id, libraries: [], downloads: {} }),
       installVersion: async () => {},
       resolveLibraries: () => [],
       clientJarPath: (mc) => require('path').join(${JSON.stringify(work)}, 'client-' + mc + '.jar'),
       osArch: () => 'x64',
       osName: () => 'windows'
     }`
  )
  const javaStub = stub(
    'java',
    `module.exports = {
       requiredJavaMajor: () => 21,
       resolveJava: async () => ({ path: 'java', version: '21', major: 21, vendor: 'Test', arch: 'x64', managed: true })
     }`
  )
  const launchStub = stub('launch', `module.exports = { isNativesClaimed: () => false }`)
  const providersStub = stub(
    'providers',
    `const { NetworkError } = require(${JSON.stringify(join(root, 'src/main/core/net.ts'))})
     const best = (projectId, mc, loader, type) => {
       const pick = globalThis.__lgVersions[projectId]
       return pick ? pick(mc, loader, type) : null
     }
     module.exports = {
       bestVersionFor: async (provider, projectId, mc, loader, type) => best(projectId, mc, loader, type),
       getVersions: async (provider, projectId) => globalThis.__lgAll[projectId] || [],
       getProject: async (provider, id) => ({ type: 'mod', name: id, author: 'Test', summary: '', pageUrl: '', versions: [] }),
       modrinth: {
         getProject: async (id) => ({ type: 'mod', name: id, author: 'Test', summary: '', pageUrl: '', versions: [] }),
         lookupByHash: async () => null,
         lookupByHashes: async (hashes) => {
           if (globalThis.__lgOffline) throw new NetworkError('Keine Verbindung (Test)')
           globalThis.__lgAsked.push(...hashes)
           const found = new Map()
           for (const h of hashes) if (globalThis.__lgKnown[h]) found.set(h, globalThis.__lgKnown[h])
           return { found, answered: new Set(hashes) }
         },
         projectBasics: async (ids) => new Map(ids.map((id) => [id, { name: 'Erkannt: ' + id, pageUrl: 'https://modrinth.com/mod/' + id }]))
       },
       curseforge: { getProject: async (id) => ({ type: 'mod', name: id }) }
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       content: require(${JSON.stringify(join(root, 'src/main/core/content.ts'))}),
       change: require(${JSON.stringify(join(root, 'src/main/core/versionChange.ts'))}),
       repair: require(${JSON.stringify(join(root, 'src/main/core/repair.ts'))}),
       instances: require(${JSON.stringify(join(root, 'src/main/core/instances.ts'))}),
       paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))})
     }`
  )
  const stubs = {
    '../loaders': loadersStub,
    './mojang': mojangStub,
    '../core/mojang': mojangStub,
    './java': javaStub,
    '../core/java': javaStub,
    './launch': launchStub,
    '../providers': providersStub
  }
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
          build.onResolve({ filter: /^(\.\.\/loaders|\.\/mojang|\.\.\/core\/mojang|\.\/java|\.\.\/core\/java|\.\/launch|\.\.\/providers)$/ }, (args) => ({
            path: stubs[args.path]
          }))
        }
      }
    ],
    logLevel: 'error'
  })

  globalThis.__lgAsked = []
  const AdmZip = require('adm-zip')
  /** A small but real jar, so the repair does not take it for damaged. */
  const realJar = (text) => {
    const zip = new AdmZip()
    zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'eigener', name: text, version: '1.0' })))
    return zip.toBuffer()
  }
  globalThis.__lgOffline = false
  const { content, change, repair, instances, paths } = require(out)
  const p = paths.paths

  // The mod as it sits on the friend's disk: a real Modrinth file for 1.21.11.
  const old = version('knownmod', 'km-12111', 'knownmod-1.21.11.jar', ['1.21.11'], '2026-05-01T00:00:00Z')
  const for262 = version('knownmod', 'km-262', 'knownmod-26.2.jar', ['26.2'], '2026-10-01T00:00:00Z')
  const for1214 = version('knownmod', 'km-1214', 'knownmod-1.21.4.jar', ['1.21.4'], '2025-01-01T00:00:00Z')
  globalThis.__lgKnown = { [old.sha1]: old }
  globalThis.__lgAll = { knownmod: [for262, old, for1214] }
  globalThis.__lgVersions = {
    knownmod: (mc) => (mc === '26.2' ? for262 : mc === '1.21.11' ? old : mc === '1.21.4' ? for1214 : null)
  }

  /** An instance on `mcVersion` with the old jar and an unknown jar dropped in by hand. */
  function makeInstance(id, mcVersion) {
    const mods = p.mods(id)
    mkdirSync(mods, { recursive: true })
    writeFileSync(join(mods, 'knownmod-1.21.11.jar'), served.get('/knownmod-1.21.11.jar'))
    writeFileSync(join(mods, 'eigener-mod.jar'), realJar('selbst gebaut'))
    mkdirSync(join(p.gameDir(id), 'saves', 'Welt'), { recursive: true })
    writeFileSync(join(p.gameDir(id), 'saves', 'Welt', 'level.dat'), 'WELT')
    writeFileSync(p.instanceFile(id), JSON.stringify({ name: id, mcVersion, loader: 'fabric', loaderVersion: '0.16.9', installed: true, content: [] }))
    return mods
  }
  const updMods = makeInstance('nach-wechsel', '26.2')
  const chgMods = makeInstance('wechsel', '1.21.11')
  const repMods = makeInstance('reparatur', '26.2')
  const offMods = makeInstance('offline', '26.2')
  const swapMods = makeInstance('getauscht', '26.2')
  const extraMods = makeInstance('zweitdatei', '26.2')
  const noFitMods = makeInstance('ohne-ersatz', '1.21.5')
  void chgMods
  void noFitMods

  // --- 1. Update check --------------------------------------------------------
  await content.checkUpdates('nach-wechsel', undefined, false)
  const afterCheck = instances.getInstance('nach-wechsel')
  const known = afterCheck.content.find((c) => c.fileName === 'knownmod-1.21.11.jar')
  const unknown = afterCheck.content.find((c) => c.fileName === 'eigener-mod.jar')
  notes.push(`Nach der Update-Prüfung: ${afterCheck.content.map((c) => `${c.fileName}=${c.provider}${c.update ? ' Update ' + c.update.versionNumber : ''}`).join(', ')}`)
  check(known?.provider === 'modrinth' && known?.projectId === 'knownmod' && known?.versionId === 'km-12111', `Der bekannte Mod wurde nicht erkannt: ${JSON.stringify(known)}`)
  check(known?.name === 'Erkannt: knownmod', `Name des erkannten Mods: ${known?.name}`)
  check(known?.update?.versionId === 'km-262', `Kein Update auf die Fassung für 26.2: ${JSON.stringify(known?.update)}`)
  check(unknown?.provider === 'local' && Boolean(unknown?.unrecognisedFrom), `Die unbekannte Datei: ${JSON.stringify(unknown)}`)

  const askedBefore = globalThis.__lgAsked.length
  await content.checkUpdates('nach-wechsel', undefined, false)
  check(globalThis.__lgAsked.length === askedBefore, `Die unbekannte Datei wurde bei der zweiten Prüfung erneut nachgefragt (${globalThis.__lgAsked.length - askedBefore}x)`)
  // Changed on disk: asked again.
  writeFileSync(join(updMods, 'eigener-mod.jar'), realJar('selbst gebaut, neue Fassung'))
  const later = new Date(Date.now() + 5000)
  utimesSync(join(updMods, 'eigener-mod.jar'), later, later)
  await content.checkUpdates('nach-wechsel', undefined, false)
  check(globalThis.__lgAsked.length === askedBefore + 1, `Eine geänderte unbekannte Datei wurde nicht erneut nachgefragt (${globalThis.__lgAsked.length - askedBefore}x)`)

  // --- 2. Version change --------------------------------------------------------
  const plan = await change.planVersionChange('wechsel', { mcVersion: '26.2', loader: 'fabric' })
  notes.push(`Vorschau: ${plan.items.map((i) => `${i.name}=${i.outcome}`).join(', ')}`)
  check(plan.items.some((i) => i.name === 'Erkannt: knownmod' && i.outcome === 'update'), 'Die Vorschau tauscht den erkannten lokalen Mod nicht aus')
  check(plan.items.some((i) => i.outcome === 'local'), 'Die unbekannte Datei fehlt in der Vorschau als lokal')
  await change.changeInstanceVersion('wechsel', { mcVersion: '26.2', loader: 'fabric' })
  const changed = readdirSync(p.mods('wechsel')).sort()
  notes.push(`Mods nach dem Wechsel: ${changed.join(', ')}`)
  check(changed.includes('knownmod-26.2.jar') && !changed.includes('knownmod-1.21.11.jar'), 'Der erkannte lokale Mod wurde beim Wechsel nicht ausgetauscht')
  check(changed.includes('eigener-mod.jar'), 'Die unbekannte Datei wurde beim Wechsel angefasst')

  // --- 3. Repair -------------------------------------------------------------------
  const report = await repair.repairInstance('reparatur')
  const repaired = readdirSync(repMods).sort()
  notes.push(`Mods nach der Reparatur: ${repaired.join(', ')}`)
  const modStep = report.steps?.find((s) => /Mods/.test(s.name ?? s.label ?? ''))
  notes.push(`Reparatur-Bericht Mods: ${JSON.stringify(modStep)}`)
  check(repaired.includes('knownmod-26.2.jar') && !repaired.includes('knownmod-1.21.11.jar'), 'Die Reparatur hat den Mod für 1.21.11 nicht ausgetauscht')
  check(repaired.includes('eigener-mod.jar'), 'Die Reparatur hat die unbekannte Datei angefasst')
  const repairedItem = instances.getInstance('reparatur').content.find((c) => c.fileName === 'knownmod-26.2.jar')
  check(repairedItem?.versionId === 'km-262' && JSON.stringify(repairedItem?.gameVersions) === '["26.2"]', `Eintrag nach der Reparatur: ${JSON.stringify(repairedItem)}`)
  check(JSON.stringify(modStep ?? {}).includes('Minecraft-Version getauscht'), 'Der Reparatur-Bericht nennt den Austausch nicht')
  check(modStep?.status === 'repaired', `Status des Mod-Schritts: ${modStep?.status}`)

  // A mod that already fits is left alone by the repair.
  const second = await repair.repairInstance('reparatur')
  const secondStep = second.steps?.find((s) => /Mods/.test(s.name ?? s.label ?? ''))
  check(!JSON.stringify(secondStep ?? {}).includes('getauscht'), `Eine zweite Reparatur tauschte erneut: ${JSON.stringify(secondStep)}`)

  // --- 5. A recognised file swapped by hand -----------------------------------------
  await content.checkUpdates('getauscht', undefined, false)
  const swapItem = () => instances.getInstance('getauscht').content.find((c) => c.fileName === 'knownmod-1.21.11.jar')
  check(swapItem()?.provider === 'modrinth' && Boolean(swapItem()?.recognisedFrom), `Vor dem Austausch nicht erkannt: ${JSON.stringify(swapItem())}`)
  // The user drops their own build in under the same name.
  writeFileSync(join(swapMods, 'knownmod-1.21.11.jar'), realJar('eigene Fassung'))
  const later2 = new Date(Date.now() + 9000)
  utimesSync(join(swapMods, 'knownmod-1.21.11.jar'), later2, later2)
  const ownBuild = readFileSync(join(swapMods, 'knownmod-1.21.11.jar'))
  await repair.repairInstance('getauscht')
  check(Buffer.compare(readFileSync(join(swapMods, 'knownmod-1.21.11.jar')), ownBuild) === 0, 'Die Reparatur hat eine von Hand getauschte Datei überschrieben')
  check(swapItem()?.provider === 'local', `Die getauschte Datei gilt noch als die erkannte Modrinth-Fassung: ${JSON.stringify(swapItem())}`)

  // --- 6. A version's extra file is not taken for the version ---------------------
  const extra = jarBytes('zusatzdatei')
  writeFileSync(join(extraMods, 'knownmod-api.jar'), extra)
  globalThis.__lgKnown[sha1(extra)] = old // Modrinth answers for the extra file with the whole version
  await content.checkUpdates('zweitdatei', undefined, false)
  const extraItem = instances.getInstance('zweitdatei').content.find((c) => c.fileName === 'knownmod-api.jar')
  check(extraItem?.provider === 'local', `Eine Zusatzdatei wurde als die Version selbst erfasst: ${JSON.stringify(extraItem)}`)
  const sameProject = instances.getInstance('zweitdatei').content.filter((c) => c.projectId === 'knownmod')
  check(sameProject.length === 1, `${sameProject.length} Einträge für dasselbe Projekt`)

  // --- 7. No replacement for a neighbouring version is not a failed repair -------
  globalThis.__lgVersions.knownmod = (mc) => (mc === '26.2' ? for262 : mc === '1.21.11' ? old : null)
  const noFit = await repair.repairInstance('ohne-ersatz')
  const noFitStep = noFit.steps?.find((s) => /Mods/.test(s.label ?? ''))
  notes.push(`Reparatur ohne Ersatz: ${JSON.stringify(noFitStep)}`)
  check(noFitStep?.status !== 'failed', `Ein Mod ohne Ersatz machte die Reparatur rot: ${JSON.stringify(noFitStep)}`)
  check(readdirSync(noFitMods).includes('knownmod-1.21.11.jar'), 'Ein Mod ohne Ersatz wurde entfernt')

  // --- 4. No answer from Modrinth -------------------------------------------------
  globalThis.__lgOffline = true
  await content.checkUpdates('offline', undefined, false).catch(() => undefined)
  globalThis.__lgOffline = false
  const offline = instances.getInstance('offline').content
  check(offline.every((c) => c.provider === 'local' && !c.unrecognisedFrom), `Ohne Verbindung wurde trotzdem etwas geändert: ${JSON.stringify(offline.map((c) => [c.fileName, c.provider, c.unrecognisedFrom]))}`)
  check(existsSync(join(offMods, 'knownmod-1.21.11.jar')), 'Ohne Verbindung verschwand eine Datei')
  void readFileSync
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
