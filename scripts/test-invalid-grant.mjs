/**
 * Prueft die Zuordnung von `invalid_grant` beim Anmelden.
 *
 *   node scripts/test-invalid-grant.mjs
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

  const { explainInvalidGrant } = await import(pathToFileURL(out).href)

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
