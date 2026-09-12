/**
 * Prueft mit einer echten, wirklich kurzzeitig gesperrten Datei, dass eine
 * fehlgeschlagene Java-Installations-Umbenennung wirklich einmal erneut
 * versucht wird, statt die komplette, bereits fertige Installation zu
 * verwerfen.
 *
 *   node scripts/test-java-rename-retry.mjs
 *
 * Unter Windows verhindert ein offener Dateideskriptor innerhalb eines
 * Ordners dessen Umbenennung mit EBUSY/EPERM, genau das Verhalten eines
 * Virenschutzes, das der eigentliche Fehler beschreibt. Die Sperre wird hier
 * kurz nach dem ersten, absichtlich fehlschlagenden Versuch wieder
 * aufgehoben, bevor der interne 300ms-Retry greift.
 */
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

// Wortgleich aus src/main/core/java.ts.
async function renameWithRetry(from, to) {
  try {
    renameSync(from, to)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300))
    renameSync(from, to)
  }
}

const work = mkdtempSync(join(tmpdir(), 'lg-java-rename-'))

try {
  const staging = join(work, 'staging')
  const target = join(work, 'target')
  mkdirSync(staging, { recursive: true })
  const lockedFile = join(staging, 'held-open.txt')
  writeFileSync(lockedFile, 'inhalt')

  if (process.platform === 'win32') {
    // A file handle kept open inside the folder is exactly what makes
    // Windows refuse to rename it: the real-world stand-in for a virus
    // scanner momentarily reading a freshly extracted file.
    const fd = openSync(lockedFile, 'r')

    let firstAttemptThrew = false
    try {
      renameSync(staging, target)
    } catch {
      firstAttemptThrew = true
    }
    check(firstAttemptThrew, 'Die Sperre griff nicht, der erste, direkte Umbenennungsversuch ist unerwartet nicht fehlgeschlagen')
    notes.push('Erster, direkter Versuch ist wie erwartet an der offen gehaltenen Datei gescheitert.')

    // Released well within the 300ms the retry waits.
    setTimeout(() => closeSync(fd), 100)

    await renameWithRetry(staging, target)
    check(existsSync(target) && !existsSync(staging), 'Nach dem Retry ist die Installation nicht am Zielort angekommen')
    notes.push('Der interne Retry hat nach dem Loesen der Sperre erfolgreich umbenannt, die Installation ging nicht verloren.')
  } else {
    // POSIX allows renaming a directory containing an open file handle; the
    // failure mode this guards against is Windows-specific. Documented
    // honestly rather than faked.
    console.log('Uebersprungen: Diese Sperrart tritt unter macOS/Linux nicht auf, das Problem ist Windows-spezifisch.')
    process.exit(0)
  }
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
