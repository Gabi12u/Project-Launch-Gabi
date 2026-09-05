/**
 * Prueft das Uebersetzungssystem selbst, unabhaengig von React.
 *
 *   node scripts/test-i18n.mjs
 *
 * store.ts ist reiner Browser-Code ohne Electron-Importe, laesst sich
 * also unter Node buendeln und ausfuehren. t() und setState() werden
 * ueber einen gemeinsamen Bundle-Einstiegspunkt geholt, damit beide
 * dieselbe Kopie des internen Zustands teilen und ein setState()
 * tatsaechlich das beeinflusst, was t() als naechstes liest.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-i18n-'))

const problems = []
const notes = []

function check(ok, message) {
  if (!ok) problems.push(message)
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const entry = join(work, 'entry.mjs')
  writeFileSync(
    entry,
    [
      `export { t, SUPPORTED_LANGUAGES } from ${JSON.stringify(join(root, 'src/renderer/src/lib/i18n.ts'))}`,
      `export { setState } from ${JSON.stringify(join(root, 'src/renderer/src/lib/store.ts'))}`
    ].join('\n')
  )

  const out = join(work, 'bundle.mjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared') },
    logLevel: 'error'
  })

  const { t, setState, SUPPORTED_LANGUAGES } = await import(pathToFileURL(out).href)

  check(Array.isArray(SUPPORTED_LANGUAGES) && SUPPORTED_LANGUAGES.length >= 2,
    'SUPPORTED_LANGUAGES hat weniger als zwei Eintraege')
  check(SUPPORTED_LANGUAGES.some((l) => l.code === 'de'), 'Deutsch fehlt in SUPPORTED_LANGUAGES')
  check(SUPPORTED_LANGUAGES.some((l) => l.code === 'en'), 'Englisch fehlt in SUPPORTED_LANGUAGES')
  notes.push(`Sprachen: ${SUPPORTED_LANGUAGES.map((l) => `${l.code} (${l.label})`).join(', ')}`)

  // Ein Beispiel aus jedem der zwoelf Namensraeume, quer durch alle
  // zehn Bereiche plus common und nav.
  const samples = [
    ['common', 'cancel'],
    ['nav', 'instances'],
    ['shell', 'hero.playStart'],
    ['instances', 'deleteConfirm.title'],
    ['instanceDetail', 'overview.crashBadge'],
    ['instanceSettings', 'backups.reasonManual'],
    ['wizard', 'createInstance.header.title'],
    ['content', 'checking'],
    ['mods', 'page.title'],
    ['settings', 'language.title'],
    ['overlays', 'update.title'],
    ['lib', 'greeting.morning']
  ]

  setState({ settings: { language: 'de' } })
  const de = {}
  for (const [ns, key] of samples) {
    if (!key) continue
    de[`${ns}.${key}`] = t(ns, key)
  }

  setState({ settings: { language: 'en' } })
  const en = {}
  for (const [ns, key] of samples) {
    if (!key) continue
    en[`${ns}.${key}`] = t(ns, key)
  }

  let anyBroken = false
  for (const [ns, key] of samples) {
    if (!key) continue
    const k = `${ns}.${key}`
    if (de[k] === k) { problems.push(`Deutsch: "${k}" bleibt unaufgeloest`); anyBroken = true }
    if (en[k] === k) { problems.push(`Englisch: "${k}" bleibt unaufgeloest`); anyBroken = true }
  }

  if (!anyBroken) {
    let anyDifferent = false
    for (const [ns, key] of samples) {
      if (!key) continue
      const k = `${ns}.${key}`
      if (de[k] !== en[k]) anyDifferent = true
      notes.push(`${k}: DE "${de[k]}" / EN "${en[k]}"`)
    }
    check(anyDifferent, 'Kein einziger Beispielschluessel unterscheidet sich zwischen Deutsch und Englisch')
  }

  // Interpolation.
  setState({ settings: { language: 'de' } })
  const interpolated = t('nav', 'home', {})
  check(typeof interpolated === 'string' && interpolated.length > 0, 'Aufruf mit leerem vars-Objekt scheitert')

  const withVar = t('shell', 'hero.welcomeBack', { name: 'Gabi' })
  check(withVar.includes('Gabi'), `Platzhalter {name} wurde nicht ersetzt: "${withVar}"`)
  check(!withVar.includes('{name}'), `Platzhalter {name} blieb woertlich stehen: "${withVar}"`)
  notes.push(`Platzhalter: "${withVar}"`)

  // Ein fehlender Schluessel faellt sichtbar auf, statt still zu brechen.
  const fallback = t('common', 'dieser-schluessel-existiert-nicht-xyz')
  check(fallback === 'common.dieser-schluessel-existiert-nicht-xyz',
    `Ein fehlender Schluessel liefert unerwartet "${fallback}"`)
  notes.push(`Fehlender Schluessel faellt sichtbar auf: "${fallback}"`)

  // Zurueck auf Deutsch, dieselbe Instanz, um zu zeigen, dass ein
  // Sprachwechsel jederzeit wieder rueckgaengig geht.
  setState({ settings: { language: 'de' } })
  const backToGerman = t('common', 'cancel')
  check(backToGerman === de['common.cancel'], 'Zurueckschalten auf Deutsch liefert nicht denselben Text wie vorher')
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
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
