/**
 * Prueft mit der echten resolveLibraries()-Funktion, dass eine Bibliothek
 * ohne eigene Download-Adresse (Forge/NeoForge-Muster: ein "artifact" ohne
 * "url", vom Installer selbst abgelegt) tatsaechlich mit download:undefined
 * aufgeloest wird, und dass die reparierte Fehlbestandspruefung in
 * launch.ts eine solche, tatsaechlich fehlende Datei jetzt erkennt.
 *
 *   node scripts/test-missing-library-no-download.mjs
 *
 * launch.ts selbst ist zu schwer zum Buendeln (spawn, viele Abhaengigkeiten)
 * fuer diesen einen Zweck; die Pruefung, die dort jetzt laeuft
 * (`libraries.filter(l => !existsSync(l.path))`), wird hier direkt gegen
 * das echte Ergebnis von resolveLibraries() nachgestellt.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-missing-lib-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
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
       shell: {}, dialog: {}, BrowserWindow: class {},
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
    logLevel: 'error'
  })

  const { resolveLibraries } = require(out)

  // Exactly the Forge/NeoForge pattern: an "artifact" object is present
  // (path, sha1, size all known), but it carries no "url" of its own, and
  // there is no library-level "url" either, since the installer places this
  // file on disk itself.
  const versionJson = {
    libraries: [
      {
        name: 'net.minecraftforge:forgeloader:1.0',
        downloads: {
          artifact: {
            path: 'net/minecraftforge/forgeloader/1.0/forgeloader-1.0.jar',
            sha1: 'a'.repeat(40),
            size: 12345
            // deliberately no "url"
          }
        }
        // deliberately no library.url either
      },
      {
        name: 'com.google.guava:guava:32.1.2-jre',
        downloads: {
          artifact: {
            path: 'com/google/guava/guava/32.1.2-jre/guava-32.1.2-jre.jar',
            url: 'https://libraries.minecraft.net/com/google/guava/guava/32.1.2-jre/guava-32.1.2-jre.jar',
            sha1: 'b'.repeat(40),
            size: 6789
          }
        }
      }
    ]
  }

  const resolved = resolveLibraries(versionJson)
  check(resolved.length === 2, `Erwartet 2 aufgeloeste Bibliotheken, erhalten ${resolved.length}`)

  const forgeEntry = resolved.find((l) => l.path.includes('forgeloader'))
  const guavaEntry = resolved.find((l) => l.path.includes('guava'))

  check(Boolean(forgeEntry), 'Forge-artige Bibliothek wurde nicht aufgeloest')
  check(
    forgeEntry?.download === undefined,
    `Erwartet download === undefined fuer die Forge-artige Bibliothek, erhalten ${JSON.stringify(forgeEntry?.download)}`
  )
  check(Boolean(guavaEntry?.download), 'Guava mit echter URL sollte weiterhin eine Download-Angabe haben')
  notes.push(
    `resolveLibraries: Forge-artige Bibliothek hat download=${JSON.stringify(forgeEntry?.download)}, Guava hat eine echte Download-Adresse.`
  )

  // Neither file exists on disk (nothing downloaded it, nothing extracted
  // it). This is the exact scenario the fix in launch.ts addresses: before,
  // only libraries with a `download` field were checked for existence, so
  // the Forge-artige entry above would have been silently dropped from the
  // classpath instead of reported as missing.
  const missingBefore = resolved.filter((l) => l.download && !existsSync(l.path))
  const missingAfter = resolved.filter((l) => !existsSync(l.path))

  check(
    missingBefore.length === 1,
    `Alte Pruefung: erwartet 1 erkannt-fehlende Bibliothek (nur die mit Download-Adresse), erhalten ${missingBefore.length}`
  )
  check(
    missingAfter.length === 2,
    `Neue Pruefung: erwartet beide fehlenden Bibliotheken erkannt, erhalten ${missingAfter.length}`
  )
  notes.push(
    `Alte Pruefung haette nur ${missingBefore.length} von 2 tatsaechlich fehlenden Bibliotheken gemeldet, ` +
      `die neue meldet ${missingAfter.length} von 2.`
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
