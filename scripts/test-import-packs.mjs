/**
 * Prueft die Modpack-Analyse an echten, hier gebauten Archiven.
 *
 *   node scripts/test-import-packs.mjs
 *
 * Baut echte .mrpack- und CurseForge-Zip-Dateien mit adm-zip (liegt ohnehin
 * im Projekt) und laesst die echte Analyse darauf los. Der eigentliche Import
 * eines Modpacks laedt die Mods einzeln von Modrinth beziehungsweise
 * CurseForge herunter, braucht also Netz und im CurseForge-Fall einen
 * API-Schluessel. Das ist hier bewusst nicht Teil der Pruefung, und der
 * Bericht sagt das auch, statt es zu verschweigen.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-packs-'))

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
    `const path = ${JSON.stringify(userData)}
     module.exports = {
       app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: class {},
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = require(${JSON.stringify(join(root, 'src/main/core/modpack.ts'))})`
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

  const { analyzeModpackFile } = require(out)

  /* ------------------------------------------------------------------ *
   * 1. Echtes .mrpack
   * ------------------------------------------------------------------ */
  const mrpackPath = join(work, 'TestPack.mrpack')
  {
    const zip = new AdmZip()
    zip.addFile(
      'modrinth.index.json',
      Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          game: 'minecraft',
          versionId: '1.0.0',
          name: 'Mein Testpack',
          summary: 'Nur zum Pruefen',
          files: [
            {
              path: 'mods/sodium.jar',
              hashes: { sha1: 'a'.repeat(40) },
              downloads: ['https://cdn.modrinth.com/data/AAAA/versions/BBBB/sodium.jar'],
              fileSize: 1234
            },
            {
              path: 'mods/lithium.jar',
              hashes: { sha1: 'b'.repeat(40) },
              downloads: ['https://cdn.modrinth.com/data/CCCC/versions/DDDD/lithium.jar'],
              fileSize: 2345
            },
            {
              path: 'mods/nurserver.jar',
              hashes: { sha1: 'c'.repeat(40) },
              env: { client: 'unsupported', server: 'required' },
              downloads: ['https://cdn.modrinth.com/data/EEEE/versions/FFFF/nurserver.jar'],
              fileSize: 999
            },
            {
              path: 'resourcepacks/hübsch.zip',
              hashes: { sha1: 'd'.repeat(40) },
              downloads: ['https://cdn.modrinth.com/data/GGGG/versions/HHHH/pack.zip'],
              fileSize: 500
            }
          ],
          dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.15.7' }
        })
      )
    )
    zip.addFile('overrides/config/sodium.json', Buffer.from('{"quality":"high"}'))
    zip.addFile('overrides/mods/handverlesen.jar', Buffer.from('LOKALER MOD'))
    zip.addFile('overrides/saves/Welt/level.dat', Buffer.from('WELT'))
    zip.writeZip(mrpackPath)
  }

  const mrpack = await analyzeModpackFile(mrpackPath)
  check(mrpack.kind === 'mrpack', `mrpack: erkannt als "${mrpack.kind}"`)
  check(mrpack.name === 'Mein Testpack', `mrpack: Name "${mrpack.name}"`)
  check(mrpack.mcVersion === '1.20.1', `mrpack: Version "${mrpack.mcVersion}"`)
  check(mrpack.loader === 'fabric', `mrpack: Loader "${mrpack.loader}"`)
  check(mrpack.loaderVersion === '0.15.7', `mrpack: Loader-Version "${mrpack.loaderVersion}"`)
  // 3 Mods aus dem Index plus 1 aus den Overrides
  check(mrpack.counts.mods === 4, `mrpack: ${mrpack.counts.mods} Mods statt 4`)
  check(mrpack.counts.resourcePacks === 1, `mrpack: ${mrpack.counts.resourcePacks} Packs statt 1`)
  check(mrpack.counts.configs === 1, `mrpack: ${mrpack.counts.configs} Konfigurationen statt 1`)
  check(mrpack.counts.worlds === 1, `mrpack: ${mrpack.counts.worlds} Welten statt 1`)
  check(mrpack.canImport === true, 'mrpack: canImport ist false')
  check(
    mrpack.findings.some((f) => f.title.includes('nur für Server')),
    'mrpack: kein Hinweis auf die reine Server-Datei'
  )
  notes.push(
    `mrpack: "${mrpack.name}", ${mrpack.mcVersion}/${mrpack.loader} ${mrpack.loaderVersion}, ` +
      `${mrpack.counts.mods} Mods, ${mrpack.counts.worlds} Welten, ${mrpack.findings.length} Befunde`
  )

  /* ------------------------------------------------------------------ *
   * 2. Echtes CurseForge-Zip
   * ------------------------------------------------------------------ */
  const cursePath = join(work, 'CursePack.zip')
  {
    const zip = new AdmZip()
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          minecraft: {
            version: '1.21.1',
            modLoaders: [{ id: 'neoforge-21.1.5', primary: true }]
          },
          name: 'Curse Testpack',
          version: '2.0',
          author: 'niemand',
          files: [
            { projectID: 1, fileID: 11, required: true },
            { projectID: 2, fileID: 22, required: true },
            { projectID: 3, fileID: 33, required: false }
          ],
          overrides: 'overrides'
        })
      )
    )
    zip.addFile('overrides/config/irgendwas.toml', Buffer.from('x=1'))
    zip.addFile('overrides/resourcepacks/pack.zip', Buffer.from('PACK'))
    zip.writeZip(cursePath)
  }

  const curse = await analyzeModpackFile(cursePath)
  check(curse.kind === 'curseforge-zip', `CurseForge: erkannt als "${curse.kind}"`)
  check(curse.name === 'Curse Testpack', `CurseForge: Name "${curse.name}"`)
  check(curse.mcVersion === '1.21.1', `CurseForge: Version "${curse.mcVersion}"`)
  check(curse.loader === 'neoforge', `CurseForge: Loader "${curse.loader}"`)
  check(curse.loaderVersion === '21.1.5', `CurseForge: Loader-Version "${curse.loaderVersion}"`)
  check(curse.counts.mods === 3, `CurseForge: ${curse.counts.mods} Mods statt 3`)
  check(curse.counts.configs === 1, `CurseForge: ${curse.counts.configs} Konfigurationen statt 1`)
  check(
    curse.findings.some((f) => f.title.includes('einzeln von CurseForge geladen')),
    'CurseForge: kein Hinweis, dass die Mods erst geladen werden muessen'
  )
  notes.push(
    `CurseForge: "${curse.name}", ${curse.mcVersion}/${curse.loader} ${curse.loaderVersion}, ` +
      `${curse.counts.mods} Mods, ${curse.findings.length} Befunde`
  )

  /* ------------------------------------------------------------------ *
   * 3. Zip, das gar kein Modpack ist, aber Inhalte hat
   * ------------------------------------------------------------------ */
  const looseePath = join(work, 'EinfachEinZip.zip')
  {
    const zip = new AdmZip()
    zip.addFile('.minecraft/mods/x.jar', Buffer.from('MOD'))
    zip.addFile('.minecraft/mods/y.jar', Buffer.from('MOD'))
    zip.addFile('.minecraft/config/a.cfg', Buffer.from('a'))
    zip.writeZip(looseePath)
  }

  const loose = await analyzeModpackFile(looseePath)
  check(loose.kind === 'unknown', `Loses Zip: erkannt als "${loose.kind}"`)
  check(loose.canImport === false, 'Loses Zip: canImport ist true')
  check(
    loose.findings.some((f) => f.level === 'blocker' && f.title.includes('Kein bekanntes Modpack-Format')),
    'Loses Zip: kein Blocker zum unbekannten Format'
  )
  check(
    loose.findings.some((f) => f.title.includes('trotzdem Inhalte gefunden')),
    'Loses Zip: meldet die gefundenen Inhalte nicht'
  )
  check(loose.counts.mods === 2, `Loses Zip: ${loose.counts.mods} Mods statt 2`)
  notes.push(
    `Loses Zip: abgelehnt, aber ${loose.counts.mods} Mods und ${loose.counts.configs} Konfigurationen gemeldet`
  )

  /* ------------------------------------------------------------------ *
   * 4. Kaputtes Archiv
   * ------------------------------------------------------------------ */
  const brokenPath = join(work, 'Kaputt.zip')
  writeFileSync(brokenPath, 'das ist ganz sicher kein zip')
  const broken = await analyzeModpackFile(brokenPath)
  check(broken.canImport === false, 'Kaputtes Zip: canImport ist true')
  check(
    broken.findings.some((f) => f.level === 'blocker'),
    'Kaputtes Zip: kein Blocker-Befund'
  )
  notes.push(`Kaputtes Zip: "${broken.findings[0]?.title}"`)

  /* 5. Datei, die es nicht gibt */
  const missing = await analyzeModpackFile(join(work, 'gibtesnicht.mrpack'))
  check(missing.canImport === false, 'Fehlende Datei: canImport ist true')
  notes.push(`Fehlende Datei: "${missing.findings[0]?.title}"`)

  notes.push(
    'Nicht geprueft: der eigentliche Modpack-Import laedt jeden Mod einzeln herunter, ' +
      'dafuer braucht es Netz und bei CurseForge einen API-Schluessel.'
  )
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // Aufraeumen ist Nebensache, der Bericht zaehlt.
  }
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
