/**
 * Prueft die Absturzhilfe fuer Fabric und das Festhalten einer Mod-Version:
 *
 *   node scripts/test-crash-help.mjs
 *
 * Der Fall aus der Praxis: Fabric startet nicht, weil ein Mod eine andere
 * Version eines zweiten Mods braucht ("braucht 1.12.56, installiert ist
 * 1.13.1"). Bisher stand das nur im Log. Und wer danach von Hand auf die
 * aeltere Version wechselte, bekam vor jedem Start "Mods sind veraltet".
 *
 * 1. Fabrics Bericht wird gelesen. Die Texte stammen unveraendert aus echten
 *    Laeufen von Fabric Loader 0.19.5 mit absichtlich unpassenden Test-Mods.
 * 2. Versionsbereiche und Vergleiche in Fabrics Wortlaut.
 * 3. Die Mod-Version im Namen einer Modrinth-Version.
 * 4. Nach dem Absturz bietet die Kompatibilitaetspruefung den Wechsel auf die
 *    passende Version an. "Beheben" setzt sie ein und haelt sie fest: keine
 *    Update-Frage mehr, kein Update durch "Alle aktualisieren".
 * 5. "Version waehlen" haelt eine aeltere Version fest, die neueste nicht.
 *    Rechtsklick "Updates wieder zulassen" zeigt das Update sofort.
 * 6. Ein fehlender Mod wird ueber seine Kennung bei Modrinth gefunden.
 * 7. Ein Mod fuer eine andere Minecraft-Version wird gegen den passenden
 *    getauscht, nicht Minecraft.
 * 8. Passt der Versionsname nicht zu Fabrics Angabe, wird nicht geraten.
 * 9. Ein neuer Start verwirft den alten Bericht.
 * 10. Quilt: echter Bericht von Quilt Loader 0.30.2, gelesen auch aus
 *     logs/latest.log, wenn er nicht mehr im Puffer des Launchers steht.
 * 11. Forge und NeoForge: Zeilen genau nach der Vorlage in ModSorter.java
 *     (Forge 1.20.1 bis 1.21.11, NeoForge 1.20.4 bis heute), Bereiche und
 *     Vergleiche nach Maven.
 *
 * Minecraft, Java und Modrinth sind ersetzt, Dateien und Downloads sind echt.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-crash-help-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex')
const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

// What the stand-in download server hands out, by path.
const served = new Map()
const base = 'https://cdn.test.invalid'
globalThis.fetch = async (url) => {
  const body = served.get(new URL(String(url)).pathname)
  if (body === undefined) return new Response('nicht da', { status: 404 })
  return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
}

/** A small but real jar declaring `modId`. */
function jarBytes(modId, name, version, extra = {}) {
  const zip = new AdmZip()
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: modId, name, version, ...extra })))
  return zip.toBuffer()
}

function release(projectId, versionId, versionNumber, gameVersions, released, modId, loaders = ['fabric'], extra = {}) {
  const fileName = `${versionId}.jar`
  const body = jarBytes(modId, projectId, versionNumber, extra)
  served.set(`/${fileName}`, body)
  return {
    provider: 'modrinth',
    versionId,
    projectId,
    name: versionNumber,
    versionNumber,
    releaseType: 'release',
    gameVersions,
    loaders,
    downloadUrl: `${base}/${fileName}`,
    fileName,
    sha1: sha1(body),
    size: body.length,
    releasedAt: released,
    dependencies: []
  }
}

// Real output of Fabric Loader 0.19.5, from runs with deliberately clashing
// test mods (only the names and ids differ per case).
const FABRIC = {
  mismatch: `[21:38:35] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
\t - Replace mod 'Fabric Language Kotlin' (fabric-language-kotlin) 1.13.1+kotlin.2.1.0 with version 1.12.56 or earlier.
More details:
\t - Mod 'Zoomify' (zoomify) 2.17.0 requires version 1.12.56 or earlier of mod 'Fabric Language Kotlin' (fabric-language-kotlin), but only the wrong version is present: 1.13.1+kotlin.2.1.0!
\tat net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)`,
  missing: `[21:38:58] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
\t - Install fabric-api, any version.
More details:
\t - Mod 'Sodium' (sodium) 0.5.3 requires any version of fabric-api, which is missing!`,
  minecraft: `[21:39:25] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
\t - Replace 'Minecraft' (minecraft) 1.21.11 with version 1.20.1.
More details:
\t - Mod 'Xaero's Minimap' (xaerominimap) 23.9.0 requires version 1.20.1 of 'Minecraft' (minecraft), but only the wrong version is present: 1.21.11!`,
  breaks: `[21:39:57] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
\t - Replace mod 'Breaker Test' (breakertest) 1.0.0 with any version that is compatible with:
\t\t - victimtest 2.0.0
More details:
\t - Mod 'Breaker Test' (breakertest) 1.0.0 is incompatible with any version of mod 'Victim Test' (victimtest), yet a conflicting version is present: 2.0.0!`,
  loader: `[21:40:30] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
\t - Replace mod 'Fabric Loader' (fabricloader) 0.19.5 with version 0.20.0 or later.
More details:
\t - Mod 'New Loader Test' (newloadertest) 1.0.0 requires version 0.20.0 or later of mod 'Fabric Loader' (fabricloader), but only the wrong version is present: 0.19.5!`,
  range: `[21:41:02] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
\t - Replace mod 'Lib Test' (libtest) 3.1.0 with any version between 2.0 (inclusive) and 3.0 (exclusive).
More details:
\t - Mod 'Range Test' (rangetest) 1.0.0 requires any version between 2.0 (inclusive) and 3.0 (exclusive) of mod 'Lib Test' (libtest), but only the wrong version is present: 3.1.0!`
}

// Real output of Quilt Loader 0.30.2 from the same kind of runs, as it lands
// in the log after "Partial Report:".
const QUILT = {
  mismatch: `[22:00:37] [ERROR] [Quilt Loader/]: Partial Report:
---- Quilt Loader: Failed to load ----
Date/Time: 2026/11/02 22:00:37.9740 [+0100]
Quilt Loader Version: 0.30.2

-- Error 1 --

Zoomify requires version (-?, 1.12.56] of fabric-language-kotlin, but only wrong versions are present:

- version 1.13.1+kotlin.2.1.0 from <mods>/flk-1131.jar

Zoomify is loaded from <mods>/zf-217.jar


-- Plugin State --

Cycle number = 1`,
  minecraft: `---- Quilt Loader: Failed to load ----
-- Error 1 --
Xaero's Minimap requires version [1.20.1, 1.20.1] of minecraft, but only wrong versions are present:
- version 1.21.11 from <game>/.cache/quilt_loader/remappedJars/minecraft-1.21.11-0.30.2/client-intermediary.jar
Xaero's Minimap is loaded from <mods>/xm-1201.jar
-- Plugin State --`,
  breaks: `---- Quilt Loader: Failed to load ----
-- Error 1 --
Breaker Test breaks all versions of victimtest, which is present!
- <mods>/breakertest.jar
-- Plugin State --`,
  loader: `---- Quilt Loader: Failed to load ----
-- Error 1 --
New Loader Test requires version [0.20.0, ?) of fabricloader, but only wrong versions are present:
- version 0.19.5 provided by Quilt Loader from /Users/x/libs/quilt-loader-0.30.2.jar
New Loader Test is loaded from <mods>/newloadertest.jar
-- Plugin State --`,
  missing: `---- Quilt Loader: Failed to load ----
-- Error 1 --
Sodium Test requires any version of fabric-api, which is missing!
Sodium Test is loaded from <mods>/sodiumtest.jar
-- Plugin State --`
}

// Forge and NeoForge print these from ModSorter with String.format, the
// header through log4j (here as the launcher's log parser passes it on).
const FORGE = `[main/ERROR] Missing or unsupported mandatory dependencies:
\tMod ID: 'geckolib', Requested by: 'mobmod', Expected range: '[4.4.9,4.5)', Actual version: '4.6.0'
\tMod ID: 'cloth_config', Requested by: 'mobmod', Expected range: '[15.0,)', Actual version: '[MISSING]'
\tMod ID: 'minecraft', Requested by: 'oldmod', Expected range: '[1.20,1.21)', Actual version: '1.21.1'
\tMod ID: 'neoforge', Requested by: 'mobmod', Expected range: '[21.1.200,)', Actual version: '21.1.77'
[main/ERROR] Incompatibilities between mods:
\tMod 'breakermod' is incompatible with 'victimmod', versions: '[1.0,)'; Version found: '2.0'`

