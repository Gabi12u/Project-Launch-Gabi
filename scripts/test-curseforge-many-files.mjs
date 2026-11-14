/**
 * Prueft, dass der Launcher auch bei CurseForge-Projekten mit sehr vielen
 * Dateien die passende Version findet.
 *
 *   node scripts/test-curseforge-many-files.mjs
 *
 * Die ungefilterte Dateiliste liest der Launcher nur bis 750 Dateien, neueste
 * zuerst. Just Enough Items hat ueber 3800. Eine aeltere Minecraft-Version wie
 * 1.12.2 lag dahinter, und der Launcher meldete "keine Version", obwohl es
 * eine gibt. Kein Netz noetig: `fetch` wird durch eine Attrappe der
 * CurseForge-API mit 3800 Dateien ersetzt, die Seiten und den Filter nach
 * Minecraft-Version so beantwortet wie die echte.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-cf-many-'))

const problems = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const PROJECT = 238222
const TOTAL = 3800
// Newest first, as the real list: the first 3000 files are for 1.21.1, the
// rest for 1.12.2, all far beyond the first 750.
const files = Array.from({ length: TOTAL }, (_, i) => {
  const old = i >= 3000
  return {
    id: 9_000_000 - i,
    modId: PROJECT,
    displayName: old ? `jei-1.12.2-${4.16 - i / 100000}` : `jei-1.21.1-${19 - i / 1000}`,
    fileName: `jei-${i}.jar`,
    releaseType: 1,
    fileDate: new Date(Date.UTC(2026, 0, 1) - i * 3_600_000).toISOString(),
    fileLength: 1000,
    downloadUrl: `https://edge.forgecdn.net/files/${i}/jei-${i}.jar`,
    gameVersions: old ? ['1.12.2', 'Forge'] : ['1.21.1', 'NeoForge'],
    hashes: [],
    dependencies: []
  }
})

const requests = []
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  requests.push(url.pathname + url.search)
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const single = /^\/v1\/mods\/(\d+)\/files\/(\d+)$/.exec(url.pathname)
  if (single) {
    const file = files.find((f) => String(f.id) === single[2])
    return file && String(file.modId) === single[1] ? json(200, { data: file }) : json(404, { error: 'not found' })
  }
  if (url.pathname === `/v1/mods/${PROJECT}/files`) {
    const index = Number(url.searchParams.get('index') ?? 0)
    const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 50), 50)
    const game = url.searchParams.get('gameVersion')
    const matching = game ? files.filter((f) => f.gameVersions.includes(game)) : files
    return json(200, {
      data: matching.slice(index, index + pageSize),
      pagination: { index, pageSize, resultCount: Math.min(pageSize, Math.max(0, matching.length - index)), totalCount: matching.length }
    })
  }
  return json(404, {})
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'launcher.json'), JSON.stringify({ dataDirectory: join(work, 'data'), curseForgeApiKey: 'test-schluessel' }))

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
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/providers/index.ts'))})`)

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

  const providers = require(out)

  // --- 1. Install for an old Minecraft version -----------------------------
  requests.length = 0
  const best = await providers.bestVersionFor('curseforge', String(PROJECT), '1.12.2', 'forge', 'mod')
  check(best !== null, 'Fuer 1.12.2 wurde keine Version gefunden, obwohl es 800 gibt')
  check(best?.gameVersions.includes('1.12.2') && best?.versionId === String(files[3000].id), `Gefunden: ${best?.versionId} (${best?.gameVersions})`)
  check(requests.length <= 20, `${requests.length} Abfragen fuer eine Installation`)
  console.log(`1.12.2 bei ${TOTAL} Dateien: ${best?.name ?? 'nichts'} mit ${requests.length} Abfragen`)

  // --- 2. The newest version still comes first ----------------------------
  const newest = await providers.bestVersionFor('curseforge', String(PROJECT), '1.21.1', 'neoforge', 'mod')
  check(newest?.versionId === String(files[0].id), `Neueste fuer 1.21.1: ${newest?.versionId}`)

  // --- 3. A version that does not exist stays missing ---------------------
  const none = await providers.bestVersionFor('curseforge', String(PROJECT), '1.7.10', 'forge', 'mod')
  check(none === null, `Fuer 1.7.10 gefunden: ${none?.versionId}`)

  // --- 4. A specific old file by its id -----------------------------------
  const oldId = String(files[3700].id)
  const picked = await providers.getVersion('curseforge', String(PROJECT), oldId)
  check(picked?.versionId === oldId, `Datei ${oldId} hinter den ersten 750: ${picked?.versionId ?? 'nicht gefunden'}`)
  const foreign = await providers.getVersion('curseforge', '1', oldId)
  check(foreign === null, 'Eine Datei wurde einem fremden Projekt zugeordnet')
  const missing = await providers.getVersion('curseforge', String(PROJECT), '123')
  check(missing === null, 'Eine nicht vorhandene Datei wurde gefunden')
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
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
