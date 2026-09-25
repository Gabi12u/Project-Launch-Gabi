/**
 * Prueft, dass ein .mrpack-Import nur Download-Adressen akzeptiert, die der
 * Modrinth-mrpack-Spezifikation entsprechen (cdn.modrinth.com, github.com,
 * raw.githubusercontent.com, gitlab.com, jeweils nur https), und dass die
 * echte sha256-Pruefung fuer den Java-Download tatsaechlich eine falsche
 * Datei erkennt.
 *
 *   node scripts/test-mrpack-url-whitelist.mjs
 *
 * Ohne diese Pruefung nahm der Import jede im Archiv genannte Adresse
 * ungeprueft an: ein manipuliertes .mrpack haette den Launcher dazu bringen
 * koennen, von einer beliebigen Adresse herunterzuladen und das Ergebnis
 * unter einem selbst gewaehlten Dateinamen abzulegen.
 */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-mrpack-whitelist-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

function bundle(require, esbuild, shim, relativeSourcePath, outName) {
  const entry = join(work, `entry-${outName}.js`)
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, relativeSourcePath))})`)
  const out = join(work, `${outName}.cjs`)
  return esbuild
    .build({
      entryPoints: [entry],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: out,
      alias: { '@shared': join(root, 'src/shared'), electron: shim },
      logLevel: 'error'
    })
    .then(() => require(out))
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

  /* ------------------------------------------------------------------ *
   * 1. filterAllowedMrpackUrls, aus dem echten modpack.ts
   * ------------------------------------------------------------------ */
  const { filterAllowedMrpackUrls } = await bundle(require, esbuild, shim, 'src/main/core/modpack.ts', 'modpack')

  const allowedCases = [
    'https://cdn.modrinth.com/data/AAAA/versions/BBBB/sodium.jar',
    'https://github.com/someuser/somerepo/releases/download/v1/file.jar',
    'https://raw.githubusercontent.com/someuser/somerepo/main/file.jar',
    'https://gitlab.com/someuser/somerepo/-/raw/main/file.jar'
  ]
  for (const url of allowedCases) {
    const result = filterAllowedMrpackUrls([url])
    check(result.length === 1 && result[0] === url, `Erlaubte Adresse wurde verworfen: ${url}`)
  }
  notes.push(`${allowedCases.length} erlaubte Adressen (cdn.modrinth.com, github.com, raw.githubusercontent.com, gitlab.com) kamen durch.`)

  const blockedCases = [
    // Falscher Host.
    'https://evil.example.com/payload.jar',
    // Host-Verwechslung, haengt "cdn.modrinth.com" nur als Pfad oder Subdomain an.
    'https://cdn.modrinth.com.evil.example.com/x.jar',
    'https://evil.example.com/cdn.modrinth.com/x.jar',
    // Kein https.
    'http://cdn.modrinth.com/data/AAAA/versions/BBBB/sodium.jar',
    'ftp://cdn.modrinth.com/data/AAAA/versions/BBBB/sodium.jar',
    // Lokale/interne Adressen, falls jemand versucht, ueber den Host-Check zu kommen.
    'https://localhost/x.jar',
    'https://127.0.0.1/x.jar',
    'file:///etc/passwd',
    // Kaputte oder leere Adresse.
    'nicht-mal-eine-url',
    ''
  ]
  for (const url of blockedCases) {
    const result = filterAllowedMrpackUrls([url])
    check(result.length === 0, `Nicht erlaubte Adresse kam durch: "${url}"`)
  }
  notes.push(`${blockedCases.length} nicht erlaubte oder ungueltige Adressen wurden verworfen.`)

  // Gemischte Liste: nur die erlaubten bleiben uebrig, in ihrer Reihenfolge.
  const mixed = filterAllowedMrpackUrls([
    'https://evil.example.com/payload.jar',
    'https://cdn.modrinth.com/data/AAAA/versions/BBBB/sodium.jar',
    'https://github.com/someuser/somerepo/releases/download/v1/file.jar'
  ])
  check(
    mixed.length === 2 &&
      mixed[0] === 'https://cdn.modrinth.com/data/AAAA/versions/BBBB/sodium.jar' &&
      mixed[1] === 'https://github.com/someuser/somerepo/releases/download/v1/file.jar',
    `Gemischte Liste wurde falsch gefiltert: ${JSON.stringify(mixed)}`
  )
  notes.push('Bei gemischten Listen (primaer + Spiegel) bleiben genau die erlaubten Adressen in Reihenfolge stehen.')

  // Eine Datei, deren einzige Adresse verboten ist, bleibt ohne jede Adresse.
  const noneLeft = filterAllowedMrpackUrls(['https://evil.example.com/payload.jar'])
  check(noneLeft.length === 0, 'Datei ohne erlaubte Adresse haette leer bleiben muessen')

  /* ------------------------------------------------------------------ *
   * 2. sha256File, aus dem echten java.ts (Fix 1: Pruefsumme fuer Java)
   * ------------------------------------------------------------------ */
  const { sha256File } = await bundle(require, esbuild, shim, 'src/main/core/java.ts', 'java')

  const smallFile = join(work, 'sample.bin')
  const content = Buffer.from('Launch Gabi Pruefsummen-Test '.repeat(500), 'utf8')
  writeFileSync(smallFile, content)
  const expected = createHash('sha256').update(content).digest('hex')

  const actual = await sha256File(smallFile)
  check(actual === expected, `sha256File liefert "${actual}" statt der erwarteten "${expected}"`)
  notes.push('sha256File auf einer echten kleinen Datei stimmt mit Node-eigenem createHash("sha256") ueberein.')

  // Eine veraenderte Datei muss eine andere Pruefsumme ergeben, genau der
  // Fall, den der Vergleich in installJavaOnce abfangen soll.
  const tamperedFile = join(work, 'sample-tampered.bin')
  writeFileSync(tamperedFile, Buffer.concat([content, Buffer.from('X')]))
  const tamperedHash = await sha256File(tamperedFile)
  check(tamperedHash !== expected, 'Eine veraenderte Datei ergab dieselbe Pruefsumme wie das Original')
  notes.push('Eine um ein Byte veraenderte Datei ergibt eine andere Pruefsumme, der Abgleich in installJavaOnce wuerde sie ablehnen.')
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
