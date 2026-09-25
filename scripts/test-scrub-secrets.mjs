/**
 * Prueft scrub() aus core/reports.ts und das Sicherheitsnetz aus logger.ts
 * (redactSecrets()).
 *
 *   node scripts/test-scrub-secrets.mjs
 *
 * Deckt den gefundenen Fehler ab: die alte "ey"-Regel brach an der ersten
 * Stelle mit einem Punkt ab. Aus einem JWT hinter "Bearer " wurde dadurch
 * "Bearer <Token>.<Token>.<Unterschrift im Klartext>", weil die
 * Bearer-Regel danach an den spitzen Klammern der schon ersetzten Teile
 * scheiterte, statt den ganzen Rest zu erfassen.
 *
 * Dazu: Microsoft-Refresh-Tokens ("M." und "0."), die Felder
 * accessToken/refresh_token in JSON und in einer URL, eine E-Mail-Adresse
 * in einer AADSTS-Meldung, und normaler Text, der unveraendert bleiben
 * muss. scrub() ersetzt eine UUID absichtlich, das leichte Sicherheitsnetz
 * im Logger tut das nicht, das wird hier getrennt geprueft.
 *
 * Bau ueber esbuild wie in test-login-messages.mjs: beide Module ziehen
 * ueber ../store bzw. direkt "electron" heran, das es hier nicht gibt.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-scrub-'))

const problems = []
const notes = []

/** Records a check by name; on failure the actual output is attached. */
function check(name, condition, actual) {
  if (condition) {
    notes.push(name)
  } else {
    problems.push(`${name}: "${String(actual).slice(0, 160)}"`)
  }
}

