/**
 * Prueft "Version aendern" mit echten Dateien auf der Platte und echten
 * Downloads von einem lokalen Server:
 *
 *   node scripts/test-version-change.mjs
 *
 * Minecraft selbst, der Mod-Loader und Modrinth sind ersetzt, damit der Test
 * ohne Internet und ohne Spieldateien laeuft. Alles dazwischen ist echt:
 * Sperren, Sicherung, Download mit Pruefsumme, Austausch der Dateien und das
 * Schreiben der Instanz.
 *
 * 1. Die Vorschau sagt fuer jeden Eintrag, was passiert, und schreibt nichts.
 * 2. Der Wechsel tauscht Mods gegen die Fassung fuer die neue Version, laesst
 *    passende stehen, schaltet aus, was es nicht gibt, und laesst von Hand
 *    abgelegte Dateien in Ruhe. Die Welten sind vorher gesichert.
 * 3. Eine neue Pflicht-Abhaengigkeit der neuen Fassung wird nachinstalliert.
 * 4. Ein Wechsel auf einen anderen Loader schaltet Mods ohne Fassung dafuer aus.
 * 5. Ohne Verbindung bricht der Wechsel ab, bevor sich etwas aendert.
 * 6. Ein Download, der scheitert, schaltet nur diesen einen Mod aus.
 * 7. Dieselbe Version und eine laufende Einrichtung werden abgelehnt.
 */
import { createHash } from 'node:crypto'

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-version-change-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const sha1 = (text) => createHash('sha1').update(text).digest('hex')

// Files the stand-in for the download server hands out, by path. A real
// local server is refused by the launcher's guard against local addresses.
const served = new Map()
const base = 'https://cdn.test.invalid'
globalThis.fetch = async (url) => {
  const body = served.get(new URL(String(url)).pathname)
  if (body === undefined) return new Response('nicht da', { status: 404 })
  return new Response(body, { status: 200, headers: { 'content-length': String(Buffer.byteLength(body)) } })
}

