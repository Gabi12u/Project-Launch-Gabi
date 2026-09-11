/**
 * Prueft mit electron-builders eigenem Datei-Filter, nicht nur durch Lesen
 * des Musters, ob ein JVM-Absturzprotokoll im Projektstamm wirklich aus dem
 * Installer ausgeschlossen wird.
 *
 *   node scripts/test-installer-log-exclusion.mjs
 *
 * `*.log` ohne Schraegstrich ist in minimatch (electron-builder nutzt es
 * ohne `matchBase`) kein Muster, das auf jeder Tiefe traf. Es trifft nur auf
 * Pfade mit genau einem Segment, also Dateien direkt im Projektstamm, genau
 * dort, wo laut Kommentar in electron-builder.yml die Absturzprotokolle
 * (hs_err_pid*.log, replay_pid*.log) tatsaechlich landen. Fuer Dateien tiefer
 * im Baum (etwa versehentlich in mod/) greift ohnehin schon `!mod/**`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const YAML = require('js-yaml')
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

try {
  const { FileMatcher } = require(join(root, 'node_modules/app-builder-lib/out/fileMatcher.js'))
  const config = YAML.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
  const configuredPatterns = config.files
  check(Array.isArray(configuredPatterns) && configuredPatterns.length > 0, 'electron-builder.yml hat kein files: Feld')
  // electron-builder.yml lists exclusions only ("!..."). electron-builder
  // itself always prepends this default "include everything" pattern before
  // applying them (getMainFileMatchers in fileMatcher.js); constructing the
  // matcher with just the exclusions, as the config file alone has them,
  // would exclude every file including legitimate ones, since a filter made
  // of only negated patterns never has anything left to negate.
  const patterns = ['**/*', ...configuredPatterns]

  const matcher = new FileMatcher(root, root, (s) => s, patterns)
  const filter = matcher.createFilter()

  const stat = (isDir) => ({
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false
  })

  const cases = [
    { path: join(root, 'hs_err_pid1234.log'), expected: false, label: 'JVM-Absturzprotokoll im Projektstamm' },
    { path: join(root, 'replay_pid5678.log'), expected: false, label: 'Replay-Protokoll im Projektstamm' },
    { path: join(root, 'mod', 'hs_err_pid9999.log'), expected: false, label: 'Absturzprotokoll versehentlich in mod/' },
    { path: join(root, 'out', 'main', 'index.js'), expected: true, label: 'Echte Ausgabedatei (Kontrolle: muss drin bleiben)' },
    { path: join(root, 'package.json'), expected: true, label: 'package.json (Kontrolle: muss drin bleiben)' }
  ]

  for (const c of cases) {
    const included = filter(c.path, stat(false))
    check(included === c.expected, `${c.label}: ${included ? 'im Installer' : 'ausgeschlossen'}, erwartet ${c.expected ? 'im Installer' : 'ausgeschlossen'}`)
    notes.push(`${c.label}: ${included ? 'WIRD EINGEPACKT' : 'ausgeschlossen'}`)
  }
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
