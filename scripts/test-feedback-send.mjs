/**
 * Prueft "Fehler melden" im Launcher:
 *
 *   node scripts/test-feedback-send.mjs
 *
 * Der Server ist durch eine Attrappe ersetzt, die sich merkt, was ankommt.
 * Echt sind feedback.ts, das Bereinigen des Protokolls aus reports.ts und
 * das Lesen der Protokolldatei.
 *
 * 1. Ohne Berichtswort im Bau laesst sich nichts senden.
 * 2. Zu kurzer Text, zu viele Bilder, ein Bild, das keines ist: abgelehnt,
 *    bevor etwas das Geraet verlaesst.
 * 3. Eine richtige Meldung: Text, Kontakt, Version, System und Bilder kommen
 *    an, mit dem Berichtswort. Das Protokoll nur mit Haekchen, und dann ohne
 *    Benutzernamen, Spielernamen und Zugangsdaten.
 * 4. Antworten des Servers werden zu Saetzen in der Sprache des Launchers.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-feedback-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const sent = []
let answer = { status: 202, body: { id: 'fb_test1' } }
globalThis.fetch = async (url, init = {}) => {
  sent.push({ url: String(url), headers: init.headers || {}, body: JSON.parse(init.body || '{}') })
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
}

async function build(token) {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const userData = join(work, `userData-${token ? 'mit' : 'ohne'}`)
  mkdirSync(join(userData, 'logs'), { recursive: true })
  const shim = join(work, `electron-shim-${token ? 'mit' : 'ohne'}.js`)
  writeFileSync(
    shim,
    `module.exports = {
       app: { getPath: () => ${JSON.stringify(userData)}, getVersion: () => '1.0.24', isPackaged: true, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = {
    feedback: require(${JSON.stringify(join(root, 'src/main/core/feedback.ts'))}),
    store: require(${JSON.stringify(join(root, 'src/main/store.ts'))})
  }`)
  const out = join(work, `bundle-${token ? 'mit' : 'ohne'}.cjs`)
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    // Wie beim echten Bau: das Wort kommt aus der Umgebung des Builds.
    define: { 'process.env.LG_REPORT_PANEL_TOKEN': JSON.stringify(token) },
    logLevel: 'error'
  })
  return { ...createRequire(import.meta.url)(out), userData }
}

const base = { message: 'Der Launcher bleibt beim Start von 1.21.4 bei 80 Prozent haengen.', contact: '  Max#1234  ', includeLog: false, images: [PNG] }

try {
  // --- 1. Ohne Berichtswort ------------------------------------------------
  const without = await build('')
  let failure = ''
  try { await without.feedback.sendFeedback(base) } catch (err) { failure = err.message }
  check(/kein Empfänger|no recipient/.test(failure), `Ohne Berichtswort: ${failure || 'gesendet'}`)
  check(sent.length === 0, 'Ohne Berichtswort ging trotzdem etwas raus')

  // --- 2. Abgelehnt, bevor etwas rausgeht ----------------------------------
  const { feedback, store, userData } = await build('test-berichtswort')
  for (const [bad, expect] of [
    [{ ...base, message: 'kaputt' }, /ein paar Worten|few words/],
    [{ ...base, images: [PNG, PNG, PNG, PNG] }, /Höchstens 3|At most 3/],
    [{ ...base, images: [Buffer.from('<html>hallo</html>').toString('base64')] }, /nicht lesen|could not be read/]
  ]) {
    failure = ''
    try { await feedback.sendFeedback(bad) } catch (err) { failure = err.message }
    check(expect.test(failure), `Erwartete Ablehnung, bekam: ${failure || 'gesendet'}`)
  }
  check(sent.length === 0, `Abgelehnte Meldungen gingen raus: ${sent.length}`)

  // --- 3. Eine richtige Meldung --------------------------------------------
  store.writeAccounts([{ id: 'a', type: 'microsoft', username: 'GeheimerSpieler', uuid: '0f0e0d0c0b0a49088776655443322110', active: true }])
  const home = userInfo().username
  writeFileSync(join(userData, 'logs', 'launcher-2026-10-01.log'), 'alt\n')
  writeFileSync(
    join(userData, 'logs', 'launcher-2026-11-01.log'),
    [
      '[info] Start',
      `[info] Daten in C:\\Users\\${home}\\AppData\\Roaming\\launch-gabi`,
      '[info] Angemeldet als GeheimerSpieler',
      '[warn] accessToken=eyJhbGciOiJIUzI1NiJ9.geheim.signatur',
      '[error] Java beendet mit Code 1'
    ].join('\n')
  )

  const quiet = await feedback.sendFeedback(base)
  check(quiet.id === 'fb_test1', `Antwort: ${JSON.stringify(quiet)}`)
  const first = sent.at(-1)
  check(first.url === 'https://admin.launchgabi.com/api/feedback', `Ziel: ${first.url}`)
  check(first.headers['x-report-token'] === 'test-berichtswort', 'Das Berichtswort fehlt')
  check(first.body.contact === 'Max#1234' && first.body.version === '1.0.24' && first.body.platform === `${process.platform} ${process.arch}`,
    `Angaben: ${JSON.stringify({ contact: first.body.contact, version: first.body.version, platform: first.body.platform })}`)
  check(first.body.images?.length === 1 && first.body.images[0].data === PNG, 'Das Bild kommt nicht unveraendert an')
  check(first.body.log === '', 'Ohne Haekchen geht das Protokoll trotzdem mit')

  await feedback.sendFeedback({ ...base, includeLog: true })
  const withLog = sent.at(-1).body.log
  check(withLog.includes('Java beendet mit Code 1'), `Das Protokoll fehlt: ${JSON.stringify(withLog)}`)
  check(!withLog.includes('alt'), 'Es wurde das alte statt des neuesten Protokolls genommen')
  check(!withLog.includes('GeheimerSpieler'), 'Der Spielername steht im Protokoll')
  check(home.length < 3 || !withLog.includes(home), 'Der Benutzername steht im Protokoll')
  check(!withLog.includes('geheim.signatur'), 'Das Zugangstoken steht im Protokoll')
  notes.push(`Protokoll nach dem Bereinigen: ${withLog.split('\n').slice(1, 4).join(' | ')}`)

  // --- 4. Antworten des Servers ---------------------------------------------
  answer = { status: 429, body: { error: 'Zu viele Meldungen.' } }
  failure = ''
  try { await feedback.sendFeedback(base) } catch (err) { failure = err.message }
  check(/mehrere Meldungen|several reports/.test(failure), `Bei 429: ${failure}`)
  answer = { status: 415, body: { error: 'Nur PNG' } }
  failure = ''
  try { await feedback.sendFeedback(base) } catch (err) { failure = err.message }
  check(/Bild wurde nicht angenommen|picture was not accepted/.test(failure), `Bei 415: ${failure}`)
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