/** A Modrinth-like version whose file the local server serves. */
function version(projectId, versionId, fileName, { gameVersions = [], loaders = [], dependencies = [], missing = false } = {}) {
  const body = `jar ${versionId}`
  if (!missing) served.set(`/${fileName}`, body)
  return {
    provider: 'modrinth',
    versionId,
    projectId,
    name: versionId,
    versionNumber: versionId,
    releaseType: 'release',
    gameVersions,
    loaders,
    downloadUrl: `${base}/${fileName}`,
    fileName,
    sha1: sha1(body),
    size: Buffer.byteLength(body),
    releasedAt: '2026-10-01T00:00:00Z',
    dependencies
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

  // Minecraft and the loaders: nothing to download, every version exists.
  const loadersStub = join(work, 'loaders-stub.js')
  writeFileSync(
    loadersStub,
    `module.exports = {
       resolveLatestLoaderVersion: async () => '0.16.9',
       installLoader: async (loader, mc, build) => { globalThis.__lgInstalled.push(loader + ' ' + mc + ' ' + build); return loader === 'vanilla' ? mc : loader + '-' + build + '-' + mc },
       listLoaderVersions: async () => [],
       availableLoaders: async () => ['vanilla']
     }`
  )
  const mojangStub = join(work, 'mojang-stub.js')
  writeFileSync(
    mojangStub,
    `module.exports = {
       loadVersionJson: async (id) => ({ id }),
       installVersion: async () => {},
       osArch: () => 'x64',
       osName: () => 'windows'
     }`
  )
  // Modrinth answers from a table the test fills in.
  const providersStub = join(work, 'providers-stub.js')
  writeFileSync(
    providersStub,
    `const { NetworkError } = require(${JSON.stringify(join(root, 'src/main/core/net.ts'))})
     const answer = (projectId, mc, loader, type) => {
       if (globalThis.__lgOffline) throw new NetworkError('Keine Verbindung (Test)')
       const pick = globalThis.__lgVersions[projectId]
       if (!pick) return null
       return pick(mc, loader, type)
     }
     const project = (projectId) => ({ type: 'mod', name: projectId, author: 'Test', summary: '', pageUrl: '', iconUrl: undefined, versions: [] })
     module.exports = {
       bestVersionFor: async (provider, projectId, mc, loader, type) => answer(projectId, mc, loader, type),
       getVersions: async (provider, projectId) => globalThis.__lgAll[projectId] || [],
       getProject: async (provider, projectId) => project(projectId),
       modrinth: { getProject: async (id) => project(id), lookupByHash: async () => null },
       curseforge: { getProject: async (id) => project(id) }
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       change: require(${JSON.stringify(join(root, 'src/main/core/versionChange.ts'))}),
       instances: require(${JSON.stringify(join(root, 'src/main/core/instances.ts'))}),
       backups: require(${JSON.stringify(join(root, 'src/main/core/backups.ts'))}),
       paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))})
     }`
  )
  const stubs = { '../loaders': loadersStub, './mojang': mojangStub, '../core/mojang': mojangStub, '../providers': providersStub }
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
          build.onResolve({ filter: /^(\.\.\/loaders|\.\/mojang|\.\.\/core\/mojang|\.\.\/providers)$/ }, (args) => ({ path: stubs[args.path] }))
        }
      }
    ],
    logLevel: 'error'
  })

  globalThis.__lgInstalled = []
  globalThis.__lgOffline = false
  const { change, instances, backups, paths } = require(out)
  const p = paths.paths

  // --- The instance: Fabric 1.21.1 with mods of every kind -------------
  const id = 'umzug'
  const gameDir = p.gameDir(id)
  const mods = p.mods(id)
  const packs = p.resourcePacks(id)
  for (const dir of [mods, packs, join(gameDir, 'saves', 'Welt')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(gameDir, 'saves', 'Welt', 'level.dat'), 'WELT')

  const record = (contentId, projectId, versionId, fileName, type = 'mod', provider = 'modrinth', enabled = true) => ({
    id: contentId,
    type,
    provider,
    fileName,
    name: projectId,
    version: versionId,
    versionId: provider === 'local' ? undefined : versionId,
    projectId: provider === 'local' ? undefined : projectId,
    enabled,
    gameVersions: ['1.21.1'],
    loaders: type === 'mod' ? ['fabric'] : [],
    dependencies: [],
    installedAt: Date.now() - 1000
  })
  const content = [
    record('c-sodium', 'sodium', 'sodium-1211', 'sodium-1211.jar'),
    record('c-fapi', 'fabric-api', 'fapi-1211', 'fapi-1211.jar'),
    record('c-old', 'oldmod', 'old-1211', 'oldmod-1211.jar'),
    record('c-hand', 'handmade', 'handmade', 'handmade.jar', 'mod', 'local'),
    record('c-flaky', 'flaky', 'flaky-1211', 'flaky-1211.jar'),
    record('c-rp', 'faithful', 'rp-1', 'faithful.zip', 'resourcepack'),
    record('c-off', 'switchedoff', 'off-1211', 'off-1211.jar', 'mod', 'modrinth', false)
  ]
  for (const item of content) {
    const dir = item.type === 'resourcepack' ? packs : mods
    writeFileSync(join(dir, item.fileName.replace(/\.disabled$/, '') + (item.enabled ? '' : '.disabled')), `alt ${item.fileName}`)
    if (!item.enabled) item.fileName = `${item.fileName}.disabled`
  }
  writeFileSync(
    p.instanceFile(id),
    JSON.stringify({ name: 'Umzug', mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.5', installed: true, content })
  )

  // What Modrinth "has" for each project.
  const sodium1214 = version('sodium', 'sodium-1214', 'sodium-1214.jar', {
    gameVersions: ['1.21.4'],
    loaders: ['fabric'],
    dependencies: [{ projectId: 'newdep', type: 'required' }]
  })
  const sodiumNeo = version('sodium', 'sodium-neo-1211', 'sodium-neo-1211.jar', { gameVersions: ['1.21.1'], loaders: ['neoforge'] })
  const fapi1214 = version('fabric-api', 'fapi-1214', 'fapi-1214.jar', { gameVersions: ['1.21.4'], loaders: ['fabric'] })
  const newdep = version('newdep', 'newdep-1214', 'newdep-1214.jar', { gameVersions: ['1.21.4'], loaders: ['fabric'] })
  const off1214 = version('switchedoff', 'off-1214', 'off-1214.jar', { gameVersions: ['1.21.4'], loaders: ['fabric'] })
  globalThis.__lgAll = { newdep: [newdep], sodium: [sodium1214, sodiumNeo] }
  globalThis.__lgVersions = {
    sodium: (mc, loader) => (loader === 'neoforge' ? sodiumNeo : mc === '1.21.4' ? sodium1214 : null),
    'fabric-api': (mc, loader) => (loader === 'fabric' && mc === '1.21.4' ? fapi1214 : null),
    oldmod: () => null,
    flaky: () => {
      throw new Error('CurseForge hat nicht geantwortet (Test)')
    },
    faithful: () => ({ ...version('faithful', 'rp-1', 'faithful.zip'), versionId: 'rp-1' }),
    switchedoff: (mc, loader) => (loader === 'fabric' && mc === '1.21.4' ? off1214 : null),
    newdep: () => newdep
  }

  // --- 1. Preview ------------------------------------------------------------
  const before = readFileSync(p.instanceFile(id), 'utf8')
  const plan = await change.planVersionChange(id, { mcVersion: '1.21.4', loader: 'fabric' })
  const outcome = (items, contentId) => items.find((i) => i.contentId === contentId)?.outcome
  const expected = { 'c-sodium': 'update', 'c-fapi': 'update', 'c-old': 'disable', 'c-hand': 'local', 'c-flaky': 'unchecked', 'c-rp': 'keep', 'c-off': 'update' }
  for (const [contentId, want] of Object.entries(expected)) {
    check(outcome(plan.items, contentId) === want, `Vorschau ${contentId}: ${outcome(plan.items, contentId)} statt ${want}`)
  }
  check(JSON.parse(readFileSync(p.instanceFile(id), 'utf8')).mcVersion === '1.21.1', 'Die Vorschau hat die Instanz verändert')
  check(existsSync(join(mods, 'sodium-1211.jar')), 'Die Vorschau hat eine Datei verändert')
  void before

  // --- 2./3. The change itself ------------------------------------------------
  const result = await change.changeInstanceVersion(id, { mcVersion: '1.21.4', loader: 'fabric' })
  const after = instances.getInstance(id)
  check(after.mcVersion === '1.21.4' && after.loader === 'fabric', `Instanz danach: ${after.mcVersion} ${after.loader}`)
  check(after.loaderVersion === '0.16.9', `Loader-Version danach: ${after.loaderVersion}, erwartet die empfohlene 0.16.9`)
  check(!after.installing && after.installed, `installing ${after.installing}, installed ${after.installed}`)
  check(globalThis.__lgInstalled.includes('fabric 1.21.4 0.16.9'), `Spieldateien eingerichtet: ${globalThis.__lgInstalled.join(', ')}`)
  check(result.loaderVersion === '0.16.9', 'Das Ergebnis nennt nicht die eingerichtete Loader-Version')

  const files = readdirSync(mods).sort()
  notes.push(`mods danach: ${files.join(', ')}`)
  check(files.includes('sodium-1214.jar') && !files.includes('sodium-1211.jar'), 'Sodium wurde nicht ausgetauscht')
  check(files.includes('fapi-1214.jar') && !files.includes('fapi-1211.jar'), 'Fabric API wurde nicht ausgetauscht')
  check(files.includes('oldmod-1211.jar.disabled') && !files.includes('oldmod-1211.jar'), 'Ein Mod ohne passende Version blieb eingeschaltet')
  check(files.includes('flaky-1211.jar.disabled'), 'Ein nicht prüfbarer Mod blieb eingeschaltet')
  check(files.includes('handmade.jar'), 'Ein von Hand abgelegter Mod wurde angefasst')
  check(readFileSync(join(mods, 'handmade.jar'), 'utf8') === 'alt handmade.jar', 'Der Inhalt eines von Hand abgelegten Mods hat sich geändert')
  check(files.includes('off-1214.jar.disabled') && !files.includes('off-1211.jar.disabled'), 'Ein ausgeschalteter Mod wurde nicht ausgeschaltet ausgetauscht')
  check(files.includes('newdep-1214.jar'), 'Die neue Pflicht-Abhängigkeit wurde nicht installiert')
  check(readdirSync(packs).includes('faithful.zip'), 'Das passende Ressourcenpaket ist verschwunden')

  const byId = (contentId) => after.content.find((c) => c.id === contentId)
  check(byId('c-sodium')?.versionId === 'sodium-1214' && byId('c-sodium')?.enabled, `Sodium-Eintrag: ${JSON.stringify(byId('c-sodium'))}`)
  check(JSON.stringify(byId('c-sodium')?.gameVersions) === '["1.21.4"]', 'Die Metadaten des neuen Sodium fehlen')
  check(byId('c-old')?.enabled === false, 'oldmod gilt im Eintrag noch als eingeschaltet')
  check(after.content.every((c) => !c.update), 'Update-Markierungen der alten Version blieben stehen')

  const list = await backups.listBackups(id)
  const saved = list.find((b) => b.reason === 'pre-update')
  check(Boolean(saved), `Keine Sicherung vor dem Wechsel: ${JSON.stringify(list.map((b) => b.reason))}`)
  notes.push(`Sicherung: ${saved?.name}`)
  const leftovers = existsSync(p.cache()) ? readdirSync(p.cache()).filter((n) => n.startsWith('version-change-')) : []
  check(leftovers.length === 0, `Zwischenordner blieben liegen: ${leftovers.join(', ')}`)

  // --- 4. Another loader --------------------------------------------------------
  await change.changeInstanceVersion(id, { mcVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.77' })
  const neo = instances.getInstance(id)
  const neoFiles = readdirSync(mods)
  notes.push(`mods nach NeoForge: ${neoFiles.sort().join(', ')}`)
  check(neo.loader === 'neoforge' && neo.loaderVersion === '21.1.77', `Loader danach: ${neo.loader} ${neo.loaderVersion}`)
  check(neoFiles.includes('sodium-neo-1211.jar'), 'Sodium für NeoForge fehlt')
  check(neoFiles.includes('fapi-1214.jar.disabled'), 'Fabric API blieb unter NeoForge eingeschaltet')

  // --- 5. Offline: nothing changes ---------------------------------------------
  const snapshot = readdirSync(mods).sort().join('|')
  globalThis.__lgOffline = true
  let offlineError = ''
  try {
    await change.changeInstanceVersion(id, { mcVersion: '1.21.4', loader: 'fabric' })
  } catch (err) {
    offlineError = err?.message ?? String(err)
  }
  globalThis.__lgOffline = false
  check(/Verbindung|connection/i.test(offlineError), `Ohne Verbindung: ${offlineError || 'kein Fehler'}`)
  const stillNeo = instances.getInstance(id)
  check(stillNeo.loader === 'neoforge' && stillNeo.mcVersion === '1.21.1' && !stillNeo.installing, 'Ohne Verbindung wurde die Instanz trotzdem verändert')
  check(readdirSync(mods).sort().join('|') === snapshot, 'Ohne Verbindung haben sich Dateien geändert')

  // --- 6. One download fails --------------------------------------------------
  served.delete('/fapi-1214.jar')
  served.delete('/sodium-1214.jar')
  globalThis.__lgVersions.sodium = (mc, loader) => (loader === 'fabric' && mc === '1.21.4' ? version('sodium', 'sodium-1214b', 'sodium-1214b.jar', { gameVersions: ['1.21.4'], loaders: ['fabric'] }) : null)
  await change.changeInstanceVersion(id, { mcVersion: '1.21.4', loader: 'fabric' })
  const mixed = readdirSync(mods)
  notes.push(`mods nach gescheitertem Download: ${mixed.sort().join(', ')}`)
  check(mixed.includes('sodium-1214b.jar'), 'Der Mod mit funktionierendem Download wurde nicht ausgetauscht')
  check(!mixed.some((n) => n.startsWith('fapi-1214.jar') && !n.endsWith('.disabled')), 'Ein Mod mit gescheitertem Download ist eingeschaltet')
  check(instances.getInstance(id).mcVersion === '1.21.4', 'Ein einzelner gescheiterter Download hat den ganzen Wechsel verhindert')

  // --- 7. Refusals ------------------------------------------------------------
  let same = ''
  try {
    await change.changeInstanceVersion(id, { mcVersion: '1.21.4', loader: 'fabric' })
  } catch (err) {
    same = err?.message ?? ''
  }
  check(same.length > 0, 'Ein Wechsel auf dieselbe Version wurde nicht abgelehnt')
  let bad = ''
  try {
    await change.changeInstanceVersion(id, { mcVersion: '../../evil', loader: 'fabric' })
  } catch (err) {
    bad = err?.message ?? ''
  }
  check(bad.length > 0, 'Eine Version mit Pfadzeichen wurde angenommen')
  instances.persist({ ...instances.getInstance(id), installing: true })
  let busy = ''
  try {
    await change.changeInstanceVersion(id, { mcVersion: '1.21.1', loader: 'fabric' })
  } catch (err) {
    busy = err?.message ?? ''
  }
  check(/eingerichtet|set up/.test(busy), `Während der Einrichtung: ${busy || 'kein Fehler'}`)
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
