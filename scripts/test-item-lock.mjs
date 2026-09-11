/**
 * Prueft die Warteschlangen-Sperre, die update+remove desselben Mods jetzt
 * voneinander trennt (src/main/core/content.ts, withItemLock).
 *
 *   node scripts/test-item-lock.mjs
 *
 * Kein Netz- oder Provider-Mock moeglich: esbuild verweigert Aliase fuer
 * relative Importpfade wie './net' (empirisch geprueft, "Invalid alias
 * name"), und applyUpdate() selbst braucht einen echten Download samt
 * Provider-Abfrage. Was hier tatsaechlich getestet wird, ist deshalb die
 * Sperre selbst, wortgleich aus content.ts uebernommen, nicht die
 * umschliessenden Funktionen. Der eigentliche Fehler lag genau in dieser
 * Sperre (withContentLock ist ein Zaehler, kein Mutex), nicht in
 * applyUpdateOnce/removeContentOnce selbst, die pruefbar korrekt lesen und
 * schreiben, sobald sie nacheinander statt gleichzeitig laufen.
 */

// Wortgleich aus src/main/core/content.ts.
const itemLocks = new Map()
function withItemLock(contentId, run) {
  const previous = itemLocks.get(contentId) ?? Promise.resolve()
  const result = previous.then(run, run)
  const marker = result.then(
    () => undefined,
    () => undefined
  )
  itemLocks.set(contentId, marker)
  void marker.finally(() => {
    if (itemLocks.get(contentId) === marker) itemLocks.delete(contentId)
  })
  return result
}

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

/* ------------------------------------------------------------------ *
 * 1. Zwei Aufrufe fuer dieselbe Id laufen nacheinander, nicht ueberlappend.
 * ------------------------------------------------------------------ */
{
  const order = []
  let insideCount = 0
  let overlapped = false

  const slow = async (label, ms) => {
    insideCount++
    if (insideCount > 1) overlapped = true
    order.push(`start:${label}`)
    await new Promise((resolve) => setTimeout(resolve, ms))
    order.push(`end:${label}`)
    insideCount--
  }

  const a = withItemLock('mod-x', () => slow('update', 100))
  const b = withItemLock('mod-x', () => slow('remove', 10))
  await Promise.all([a, b])

  check(!overlapped, 'Zwei Aufrufe fuer dieselbe Id liefen gleichzeitig, das ist genau die Race, die behoben werden sollte')
  check(
    order.join(',') === 'start:update,end:update,start:remove,end:remove',
    `Reihenfolge war "${order.join(',')}", erwartet strikt nacheinander in Aufrufreihenfolge`
  )
  notes.push(`Gleiche Id, zwei Aufrufe: ${order.join(' -> ')}`)
}

/* ------------------------------------------------------------------ *
 * 2. Verschiedene Ids blockieren sich gegenseitig nicht.
 * ------------------------------------------------------------------ */
{
  const order = []
  const a = withItemLock('mod-a', async () => {
    order.push('a-start')
    await new Promise((resolve) => setTimeout(resolve, 50))
    order.push('a-end')
  })
  const b = withItemLock('mod-b', async () => {
    order.push('b-start')
    await new Promise((resolve) => setTimeout(resolve, 10))
    order.push('b-end')
  })
  await Promise.all([a, b])

  check(
    order[0] === 'a-start' && order[1] === 'b-start',
    `Verschiedene Ids sollten sich nicht blockieren, Reihenfolge war "${order.join(',')}"`
  )
  notes.push(`Verschiedene Ids liefen parallel: ${order.join(' -> ')}`)
}

/* ------------------------------------------------------------------ *
 * 3. Ein fehlschlagender Aufruf blockiert die Warteschlange nicht dauerhaft.
 * ------------------------------------------------------------------ */
{
  let secondRan = false
  const first = withItemLock('mod-y', async () => {
    throw new Error('erster Aufruf schlaegt absichtlich fehl')
  })
  const second = withItemLock('mod-y', async () => {
    secondRan = true
  })

  let firstThrew = false
  try {
    await first
  } catch {
    firstThrew = true
  }
  await second

  check(firstThrew, 'Der erste, absichtlich fehlschlagende Aufruf hat nicht geworfen')
  check(secondRan, 'Ein fehlgeschlagener Aufruf hat die Warteschlange fuer denselben Namen dauerhaft blockiert')
  notes.push('Fehlschlag in der Warteschlange blockiert nachfolgende Aufrufe fuer dieselbe Id nicht.')
}

/* ------------------------------------------------------------------ *
 * 4. Selbstaufraeumend: nach Abschluss bleibt kein Eintrag zurueck.
 * ------------------------------------------------------------------ */
{
  await withItemLock('mod-z', async () => {})
  // Der interne finally() haengt an derselben Microtask-Kette, ein Tick
  // Abstand reicht, um ihn sicher durchlaufen zu lassen.
  await new Promise((resolve) => setTimeout(resolve, 0))
  check(!itemLocks.has('mod-z'), 'Eintrag blieb nach Abschluss in der Map stehen, das waechst unbegrenzt')
  notes.push(`Offene Eintraege nach allen Tests: ${itemLocks.size}`)
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
