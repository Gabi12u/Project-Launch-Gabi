/**
 * Prueft zwei getrennte Funktionen aus zwei Dateien, gebuendelt genau wie im
 * echten Hauptprozess, nicht gegen eine Kopie ihrer Logik:
 *
 *   node scripts/test-split-args-and-pack-format.mjs
 *
 * splitUserArgs() in launch.ts entfernte bisher nur ein Anfuehrungszeichen
 * ganz am Anfang und Ende eines Tokens, sodass `-Dfoo="C:\Program Files\x"`
 * zu `-Dfoo="C:\Program Files\x` wurde (das schliessende Zeichen sitzt nicht
 * am Tokenrand). Jetzt wird jedes Anfuehrungszeichen-Paar im Token entfernt,
 * egal wo es steht.
 *
 * packFormatFor() in startScreen.ts zerlegte jede Version an den Punkten und
 * las jeden Teil mit parseInt, wodurch ein Snapshot wie "26w03a" als
 * Versionsnummer "0" gelesen wurde und den niedrigsten pack_format bekam.
 * Snapshots und Vorabversionen ("1.21.5-pre1", "1.21.5-rc1") werden jetzt vor
 * dem Zerlegen erkannt.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-splitargs-packformat-'))

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
     class BrowserWindowShim { static getAllWindows() { return [] } }
     module.exports = {
       app: {
         getPath: () => path,
         getAppPath: () => ${JSON.stringify(root)},
         getVersion: () => '0.0.0-test',
         isPackaged: false,
         getName: () => 'launch-gabi'
       },
       BrowserWindow: BrowserWindowShim,
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `const launch = require(${JSON.stringify(join(root, 'src/main/core/launch.ts'))})
     const startScreen = require(${JSON.stringify(join(root, 'src/main/core/startScreen.ts'))})
     module.exports = {
       splitUserArgs: launch.splitUserArgs,
       packFormatFor: startScreen.packFormatFor
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

  const { splitUserArgs, packFormatFor } = require(out)

  /* ------------------------------------------------------------------ *
   * splitUserArgs: quotes that do not sit at the very edge of a token.
   * ------------------------------------------------------------------ */
  check(typeof splitUserArgs === 'function', 'splitUserArgs wurde nicht exportiert')

  const jvmArgQuoted = splitUserArgs('-Dfoo="C:\\Program Files\\x"')
  check(
    jvmArgQuoted.length === 1 && jvmArgQuoted[0] === '-Dfoo=C:\\Program Files\\x',
    `splitUserArgs('-Dfoo="C:\\\\Program Files\\\\x"') ergab ${JSON.stringify(jvmArgQuoted)}, erwartet ["-Dfoo=C:\\\\Program Files\\\\x"]`
  )

  const javaAgentQuoted = splitUserArgs('-javaagent:"C:\\A B\\a.jar"')
  check(
    javaAgentQuoted.length === 1 && javaAgentQuoted[0] === '-javaagent:C:\\A B\\a.jar',
    `splitUserArgs('-javaagent:"C:\\\\A B\\\\a.jar"') ergab ${JSON.stringify(javaAgentQuoted)}, erwartet ["-javaagent:C:\\\\A B\\\\a.jar"]`
  )

  const barePathQuoted = splitUserArgs('"C:\\Pfad mit Leer\\a.jar"')
  check(
    barePathQuoted.length === 1 && barePathQuoted[0] === 'C:\\Pfad mit Leer\\a.jar',
    `splitUserArgs('"C:\\\\Pfad mit Leer\\\\a.jar"') ergab ${JSON.stringify(barePathQuoted)}, erwartet ["C:\\\\Pfad mit Leer\\\\a.jar"]`
  )

  const singleQuoted = splitUserArgs("-Dfoo='C:\\Program Files\\x'")
  check(
    singleQuoted.length === 1 && singleQuoted[0] === '-Dfoo=C:\\Program Files\\x',
    `splitUserArgs("-Dfoo='C:\\\\Program Files\\\\x'") ergab ${JSON.stringify(singleQuoted)}, erwartet ["-Dfoo=C:\\\\Program Files\\\\x"]`
  )

  const plain = splitUserArgs('-Xmx4G -XX:+UseG1GC')
  check(
    plain.length === 2 && plain[0] === '-Xmx4G' && plain[1] === '-XX:+UseG1GC',
    `splitUserArgs('-Xmx4G -XX:+UseG1GC') ergab ${JSON.stringify(plain)}, erwartet ["-Xmx4G","-XX:+UseG1GC"]`
  )

  const empty = splitUserArgs('')
  check(Array.isArray(empty) && empty.length === 0, `splitUserArgs('') ergab ${JSON.stringify(empty)}, erwartet []`)

  const twoQuotedInOne = splitUserArgs('-Dfoo="C:\\Program Files\\x" -javaagent:"C:\\A B\\a.jar"')
  check(
    twoQuotedInOne.length === 2 &&
      twoQuotedInOne[0] === '-Dfoo=C:\\Program Files\\x' &&
      twoQuotedInOne[1] === '-javaagent:C:\\A B\\a.jar',
    `splitUserArgs(zwei gequotete Argumente) ergab ${JSON.stringify(twoQuotedInOne)}`
  )

  notes.push(`splitUserArgs: ${JSON.stringify(jvmArgQuoted)}, ${JSON.stringify(javaAgentQuoted)}, ${JSON.stringify(barePathQuoted)}`)

  /* ------------------------------------------------------------------ *
   * packFormatFor: release, snapshot, pre-release.
   * ------------------------------------------------------------------ */
  check(typeof packFormatFor === 'function', 'packFormatFor wurde nicht exportiert')

  const release = packFormatFor('1.21.5')
  check(release === 55, `packFormatFor('1.21.5') ergab ${release}, erwartet 55 (Tabelleneintrag)`)

  const snapshotA = packFormatFor('26w03a')
  const snapshotB = packFormatFor('25w31a')
  check(snapshotA === 88, `packFormatFor('26w03a') ergab ${snapshotA}, erwartet 88 (neuestes bekanntes Format)`)
  check(snapshotB === 88, `packFormatFor('25w31a') ergab ${snapshotB}, erwartet 88 (neuestes bekanntes Format)`)

  const preRelease = packFormatFor('1.21.5-pre1')
  const releaseCandidate = packFormatFor('1.21.5-rc1')
  check(preRelease === 55, `packFormatFor('1.21.5-pre1') ergab ${preRelease}, erwartet 55 (wie die Basisversion 1.21.5)`)
  check(
    releaseCandidate === 55,
    `packFormatFor('1.21.5-rc1') ergab ${releaseCandidate}, erwartet 55 (wie die Basisversion 1.21.5)`
  )

  notes.push(
    `packFormatFor: Release 1.21.5 -> ${release}, Snapshot 26w03a -> ${snapshotA}, Vorabversion 1.21.5-pre1 -> ${preRelease}`
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
