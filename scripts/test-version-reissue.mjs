/**
 * Prueft, dass eine gespeicherte Versionsdatei erneuert wird, wenn Mojang die
 * Version unter derselben Nummer neu ausstellt.
 *
 *   node scripts/test-version-reissue.mjs
 *
 * Am 25.11.2026 hat Mojang die Versionsdateien von 26.1 bis 26.3 still
 * geaendert, um eine reparierte FreeType-Bibliothek auszuliefern
 * ("Minecraft2Shell"). Der Launcher nahm bis dahin fuer immer die einmal
 * gespeicherte Datei, der Fix kam also nie an. Kein Netz noetig: `fetch` wird
 * durch eine Attrappe ersetzt, die Mojangs Versionsliste und Dateien spielt.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-reissue-'))

const problems = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const sha1 = (text) => createHash('sha1').update(text).digest('hex')
const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'
const fileUrl = (id) => `https://piston-meta.mojang.com/v1/packages/test/${id}.json`

/** A minimal version file, with the FreeType library in the given version. */
const versionText = (id, freetype) =>
  JSON.stringify({
    id,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    libraries: [{ name: `org.lwjgl:lwjgl-freetype:${freetype}` }]
  })

const OLD = '3.4.1'
const NEW = '3.4.1-mojang-2.15.0.3'

// What Mojang serves right now, per version id.
const served = {
  '26.2': versionText('26.2', NEW),
  '26.1': versionText('26.1', NEW),
  '26.3': versionText('26.3', NEW),
  '1.21.1': versionText('1.21.1', '3.3.3'),
  '1.21.4': versionText('1.21.4', NEW)
}

let mode = 'online'
const requests = []
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input)
  requests.push(url)
  if (mode === 'offline') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
  if (url === MANIFEST_URL) {
    const versions = Object.entries(served).map(([id, text]) => ({
      id,
      type: 'release',
      url: fileUrl(id),
      time: '2026-11-25T06:58:30+00:00',
      releaseTime: '2026-09-15T11:23:02+00:00',
      sha1: sha1(text)
    }))
    return new Response(JSON.stringify({ latest: { release: '26.3', snapshot: '26.3' }, versions }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  const id = Object.keys(served).find((key) => url === fileUrl(key))
  if (id) {
    if (mode === 'files-broken') return new Response('Service Unavailable', { status: 503 })
    return new Response(served[id], { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('not found', { status: 404 })
}

const keepAlive = setInterval(() => {}, 1000)

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  const data = join(work, 'data')
  mkdirSync(userData, { recursive: true })
  mkdirSync(join(data, 'meta'), { recursive: true })
  writeFileSync(join(userData, 'launcher.json'), JSON.stringify({ dataDirectory: data }))

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
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/mojang.ts'))})`)
  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    define: { 'process.env.LG_STALE_CACHE_DEADLINE_MS': JSON.stringify('300') },
    logLevel: 'error'
  })
  const { loadVersionJson } = require(out)

  const versionFile = (id) => join(data, 'versions', id, `${id}.json`)
  const store = (id, text) => {
    mkdirSync(dirname(versionFile(id)), { recursive: true })
    writeFileSync(versionFile(id), text)
  }
  const freetypeOf = (json) => json.libraries.find((l) => l.name.includes('lwjgl-freetype'))?.name.split(':')[2]
  const fileRequests = () => requests.filter((url) => url !== MANIFEST_URL).length
  const manifestCache = join(data, 'meta', 'version_manifest_v2.json')
  const leftovers = (id) => readdirSync(dirname(versionFile(id))).filter((name) => name.endsWith('.part'))

  // --- 1. Offline, no list at hand: the stored file, no error ------------
  store('26.1', versionText('26.1', OLD))
  mode = 'offline'
  let json = await loadVersionJson('26.1')
  check(freetypeOf(json) === OLD, `Offline: erwartet gespeicherte ${OLD}, bekam ${freetypeOf(json)}`)
  check(readFileSync(versionFile('26.1'), 'utf8') === versionText('26.1', OLD), 'Offline: die gespeicherte Datei wurde veraendert')
  console.log('Offline ohne Versionsliste: gespeicherte Datei genutzt, kein Fehler')

  // --- 2. Re-issued by Mojang: the new file replaces the stored one ------
  mode = 'online'
  rmSync(manifestCache, { force: true })
  store('26.2', versionText('26.2', OLD))
  requests.length = 0
  json = await loadVersionJson('26.2')
  check(freetypeOf(json) === NEW, `Neu ausgestellt: erwartet ${NEW}, bekam ${freetypeOf(json)}`)
  check(readFileSync(versionFile('26.2'), 'utf8') === served['26.2'], 'Neu ausgestellt: die Datei auf der Platte ist noch die alte')
  check(fileRequests() === 1, `Neu ausgestellt: ${fileRequests()} Dateiabrufe statt 1`)
  console.log(`Neu ausgestellt: ${OLD} durch ${NEW} ersetzt`)

  // --- 3. Unchanged: nothing is downloaded --------------------------------
  store('1.21.1', served['1.21.1'])
  requests.length = 0
  json = await loadVersionJson('1.21.1')
  check(freetypeOf(json) === '3.3.3', `Unveraendert: bekam ${freetypeOf(json)}`)
  check(fileRequests() === 0, `Unveraendert: trotzdem ${fileRequests()} Dateiabrufe`)
  console.log('Unveraendert: nichts geladen')

  // --- 4. The new file cannot be fetched: the stored one stays ------------
  store('26.3', versionText('26.3', OLD))
  mode = 'files-broken'
  json = await loadVersionJson('26.3')
  check(freetypeOf(json) === OLD, `Download scheitert: erwartet gespeicherte ${OLD}, bekam ${freetypeOf(json)}`)
  check(readFileSync(versionFile('26.3'), 'utf8') === versionText('26.3', OLD), 'Download scheitert: die gespeicherte Datei wurde beschaedigt')
  check(leftovers('26.3').length === 0, `Download scheitert: Reste liegen herum: ${leftovers('26.3').join(', ')}`)
  console.log('Download scheitert: gespeicherte Datei bleibt heil und in Gebrauch')

  // --- 5. Asked again right away: no second round on the network ----------
  requests.length = 0
  await loadVersionJson('26.3')
  check(requests.length === 0, `Gleich danach erneut: ${requests.length} Abrufe statt 0`)
  console.log('Gleich danach erneut: keine weitere Abfrage')

  // --- 6. A mod loader profile: left alone, its parent refreshed ----------
  mode = 'online'
  store('1.21.4', versionText('1.21.4', OLD))
  const loaderId = 'fabric-loader-0.19.3-1.21.4'
  const loaderText = JSON.stringify({ id: loaderId, inheritsFrom: '1.21.4', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', libraries: [] })
  store(loaderId, loaderText)
  json = await loadVersionJson(loaderId)
  check(freetypeOf(json) === NEW, `Mod-Loader: Elternversion nicht erneuert, bekam ${freetypeOf(json)}`)
  check(readFileSync(versionFile(loaderId), 'utf8') === loaderText, 'Mod-Loader: das Loader-Profil wurde angefasst')
  console.log('Mod-Loader: Profil unberuehrt, Minecraft-Version darunter erneuert')
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
  clearInterval(keepAlive)
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // a locked temp folder is no test failure
  }
}

if (problems.length) {
  console.log('\nPROBLEME:')
  for (const p of problems) console.log(`  - ${p}`)
  console.log('\nERGEBNIS: FEHLGESCHLAGEN')
  process.exit(1)
}
console.log('\nERGEBNIS: BESTANDEN')
