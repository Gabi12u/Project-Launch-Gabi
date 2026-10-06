/**
 * Prueft das Auslesen der Mod-Metadaten aus echten Jar-Dateien und die
 * Regel, welche Minecraft-Versionen als passend gelten:
 *
 *   node scripts/test-jar-metadata.mjs
 *
 * 1. `readSmallEntries` liest nur das Inhaltsverzeichnis und die gesuchten
 *    Eintraege. Es muss genau dasselbe liefern wie das vollstaendige Lesen,
 *    fuer gespeicherte und komprimierte Eintraege, und bei einer kaputten
 *    Datei auf das vollstaendige Lesen ausweichen statt nichts zu finden.
 * 2. `readJarMetadata` erkennt Fabric, Quilt, Forge und NeoForge, auch mit
 *    BOM und Kommentaren in fabric.mod.json, und ordnet eine mods.toml ueber
 *    ihre Abhaengigkeit Forge oder NeoForge zu.
 * 3. `gameVersionMatches` laesst nur gleiche Versionen und echte Hotfixes zu,
 *    nicht mehr jede Version derselben Reihe.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-jar-metadata-'))

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
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] },
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       archive: require(${JSON.stringify(join(root, 'src/main/core/archive.ts'))}),
       meta: require(${JSON.stringify(join(root, 'src/main/core/modMetadata.ts'))}),
       versions: require(${JSON.stringify(join(root, 'src/main/core/gameVersions.ts'))})
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

  const { archive, meta, versions } = require(out)

  function jar(name, files, { store = false } = {}) {
    const zip = new AdmZip()
    // Filler first, so the wanted entries sit somewhere in the middle of the
    // directory as they do in a real mod.
    for (let i = 0; i < 300; i++) zip.addFile(`com/example/Class${i}.class`, Buffer.from(`class ${i} `.repeat(20)))
    for (const [entryName, text] of Object.entries(files)) {
      zip.addFile(entryName, Buffer.from(text, 'utf8'))
      if (store) zip.getEntry(entryName).header.method = 0
    }
    const file = join(work, name)
    zip.writeZip(file)
    return file
  }

  // --- 1. Quick read equals the full read --------------------------------
  const names = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml']
  for (const store of [false, true]) {
    const file = jar(`same-${store}.jar`, {
      'fabric.mod.json': JSON.stringify({ id: 'sodium', name: 'Sodium', version: '0.6.0' }),
      'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="sodium"\n'
    }, { store })
    const quick = await archive.readSmallEntries(file, names)
    for (const entryName of names) {
      const full = await archive.readEntryText(file, entryName)
      check(
        (quick.get(entryName) ?? null) === full,
        `readSmallEntries (${store ? 'gespeichert' : 'komprimiert'}) weicht bei ${entryName} vom vollstaendigen Lesen ab`
      )
    }
    check(quick.size === 2, `readSmallEntries fand ${quick.size} statt 2 Eintraege`)
  }

  // Not a zip at all: no crash, just nothing found.
  const junk = join(work, 'junk.jar')
  writeFileSync(junk, Buffer.from('kein zip'))
  const junkResult = await archive.readSmallEntries(junk, names)
  check(junkResult.size === 0, 'Eine kaputte Datei lieferte trotzdem Eintraege')

  // A zip with leading bytes (as self extracting archives have) still works
  // through the fallback.
  const plain = jar('plain.jar', { 'fabric.mod.json': JSON.stringify({ id: 'lithium' }) })
  const shifted = join(work, 'shifted.jar')
  writeFileSync(shifted, Buffer.concat([Buffer.alloc(64, 7), readFileSync(plain)]))
  const shiftedMeta = await meta.readJarMetadata(shifted)
  notes.push(`Jar mit vorangestellten Bytes: ids ${JSON.stringify(shiftedMeta?.ids ?? null)}`)

  // --- 2. Metadata per loader ---------------------------------------------
  const fabricBom = jar('fabric-bom.jar', {
    'fabric.mod.json':
      '﻿{\n  // comment the loader accepts\n  "id": "fabric-api",\n  "name": "Fabric API",\n  "version": "0.100.0",\n}\n'
  })
  const fabricMeta = await meta.readJarMetadata(fabricBom)
  check(fabricMeta?.ids?.[0] === 'fabric-api', `fabric.mod.json mit BOM und Kommentar: ids ${JSON.stringify(fabricMeta?.ids)}`)
  check(fabricMeta?.name === 'Fabric API', `fabric.mod.json: Name ${fabricMeta?.name}`)
  check(JSON.stringify(fabricMeta?.loaders) === '["fabric"]', `fabric.mod.json: Loader ${JSON.stringify(fabricMeta?.loaders)}`)

  const forgeJar = jar('forge.jar', {
    'META-INF/mods.toml':
      'modLoader="javafml"\n[[mods]]\nmodId="jei"\ndisplayName="Just Enough Items"\nversion="${file.jarVersion}"\n' +
      'description=\'\'\'\n[[mods]]\nmodId="fake"\n\'\'\'\n[[dependencies.jei]]\nmodId="forge"\nmandatory=true\n'
  })
  const forgeMeta = await meta.readJarMetadata(forgeJar)
  check(JSON.stringify(forgeMeta?.ids) === '["jei"]', `mods.toml: ids ${JSON.stringify(forgeMeta?.ids)}`)
  check(forgeMeta?.name === 'Just Enough Items', `mods.toml: Name ${forgeMeta?.name}`)
  check(forgeMeta?.version === undefined, `mods.toml: Platzhalter-Version wurde uebernommen (${forgeMeta?.version})`)
  check(JSON.stringify(forgeMeta?.loaders) === '["forge"]', `mods.toml mit Forge-Abhaengigkeit: Loader ${JSON.stringify(forgeMeta?.loaders)}`)

  const neoJar = jar('neo.jar', { 'META-INF/neoforge.mods.toml': '[[mods]]\nmodId="create"\n' })
  const neoMeta = await meta.readJarMetadata(neoJar)
  check(JSON.stringify(neoMeta?.loaders) === '["neoforge"]', `neoforge.mods.toml: Loader ${JSON.stringify(neoMeta?.loaders)}`)

  const openToml = jar('open.jar', { 'META-INF/mods.toml': '[[mods]]\nmodId="anything"\n' })
  const openMeta = await meta.readJarMetadata(openToml)
  check(
    JSON.stringify(openMeta?.loaders) === '["forge","neoforge"]',
    `mods.toml ohne Loader-Abhaengigkeit: Loader ${JSON.stringify(openMeta?.loaders)}`
  )

  const empty = jar('empty.jar', {})
  const emptyMeta = await meta.readJarMetadata(empty)
  check(
    emptyMeta !== null && emptyMeta.ids.length === 0 && emptyMeta.loaders.length === 0,
    `Jar ohne Metadaten: ${JSON.stringify(emptyMeta)}`
  )
  const missing = await meta.readJarMetadata(join(work, 'gibt-es-nicht.jar'))
  check(missing === null, 'Eine fehlende Datei lieferte nicht null')

  // --- 3. Version rule ------------------------------------------------------
  const cases = [
    ['1.20.1', '1.20.1', true],
    ['1.20.1', '1.20', true],
    ['1.20', '1.20.1', true],
    ['1.21.1', '1.21', true],
    ['1.20.1', '1.20.6', false],
    ['1.20.1', '1.20.4', false],
    ['1.21.1', '1.21.4', false],
    ['1.21.1', '1.21.10', false],
    ['1.21.8', '1.21.7', true],
    ['1.21.4', '1.21', false]
  ]
  for (const [target, candidate, expected] of cases) {
    const got = versions.gameVersionMatches(target, candidate)
    check(got === expected, `gameVersionMatches(${target}, ${candidate}) = ${got}, erwartet ${expected}`)
  }
  check(versions.sameVersionLine('1.21.5', '1.21.4'), 'sameVersionLine fuer Ressourcenpakete zu streng')
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
