/**
 * Prueft den Import grosser Modpacks, die Eintrag fuer Eintrag gelesen werden.
 *
 *   node scripts/test-import-packs-large.mjs
 *
 * Ab 1 GB liest der Launcher ein Archiv nicht mehr als Ganzes in den Speicher,
 * denn ab 2 GB verweigert Node das, und ein gueltiges Modpack mit
 * mitgelieferten Welten wurde als "kein gueltiges .mrpack" abgelehnt. Ein
 * echtes Archiv dieser Groesse waere fuer einen Test zu schwer. Stattdessen
 * laeuft test-import-packs.mjs mit allen seinen Faellen noch einmal, die
 * Grenze auf 1 Byte gesenkt, so dass jedes Archiv den Weg grosser Archive
 * nimmt.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const run = spawnSync(process.execPath, [join(here, 'test-import-packs.mjs')], {
  env: { ...process.env, LG_ZIP_STREAM_FROM_BYTES: '1' },
  encoding: 'utf8'
})
process.stdout.write(run.stdout ?? '')
process.stderr.write(run.stderr ?? '')
if (run.status !== 0) {
  console.log('\nERGEBNIS: FEHLGESCHLAGEN (Import grosser Archive)')
  process.exit(1)
}
console.log('\nERGEBNIS: BESTANDEN (alle Faelle ueber den Weg grosser Archive)')
