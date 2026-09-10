/**
 * Prueft die Import-Analyse an echten, hier angelegten Ordnern.
 *
 *   node scripts/test-import-analysis.mjs
 *
 * Die Analyse-Funktionen sind reiner Node-Code ohne Electron-Importe, sie
 * lassen sich also buendeln und ausfuehren, ohne den Launcher zu starten.
 * Gebaut wird gegen echte Ordner in einem Temp-Verzeichnis, nicht gegen
 * erfundene Rueckgabewerte: eine Analyse, die nur im Test funktioniert,
 * waere keine.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-import-'))

const problems = []
const notes = []

function check(ok, message) {
  if (!ok) problems.push(message)
}

/** Legt einen Ordner mit ein paar Dateien an. */
function make(path, files = {}) {
  mkdirSync(path, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const full = join(path, name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return path
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  // paths.ts liest die Einstellungen ueber electron's app-Objekt. Fuer die
  // Analyse wird davon nichts gebraucht, also wird electron durch einen
  // Platzhalter ersetzt, statt den ganzen Launcher hochzufahren.
  const shim = join(work, 'electron-shim.mjs')
  writeFileSync(
    shim,
    `export const app = { getPath: () => ${JSON.stringify(work)}, getVersion: () => '0.0.0', isPackaged: false }
     export const safeStorage = { isEncryptionAvailable: () => false }
     export const shell = {}
     export const dialog = {}
     export const BrowserWindow = class {}
     export const ipcMain = { handle() {}, on() {} }
     export const desktopCapturer = {}
     export const globalShortcut = {}
     export default { app }`
  )

  const entry = join(work, 'entry.mjs')
  writeFileSync(
    entry,
    `export { analyzeInstanceFolder } from ${JSON.stringify(join(root, 'src/main/core/instanceFolder.ts'))}`
  )

  // CommonJS, nicht ESM: ueber die Importkette haengt adm-zip mit drin, das
  // `require` fuer Node-Bausteine benutzt, und das gibt es in einem
  // ESM-Bundle nicht.
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

  const { analyzeInstanceFolder } = require(out)

  /* 1. Prism-Instanz -------------------------------------------------- */
  const prism = join(work, 'PrismInstanz')
  make(prism, {
    'mmc-pack.json': JSON.stringify({
      components: [
        { uid: 'net.minecraft', version: '1.20.1' },
        { uid: 'net.fabricmc.fabric-loader', version: '0.15.7' }
      ]
    }),
    'instance.cfg': 'name=Meine Prism Instanz\n'
  })
  make(join(prism, '.minecraft/mods'), { 'sodium.jar': 'x', 'lithium.jar': 'x' })
  make(join(prism, '.minecraft/saves/Welt1'), { 'level.dat': 'x' })
  make(join(prism, '.minecraft/config'), { 'sodium.json': '{}' })

  const a1 = analyzeInstanceFolder(prism)
  check(a1.kind === 'prism', `Prism nicht erkannt, sondern "${a1.kind}"`)
  check(a1.mcVersion === '1.20.1', `Prism: falsche Version "${a1.mcVersion}"`)
  check(a1.loader === 'fabric', `Prism: falscher Loader "${a1.loader}"`)
  check(a1.counts.mods === 2, `Prism: ${a1.counts.mods} Mods statt 2`)
  check(a1.counts.worlds === 1, `Prism: ${a1.counts.worlds} Welten statt 1`)
  check(a1.canImport === true, 'Prism: canImport ist false')
  check(a1.versionGuessed === false, 'Prism: Version faelschlich als geschaetzt markiert')
  notes.push(`Prism: ${a1.name}, ${a1.mcVersion}, ${a1.loader}, ${a1.counts.mods} Mods, ${a1.findings.length} Befunde`)

  /* 2. Modrinth-App-Profil -------------------------------------------- */
  const modrinth = join(work, 'ModrinthProfil')
  make(modrinth, {
    'profile.json': JSON.stringify({
      name: 'Mein Modrinth Profil',
      game_version: '1.21.1',
      loader: 'quilt',
      loader_version: { id: '0.26.0' }
    })
  })
  make(join(modrinth, 'mods'), { 'a.jar': 'x', 'b.jar': 'x', 'c.jar.disabled': 'x' })

  const a2 = analyzeInstanceFolder(modrinth)
  check(a2.kind === 'modrinth-app', `Modrinth nicht erkannt, sondern "${a2.kind}"`)
  check(a2.mcVersion === '1.21.1', `Modrinth: falsche Version "${a2.mcVersion}"`)
  check(a2.loader === 'quilt', `Modrinth: falscher Loader "${a2.loader}"`)
  check(a2.loaderVersion === '0.26.0', `Modrinth: falsche Loader-Version "${a2.loaderVersion}"`)
  check(a2.counts.mods === 3, `Modrinth: ${a2.counts.mods} Mods statt 3 (deaktivierte zaehlen mit)`)
  notes.push(`Modrinth: ${a2.name}, ${a2.mcVersion}, ${a2.loader} ${a2.loaderVersion}, ${a2.counts.mods} Mods`)

  /* 3. Blanker .minecraft-Ordner -------------------------------------- */
  const bare = join(work, '.minecraft')
  make(join(bare, 'versions/1.19.2'), { '1.19.2.json': '{}' })
  make(join(bare, 'mods'), { 'irgendwas.jar': 'x' })
  make(join(bare, 'resourcepacks'), { 'pack.zip': 'x' })

  const a3 = analyzeInstanceFolder(bare)
  check(a3.mcVersion === '1.19.2', `Blanker Ordner: falsche Version "${a3.mcVersion}"`)
  check(a3.versionGuessed === true, 'Blanker Ordner: Version nicht als geschaetzt markiert')
  check(
    a3.findings.some((f) => f.level === 'warn' && f.title.includes('geschätzt')),
    'Blanker Ordner: kein Warn-Befund zur geschaetzten Version'
  )
  check(a3.counts.resourcePacks === 1, `Blanker Ordner: ${a3.counts.resourcePacks} Packs statt 1`)
  notes.push(`Blank: ${a3.mcVersion} (geschaetzt), ${a3.counts.mods} Mods, ${a3.counts.resourcePacks} Packs`)

  /* 4. Ordner ohne alles ---------------------------------------------- */
  const empty = make(join(work, 'LeererOrdner'), { 'liesmich.txt': 'nichts hier' })
  const a4 = analyzeInstanceFolder(empty)
  check(a4.canImport === false, 'Leerer Ordner: canImport ist true')
  check(
    a4.findings.some((f) => f.level === 'blocker'),
    'Leerer Ordner: kein Blocker-Befund'
  )
  check(a4.kind === 'unknown', `Leerer Ordner: kind ist "${a4.kind}" statt unknown`)
  notes.push(`Leer: canImport=${a4.canImport}, ${a4.findings.length} Befunde, erster: "${a4.findings[0]?.title}"`)

  /* 5. Mods ohne Loader ------------------------------------------------ */
  const noLoader = join(work, 'ModsOhneLoader')
  make(join(noLoader, 'versions/1.20.4'), { '1.20.4.json': '{}' })
  make(join(noLoader, 'mods'), { 'x.jar': 'x' })
  const a5 = analyzeInstanceFolder(noLoader)
  check(
    a5.findings.some((f) => f.level === 'warn' && f.title.includes('kein Mod-Loader')),
    'Mods ohne Loader: fehlender Hinweis'
  )
  notes.push(`Ohne Loader: Loader=${a5.loader}, Warnung vorhanden`)

  /* 6. Pfad ist gar kein Ordner ---------------------------------------- */
  const notADir = join(work, 'einedatei.txt')
  writeFileSync(notADir, 'x')
  const a6 = analyzeInstanceFolder(notADir)
  check(a6.canImport === false, 'Datei statt Ordner: canImport ist true')
  check(a6.findings[0]?.level === 'blocker', 'Datei statt Ordner: kein Blocker')
  notes.push(`Datei statt Ordner: "${a6.findings[0]?.title}"`)
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
