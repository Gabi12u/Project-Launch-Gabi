/**
 * Prueft, dass ein Download oder eine API-Anfrage nicht mehr blind einer
 * Umleitung auf eine lokale/interne Adresse folgt.
 *
 *   node scripts/test-redirect-ssrf.mjs
 *
 * `fetch` mit dem Standardverhalten `redirect: 'follow'` gab keine
 * Moeglichkeit, ein Umleitungsziel vor dem Folgen zu pruefen. Eine
 * manipulierte oder kompromittierte Download-Adresse (Mod, Modpack) haette
 * dadurch eine Anfrage an das eigene Netzwerk des Nutzers ausloesen koennen.
 *
 * Zwei Teile: eine reine Tabellenpruefung der Adress-Erkennung (kein Netz
 * noetig), und ein echter Test gegen httpbin.org, das gezielt zum Testen von
 * Umleitungen gedacht ist, mit einer echten Umleitung auf eine lokale
 * Adresse. Braucht eine Internetverbindung für den zweiten Teil.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-ssrf-'))

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
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] },
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/net.ts'))})`)

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

  const { httpRequest } = require(out)

  // --- Part 1: a direct request to a private address, no server needed --
  // ------------------------------------------------------------------

  const privateTargets = [
    'http://127.0.0.1:1/x',
    'http://127.0.0.5:1/x',
    'http://10.0.0.1:1/x',
    'http://172.16.0.1:1/x',
    'http://172.31.255.255:1/x',
    'http://192.168.1.1:1/x',
    'http://169.254.169.254:1/x', // the classic cloud metadata SSRF target
    'http://localhost:1/x',
    'http://[::1]:1/x'
  ]
  for (const url of privateTargets) {
    try {
      await httpRequest(url, {}, 0)
      problems.push(`${url} wurde nicht abgelehnt`)
    } catch (err) {
      check(
        String(err?.message ?? err).includes('interne Adresse'),
        `${url} wurde abgelehnt, aber mit der falschen Meldung: ${err?.message ?? err}`
      )
    }
  }
  notes.push(`${privateTargets.length} lokale/interne Zieladressen direkt geprüft, alle abgelehnt.`)

  // A real public address must not be caught by the same check. 172.32.x.x
  // looks close to the private 172.16-31 range but sits just outside it.
  const publicLookingButNot = 'http://172.32.0.1:1/x'
  try {
    await httpRequest(publicLookingButNot, {}, 0)
    problems.push(`${publicLookingButNot} haette eigentlich einen Verbindungsfehler werfen sollen`)
  } catch (err) {
    check(
      !String(err?.message ?? err).includes('interne Adresse'),
      `${publicLookingButNot} wurde faelschlich als interne Adresse abgelehnt`
    )
  }

  // --- Part 2: a real redirect from a public host to a private target ---
  // ------------------------------------------------------------------

  try {
    const redirectTo = encodeURIComponent('http://127.0.0.1:1/internal')
    await httpRequest(`https://httpbin.org/redirect-to?url=${redirectTo}&status_code=302`, {}, 0)
    problems.push('Umleitung von httpbin.org auf 127.0.0.1 wurde nicht abgelehnt')
  } catch (err) {
    const message = String(err?.message ?? err)
    check(
      message.includes('interne Adresse'),
      `Umleitungstest lief, aber mit unerwarteter Meldung: ${message}`
    )
    if (message.includes('interne Adresse')) {
      notes.push('Echte Umleitung von httpbin.org (öffentlich) auf 127.0.0.1 wurde live abgelehnt.')
    }
  }

  // A normal, non-redirecting real request must still work.
  const res = await httpRequest('https://httpbin.org/get', {}, 0)
  check(res.ok, 'Normale Anfrage an httpbin.org ist fehlgeschlagen')
  notes.push('Normale, nicht umgeleitete Anfrage an einen echten Server funktioniert weiterhin.')
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
// Not process.exit(): eleven back-to-back AbortSignal.timeout() calls each
// arm a real timer, and forcing the process down immediately while several
// are still being torn down crashes the Windows build of Node in native
// code (src/win/async.c) with an unrelated assertion, after every check
// above has already passed. Setting the code and letting the event loop
// drain on its own avoids that.
process.exitCode = problems.length === 0 ? 0 : 1