try {
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
  const providersStub = join(work, 'providers.js')
  writeFileSync(
    providersStub,
    `module.exports = {
       bestVersionFor: async (provider, projectId, mc) => {
         const pick = globalThis.__lgBest[projectId]
         return pick ? pick(mc) : null
       },
       getVersions: async (provider, projectId) => globalThis.__lgAll[projectId] || [],
       getProject: async (provider, id) => ({
         projectId: id,
         slug: Object.keys(globalThis.__lgSlugs).find((slug) => globalThis.__lgSlugs[slug].projectId === id) ?? id,
         type: 'mod', name: 'Projekt ' + id, author: 'Test', summary: '', pageUrl: ''
       }),
       modrinth: {
         getProject: async (id) => {
           const known = globalThis.__lgSlugs[id]
           if (known) return { projectId: known.projectId, slug: id, type: 'mod', name: known.name, author: 'Test', summary: '', pageUrl: '' }
           // Asked by project id, Modrinth answers with the real slug too.
           const byId = Object.entries(globalThis.__lgSlugs).find(([, value]) => value.projectId === id)
           if (byId) return { projectId: id, slug: byId[0], type: 'mod', name: byId[1].name, author: 'Test', summary: '', pageUrl: '' }
           if (!globalThis.__lgAll[id] && !globalThis.__lgBest[id]) throw new Error('HTTP 404')
           return { projectId: id, slug: id, type: 'mod', name: 'Projekt ' + id, author: 'Test', summary: '', pageUrl: '' }
         },
         lookupByHash: async () => null,
         lookupByHashes: async (hashes) => ({ found: new Map(), answered: new Set(hashes) }),
         projectBasics: async () => new Map()
       },
       curseforge: { getProject: async (id) => ({ projectId: id, type: 'mod', name: id }) }
     }`
  )
  const loadersStub = join(work, 'loaders.js')
  writeFileSync(
    loadersStub,
    `module.exports = {
       listLoaderVersions: async (loader) => {
         if (globalThis.__lgLoadersOffline) throw new Error('offline')
         return globalThis.__lgLoaders[loader] || []
       },
       resolveLatestLoaderVersion: async (loader) => (globalThis.__lgLoaders[loader] || [])[0]?.version || '',
       installLoader: async (loader, mc, build) => loader + '-' + build + '-' + mc,
       availableLoaders: async () => ['fabric']
     }`
  )
  // Passes everything to the real fs, except that the one file named in
  // `globalThis.__lgLocked` can be neither renamed nor deleted, the way a
  // virus scanner holding it behaves.
  const fsShim = join(work, 'fs-shim.js')
  writeFileSync(
    fsShim,
    `const real = require('fs')
     const locked = (path) => typeof globalThis.__lgLocked === 'string' && String(path).toLowerCase() === globalThis.__lgLocked.toLowerCase()
     const refuse = () => { const err = new Error('EPERM: gesperrt (Test)'); err.code = 'EPERM'; throw err }
     module.exports = new Proxy(real, {
       get(target, prop, receiver) {
         if (prop === 'renameSync') return (from, to) => (locked(from) ? refuse() : target.renameSync(from, to))
         if (prop === 'rmSync') return (path, options) => (locked(path) ? refuse() : target.rmSync(path, options))
         if (prop === 'unlinkSync') return (path) => (locked(path) ? refuse() : target.unlinkSync(path))
         return Reflect.get(target, prop, receiver)
       }
     })`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       crash: require(${JSON.stringify(join(root, 'src/main/core/crashHelp.ts'))}),
       compat: require(${JSON.stringify(join(root, 'src/main/core/compat.ts'))}),
       content: require(${JSON.stringify(join(root, 'src/main/core/content.ts'))}),
       instances: require(${JSON.stringify(join(root, 'src/main/core/instances.ts'))}),
       log: require(${JSON.stringify(join(root, 'src/main/core/instanceLog.ts'))}),
       paths: require(${JSON.stringify(join(root, 'src/main/paths.ts'))}),
       lock: require(${JSON.stringify(join(root, 'src/main/core/contentLock.ts'))})
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
          build.onResolve({ filter: /^\.\.\/providers$/ }, () => ({ path: providersStub }))
          build.onResolve({ filter: /^\.\.\/loaders$/ }, () => ({ path: loadersStub }))
          build.onResolve({ filter: /^node:fs$/ }, () => ({ path: fsShim }))
        }
      }
    ],
    logLevel: 'error'
  })

  globalThis.__lgAll = {}
  globalThis.__lgBest = {}
  globalThis.__lgSlugs = {}
  // Loader builds per loader, newest first like the real lists.
  globalThis.__lgLoaders = {
    fabric: [
      { version: '0.20.2-beta.1', stable: false },
      { version: '0.20.1', stable: true },
      { version: '0.20.0', stable: true },
      { version: '0.19.5', stable: true }
    ],
    quilt: [
      { version: '0.30.2', stable: true },
      { version: '0.29.0', stable: true }
    ],
    neoforge: [
      { version: '21.1.77', stable: true },
      { version: '21.1.215-beta', stable: false },
      { version: '21.1.209', stable: true }
    ]
  }
  const { crash, compat, content, instances, log, paths, lock } = require(out)
  const withContentLockFor = (id, work) => lock.withContentLock(id, work)
  const p = paths.paths

  // --- 1. Reading Fabric's report ------------------------------------------------
  const mm = crash.parseFabricReport(FABRIC.mismatch)
  check(mm?.solutions.length === 1 && mm.solutions[0].kind === 'replace', `Lösung beim Versionskonflikt: ${JSON.stringify(mm?.solutions)}`)
  check(mm?.solutions[0].mod.id === 'fabric-language-kotlin' && mm.solutions[0].mod.version === '1.13.1+kotlin.2.1.0', `Zu ersetzender Mod: ${JSON.stringify(mm?.solutions[0])}`)
  check(mm?.solutions[0].range === 'version 1.12.56 or earlier', `Bereich: ${mm?.solutions[0].range}`)
  const mmd = mm?.details[0]
  check(mmd?.kind === 'mismatch' && mmd.mod.id === 'zoomify' && mmd.dep.id === 'fabric-language-kotlin' && mmd.present[0] === '1.13.1+kotlin.2.1.0', `Einzelheit: ${JSON.stringify(mmd)}`)

  const ms = crash.parseFabricReport(FABRIC.missing)
  check(ms?.solutions[0]?.kind === 'install' && ms.solutions[0].mod.id === 'fabric-api', `Fehlender Mod, Lösung: ${JSON.stringify(ms?.solutions)}`)
  check(ms?.details[0]?.kind === 'missing' && ms.details[0].dep.id === 'fabric-api' && ms.details[0].mod.id === 'sodium', `Fehlender Mod, Einzelheit: ${JSON.stringify(ms?.details)}`)

  const mc = crash.parseFabricReport(FABRIC.minecraft)
  check(mc?.details[0]?.mod.name === "Xaero's Minimap" && mc.details[0].mod.id === 'xaerominimap', `Name mit Apostroph: ${JSON.stringify(mc?.details[0]?.mod)}`)
  check(mc?.solutions[0]?.kind === 'replace' && mc.solutions[0].mod.id === 'minecraft', `Minecraft-Lösung: ${JSON.stringify(mc?.solutions)}`)

  const br = crash.parseFabricReport(FABRIC.breaks)
  check(br?.solutions[0]?.kind === 'refit' && br.solutions[0].mod.id === 'breakertest', `Konflikt, Lösung: ${JSON.stringify(br?.solutions)}`)
  check(br?.details[0]?.kind === 'breaks' && br.details[0].dep.id === 'victimtest', `Konflikt, Einzelheit: ${JSON.stringify(br?.details)}`)

  const ld = crash.parseFabricReport(FABRIC.loader)
  check(ld?.solutions[0]?.mod.id === 'fabricloader' && ld.solutions[0].range === 'version 0.20.0 or later', `Loader: ${JSON.stringify(ld?.solutions)}`)
  const rg = crash.parseFabricReport(FABRIC.range)
  check(rg?.solutions[0]?.range === 'any version between 2.0 (inclusive) and 3.0 (exclusive)', `Bereich zwischen: ${JSON.stringify(rg?.solutions)}`)

  check(crash.parseFabricReport('[main/INFO]: Loading 107 mods') === null, 'Ein normales Log wurde als Bericht gelesen')
  // Fabric in another language (here Spanish): no guess.
  check(crash.parseFabricReport('Incompatible mods found!\n\t - Reemplaza el mod ...') === null, 'Ein fremdsprachiger Bericht wurde gelesen')

  // --- 2. Ranges and comparisons -------------------------------------------------
  const r = (text) => crash.parseRange(text)
  const earlier = r('version 1.12.56 or earlier')
  check(earlier?.test('1.12.56+kotlin.2.0.0') && earlier.test('1.12.9') && !earlier.test('1.13.1+kotlin.2.1.0'), 'Bereich "or earlier"')
  check(earlier?.de === 'Version 1.12.56 oder älter', `Bereich auf Deutsch: ${earlier?.de}`)
  const between = r('any version between 2.0 (inclusive) and 3.0 (exclusive)')
  check(between?.test('2.0') && between.test('2.9.9') && !between.test('3.0') && !between.test('3.1.0'), 'Bereich "between"')
  const either = r('any 1.12.x version or version 2.0 or later')
  check(either?.test('1.12.3') && either.test('2.5') && !either.test('1.13.0'), 'Bereich mit "or"')
  check(r('version 0.20.0 or later')?.test('0.20.1') && !r('version 0.20.0 or later')?.test('0.19.5'), 'Bereich "or later"')
  check(r('version 1.20.1')?.test('1.20.1') && !r('version 1.20.1')?.test('1.20.2'), 'Bereich "version"')
  check(r('any version')?.test('0.0.1'), 'Bereich "any version"')
  check(r('etwas Unbekanntes') === null, 'Ein unbekannter Bereich wurde gelesen')
  check(crash.compareVersions('1.0.0-beta.2', '1.0.0') < 0 && crash.compareVersions('1.0.0-beta.10', '1.0.0-beta.2') > 0, 'Vorabversionen')
  check(crash.compareVersions('0.92.0+1.20.1', '0.92.0+1.21') === 0, 'Build-Angabe nach + zählt nicht')

  // --- 3. Release names --------------------------------------------------------------
  const names = [
    ['mc1.20.1-0.5.3', '1.20.1', '0.5.3'],
    ['0.92.0+1.20.1', '1.20.1', '0.92.0'],
    ['1.13.14+kotlin.2.2.21', '26.2', '1.13.14'],
    ['23.9.0_Fabric_1.20', '1.20.1', '23.9.0'],
    ['3.9.7+26.2-fabric', '26.2', '3.9.7'],
    ['1.0.0-beta.3', '1.21.11', '1.0.0-beta.3'],
    ['0.5.3-mc1.20', '1.20.1', '0.5.3'],
    ['1.20.1-2.4.0', '1.20.1', '2.4.0'],
    ['fabric-1.2.3', '1.21.11', '1.2.3']
  ]
  for (const [name, game, expected] of names) {
    const got = crash.modVersionOf(name, game)
    check(got === expected, `Versionsname "${name}": ${got} statt ${expected}`)
  }

  // --- 4. Crash, fix, held -----------------------------------------------------------
  const flkFor = (id, number, released, games = ['1.21.11']) =>
    release('flk', id, number, games, released, 'fabric-language-kotlin')
  const flkNew = flkFor('flk-1132', '1.13.2+kotlin.2.1.0', '2026-10-20T00:00:00Z')
  const flkCur = flkFor('flk-1131', '1.13.1+kotlin.2.1.0', '2026-10-01T00:00:00Z')
  const flkOther = flkFor('flk-11260', '1.12.60+kotlin.2.0.0', '2026-09-01T00:00:00Z', ['1.20.1'])
  const flkOld = flkFor('flk-11256', '1.12.56+kotlin.2.0.0', '2026-08-01T00:00:00Z')
  const flkOlder = flkFor('flk-11255', '1.12.55+kotlin.2.0.0', '2026-07-01T00:00:00Z')
  globalThis.__lgAll.flk = [flkNew, flkCur, flkOther, flkOld, flkOlder]
  globalThis.__lgBest.flk = () => flkNew
  const zoom = release('zoomify', 'zf-217', '2.17.0', ['1.21.11'], '2026-10-01T00:00:00Z', 'zoomify')
  globalThis.__lgAll.zoomify = [zoom]
  globalThis.__lgBest.zoomify = () => zoom

  const NAMES = { flk: 'Fabric Language Kotlin', zoomify: 'Zoomify', geckolib: 'GeckoLib', mobmod: 'Mob Mod', oldmod: 'Old Mod' }
  /** An instance whose mods folder and record hold `releases`. */
  function makeInstance(id, mcVersion, releases, loader = 'fabric') {
    mkdirSync(p.mods(id), { recursive: true })
    const items = releases.map((v, i) => {
      writeFileSync(join(p.mods(id), v.fileName), served.get(`/${v.fileName}`))
      return {
        id: `${id}-${i}`,
        type: 'mod',
        provider: 'modrinth',
        fileName: v.fileName,
        name: NAMES[v.projectId] ?? v.projectId,
        version: v.versionNumber,
        versionId: v.versionId,
        projectId: v.projectId,
        sha1: v.sha1,
        size: v.size,
        enabled: true,
        gameVersions: v.gameVersions,
        loaders: v.loaders,
        dependencies: [],
        installedAt: Date.now() - 86400000,
        releasedAt: v.releasedAt,
        update: null
      }
    })
    writeFileSync(
      p.instanceFile(id),
      JSON.stringify({ name: id, mcVersion, loader, loaderVersion: '0.19.5', installed: true, content: items })
    )
  }
  const crashed = (id, text) => {
    const startedAt = Date.now() - 50
    for (const line of text.split('\n')) log.pushLog({ instanceId: id, stream: 'stdout', level: 'error', text: line, time: Date.now() })
    return crash.rememberCrash(id, startedAt)
  }

  // All instances exist before the first one is read: the list is loaded once.
  const sodium = release('sodium', 'so-053', 'mc1.21.11-0.5.3', ['1.21.11'], '2026-10-01T00:00:00Z', 'sodium')
  const api = release('P7dR8mSH', 'api-1', '0.141.0+1.21.11', ['1.21.11'], '2026-10-01T00:00:00Z', 'fabric-api')
  globalThis.__lgBest.P7dR8mSH = () => api
  globalThis.__lgSlugs['fabric-api'] = { projectId: 'P7dR8mSH', name: 'Fabric API' }
  const xOld = release('xaero', 'xm-1201', '23.9.0', ['1.20.1'], '2026-01-01T00:00:00Z', 'xaerominimap')
  const xNew = release('xaero', 'xm-12111', '25.2.0', ['1.21.11'], '2026-10-01T00:00:00Z', 'xaerominimap')
  globalThis.__lgAll.xaero = [xNew, xOld]
  globalThis.__lgBest.xaero = (game) => (game === '1.21.11' ? xNew : null)
  const odd = release('odd', 'odd-1', 'Release 7', ['1.21.11'], '2026-10-01T00:00:00Z', 'fabric-language-kotlin')
  globalThis.__lgAll.odd = [odd]
  makeInstance('absturz', '1.21.11', [zoom, flkCur])
  makeInstance('waehlen', '1.21.11', [flkNew])
  makeInstance('fehlt', '1.21.11', [sodium])
  makeInstance('minecraft', '1.21.11', [xOld])
  makeInstance('raten', '1.21.11', [zoom, odd])
  makeInstance('quilt', '1.21.11', [zoom, flkCur, xOld], 'quilt')
  // Fabric API 0.140 carries Fabric Rendering 4.0.0 as a nested jar, and
  // Iris asks for 5.0.0 or later of that module.
  const apiOld = release('P7dR8mSH', 'api-0', '0.140.0+1.21.11', ['1.21.11'], '2026-09-01T00:00:00Z', 'fabric-api', ['fabric'], {
    jars: [{ file: 'META-INF/jars/fabric-api-base-0.4.42+6573ed8c19.jar' }, { file: 'META-INF/jars/fabric-rendering-v1-4.0.0+abc.jar' }]
  })
  const iris = release('iris', 'iris-180', '1.8.0', ['1.21.11'], '2026-10-01T00:00:00Z', 'iris')
  NAMES.P7dR8mSH = 'Fabric API'
  NAMES.iris = 'Iris'
  makeInstance('modul', '1.21.11', [iris, apiOld])
  makeInstance('ohnetraeger', '1.21.11', [iris])
  makeInstance('gesperrt', '1.21.11', [flkCur])
  // Fabric API installed but switched off.
  makeInstance('abhaengig', '1.21.11', [apiOld])
  {
    const record = JSON.parse(readFileSync(p.instanceFile('abhaengig'), 'utf8'))
    record.content[0].enabled = false
    record.content[0].fileName = `${apiOld.fileName}.disabled`
    renameSync(join(p.mods('abhaengig'), apiOld.fileName), join(p.mods('abhaengig'), `${apiOld.fileName}.disabled`))
    writeFileSync(p.instanceFile('abhaengig'), JSON.stringify(record))
  }
  // Fabric API missing entirely, and installed but too old to carry a module.
  makeInstance('apifehlt', '1.21.11', [sodium])
  makeInstance('apizualt', '1.21.11', [sodium, apiOld])
  // Quilt with Quilted Fabric API, which stands in for "fabric-api", and a
  // mod that requires Fabric API.
  makeInstance('qfapi', '1.21.11', [zoom], 'quilt')
  {
    const qfapiJar = new AdmZip()
    qfapiJar.addFile(
      'quilt.mod.json',
      Buffer.from(
        JSON.stringify({
          schema_version: 1,
          quilt_loader: {
            id: 'quilted_fabric_api',
            version: '7.7.0+0.92.2-1.21.11',
            metadata: { name: 'Quilted Fabric API' },
            provides: [{ id: 'fabric-api', version: '0.92.2' }, { id: 'fabric', version: '0.92.2' }]
          }
        })
      )
    )
    writeFileSync(join(p.mods('qfapi'), 'qfapi-7.7.0.jar'), qfapiJar.toBuffer())
    const record = JSON.parse(readFileSync(p.instanceFile('qfapi'), 'utf8'))
    record.content[0].dependencies = [{ type: 'required', projectId: 'P7dR8mSH' }]
    record.content.push({
      id: 'qfapi-x', type: 'mod', provider: 'modrinth', projectId: 'qvIfYCYJ', versionId: 'qf-1', fileName: 'qfapi-7.7.0.jar',
      name: 'Quilted Fabric API', version: '7.7.0', enabled: true, gameVersions: ['1.21.11'], loaders: ['quilt'],
      dependencies: [], installedAt: Date.now(), update: null
    })
    writeFileSync(p.instanceFile('qfapi'), JSON.stringify(record))
  }
  // The same, but switched off by a version change because nothing fit.
  makeInstance('wechselaus', '1.21.11', [apiOld])
  {
    const record = JSON.parse(readFileSync(p.instanceFile('wechselaus'), 'utf8'))
    record.content[0].enabled = false
    record.content[0].disabledByVersionChange = true
    record.content[0].fileName = `${apiOld.fileName}.disabled`
    renameSync(join(p.mods('wechselaus'), apiOld.fileName), join(p.mods('wechselaus'), `${apiOld.fileName}.disabled`))
    writeFileSync(p.instanceFile('wechselaus'), JSON.stringify(record))
  }
  // A setup that never got to pin a loader build, as one that failed offline.
  mkdirSync(p.mods('ohneloader'), { recursive: true })
  writeFileSync(
    p.instanceFile('ohneloader'),
    JSON.stringify({ name: 'ohneloader', mcVersion: '1.21.11', loader: 'fabric', loaderVersion: '', installed: false, content: [] })
  )

  // NeoForge 1.21.1: GeckoLib 4.6.0 where Mob Mod wants [4.4.9,4.5), Cloth
  // Config missing, Old Mod built for 1.20, Breaker refusing Victim.
  const neo = (projectId, versionId, number, games, released, modId) =>
    release(projectId, versionId, number, games, released, modId, ['neoforge'])
  const gl460 = neo('geckolib', 'gl-460', 'geckolib-neoforge-1.21.1-4.6.0', ['1.21.1'], '2026-10-01T00:00:00Z', 'geckolib')
  const gl4412 = neo('geckolib', 'gl-4412', 'geckolib-neoforge-1.21.1-4.4.12', ['1.21.1'], '2026-09-01T00:00:00Z', 'geckolib')
  const gl4410 = neo('geckolib', 'gl-4410', 'geckolib-neoforge-1.21.1-4.4.10', ['1.21.1'], '2026-08-01T00:00:00Z', 'geckolib')
  const gl4413old = neo('geckolib', 'gl-4413-120', 'geckolib-neoforge-1.20.4-4.4.13', ['1.20.4'], '2026-09-15T00:00:00Z', 'geckolib')
  globalThis.__lgAll.geckolib = [gl460, gl4413old, gl4412, gl4410]
  globalThis.__lgBest.geckolib = () => gl460
  const mob = neo('mobmod', 'mob-1', '2.0.0', ['1.21.1'], '2026-10-01T00:00:00Z', 'mobmod')
  const oldMod = neo('oldmod', 'old-120', '1.0.0', ['1.20.1'], '2026-01-01T00:00:00Z', 'oldmod')
  const oldMod121 = neo('oldmod', 'old-121', '1.1.0', ['1.21.1'], '2026-10-01T00:00:00Z', 'oldmod')
  globalThis.__lgBest.oldmod = (game) => (game === '1.21.1' ? oldMod121 : null)
  const breaker = neo('breakermod', 'br-1', '1.0.0', ['1.21.1'], '2026-10-01T00:00:00Z', 'breakermod')
  const victim = neo('victimmod', 'vi-2', '2.0', ['1.21.1'], '2026-10-01T00:00:00Z', 'victimmod')
  const cloth = neo('9s6osm5g', 'cl-15', '15.0.140', ['1.21.1'], '2026-10-01T00:00:00Z', 'cloth_config')
  globalThis.__lgBest['9s6osm5g'] = () => cloth
  globalThis.__lgSlugs['cloth-config'] = { projectId: '9s6osm5g', name: 'Cloth Config API' }
  makeInstance('neoforge', '1.21.1', [mob, gl460, oldMod, breaker, victim], 'neoforge')
  // Two mods asking for different GeckoLib versions.
  const otherMod = neo('othermod', 'oth-1', '1.0.0', ['1.21.1'], '2026-10-01T00:00:00Z', 'othermod')
  makeInstance('zweimods', '1.21.1', [mob, otherMod, gl460], 'neoforge')
  // Fabric API missing, later put in by hand.
  makeInstance('vonhand', '1.21.11', [sodium])
  // An old report left in latest.log.
  makeInstance('altbericht', '1.21.11', [zoom, flkCur])

  check((await crashed('absturz', FABRIC.mismatch)) === true, 'Nach dem Absturz gab es keinen Vorschlag')
  let report = await compat.checkCompatibility('absturz')
  const first = report.issues[0]
  notes.push(`Vorschlag: ${first?.title} / ${first?.detail} / ${first?.fix?.label}`)
  check(first?.id === 'crash-replace-fabric-language-kotlin', `Erster Eintrag der Prüfung: ${JSON.stringify(first)}`)
  check(first?.severity === 'error' && report.launchable === false, 'Der Vorschlag hält den Start nicht an')
  check(first?.fix?.kind === 'install-version' && first.fix.versionId === 'flk-11256', `Gewählte Version: ${JSON.stringify(first?.fix)}`)
  check(/Zoomify braucht Fabric Language Kotlin: Version 1\.12\.56 oder älter/.test(first?.title ?? ''), `Titel: ${first?.title}`)

  report = await content.applyFix('absturz', first.fix).then(() => compat.checkCompatibility('absturz'))
  const flkAfter = () => instances.getInstance('absturz').content.find((c) => c.projectId === 'flk')
  check(flkAfter()?.versionId === 'flk-11256', `Nach dem Beheben: ${flkAfter()?.versionId}`)
  check(flkAfter()?.keepVersion === true, 'Die eingesetzte ältere Version ist nicht festgehalten')
  check(!report.issues.some((i) => i.id.startsWith('crash-')), `Der behobene Vorschlag ist noch da: ${report.issues.map((i) => i.id).join(', ')}`)
  check(report.launchable, `Nach dem Beheben nicht startbar: ${report.issues.map((i) => i.title).join(' | ')}`)

  await content.checkUpdates('absturz', undefined, false)
  check(!flkAfter()?.update, `Die Update-Prüfung bietet die festgehaltene Version wieder an: ${JSON.stringify(flkAfter()?.update)}`)
  const summary = instances.listInstances?.().find((i) => i.id === 'absturz')
  if (summary) check(summary.updateCount === 0, `Update-Zähler trotz Festhalten: ${summary.updateCount}`)
  const updated = await content.updateAll('absturz')
  check(updated === 0 && flkAfter()?.versionId === 'flk-11256', `"Alle aktualisieren" hat die festgehaltene Version getauscht (${updated}, ${flkAfter()?.versionId})`)

  // --- 5. Holding by hand --------------------------------------------------------------
  const flkItem = flkAfter()
  await content.setKeepVersion('absturz', flkItem.id, false)
  check(!flkAfter()?.keepVersion && flkAfter()?.update?.versionId === 'flk-1132', `Nach "Updates wieder zulassen": ${JSON.stringify({ keep: flkAfter()?.keepVersion, update: flkAfter()?.update })}`)
  await content.setKeepVersion('absturz', flkItem.id, true)
  check(flkAfter()?.keepVersion === true && !flkAfter()?.update, 'Nach "Version festhalten" ist das Update noch markiert')

  const pick = (versionId, holdIfOlder) =>
    content.installContent({ instanceId: 'waehlen', provider: 'modrinth', projectId: 'flk', versionId, type: 'mod', holdIfOlder })
  const flkIn = () => instances.getInstance('waehlen').content.find((c) => c.projectId === 'flk')
  await pick('flk-1131', true)
  check(flkIn()?.versionId === 'flk-1131' && flkIn()?.keepVersion === true, `Ältere Version gewählt: ${JSON.stringify({ v: flkIn()?.versionId, keep: flkIn()?.keepVersion })}`)
  await pick('flk-1132', true)
  check(flkIn()?.versionId === 'flk-1132' && !flkIn()?.keepVersion, 'Die neueste Version wurde festgehalten')
  await pick('flk-1131', undefined)
  check(!flkIn()?.keepVersion, 'Eine Installation ohne Wahl hat festgehalten')
  await content.checkUpdates('waehlen', undefined, false)
  check(flkIn()?.update?.versionId === 'flk-1132', 'Ohne Festhalten fehlt das Update')

  // --- 6. Missing mod ------------------------------------------------------------------
  await crashed('fehlt', FABRIC.missing)
  report = await compat.checkCompatibility('fehlt')
  const missing = report.issues.find((i) => i.id === 'crash-install-fabric-api')
  check(missing?.fix?.kind === 'install-dependency' && missing.fix.projectId === 'P7dR8mSH', `Fehlender Mod: ${JSON.stringify(missing)}`)
  check(/Sodium braucht Fabric API/.test(missing?.title ?? ''), `Titel beim fehlenden Mod: ${missing?.title}`)

  // --- 7. Mod for another Minecraft version --------------------------------------------
  await crashed('minecraft', FABRIC.minecraft)
  report = await compat.checkCompatibility('minecraft')
  const refit = report.issues.find((i) => i.id === 'crash-refit-xaerominimap')
  check(refit?.fix?.kind === 'install-version' && refit.fix.versionId === 'xm-12111', `Mod für andere Minecraft-Version: ${JSON.stringify(report.issues.map((i) => [i.id, i.fix]))}`)
  check(!report.issues.some((i) => i.id === 'crash-replace-minecraft'), 'Es wurde vorgeschlagen, Minecraft zu tauschen')

  // --- 8. Release names that do not carry Fabric's version -----------------------------
  await crashed('raten', FABRIC.mismatch)
  report = await compat.checkCompatibility('raten')
  const guess = report.issues.find((i) => i.id === 'crash-replace-fabric-language-kotlin')
  check(guess && guess.fix?.kind !== 'install-version', `Bei unklarem Versionsnamen wurde geraten: ${JSON.stringify(guess?.fix)}`)
  check(/Version wählen/.test(guess?.detail ?? ''), `Kein Hinweis auf "Version wählen": ${guess?.detail}`)

  // --- 9. A new start drops the old report ----------------------------------------------
  crash.forgetCrash('raten')
  report = await compat.checkCompatibility('raten')
  check(!report.issues.some((i) => i.id.startsWith('crash-')), 'Nach einem neuen Start ist der alte Bericht noch da')

  // --- 10. Quilt -------------------------------------------------------------------------
  const qm = crash.parseQuiltReport(QUILT.mismatch)
  const qd = qm?.details[0]
  check(qd?.kind === 'mismatch' && qd.mod.name === 'Zoomify' && qd.mod.file === 'zf-217.jar', `Quilt, fragender Mod: ${JSON.stringify(qd?.mod)}`)
  check(qd?.dep.id === 'fabric-language-kotlin' && qd.dep.file === 'flk-1131.jar' && qd.present[0] === '1.13.1+kotlin.2.1.0', `Quilt, Abhängigkeit: ${JSON.stringify(qd?.dep)} ${qd?.present}`)
  check(qd?.range === '(-?, 1.12.56]', `Quilt, Bereich: ${qd?.range}`)
  check(crash.parseQuiltReport(QUILT.missing)?.details[0]?.kind === 'missing', 'Quilt, fehlender Mod')
  const qb = crash.parseQuiltReport(QUILT.breaks)?.details[0]
  check(qb?.kind === 'breaks' && qb.mod.file === 'breakertest.jar' && qb.dep.id === 'victimtest', `Quilt, Konflikt: ${JSON.stringify(qb)}`)
  check(crash.parseQuiltReport(QUILT.loader)?.details[0]?.dep.file === undefined, 'Quilt, ein Pfad außerhalb des Mod-Ordners wurde als Datei gelesen')
  const qr = (text) => crash.parseQuiltRange(text)
  check(qr('(-?, 1.12.56]')?.test('1.12.56') && !qr('(-?, 1.12.56]')?.test('1.13.1'), 'Quilt-Bereich nach oben offen')
  check(qr('(-?, 1.12.56]')?.de === 'Version 1.12.56 oder älter', `Quilt-Bereich auf Deutsch: ${qr('(-?, 1.12.56]')?.de}`)
  check(qr('[0.20.0, ?)')?.test('0.20.1') && !qr('[0.20.0, ?)')?.test('0.19.5'), 'Quilt-Bereich nach unten offen')
  check(qr('[1.20.1, 1.20.1]')?.de === 'Version 1.20.1', `Quilt, genau eine Version: ${qr('[1.20.1, 1.20.1]')?.de}`)
  const qu = qr('{ [1.0, 2.0) U [3.0, ?) }')
  check(qu?.test('1.5') && qu.test('3.1') && !qu.test('2.5'), 'Quilt, mehrere Bereiche')

  // Read from logs/latest.log: the launcher's buffer holds nothing of it.
  const quiltLog = (text) => {
    mkdirSync(join(p.gameDir('quilt'), 'logs'), { recursive: true })
    writeFileSync(join(p.gameDir('quilt'), 'logs', 'latest.log'), text)
  }
  quiltLog(QUILT.mismatch)
  check((await crash.rememberCrash('quilt', Date.now() - 100)) === true, 'Quilt: Bericht aus latest.log nicht gelesen')
  report = await compat.checkCompatibility('quilt')
  const qfix = report.issues.find((i) => i.id === 'crash-replace-fabric-language-kotlin')
  check(qfix?.fix?.kind === 'install-version' && qfix.fix.versionId === 'flk-11256', `Quilt, Vorschlag: ${JSON.stringify(report.issues.map((i) => [i.id, i.fix?.versionId]))}`)
  check(/Zoomify braucht Fabric Language Kotlin: Version 1\.12\.56 oder älter/.test(qfix?.title ?? ''), `Quilt, Titel: ${qfix?.title}`)
  check(/Quilt den Start abgebrochen/.test(qfix?.detail ?? ''), `Quilt, Text nennt den Loader nicht: ${qfix?.detail}`)
  quiltLog(QUILT.minecraft)
  await crash.rememberCrash('quilt', Date.now() - 100)
  report = await compat.checkCompatibility('quilt')
  const qrefit = report.issues.find((i) => i.id.startsWith('crash-refit-'))
  check(qrefit?.fix?.kind === 'install-version' && qrefit.fix.versionId === 'xm-12111', `Quilt, Mod für andere Minecraft-Version: ${JSON.stringify(report.issues.map((i) => [i.id, i.fix]))}`)
  quiltLog(QUILT.loader)
  check((await crash.rememberCrash('quilt', Date.now() - 100)) === true, 'Quilt: zu alter Loader ohne Hinweis')
  report = await compat.checkCompatibility('quilt')
  // Quilt stands in for Fabric Loader under another number: its newest build.
  const qload = report.issues.find((i) => i.id === 'crash-replace-fabricloader')
  check(qload?.fix?.kind === 'change-loader' && qload.fix.loaderVersion === '0.30.2', `Quilt, Loader zu alt: ${JSON.stringify(qload)}`)
  check(qload?.fix?.label === 'Quilt Loader auf 0.30.2 aktualisieren', `Quilt, Knopf: ${qload?.fix?.label}`)
  // An older log file says nothing about this start.
  quiltLog(QUILT.mismatch)
  check((await crash.rememberCrash('quilt', Date.now() + 60000)) === false, 'Ein latest.log von vorher wurde gelesen')

  // --- 11. Forge and NeoForge -------------------------------------------------------------
  const fr = crash.parseForgeReport(FORGE)
  check(fr?.details.length === 5, `Forge, Anzahl: ${fr?.details.length}`)
  const [fGecko, fCloth, fMc, , fBreak] = fr?.details ?? []
  check(fGecko?.kind === 'mismatch' && fGecko.mod.id === 'mobmod' && fGecko.dep.id === 'geckolib' && fGecko.range === '[4.4.9,4.5)' && fGecko.present[0] === '4.6.0', `Forge, falsche Version: ${JSON.stringify(fGecko)}`)
  check(fCloth?.kind === 'missing' && fCloth.dep.id === 'cloth_config', `Forge, fehlend: ${JSON.stringify(fCloth)}`)
  check(fMc?.dep.id === 'minecraft', `Forge, Minecraft: ${JSON.stringify(fMc)}`)
  check(fBreak?.kind === 'breaks' && fBreak.mod.id === 'breakermod' && fBreak.dep.id === 'victimmod', `Forge, Konflikt: ${JSON.stringify(fBreak)}`)
  check(crash.parseForgeReport('[main/INFO] Loading 120 mods') === null, 'Ein normales Forge-Log wurde als Bericht gelesen')
  // Only a warning the game goes on after, so no report.
  check(crash.parseForgeReport("Conflicts between mods:\n\tMod 'a' discourages 'b', versions: '[1,)'; Version found: '2'") === null, 'Eine bloße Warnung wurde als Bericht gelesen')

  const mr = (text) => crash.parseMavenRange(text)
  check(mr('[4.4.9,4.5)')?.test('4.4.12') && !mr('[4.4.9,4.5)')?.test('4.5.0') && !mr('[4.4.9,4.5)')?.test('4.4.8'), 'Maven-Bereich')
  check(mr('(,1.13.14]')?.de === 'Version 1.13.14 oder älter', `Maven nach oben: ${mr('(,1.13.14]')?.de}`)
  check(mr('[15.0,)')?.de === 'Version 15.0 oder neuer', `Maven nach unten: ${mr('[15.0,)')?.de}`)
  check(mr('[1.0]')?.test('1.0') && !mr('[1.0]')?.test('1.1'), 'Maven, genau eine Version')
  check(mr('1.0')?.test('0.1') && mr('')?.test('9') && mr('*')?.test('9'), 'Maven, ohne Klammern ist jede Version recht')
  const multi = mr('[1.0,2.0),[3.0,)')
  check(multi?.test('1.5') && multi.test('3.2') && !multi.test('2.5'), 'Maven, mehrere Bereiche')
  const cm = crash.compareMaven
  check(cm('1.0-beta', '1.0') < 0 && cm('0.5.1.f', '0.5.1') > 0 && cm('1.0', '1.0.0') === 0 && cm('15.20.0.106', '15.2.0.27') > 0, 'Maven-Vergleich')
  const forgeNames = [
    ['jei-1.20.1-forge-15.20.0.106', '1.20.1', '15.20.0.106'],
    ['0.5.1.f', '1.20.1', '0.5.1.f'],
    ['geckolib-neoforge-1.21.1-4.4.9', '1.21.1', '4.4.9'],
    ['1.21.1-4.4.9', '1.21.1', '4.4.9'],
    ['create-1.21.1-6.0.4', '1.21.1', '6.0.4']
  ]
  for (const [name, game, expected] of forgeNames) {
    const got = crash.modVersionOf(name, game)
    check(got === expected, `Versionsname "${name}": ${got} statt ${expected}`)
  }

  check((await crashed('neoforge', FORGE)) === true, 'NeoForge: kein Vorschlag')
  report = await compat.checkCompatibility('neoforge')
  notes.push(`NeoForge: ${report.issues.filter((i) => i.id.startsWith('crash-')).map((i) => `${i.title} [${i.fix?.label ?? '-'}]`).join(' | ')}`)
  const nGecko = report.issues.find((i) => i.id === 'crash-replace-geckolib')
  check(nGecko?.fix?.kind === 'install-version' && nGecko.fix.versionId === 'gl-4412', `NeoForge, GeckoLib: ${JSON.stringify(nGecko?.fix)}`)
  check(/Mob Mod braucht GeckoLib: eine Version ab 4\.4\.9 und unter 4\.5/.test(nGecko?.title ?? ''), `NeoForge, Titel: ${nGecko?.title}`)
  const nCloth = report.issues.find((i) => i.id === 'crash-install-cloth_config')
  check(nCloth?.fix?.kind === 'install-dependency' && nCloth.fix.projectId === '9s6osm5g' && /Cloth Config API/.test(nCloth.title), `NeoForge, Cloth Config: ${JSON.stringify(nCloth)}`)
  const nOld = report.issues.find((i) => i.id === 'crash-refit-oldmod')
  check(nOld?.fix?.kind === 'install-version' && nOld.fix.versionId === 'old-121', `NeoForge, Mod für 1.20: ${JSON.stringify(nOld)}`)
  const nBreak = report.issues.find((i) => i.id === 'crash-refit-breakermod')
  check(nBreak?.fix?.kind === 'disable-content' && /verträgt sich nicht/.test(nBreak.title), `NeoForge, Konflikt: ${JSON.stringify(nBreak)}`)
  // The newest stable build in range, not the beta above it.
  const nLoader = report.issues.find((i) => i.id === 'crash-replace-neoforge')
  check(nLoader?.fix?.kind === 'change-loader' && nLoader.fix.loaderVersion === '21.1.209', `NeoForge, Loader: ${JSON.stringify(nLoader?.fix)}`)

  await content.applyFix('neoforge', nGecko.fix)
  const geckoNow = instances.getInstance('neoforge').content.find((c) => c.projectId === 'geckolib')
  check(geckoNow?.versionId === 'gl-4412' && geckoNow.keepVersion === true, `NeoForge, nach dem Beheben: ${JSON.stringify({ v: geckoNow?.versionId, keep: geckoNow?.keepVersion })}`)
  report = await compat.checkCompatibility('neoforge')
  check(!report.issues.some((i) => i.id === 'crash-replace-geckolib') && report.issues.some((i) => i.id === 'crash-refit-oldmod'), 'NeoForge: nach einem Fix verschwanden die falschen Einträge')

  // --- 12. The loader gets offered an update too ------------------------------------
  // "waehlen" runs Fabric Loader 0.19.5; 0.20.1 is the newest stable build.
  await content.checkUpdates('waehlen', undefined, false)
  check(instances.getInstance('waehlen').loaderUpdate === '0.20.1', `Loader-Update nicht gefunden: ${instances.getInstance('waehlen').loaderUpdate}`)
  await content.checkUpdates('neoforge', undefined, false)
  check(instances.getInstance('neoforge').loaderUpdate === '21.1.209', `NeoForge-Update: ${instances.getInstance('neoforge').loaderUpdate}`)
  const modsBefore = instances.getInstance('waehlen').content.map((c) => c.versionId).join(',')
  instances.setLoaderVersion('waehlen', '0.20.1')
  const afterLoader = instances.getInstance('waehlen')
  check(afterLoader.loaderVersion === '0.20.1' && !afterLoader.loaderUpdate, `Nach dem Umstellen: ${afterLoader.loaderVersion} / ${afterLoader.loaderUpdate}`)
  check(afterLoader.content.map((c) => c.versionId).join(',') === modsBefore, 'Das Umstellen des Loaders hat Mods verändert')
  await content.checkUpdates('waehlen', undefined, false)
  check(!instances.getInstance('waehlen').loaderUpdate, 'Auf dem neuesten Loader wird trotzdem ein Update angeboten')
  // Kept in the file, so it survives a restart of the launcher.
  const onDisk = JSON.parse(readFileSync(p.instanceFile('neoforge'), 'utf8'))
  check(onDisk.loaderUpdate === '21.1.209', `Nicht gespeichert: ${onDisk.loaderUpdate}`)

  // --- 13. A module of Fabric API is updated through Fabric API itself -------------
  const MODULE = `[21:40:11] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Replace mod 'Fabric Rendering (v1)' (fabric-rendering-v1) 4.0.0+abc with version 5.0.0 or later.
More details:
	 - Mod 'Iris' (iris) 1.8.0 requires version 5.0.0 or later of mod 'Fabric Rendering (v1)' (fabric-rendering-v1), but only the wrong version is present: 4.0.0+abc!`
  check((await crashed('modul', MODULE)) === true, 'Modul: kein Vorschlag nach dem Absturz')
  report = await compat.checkCompatibility('modul')
  const mod = report.issues.find((i) => i.id === 'crash-replace-fabric-rendering-v1')
  const apiItem = instances.getInstance('modul').content.find((c) => c.projectId === 'P7dR8mSH')
  notes.push(`Modul: ${mod?.title} / ${mod?.detail} / ${mod?.fix?.label}`)
  check(!/von Hand/.test(mod?.detail ?? ''), `Modul: als von Hand hinzugefügt bezeichnet: ${mod?.detail}`)
  check(
    mod?.fix?.kind === 'install-version' && mod.fix.versionId === 'api-1' && mod.fix.contentId === apiItem?.id,
    `Modul: kein Update von Fabric API angeboten: ${JSON.stringify(mod?.fix)}`
  )
  check(/Teil von Fabric API/.test(mod?.detail ?? ''), `Modul: Text nennt Fabric API nicht: ${mod?.detail}`)

  // No mod carries it: no claim it was added by hand, and Iris can be switched off.
  check((await crashed('ohnetraeger', MODULE)) === true, 'Ohne Träger: kein Vorschlag nach dem Absturz')
  report = await compat.checkCompatibility('ohnetraeger')
  const lone = report.issues.find((i) => i.id === 'crash-replace-fabric-rendering-v1')
  check(lone !== undefined && !/von Hand/.test(lone.detail ?? ''), `Ohne Träger: ${lone?.detail}`)
  check(lone?.fix?.kind === 'disable-content' && /Iris/.test(lone.fix.label), `Ohne Träger, Knopf: ${JSON.stringify(lone?.fix)}`)

  // --- 14. An update whose old file is locked is undone, not left doubled -----------
  await content.checkUpdates('gesperrt', undefined, false)
  const lockedItem = instances.getInstance('gesperrt').content.find((c) => c.projectId === 'flk')
  check(lockedItem?.update?.versionId === 'flk-1132', `Gesperrt: kein Update gefunden: ${JSON.stringify(lockedItem?.update)}`)
  const modsOf = (id) => readdirSync(p.mods(id)).sort().join(', ')
  globalThis.__lgLocked = join(p.mods('gesperrt'), lockedItem.fileName)
  let lockedError
  try {
    await content.applyUpdate('gesperrt', lockedItem.id)
  } catch (err) {
    lockedError = err
  }
  globalThis.__lgLocked = null
  check(lockedError !== undefined && /gesperrt|locked/.test(lockedError.message), `Gesperrt: das Update meldete Erfolg (${lockedError?.message})`)
  check(modsOf('gesperrt') === 'flk-1131.jar', `Gesperrt: im Mods-Ordner liegt danach: ${modsOf('gesperrt')}`)
  const afterLocked = instances.getInstance('gesperrt').content.filter((c) => c.type === 'mod')
  check(afterLocked.length === 1 && afterLocked[0].versionId === 'flk-1131', `Gesperrt: die Liste nach dem Fehlschlag: ${JSON.stringify(afterLocked.map((c) => c.versionId))}`)

  // Once the lock is gone the same update goes through and leaves nothing behind.
  await content.applyUpdate('gesperrt', lockedItem.id)
  check(modsOf('gesperrt') === 'flk-1132.jar', `Gesperrt, zweiter Versuch: im Mods-Ordner liegt: ${modsOf('gesperrt')}`)
  check(
    instances.getInstance('gesperrt').content.find((c) => c.projectId === 'flk')?.versionId === 'flk-1132',
    'Gesperrt, zweiter Versuch: die Liste nennt nicht die neue Version'
  )

  // --- 15. The first start of an instance without a loader build pins one -----------
  const newestFabric = globalThis.__lgLoaders.fabric[0].version
  const startId = await instances.resolveVersionId(instances.getInstance('ohneloader'))
  check(
    instances.getInstance('ohneloader').loaderVersion === newestFabric,
    `Ohne Loader-Version: nach dem Start steht dort „${instances.getInstance('ohneloader').loaderVersion}“ statt ${newestFabric}`
  )
  check(startId.includes(newestFabric), `Ohne Loader-Version: gestartet wurde ${startId}`)
  // Only looking, as the pre-launch check does, changes nothing.
  writeFileSync(
    p.instanceFile('ohneloader'),
    JSON.stringify({ ...JSON.parse(readFileSync(p.instanceFile('ohneloader'), 'utf8')), loaderVersion: '' })
  )
  instances.loadInstances(true)
  await instances.resolveVersionId(instances.getInstance('ohneloader'), false).catch(() => undefined)
  check(instances.getInstance('ohneloader').loaderVersion === '', 'Ohne Loader-Version: schon das Nachsehen hat die Version festgelegt')

  // --- 16. A required dependency that is switched off is switched back on -------------
  await content.installNewDependencies('abhaengig', {
    id: 'iris-neu', type: 'mod', provider: 'modrinth', name: 'Iris', dependencies: [{ type: 'required', projectId: 'P7dR8mSH' }]
  })
  const depAfter = instances.getInstance('abhaengig').content.find((c) => c.projectId === 'P7dR8mSH')
  check(depAfter?.enabled === true, `Ausgeschaltete Abhängigkeit blieb aus: ${JSON.stringify({ enabled: depAfter?.enabled, file: depAfter?.fileName })}`)
  check(existsSync(join(p.mods('abhaengig'), apiOld.fileName)), `Die Datei der Abhängigkeit heißt noch: ${readdirSync(p.mods('abhaengig')).join(', ')}`)
  // Switched off by a version change: its file is for the old game and stays off.
  await content.installNewDependencies('wechselaus', {
    id: 'iris-neu', type: 'mod', provider: 'modrinth', name: 'Iris', dependencies: [{ type: 'required', projectId: 'P7dR8mSH' }]
  })
  const changedAfter = instances.getInstance('wechselaus').content.find((c) => c.projectId === 'P7dR8mSH')
  check(changedAfter?.enabled === false, 'Vom Versionswechsel ausgeschaltet: die alte Abhängigkeit wurde wieder eingeschaltet')
  check(existsSync(join(p.mods('wechselaus'), `${apiOld.fileName}.disabled`)), `Vom Versionswechsel ausgeschaltet: im Ordner liegt ${readdirSync(p.mods('wechselaus')).join(', ')}`)

  // --- 17. Two mods asking for different versions: the pick suits both ---------------
  const TWO = `[main/ERROR] Missing or unsupported mandatory dependencies:
	Mod ID: 'geckolib', Requested by: 'mobmod', Expected range: '[4.4.9,4.5)', Actual version: '4.6.0'
	Mod ID: 'geckolib', Requested by: 'othermod', Expected range: '[4.4.9,4.4.11)', Actual version: '4.6.0'`
  check((await crashed('zweimods', TWO)) === true, 'Zwei Mods: kein Vorschlag')
  report = await compat.checkCompatibility('zweimods')
  const twoGecko = report.issues.find((i) => i.id === 'crash-replace-geckolib')
  notes.push(`Zwei Mods: ${twoGecko?.title} [${twoGecko?.fix?.label ?? '-'}]`)
  check(twoGecko?.fix?.kind === 'install-version' && twoGecko.fix.versionId === 'gl-4410', `Zwei Mods: gewählt ${JSON.stringify(twoGecko?.fix)}`)
  check(/Mob Mod und othermod brauchen GeckoLib/.test(twoGecko?.title ?? ''), `Zwei Mods, Titel: ${twoGecko?.title}`)

  // --- 18. A missing mod put in by hand ends the finding -----------------------------
  check((await crashed('vonhand', FABRIC.missing)) === true, 'Von Hand: kein Vorschlag')
  report = await compat.checkCompatibility('vonhand')
  check(report.issues.some((i) => i.id === 'crash-install-fabric-api'), 'Von Hand: der Vorschlag fehlt schon vorher')
  writeFileSync(join(p.mods('vonhand'), 'fabric-api-handgeladen.jar'), jarBytes('fabric-api', 'Fabric API', '0.141.0'))
  await instances.syncContentWithDisk('vonhand', { force: true })
  report = await compat.checkCompatibility('vonhand')
  check(!report.issues.some((i) => i.id === 'crash-install-fabric-api'), 'Von Hand installiert: der Vorschlag „fehlt“ bleibt stehen')

  // --- 19. A report from before this start is not this start's --------------------
  const oldLog = join(p.gameDir('altbericht'), 'logs', 'latest.log')
  mkdirSync(dirname(oldLog), { recursive: true })
  writeFileSync(oldLog, FABRIC.mismatch)
  const before = (Date.now() - 500) / 1000
  utimesSync(oldLog, before, before)
  check((await crash.rememberCrash('altbericht', Date.now())) === false, 'Der Bericht des vorigen Absturzes galt als neuer')

  // --- 20. The loader notice survives a failed lookup, its fix still applies --------
  check(instances.getInstance('neoforge').loaderUpdate === '21.1.209', `Vorher kein Loader-Hinweis: ${instances.getInstance('neoforge').loaderUpdate}`)
  globalThis.__lgLoadersOffline = true
  await content.checkUpdates('neoforge', undefined, false).catch(() => undefined)
  globalThis.__lgLoadersOffline = false
  check(instances.getInstance('neoforge').loaderUpdate === '21.1.209', `Nach einer gescheiterten Abfrage ist der Loader-Hinweis weg: ${instances.getInstance('neoforge').loaderUpdate}`)
  await content.applyFix('neoforge', nLoader.fix)
  check(instances.getInstance('neoforge').loaderVersion === '21.1.209', `Der Loader-Knopf der Absturzhilfe wirkt nicht: ${instances.getInstance('neoforge').loaderVersion}`)

  // --- 21. All of Fabric API missing: Fabric names one of its modules ----------------
  const MODULE_MISSING = `[21:38:58] [ERROR] [FabricLoader/]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
\t - Install fabric-resource-loader-v0, any version.
More details:
\t - Mod 'Sodium' (sodium) 0.5.3 requires any version of fabric-resource-loader-v0, which is missing!`
  check((await crashed('apifehlt', MODULE_MISSING)) === true, 'Fabric API fehlt: kein Vorschlag')
  report = await compat.checkCompatibility('apifehlt')
  const noApi = report.issues.find((i) => i.id === 'crash-install-fabric-resource-loader-v0')
  notes.push(`Fabric API fehlt: ${noApi?.title} [${noApi?.fix?.label ?? '-'}]`)
  check(noApi?.fix?.kind === 'install-dependency' && noApi.fix.projectId === 'P7dR8mSH', `Fabric API fehlt: angeboten wird ${JSON.stringify(noApi?.fix)}`)
  check(/Sodium braucht Fabric API/.test(noApi?.title ?? ''), `Fabric API fehlt, Titel: ${noApi?.title}`)
  // Put in by hand, the finding ends without another start.
  writeFileSync(join(p.mods('apifehlt'), 'fabric-api-handgeladen.jar'), jarBytes('fabric-api', 'Fabric API', '0.141.0'))
  await instances.syncContentWithDisk('apifehlt', { force: true })
  report = await compat.checkCompatibility('apifehlt')
  check(!report.issues.some((i) => i.id === 'crash-install-fabric-resource-loader-v0'), 'Fabric API von Hand installiert: der Fund blieb stehen')

  // Installed, but too old to carry the module: the update is offered.
  check((await crashed('apizualt', MODULE_MISSING)) === true, 'Fabric API zu alt: kein Vorschlag')
  report = await compat.checkCompatibility('apizualt')
  const oldApi = report.issues.find((i) => i.id === 'crash-install-fabric-resource-loader-v0')
  notes.push(`Fabric API zu alt: ${oldApi?.title} [${oldApi?.fix?.label ?? '-'}]`)
  check(oldApi?.fix?.kind === 'install-version' && oldApi.fix.versionId === 'api-1', `Fabric API zu alt: angeboten wird ${JSON.stringify(oldApi?.fix)}`)

  // --- 22. Quilted Fabric API counts as Fabric API --------------------------------
  report = await compat.checkCompatibility('qfapi')
  const needsApi = report.issues.find((i) => i.id.startsWith('dep-') && i.id.endsWith('P7dR8mSH'))
  check(!needsApi, `Quilted Fabric API: die Prüfung verlangt trotzdem Fabric API: ${needsApi?.title}`)
  const before22 = instances.getInstance('qfapi').content.length
  await content.installNewDependencies('qfapi', instances.getInstance('qfapi').content.find((c) => c.name === 'Zoomify'))
  check(
    instances.getInstance('qfapi').content.length === before22,
    `Quilted Fabric API: Fabric API wurde zusätzlich installiert: ${instances.getInstance('qfapi').content.map((c) => c.name).join(', ')}`
  )
  await instances.syncContentWithDisk('qfapi', { force: true })
  const qfRecord = instances.getInstance('qfapi').content.find((c) => c.name === 'Quilted Fabric API')
  check((qfRecord?.provides ?? []).includes('fabric-api'), `Quilted Fabric API: der Eintrag nennt nach dem Abgleich ${JSON.stringify(qfRecord?.provides)}`)

  // --- 23. A file an update left aside is swept, but not mid update ------------------
  const leftOver = join(p.mods('gesperrt'), 'flk-1131.jar.0a1b2c3d.replaced')
  writeFileSync(leftOver, 'alt')
  await withContentLockFor('gesperrt', () => instances.syncContentWithDisk('gesperrt', { force: true }))
  check(existsSync(leftOver), 'Beiseitegelegte Datei: während einer Arbeit an den Mods weggeräumt')
  await instances.syncContentWithDisk('gesperrt', { force: true })
  check(!existsSync(leftOver), 'Beiseitegelegte Datei: nach dem Abgleich noch da')
  check(
    !instances.getInstance('gesperrt').content.some((c) => c.fileName.includes('.replaced')),
    'Beiseitegelegte Datei: als Inhalt eingetragen'
  )
} catch (err) {
  problems.push(`Abbruch: ${err?.stack ?? err}`)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // a scanner holding a file: the temp folder goes later
  }
}

for (const note of notes) console.log(`  ${note}`)
console.log('')
if (problems.length === 0) console.log('  keine Probleme gefunden')
for (const problem of problems) console.log(`  FEHLER: ${problem}`)
console.log(`\nERGEBNIS: ${problems.length === 0 ? 'BESTANDEN' : `FEHLGESCHLAGEN (${problems.length})`}`)
process.exitCode = problems.length === 0 ? 0 : 1
