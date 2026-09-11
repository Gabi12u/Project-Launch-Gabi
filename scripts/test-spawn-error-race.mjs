/**
 * Prueft mit einem echten, fehlschlagenden spawn() (keine Attrappe), dass
 * Node den 'error'-Fall wirklich erst nach dem laufenden synchronen Block
 * meldet, und dass das Warten auf 'spawn' oder 'error' in launch.ts diesen
 * Fall tatsaechlich abfaengt, bevor markPlayed()/task.done() liefen.
 *
 *   node scripts/test-spawn-error-race.mjs
 *
 * Erst wird das alte Verhalten nachgestellt (kein Warten: der synchrone
 * Code nach spawn() laeuft komplett durch, bevor 'error' ueberhaupt
 * eintrifft), dann das neue (mit dem in launch.ts ergaenzten Promise).
 */
import { spawn } from 'node:child_process'

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const missingCommand = 'lg-does-not-exist-anywhere-xyz'

/* ------------------------------------------------------------------ *
 * 1. Das alte Verhalten: kein Warten auf 'spawn'/'error'.
 * ------------------------------------------------------------------ */
{
  const order = []
  const child = spawn(missingCommand, [])
  child.on('error', () => order.push('error'))
  // Genau der Code, der in launch.ts vor der Reparatur direkt nach spawn()
  // stand: rein synchron, kein await dazwischen.
  order.push('markPlayed')
  order.push('task.done')

  await new Promise((resolve) => setTimeout(resolve, 200))

  check(
    order[0] === 'markPlayed' && order[1] === 'task.done' && order[2] === 'error',
    `Altes Verhalten: Reihenfolge war "${order.join(', ')}", erwartet "markPlayed, task.done, error" ` +
      '(das ist genau der Fehler: Erfolg wurde gemeldet, bevor der Fehlschlag ueberhaupt eintraf)'
  )
  notes.push(`Ohne Warten: Reihenfolge war ${order.join(' -> ')}`)
}

/* ------------------------------------------------------------------ *
 * 2. Das neue Verhalten: auf 'spawn' oder 'error' warten, wie jetzt in
 *    launch.ts, bevor markPlayed()/task.done() laufen.
 * ------------------------------------------------------------------ */
{
  const order = []
  const child = spawn(missingCommand, [])

  let threw = false
  try {
    await new Promise((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError)
        resolve()
      }
      const onError = (err) => {
        child.off('spawn', onSpawn)
        reject(err)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })
    order.push('markPlayed')
    order.push('task.done')
  } catch {
    threw = true
  }

  check(threw, 'Neues Verhalten: der Fehlschlag wurde nicht abgefangen, das Promise ist nicht fehlgeschlagen')
  check(order.length === 0, `Neues Verhalten: markPlayed/task.done liefen trotzdem (${order.join(', ')})`)
  notes.push(
    threw
      ? 'Mit Warten: der Fehlschlag wurde abgefangen, bevor markPlayed()/task.done() laufen konnten.'
      : 'Mit Warten: FEHLER, der Fehlschlag wurde nicht abgefangen.'
  )
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
