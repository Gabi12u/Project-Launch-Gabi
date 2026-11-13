/**
 * Prueft, welches Java-Paket der Launcher bei Adoptium anfragt.
 *
 *   node scripts/test-java-package-choice.mjs
 *
 * Minecraft 1.17 und 1.17.1 verlangen Java 16. Der Launcher fragte dafuer
 * nur die schlanke Laufzeit (JRE) an, die Adoptium fuer Java 16 nie gebaut
 * hat, und jeder Start brach mit "kein Paket fuer dieses System" ab. Jetzt
 * nimmt er in dem Fall das JDK. Die Antworten von Adoptium kommen von einem
 * Ersatz fuer fetch, so wie sie live aussehen: leer fuer das JRE von 16.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-java-package-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

// What Adoptium has, per major and image type.
const builds = {
  '8:jdk': true,
  '16:jdk': true,
  '17:jre': true,
  '17:jdk': true,
  '21:jre': true,
  '21:jdk': true
}
const asked = []
globalThis.fetch = async (url) => {
  const target = new URL(String(url))
  const major = target.pathname.split('/').at(-2)
  const type = target.searchParams.get('image_type')
  asked.push(`${major}:${type}`)
  const body = builds[`${major}:${type}`]
    ? [{ binary: { package: { link: `https://example.invalid/temurin-${major}-${type}.zip`, size: 1234, checksum: 'a'.repeat(64) } } }]
    : []
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })
  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `module.exports = {
       app: { getPath: () => ${JSON.stringify(userData)}, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/java.ts'))})`)
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
  const { adoptiumPackageFor } = require(out)

  // --- Java 16: no JRE exists, the JDK is taken -------------------------
  asked.length = 0
  const sixteen = await adoptiumPackageFor(16)
  check(sixteen !== 'unavailable' && sixteen !== null, `Java 16: ${JSON.stringify(sixteen)}`)
  check(sixteen?.url?.endsWith('temurin-16-jdk.zip'), `Java 16: geladen würde ${sixteen?.url}`)
  check(asked.join(',') === '16:jre,16:jdk', `Java 16: gefragt wurde ${asked.join(', ')}`)
  notes.push('Java 16 (Minecraft 1.17): kein JRE bei Adoptium, das JDK wird genommen.')

  // --- Java 21: the JRE exists and is taken, no second request ----------
  asked.length = 0
  const twentyOne = await adoptiumPackageFor(21)
  check(twentyOne?.url?.endsWith('temurin-21-jre.zip'), `Java 21: geladen würde ${twentyOne?.url}`)
  check(asked.join(',') === '21:jre', `Java 21: gefragt wurde ${asked.join(', ')}`)

  // --- Java 8 stays on the JDK, as before -------------------------------
  asked.length = 0
  const eight = await adoptiumPackageFor(8)
  check(eight?.url?.endsWith('temurin-8-jdk.zip'), `Java 8: geladen würde ${eight?.url}`)
  check(asked.join(',') === '8:jdk', `Java 8: gefragt wurde ${asked.join(', ')}`)

  // --- Nothing at all still says so ------------------------------------
  asked.length = 0
  const none = await adoptiumPackageFor(19)
  check(none === 'unavailable', `Java 19 ohne jedes Paket: ${JSON.stringify(none)}`)
  notes.push('Gibt es weder JRE noch JDK, bleibt es bei der Meldung „kein Paket für dieses System“.')
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
