/**
 * Prueft die Umwandlung von Minecrafts XML-Konsolenausgabe in lesbare Zeilen
 * (src/main/core/log4jParse.ts) gegen echte Ereignisse, wie sie Mojangs
 * Log-Konfiguration mit LegacyXMLLayout schreibt.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-log4j-'))
const problems = []
const notes = []
const check = (ok, message) => { if (!ok) problems.push(message) }

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/log4jParse.ts'))})`)
  const out = join(work, 'bundle.cjs')
  esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', outfile: out, alias: { '@shared': join(root, 'src/shared') }, logLevel: 'error' })
  const { createLog4jParser } = require(out)

  function run(rawLines) {
    const got = []
    const parser = createLog4jParser((line) => got.push(line), (line) => (/WARN/.test(line) ? 'warn' : 'info'))
    for (const raw of rawLines) parser.push(raw)
    parser.end()
    return got
  }

  /* 1. Ein Ereignis wie im gemeldeten Log */
  {
    const got = run([
      '  <log4j:Event logger="net.minecraft.class_7764" timestamp="1790783601501" level="WARN" thread="Worker-Main-4">',
      '    <log4j:Message><![CDATA[Invalid frame index on sprite minecraft:item/axolotl_bucket_gold_3d frame 50: 16]]></log4j:Message>',
      '  </log4j:Event>'
    ])
    check(got.length === 1, `Ein Ereignis ergab ${got.length} Zeilen statt 1`)
    check(got[0]?.text === '[Worker-Main-4/WARN] Invalid frame index on sprite minecraft:item/axolotl_bucket_gold_3d frame 50: 16', `Text falsch: ${got[0]?.text}`)
    check(got[0]?.level === 'warn', `Stufe falsch: ${got[0]?.level}`)
    check(got[0]?.time === 1790783601501, `Zeit falsch: ${got[0]?.time}`)
    notes.push(`Ereignis: ${got[0]?.text}`)
  }

  /* 2. Mehrzeilige Meldung, geteiltes CDATA und Stacktrace */
  {
    const got = run([
      '<log4j:Event logger="x" timestamp="1" level="ERROR" thread="Render thread">',
      '  <log4j:Message><![CDATA[Erste Zeile',
      'zweite Zeile mit ]]]]><![CDATA[> darin]]></log4j:Message>',
      '  <log4j:Throwable><![CDATA[java.lang.RuntimeException: kaputt',
      '\tat a.b.C.d(C.java:1)]]></log4j:Throwable>',
      '</log4j:Event>'
    ])
    check(got.length === 4, `Mehrzeiliges Ereignis ergab ${got.length} Zeilen statt 4`)
    check(got[0]?.text === '[Render thread/ERROR] Erste Zeile', `Erste Zeile falsch: ${got[0]?.text}`)
    check(got[1]?.text === 'zweite Zeile mit ]]> darin', `Geteiltes CDATA falsch: ${got[1]?.text}`)
    check(got[2]?.text === 'java.lang.RuntimeException: kaputt' && got[3]?.text.includes('C.java:1'), 'Stacktrace fehlt')
    check(got.every((l) => l.level === 'error'), 'Stufe bei ERROR falsch')
  }

  /* 3. Normale Zeilen laufen unverändert durch, leere fallen weg */
  {
    const got = run(['Exception in thread "main" java.lang.Error', '', 'WARN plain'])
    check(got.length === 2 && got[0].text.startsWith('Exception'), 'Normale Zeilen falsch behandelt')
    check(got[1]?.level === 'warn', 'Normale Zeile falsch eingestuft')
  }

  /* 4. Nie geschlossenes Ereignis wird am Ende roh ausgegeben */
  {
    const got = run(['<log4j:Event level="INFO" thread="t">', '  <log4j:Message><![CDATA[halb'])
    check(got.length === 2, `Offenes Ereignis ergab ${got.length} Zeilen statt 2`)
  }

  /* 5. Flut: 20 000 Ereignisse */
  {
    const raw = []
    for (let i = 0; i < 20000; i++) {
      raw.push(`  <log4j:Event logger="net.minecraft.class_7764" timestamp="${1790783601501 + i}" level="WARN" thread="Worker-Main-4">`)
      raw.push(`    <log4j:Message><![CDATA[Invalid frame index on sprite frame ${i}]]></log4j:Message>`)
      raw.push('  </log4j:Event>')
    }
    const started = performance.now()
    const got = run(raw)
    const ms = Math.round(performance.now() - started)
    check(got.length === 20000, `Flut ergab ${got.length} Zeilen statt 20000`)
    check(ms < 2000, `Flut dauerte ${ms} ms`)
    notes.push(`20 000 Ereignisse (60 000 Rohzeilen) in ${ms} ms zu 20 000 Zeilen umgewandelt`)
  }
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
} finally {
  try { rmSync(work, { recursive: true, force: true }) } catch { /* egal */ }
}

console.log('\n=== Beobachtungen ===')
notes.forEach((n) => console.log('  - ' + n))
console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
