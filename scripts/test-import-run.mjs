/**
 * Fuehrt echte Importe aus und prueft, ob dabei wirklich etwas passiert.
 *
 *   node scripts/test-import-run.mjs
 *
 * Anders als test-import-analysis.mjs, das nur die Erkennung prueft, laeuft
 * hier der komplette Importweg: Instanz anlegen, Dateien kopieren, Inhalte
 * erfassen, Ergebnis pruefen. Gegen echte Ordner in einem Temp-Verzeichnis.
 *
 * Der Hintergrund-Download der Minecraft-Dateien scheitert dabei mangels
 * Netzwerk oder laeuft ins Leere. Das ist Absicht und Teil der Pruefung: der
 * Kopiervorgang darf davon nicht abhaengen.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-import-run-'))

const problems = []
const notes = []

function check(ok, message) {
  if (!ok) problems.push(message)
}

function make(path, files = {}) {
  mkdirSync(path, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const full = join(path, name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return path
}

/** Wartet, bis eine Bedingung zutrifft, oder gibt nach der Frist auf. */
async function waitFor(label, condition, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  problems.push(`Zeitueberschreitung: ${label}`)
  return false
}

/** Zaehlt Dateien in einem Baum, damit "es wurde etwas kopiert" messbar ist. */
function countFiles(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name))
    else total++
  }
  return total
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
       desktopCapturer: {}, globalShortcut: {}, Notification: class {},
       net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       ...require(${JSON.stringify(join(root, 'src/main/core/instanceFolder.ts'))}),
       ...require(${JSON.stringify(join(root, 'src/main/core/instances.ts'))}),
       ...require(${JSON.stringify(join(root, 'src/main/core/importCheck.ts'))}),
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
    logLevel: 'error'
  })

  const api = require(out)
  const { analyzeInstanceFolder, importInstanceFolder, getInstance, listSummaries, paths } = api

  notes.push(`Datenverzeichnis: ${paths.root()}`)

  /* ------------------------------------------------------------------ *
   * Fall 1: Prism-Instanz mit Mods, Welt und Konfiguration
   * ------------------------------------------------------------------ */
  const prism = join(work, 'PrismQuelle')
  make(prism, {
    'mmc-pack.json': JSON.stringify({
      components: [
        { uid: 'net.minecraft', version: '1.20.1' },
        { uid: 'net.fabricmc.fabric-loader', version: '0.15.7' }
      ]
    }),
    'instance.cfg': 'name=Testinstanz Prism\n'
  })
  make(join(prism, '.minecraft/mods'), {
    'sodium.jar': 'MOD-INHALT-SODIUM',
    'lithium.jar': 'MOD-INHALT-LITHIUM'
  })
  make(join(prism, '.minecraft/saves/MeineWelt'), {
    'level.dat': 'WELT-DATEN',
    'region/r.0.0.mca': 'REGION'
  })
  make(join(prism, '.minecraft/config'), { 'sodium.json': '{"quality":"high"}' })
  make(join(prism, '.minecraft'), { 'options.txt': 'fov:80\n' })

  const sourceFilesBefore = countFiles(prism)
  const sourceModBefore = readFileSync(join(prism, '.minecraft/mods/sodium.jar'), 'utf8')

  const analysis = analyzeInstanceFolder(prism)
  check(analysis.canImport, 'Prism: Analyse sagt canImport=false')
  notes.push(
    `Analyse: ${analysis.sourceLabel}, ${analysis.mcVersion}, ${analysis.loader}, ` +
      `${analysis.counts.mods} Mods, ${analysis.counts.worlds} Welten`
  )

  const instance = await importInstanceFolder(prism)
  check(Boolean(instance?.id), 'Prism: importInstanceFolder gab keine Instanz zurueck')
  notes.push(`Instanz angelegt: ${instance.id} ("${instance.name}")`)

  const gameDir = paths.gameDir(instance.id)

  // Der Kopiervorgang laeuft als Hintergrundaufgabe, also wird darauf gewartet.
  const copied = await waitFor(
    'Mods wurden in die neue Instanz kopiert',
    () => existsSync(join(gameDir, 'mods/sodium.jar')) && existsSync(join(gameDir, 'saves/MeineWelt/level.dat'))
  )

  if (copied) {
    const modContent = readFileSync(join(gameDir, 'mods/sodium.jar'), 'utf8')
    check(modContent === 'MOD-INHALT-SODIUM', 'Prism: kopierter Mod hat anderen Inhalt als das Original')

    check(existsSync(join(gameDir, 'mods/lithium.jar')), 'Prism: zweiter Mod fehlt')
    check(existsSync(join(gameDir, 'saves/MeineWelt/region/r.0.0.mca')), 'Prism: Regionsdatei der Welt fehlt')
    check(existsSync(join(gameDir, 'config/sodium.json')), 'Prism: Konfiguration fehlt')
    check(existsSync(join(gameDir, 'options.txt')), 'Prism: options.txt fehlt')

    const targetFiles = countFiles(gameDir)
    check(targetFiles >= 6, `Prism: nur ${targetFiles} Dateien im Ziel, erwartet mindestens 6`)
    notes.push(`Kopiert: ${targetFiles} Dateien nach ${gameDir}`)
  }

  /* Die wichtigste Sicherheitsregel: das Original bleibt unangetastet. */
  check(
    countFiles(prism) === sourceFilesBefore,
    `Quellordner veraendert: ${countFiles(prism)} Dateien statt ${sourceFilesBefore}`
  )
  check(
    readFileSync(join(prism, '.minecraft/mods/sodium.jar'), 'utf8') === sourceModBefore,
    'Quelldatei wurde veraendert'
  )
  notes.push(`Quellordner unveraendert: ${sourceFilesBefore} Dateien, Inhalt identisch`)

  /* Erfasst der Launcher die kopierten Mods auch als Inhalte? */
  await waitFor(
    'Mods wurden als Inhalte erfasst',
    () => {
      try {
        return getInstance(instance.id).content.filter((c) => c.type === 'mod').length >= 2
      } catch {
        return false
      }
    },
    20000
  )
  const recorded = getInstance(instance.id).content.filter((c) => c.type === 'mod')
  check(recorded.length >= 2, `Prism: nur ${recorded.length} Mods erfasst, erwartet 2`)
  notes.push(`Erfasst: ${recorded.length} Mods (${recorded.map((m) => m.fileName).join(', ')})`)

  /* Metadaten der Instanz */
  const stored = getInstance(instance.id)
  check(stored.mcVersion === '1.20.1', `Prism: Instanz hat Version "${stored.mcVersion}"`)
  check(stored.loader === 'fabric', `Prism: Instanz hat Loader "${stored.loader}"`)

  /* ------------------------------------------------------------------ *
   * Fall 2: Modrinth-App-Profil, Spielordner ist der Ordner selbst
   * ------------------------------------------------------------------ */
  const modrinth = join(work, 'ModrinthQuelle')
  make(modrinth, {
    'profile.json': JSON.stringify({
      name: 'Testprofil Modrinth',
      game_version: '1.21.1',
      loader: 'fabric',
      loader_version: { id: '0.16.0' }
    })
  })
  make(join(modrinth, 'mods'), { 'irisshaders.jar': 'IRIS' })
  make(join(modrinth, 'shaderpacks'), { 'BSL.zip': 'SHADER' })

  const instance2 = await importInstanceFolder(modrinth)
  const gameDir2 = paths.gameDir(instance2.id)
  const copied2 = await waitFor(
    'Modrinth-Inhalte wurden kopiert',
    () => existsSync(join(gameDir2, 'mods/irisshaders.jar'))
  )
  if (copied2) {
    check(existsSync(join(gameDir2, 'shaderpacks/BSL.zip')), 'Modrinth: Shaderpack fehlt')
    notes.push(`Modrinth: ${countFiles(gameDir2)} Dateien kopiert, Instanz ${instance2.id}`)
  }
  const stored2 = getInstance(instance2.id)
  check(stored2.mcVersion === '1.21.1', `Modrinth: Version "${stored2.mcVersion}"`)
  check(stored2.loader === 'fabric', `Modrinth: Loader "${stored2.loader}"`)

  /* ------------------------------------------------------------------ *
   * Fall 3: Ordner, der nicht importierbar ist
   * ------------------------------------------------------------------ */
  const junk = make(join(work, 'Unsinn'), { 'liesmich.txt': 'nichts' })
  let threw = false
  try {
    await importInstanceFolder(junk)
  } catch {
    threw = true
  }
  check(threw, 'Unsinniger Ordner wurde ohne Fehler importiert')
  notes.push(`Unsinniger Ordner: Import abgelehnt (${threw ? 'wie erwartet' : 'FEHLER'})`)

  /* Beide echten Instanzen sind in der Liste */
  const all = listSummaries()
  check(all.length >= 2, `Nur ${all.length} Instanzen in der Liste, erwartet mindestens 2`)
  notes.push(`Instanzliste: ${all.map((i) => `${i.name} (${i.mcVersion})`).join(' | ')}`)
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // Ein noch offenes Dateihandle aus dem Hintergrund-Download darf den
    // Testbericht nicht verschlucken.
  }
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
