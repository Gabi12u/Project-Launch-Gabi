/**
 * Prueft "Version aendern", wenn der Launcher mitten im Austausch der Mods
 * hart beendet wird:
 *
 *   node scripts/test-version-change-interrupted.mjs
 *
 * Ein Kindprozess startet den Wechsel von 1.21.1 auf 1.21.4 und beendet sich
 * genau nach dem ersten ausgetauschten Mod, wie bei einem Absturz oder einem
 * ausgeschalteten PC. Danach:
 *
 * 1. Die Instanz merkt sich den unterbrochenen Wechsel, "wird eingerichtet"
 *    bleibt nicht haengen, und ein Spielstart wird mit einer Erklaerung
 *    abgelehnt statt mit halb getauschten Mods zu starten.
 * 2. Ein zweiter Wechsel auf das Ziel schliesst ihn ab und raeumt den
 *    liegengebliebenen Zwischenordner weg.
 * 3. Ein Wechsel zurueck auf die eingetragene Version ist danach erlaubt und
 *    bringt die Mods wieder auf diese Version.
 * 4. "Reparieren" bringt die Mods ebenfalls auf die eingetragene Version und
 *    loest den gemerkten Wechsel auf.
 *
 * Minecraft, Java, der Mod-Loader und Modrinth sind ersetzt.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const [, , mode, killInstance, killWork] = process.argv
const child = mode === '--abbruch'
const work = child ? killWork : mkdtempSync(join(tmpdir(), 'lg-version-interrupted-'))
const require = createRequire(import.meta.url)

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}
const sha1 = (body) => createHash('sha1').update(body).digest('hex')

const served = new Map()
globalThis.fetch = async (url) => {
  const body = served.get(new URL(String(url)).pathname)
  if (body === undefined) return new Response('nicht da', { status: 404 })
  return new Response(body, { status: 200, headers: { 'content-length': String(Buffer.byteLength(body)) } })
}

/** A small but real jar, so the repair does not take it for damaged. */
function jar(text) {
  const AdmZip = require('adm-zip')
  const zip = new AdmZip()
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'testmod', name: text, version: '1.0' })))
  return zip.toBuffer()
}

const projects = ['iris', 'lithium', 'sodium']
const builds = new Map()
function build(project, mc) {
  const key = `${project}-${mc.replaceAll('.', '')}`
  if (!builds.has(key)) {
    const body = `jar ${key}`
    served.set(`/${key}.jar`, body)
    builds.set(key, {
      provider: 'modrinth', versionId: key, projectId: project, name: key, versionNumber: key, releaseType: 'release',
      gameVersions: [mc], loaders: ['fabric'], downloadUrl: `https://cdn.test.invalid/${key}.jar`, fileName: `${key}.jar`,
      sha1: sha1(body), size: Buffer.byteLength(body), releasedAt: mc === '1.21.4' ? '2026-10-01T00:00:00Z' : '2026-05-01T00:00:00Z', dependencies: []
    })
  }
  return builds.get(key)
}
globalThis.__lgVersions = Object.fromEntries(projects.map((p) => [p, (mc) => (mc === '1.21.4' || mc === '1.21.1' ? build(p, mc) : null)]))
globalThis.__lgAll = Object.fromEntries(projects.map((p) => [p, [build(p, '1.21.4'), build(p, '1.21.1')]]))

