/**
 * Prueft mit einem echten, per Signal beendeten Kindprozess, dass die neue
 * crashed-Formel in launch.ts einen solchen Fall wirklich als Absturz
 * erkennt, die alte aber nicht.
 *
 *   node scripts/test-signal-crash-detection.mjs
 *
 * Nur unter POSIX aussagekraeftig: Windows kennt keine Signale, `code` ist
 * dort bei einem taskkill immer eine Zahl, nie null, und genau dafuer
 * existiert schon der separate stopRequested-Schutz. Unter Windows meldet
 * dieser Test das ehrlich statt ein Ergebnis vorzutaeuschen.
 */
import { spawn } from 'node:child_process'

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

if (process.platform === 'win32') {
  console.log('Uebersprungen: Windows hat keine POSIX-Signale, dieser Fall betrifft nur macOS/Linux.')
  process.exit(0)
}

const child = spawn('sleep', ['30'])

const exitInfo = await new Promise((resolve) => {
  child.on('spawn', () => {
    setTimeout(() => process.kill(child.pid, 'SIGTERM'), 200)
  })
  child.on('exit', (code, signal) => resolve({ code, signal }))
})

notes.push(`Echter Prozess nach SIGTERM: code=${exitInfo.code}, signal=${exitInfo.signal}`)

check(exitInfo.code === null, `Erwartet code === null nach Signal, war ${exitInfo.code}`)
check(exitInfo.signal === 'SIGTERM', `Erwartet signal === "SIGTERM", war ${exitInfo.signal}`)

const requested = false // "Stopp" wurde nicht angefordert, das hier ist ein unerwartetes Ende

const oldCrashed = !requested && exitInfo.code !== 0 && exitInfo.code !== null
const newCrashed = !requested && (exitInfo.signal !== null || (exitInfo.code !== 0 && exitInfo.code !== null))

check(oldCrashed === false, `Alte Formel: sollte den Fehler zeigen (false statt eines Absturzes), war ${oldCrashed}`)
check(newCrashed === true, `Neue Formel: haette den Absturz erkennen muessen, ergab ${newCrashed}`)

notes.push(`Alte Formel (code!==0 && code!==null): crashed = ${oldCrashed} (falsch, das war ein Absturz)`)
notes.push(`Neue Formel (signal!==null || ...): crashed = ${newCrashed} (richtig)`)

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
