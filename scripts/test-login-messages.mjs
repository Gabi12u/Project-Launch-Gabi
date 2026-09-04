/**
 * Prueft die Saetze, die eine gescheiterte Anmeldung ausgibt.
 *
 *   node scripts/test-login-messages.mjs
 *
 * Zwei Zuordnungen: warum Microsoft den Geraetecode abgelehnt hat, und
 * warum ein Konto kein Minecraft-Java-Profil hat. Beide entscheiden,
 * was jemand als Naechstes tun soll, und eine falsche Anleitung ist an
 * der Stelle schlimmer als keine.
 *
 * Die beiden ersten Faelle sind keine erdachten Beispiele: der eine ist
 * die echte Antwort von login.live.com auf einen Code, den es nicht
 * gibt, der andere stammt Wort fuer Wort aus einem Fehlerbericht aus
 * 1.0.16.
 *
 * Der Modul-Import laeuft ueber esbuild, weil microsoft.ts TypeScript
 * ist und `electron` importiert, das es hier nicht gibt. Ueber die
 * Programmierschnittstelle statt ueber die ausfuehrbare Datei: der
 * Projektpfad enthaelt Leerzeichen, und ein Aufruf ueber die Shell
 * zerbricht daran.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-grant-'))

const problems = []
const notes = []

try {
  // electron und die Nachbarmodule werden nicht gebraucht, nur die eine
  // Funktion. Ein Stub haelt den Bundler zufrieden.
  const stub = join(work, 'electron.js')
  writeFileSync(stub, 'export const app = {}; export const safeStorage = {};')

  const out = join(work, 'microsoft.mjs')
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  await esbuild.build({
    entryPoints: [join(root, 'src', 'main', 'auth', 'microsoft.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    alias: { electron: stub, '@shared': join(root, 'src', 'shared') },
    logLevel: 'error'
  })

  const { explainInvalidGrant, explainMissingProfile, technicalSuffix } =
    await import(pathToFileURL(out).href)

  const cases = [
    {
      name: 'abgelaufener oder unbekannter Code',
      body: '{"error":"invalid_grant","error_description":"The provided value for the input parameter \'device_code\' is not valid."}',
      expect: /abgelaufen/i
    },
    {
      name: 'Anmeldung im Browser nicht abgeschlossen',
      body: '{"error":"invalid_grant","error_description":"The user could not be authenticated or user interaction is required. The user must sign in again and if needed grant the client application access to the requested scope.","correlation_id":"x"}',
      expect: /nicht abgeschlossen/i
    },
    {
      name: 'etwas Unbekanntes',
      body: '{"error":"invalid_grant","error_description":"Something else entirely."}',
      expect: /abgelehnt/i
    },
    {
      name: 'leerer Rumpf',
      body: '',
      expect: /abgelehnt/i
    }
  ]

  for (const c of cases) {
    const message = explainInvalidGrant(c.body)
    if (!c.expect.test(message)) {
      problems.push(`${c.name}: "${message}"`)
    } else {
      notes.push(`${c.name} -> "${message.slice(0, 62)}..."`)
    }
    if (/HTTP 400|invalid_grant|error_description/.test(message)) {
      problems.push(`${c.name}: rohe Fehlerdaten in der Nutzermeldung`)
    }
  }

  // Die beiden Faelle muessen verschieden ausgehen, sonst haette die
  // Unterscheidung keinen Sinn.
  if (explainInvalidGrant(cases[0].body) === explainInvalidGrant(cases[1].body)) {
    problems.push('Beide bekannten Faelle liefern dieselbe Meldung')
  }

  /* --- Konto ohne Java-Profil ------------------------------------- *
   * Der Weg zu einem Spielernamen ist je nach Herkunft ein anderer.
   * Wer Game Pass hat, findet auf minecraft.net keinen Knopf dafuer und
   * denkt, es liege am Launcher.
   * ---------------------------------------------------------------- */

  const profileCases = [
    {
      name: 'Game Pass',
      items: ['product_game_pass_ultimate', 'product_game_pass_pc'],
      expect: /Xbox-App|Game Pass/i,
      forbid: /minecraft\.net/i
    },
    {
      name: 'gekaufte Java Edition',
      items: ['product_minecraft', 'game_minecraft'],
      expect: /minecraft\.net/i,
      forbid: /Game Pass/i
    },
    {
      name: 'nichts gemeldet',
      items: [],
      expect: /Game Pass.*minecraft\.net|minecraft\.net.*Game Pass/is,
      forbid: null
    }
  ]

  for (const c of profileCases) {
    const message = explainMissingProfile(c.items)
    if (!c.expect.test(message)) {
      problems.push(`Profil, ${c.name}: falscher Weg genannt: "${message.slice(0, 80)}"`)
    } else {
      notes.push(`Profil, ${c.name} -> "${message.slice(0, 62)}..."`)
    }
    if (c.forbid && c.forbid.test(message)) {
      problems.push(`Profil, ${c.name}: nennt den Weg der anderen Herkunft`)
    }
    if (/Lizenz|besitzt keine/i.test(message)) {
      problems.push(`Profil, ${c.name}: behauptet fehlenden Besitz, obwohl nur das Profil fehlt`)
    }
  }

  // Game Pass und Kauf duerfen nicht denselben Satz bekommen.
  if (explainMissingProfile(['product_game_pass_pc']) === explainMissingProfile(['product_minecraft'])) {
    problems.push('Game Pass und Kauf bekommen dieselbe Anleitung')
  }

  /* --- Der technische Anhang ---------------------------------------- *
   * Er soll da sein, aber hinten: der Satz davor sagt, was zu tun ist,
   * der Anhang hilft auf einem Screenshot weiter.
   * ------------------------------------------------------------------ */

  const suffix = technicalSuffix(400, 'invalid_grant')
  if (!/invalid_grant/.test(suffix) || !/400/.test(suffix)) {
    problems.push(`Anhang nennt Code und Status nicht: "${suffix}"`)
  }
  if (technicalSuffix() !== '') {
    problems.push('Ohne Code und Status wird trotzdem etwas angehaengt')
  }
  const full = explainInvalidGrant(cases[1].body) + suffix
  if (full.indexOf('invalid_grant') < full.indexOf('Anmeldung bei Microsoft')) {
    problems.push('Der technische Teil steht vor dem verstaendlichen')
  }
  notes.push(`Anhang: "${suffix.trim()}"`)
  notes.push(`Vollstaendig: "${full.slice(0, 78)}..."`)
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