async function load(withKill) {
  const esbuild = require('esbuild')
  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })
  const file = (name, code) => {
    const f = join(work, name)
    writeFileSync(f, code)
    return f
  }
  const shim = file('electron.js', `module.exports = { app: { getPath: () => ${JSON.stringify(userData)}, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} }, desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {} }`)
  const loaders = file('loaders.js', `module.exports = { resolveLatestLoaderVersion: async () => '0.16.9', installLoader: async (l, mc, b) => l === 'vanilla' ? mc : l + '-' + b + '-' + mc, listLoaderVersions: async () => [], availableLoaders: async () => [] }`)
  const mojang = file('mojang.js', `module.exports = { loadVersionJson: async (id) => ({ id, libraries: [], downloads: {} }), installVersion: async () => {}, resolveLibraries: () => [], clientJarPath: (mc) => require('path').join(${JSON.stringify(work)}, 'client-' + mc + '.jar'), osArch: () => 'x64', osName: () => 'windows' }`)
  const java = file('java.js', `module.exports = { requiredJavaMajor: () => 21, resolveJava: async () => ({ path: 'java', version: '21', major: 21, vendor: 'Test', arch: 'x64', managed: true }) }`)
  const launch = file('launch.js', `module.exports = { isNativesClaimed: () => false }`)
  const providers = file('providers.js', `module.exports = {
    bestVersionFor: async (prov, id, mc) => (globalThis.__lgVersions[id] ? globalThis.__lgVersions[id](mc) : null),
    getVersions: async (prov, id) => globalThis.__lgAll[id] || [],
    getProject: async (prov, id) => ({ type: 'mod', name: id }),
    modrinth: { getProject: async (id) => ({ type: 'mod', name: id }), lookupByHash: async () => null, lookupByHashes: async (h) => ({ found: new Map(), answered: new Set(h) }), projectBasics: async () => new Map() },
    curseforge: { getProject: async (id) => ({ type: 'mod', name: id }) } }`)
  // Ends the process the moment the second downloaded mod is about to be
  // moved into the mods folder: the first swap is complete, nothing after.
  const fsShim = file('fs-kill.js', `const real = require('fs'); let moved = 0
    module.exports = new Proxy(real, { get(t, k, r) {
      if (k === 'renameSync') return (a, b) => {
        if (String(a).includes('version-change-') && !String(b).includes('version-change-') && ++moved === 2) process.exit(7)
        return t.renameSync(a, b)
      }
      return Reflect.get(t, k, r) } })`)
  const fsp = file('fsp.js', `module.exports = require('fs/promises')`)
  const entry = file('entry.js', `module.exports = {
    change: require(${JSON.stringify(join(root, 'src/main/core/versionChange.ts'))}),
    repair: require(${JSON.stringify(join(root, 'src/main/core/repair.ts'))}),
    instances: require(${JSON.stringify(join(root, 'src/main/core/instances.ts'))}),
    paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))}) }`)
  const stubs = { '../loaders': loaders, './mojang': mojang, '../core/mojang': mojang, './java': java, '../core/java': java, './launch': launch, '../providers': providers }
  const out = join(work, withKill ? 'bundle-kill.cjs' : 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim, ...(withKill ? { 'node:fs': fsShim, 'node:fs/promises': fsp } : {}) },
    plugins: [{ name: 'stubs', setup(b) { b.onResolve({ filter: /^(\.\.\/loaders|\.\/mojang|\.\.\/core\/mojang|\.\/java|\.\.\/core\/java|\.\/launch|\.\.\/providers)$/ }, (a) => ({ path: stubs[a.path] })) } }],
    logLevel: 'error'
  })
  return require(out)
}

if (child) {
  const { change } = await load(true)
  await change.changeInstanceVersion(killInstance, { mcVersion: '1.21.4', loader: 'fabric' })
  process.exit(0)
}