try {
  // scrub() calls into store.ts, which needs a working app.getPath, unlike
  // the plain stub test-login-messages.mjs uses for microsoft.ts.
  const stub = join(work, 'electron.js')
  writeFileSync(
    stub,
    `export const app = { getPath: () => ${JSON.stringify(work)}, getVersion: () => '0.0.0-test' };\n` +
      "export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (b) => b.toString() };\n" +
      'export const BrowserWindow = { getAllWindows: () => [] };\n'
  )

  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const aliasOptions = { electron: stub, '@shared': join(root, 'src', 'shared') }

  const reportsOut = join(work, 'reports.mjs')
  await esbuild.build({
    entryPoints: [join(root, 'src', 'main', 'core', 'reports.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: reportsOut,
    alias: aliasOptions,
    logLevel: 'error'
  })

  const loggerOut = join(work, 'logger.mjs')
  await esbuild.build({
    entryPoints: [join(root, 'src', 'main', 'logger.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: loggerOut,
    alias: aliasOptions,
    logLevel: 'error'
  })

  const { scrub } = await import(pathToFileURL(reportsOut).href)
  const { redactSecrets } = await import(pathToFileURL(loggerOut).href)

  const functions = [
    ['scrub', scrub],
    ['redactSecrets', redactSecrets]
  ]

  /* --- Ein echt aussehendes JWT --------------------------------------- */
  const jwtHeader = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
  const jwtPayload = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0'
  const jwtSignature = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
  const jwt = `${jwtHeader}.${jwtPayload}.${jwtSignature}`

  for (const [label, fn] of functions) {
    check(`${label}: nacktes JWT wird zu genau einem <Token>`, fn(jwt) === '<Token>', fn(jwt))

    const withBearer = fn(`Authorization: Bearer ${jwt}`)
    check(
      `${label}: "Bearer <JWT>" wird zu "Authorization: Bearer <Token>"`,
      withBearer === 'Authorization: Bearer <Token>',
      withBearer
    )
    // Der eigentliche Fund: keiner der drei Teile, vor allem nicht die
    // Unterschrift, darf noch lesbar sein.
    check(
      `${label}: weder Kopf, Nutzlast noch Unterschrift bleiben lesbar`,
      !withBearer.includes(jwtHeader) && !withBearer.includes(jwtPayload) && !withBearer.includes(jwtSignature),
      withBearer
    )
    check(
      `${label}: kein zerstueckeltes "<Token>.<Token>" mehr`,
      !/<Token>\s*\.\s*<Token>/.test(withBearer),
      withBearer
    )
  }

  /* --- Microsoft-Refresh-Tokens ---------------------------------------- */
  const msToken = 'M.C534_BAY.2.U.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_!*'
  const familyToken = '0.AXoAv4j5cdEXhqRstUvWxYzABCDEFGHIJKLMNOPQRSTUVWXYZ0123'

  for (const [label, fn] of functions) {
    check(`${label}: "M."-Refresh-Token wird ersetzt`, fn(msToken) === '<Token>', fn(msToken))
    check(`${label}: "0."-Refresh-Token wird ersetzt`, fn(familyToken) === '<Token>', fn(familyToken))
    // "0." sieht aus wie der Anfang einer Versionsnummer. Die darf nicht
    // als Token verschluckt werden, ein Dezimalbruch erst recht nicht.
    check(
      `${label}: Versionsnummer "0.21.11" bleibt unveraendert`,
      fn('Version 0.21.11 gestartet') === 'Version 0.21.11 gestartet',
      fn('Version 0.21.11 gestartet')
    )
    check(`${label}: Dezimalzahl "0.5" bleibt unveraendert`, fn('Wert 0.5 gemessen') === 'Wert 0.5 gemessen')
  }

  /* --- JSON-Felder accessToken / refresh_token ------------------------- */
  const json = '{"accessToken":"abcDEF1234567890ghijkl","refresh_token":"xyzGHI0987654321mnopqr","other":"kept"}'
  for (const [label, fn] of functions) {
    const out = fn(json)
    check(
      `${label}: accessToken- und refresh_token-Werte verschwinden aus JSON`,
      !out.includes('abcDEF1234567890ghijkl') && !out.includes('xyzGHI0987654321mnopqr'),
      out
    )
    check(`${label}: uebrige JSON-Felder bleiben erhalten`, out.includes('"other":"kept"'), out)
  }

  /* --- URL mit ?access_token= ------------------------------------------ */
  const url = 'https://example.com/callback?state=xyz&access_token=SECRETVALUE1234567890'
  for (const [label, fn] of functions) {
    const out = fn(url)
    check(`${label}: access_token in der URL verschwindet`, !out.includes('SECRETVALUE1234567890'), out)
    check(
      `${label}: Rest der URL bleibt lesbar`,
      out.includes('example.com') && out.includes('state=xyz'),
      out
    )
  }

  /* --- E-Mail in einer AADSTS-Meldung ----------------------------------- */
  const aadsts = "AADSTS50034: The user account gabriel.tester@example.com does not exist in tenant 'consumers'."
  for (const [label, fn] of functions) {
    const out = fn(aadsts)
    check(`${label}: E-Mail aus der AADSTS-Meldung verschwindet`, !out.includes('gabriel.tester@example.com'), out)
    check(`${label}: Fehlercode AADSTS50034 bleibt lesbar`, out.includes('AADSTS50034'), out)
  }

  /* --- Normaler Text, der unveraendert bleiben muss --------------------- */
  const instanceUuid = '550e8400-e29b-41d4-a716-446655440000'
  const normalLine = `Instanz 'Mein Modpack Server' gestartet, Version 1.21.11, Geraete-ID ${instanceUuid}`

  // Das leichte Sicherheitsnetz im Logger darf Instanznamen, Versionen und
  // UUIDs nicht anfassen, sonst wird jede gewoehnliche Log-Zeile unlesbar.
  check(
    'redactSecrets: Instanzname, Versionsnummer und UUID bleiben unveraendert',
    redactSecrets(normalLine) === normalLine,
    redactSecrets(normalLine)
  )

  // scrub() ist die vollstaendige Reinigung fuer Berichte und ersetzt eine
  // UUID absichtlich (Mojang-IDs, Geraete-IDs), anders als das Sicherheitsnetz
  // im Logger. Die Versionsnummer bleibt auch hier unangetastet.
  const scrubbedNormal = scrub(normalLine)
  check(
    'scrub: Versionsnummer bleibt, UUID wird zu <UUID>',
    scrubbedNormal.includes('1.21.11') && !scrubbedNormal.includes(instanceUuid) && scrubbedNormal.includes('<UUID>'),
    scrubbedNormal
  )
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stderr ? String(err.stderr) : err.message))
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
