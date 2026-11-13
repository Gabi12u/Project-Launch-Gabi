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
 * Zwei Teile: eine reine Tabellenpruefung der Adress-Erkennung, und
 * Umleitungen, die ein Ersatz fuer fetch liefert: auf interne Ziele, von
 * https auf http, endlos, und eine harmlose. Braucht kein Netz.
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

  // --- Part 2: redirects, answered by a stand-in for fetch ---------------
  // ------------------------------------------------------------------
  // This used to ask httpbin.org for a real redirect to 127.0.0.1. httpbin
  // now refuses that itself with a 403, so the test failed for a reason that
  // had nothing to do with the launcher. What is under test is the launcher's
  // own check of every hop, so the hops come from a stand-in instead, and the
  // test no longer depends on a third party at all.

  const realFetch = globalThis.fetch
  const asked = []
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url))
    asked.push({ url: target.toString(), headers: new Headers(init.headers), redirect: init.redirect })
    if (target.hostname === 'mods.example') {
      return new Response(null, { status: 302, headers: { location: target.searchParams.get('to') } })
    }
    if (target.hostname === 'loop.example') {
      return new Response(null, { status: 301, headers: { location: `https://loop.example/${asked.length}` } })
    }
    if (target.hostname === 'cdn.example') return new Response('inhalt', { status: 200 })
    throw new Error(`Unerwartete Anfrage an ${target}`)
  }
  const via = (to) => `https://mods.example/download?to=${encodeURIComponent(to)}`
  const failureOf = async (url, init = {}) => {
    try {
      await httpRequest(url, init, 0)
      return ''
    } catch (err) {
      return String(err?.message ?? err)
    }
  }

  try {
    for (const inside of ['http://127.0.0.1:1/internal', 'https://192.168.1.1/router', 'https://[::ffff:127.0.0.1]/x', 'https://localhost/x']) {
      asked.length = 0
      const message = await failureOf(via(inside))
      check(message.includes('interne Adresse'), `Umleitung auf ${inside}: ${message || 'gefolgt'}`)
      check(asked.length === 1, `Umleitung auf ${inside}: das interne Ziel wurde trotzdem angefragt (${asked.map((a) => a.url).join(', ')})`)
    }
    notes.push('Umleitungen von einer öffentlichen Adresse auf vier interne Ziele wurden abgelehnt, bevor das Ziel angefragt wurde.')

    asked.length = 0
    const downgrade = await failureOf(via('http://cdn.example/datei.jar'))
    check(downgrade.includes('unverschlüsselte'), `Umleitung von https auf http: ${downgrade || 'gefolgt'}`)
    check(asked.length === 1, 'Die unverschlüsselte Adresse wurde trotzdem angefragt')

    asked.length = 0
    const endless = await failureOf('https://loop.example/start')
    check(endless.includes('Zu viele Umleitungen'), `Endlose Umleitung: ${endless || 'gefolgt'}`)
    check(asked.length <= 6, `Endlose Umleitung: ${asked.length} Anfragen`)

    // A harmless redirect still works, and the key meant for the first
    // server does not travel along to the second.
    asked.length = 0
    const res = await httpRequest(via('https://cdn.example/datei.jar'), { headers: { 'x-api-key': 'geheim', Authorization: 'Bearer geheim' } }, 0)
    check(res.ok && (await res.text()) === 'inhalt', 'Eine harmlose Umleitung wurde nicht gefolgt')
    check(asked.every((a) => a.redirect === 'manual'), 'Eine Anfrage folgte Umleitungen selbst, ohne Prüfung')
    check(asked[0]?.headers.get('x-api-key') === 'geheim', 'Der erste Server bekam seinen Schlüssel nicht')
    const second = asked[1]?.headers
    check(second && !second.get('x-api-key') && !second.get('authorization'), 'Der Schlüssel ging bei der Umleitung an einen fremden Server mit')
    notes.push('Eine harmlose Umleitung wird gefolgt, ohne den Schlüssel an den fremden Server weiterzugeben.')
  } finally {
    globalThis.fetch = realFetch
  }
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