try {
  const { change, repair, instances, paths } = await load(false)
  const p = paths.paths

  function makeInstance(id) {
    const mods = p.mods(id)
    mkdirSync(mods, { recursive: true })
    mkdirSync(join(p.gameDir(id), 'saves', 'Welt'), { recursive: true })
    writeFileSync(join(p.gameDir(id), 'saves', 'Welt', 'level.dat'), 'WELT')
    const content = projects.map((pr) => ({
      id: `${id}-${pr}`, type: 'mod', provider: 'modrinth', fileName: `${pr}-1211.jar`, name: pr, version: `${pr}-1211`,
      versionId: `${pr}-1211`, projectId: pr, enabled: true, gameVersions: ['1.21.1'], loaders: ['fabric'], dependencies: [], installedAt: 1
    }))
    for (const c of content) writeFileSync(join(mods, c.fileName), jar(c.fileName))
    writeFileSync(p.instanceFile(id), JSON.stringify({ name: id, mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.9', installed: true, content }))
    return mods
  }

  /** Runs the change in a child process that dies after the first swap. */
  function interrupt(id) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--abbruch', id, work], { encoding: 'utf8' })
    instances.invalidateInstanceCache()
    return run.status
  }

  // --- 1. What is left after the crash ------------------------------------------
  const finishMods = makeInstance('abschliessen')
  const status = interrupt('abschliessen')
  check(status === 7, `Der Kindprozess endete nicht an der vorgesehenen Stelle (Exitcode ${status})`)
  const raw = JSON.parse(readFileSync(p.instanceFile('abschliessen'), 'utf8'))
  const loaded = instances.getInstance('abschliessen')
  const half = readdirSync(finishMods).sort()
  notes.push(`Nach dem Abbruch: Version ${raw.mcVersion}, Dateien ${half.join(', ')}, gemerkt ${JSON.stringify(raw.pendingVersionChange)}`)
  check(half.includes('iris-1214.jar') && half.includes('sodium-1211.jar'), `Der Abbruch traf nicht die Mitte des Austauschs: ${half.join(', ')}`)
  check(raw.pendingVersionChange?.mcVersion === '1.21.4', 'Der unterbrochene Wechsel wurde nicht gemerkt')
  check(loaded.pendingVersionChange?.mcVersion === '1.21.4', 'Der gemerkte Wechsel ging beim Laden verloren')
  check(loaded.installing === false, '"wird eingerichtet" blieb nach dem Neustart hängen')
  const leftover = readdirSync(p.cache()).filter((n) => n.startsWith('version-change-'))
  check(leftover.length === 1, `Erwartet war ein liegengebliebener Zwischenordner, gefunden: ${leftover.join(', ') || 'keiner'}`)

  // The start is refused with a reason, checked through the real launch code.
  {
    const esbuild = require('esbuild')
    const out = join(work, 'launch.cjs')
    await esbuild.build({
      entryPoints: [join(root, 'src/main/core/launch.ts')], bundle: true, format: 'cjs', platform: 'node', outfile: out,
      alias: { '@shared': join(root, 'src/shared'), electron: join(work, 'electron.js') }, logLevel: 'error', external: ['node-global-key-listener']
    })
    const launch = require(out)
    let refused = ''
    try {
      await launch.launchInstance({ instanceId: 'abschliessen' })
    } catch (err) {
      refused = err?.message ?? String(err)
    }
    notes.push(`Spielstart: ${refused.slice(0, 90)}`)
    check(/unterbrochen|cut off/.test(refused), `Der Spielstart wurde nicht wegen des unterbrochenen Wechsels abgelehnt: ${refused || 'er lief los'}`)
  }

  // --- 2. Finishing it -------------------------------------------------------------
  await change.changeInstanceVersion('abschliessen', { mcVersion: '1.21.4', loader: 'fabric' })
  const finished = instances.getInstance('abschliessen')
  check(finished.mcVersion === '1.21.4' && !finished.pendingVersionChange, `Nach dem Abschluss: ${finished.mcVersion}, gemerkt ${JSON.stringify(finished.pendingVersionChange)}`)
  check(readdirSync(finishMods).sort().join(',') === 'iris-1214.jar,lithium-1214.jar,sodium-1214.jar', `Mods nach dem Abschluss: ${readdirSync(finishMods).join(', ')}`)
  const stillThere = readdirSync(p.cache()).filter((n) => n.startsWith('version-change-'))
  check(stillThere.length === 0, `Der alte Zwischenordner blieb liegen: ${stillThere.join(', ')}`)

  // --- 3. Going back to the recorded version instead ---------------------------
  const backMods = makeInstance('zurueck')
  instances.invalidateInstanceCache()
  interrupt('zurueck')
  await change.changeInstanceVersion('zurueck', { mcVersion: '1.21.1', loader: 'fabric' })
  const back = instances.getInstance('zurueck')
  check(back.mcVersion === '1.21.1' && !back.pendingVersionChange, `Zurück: ${back.mcVersion}, gemerkt ${JSON.stringify(back.pendingVersionChange)}`)
  check(readdirSync(backMods).sort().join(',') === 'iris-1211.jar,lithium-1211.jar,sodium-1211.jar', `Mods nach dem Rückweg: ${readdirSync(backMods).join(', ')}`)

  // --- 4. Repairing instead ------------------------------------------------------
  const repairMods = makeInstance('reparieren')
  instances.invalidateInstanceCache()
  interrupt('reparieren')
  const report = await repair.repairInstance('reparieren')
  const fixed = instances.getInstance('reparieren')
  notes.push(`Reparatur: ${JSON.stringify(report.steps?.find((s) => /Mods/.test(s.label ?? ''))?.detail)}`)
  check(!fixed.pendingVersionChange, 'Die Reparatur hat den unterbrochenen Wechsel nicht aufgelöst')
  check(readdirSync(repairMods).sort().join(',') === 'iris-1211.jar,lithium-1211.jar,sodium-1211.jar', `Mods nach der Reparatur: ${readdirSync(repairMods).join(', ')}`)
  void existsSync
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
