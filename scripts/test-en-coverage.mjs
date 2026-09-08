/**
 * Prueft, ob wirklich jeder Changelog-Eintrag und jedes bekannte Problem
 * eine englische Entsprechung hat, statt still auf Deutsch zurueckzufallen.
 *
 *   node scripts/test-en-coverage.mjs
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'lg-en-coverage-'))
const problems = []

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const entry = join(work, 'entry.mjs')
  writeFileSync(
    entry,
    [
      `export { CHANGELOG } from ${JSON.stringify(join(root, 'src/shared/changelog.ts'))}`,
      `export { changelogLocalized } from ${JSON.stringify(join(root, 'src/shared/changelogEn.ts'))}`,
      `export { KNOWN_ISSUES } from ${JSON.stringify(join(root, 'src/shared/knownIssues.ts'))}`,
      `export { knownIssuesLocalized } from ${JSON.stringify(join(root, 'src/shared/knownIssuesEn.ts'))}`
    ].join('\n')
  )
  const out = join(work, 'bundle.mjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'error'
  })
  const { CHANGELOG, changelogLocalized, KNOWN_ISSUES, knownIssuesLocalized } = await import(
    pathToFileURL(out).href
  )

  const de = changelogLocalized('de')
  const en = changelogLocalized('en')
  CHANGELOG.forEach((release, i) => {
    if (en[i].headline === de[i].headline) {
      problems.push(`Changelog ${release.version}: Ueberschrift bleibt Deutsch`)
    }
    release.changes.forEach((change, j) => {
      if (en[i].changes[j].text === change.text) {
        problems.push(`Changelog ${release.version}, Eintrag ${j + 1}: bleibt Deutsch`)
      }
    })
  })

  const issuesDe = knownIssuesLocalized('de')
  const issuesEn = knownIssuesLocalized('en')
  KNOWN_ISSUES.forEach((issue, i) => {
    if (issuesEn[i].title === issuesDe[i].title) problems.push(`Problem ${issue.id}: Titel bleibt Deutsch`)
    if (issuesEn[i].detail === issuesDe[i].detail) problems.push(`Problem ${issue.id}: Text bleibt Deutsch`)
  })

  console.log(`Changelog: ${CHANGELOG.length} Versionen geprueft.`)
  console.log(`Bekannte Probleme: ${KNOWN_ISSUES.length} Eintraege geprueft.`)
} catch (err) {
  problems.push('Testlauf abgebrochen: ' + (err.stack || err.message))
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log('\n=== Probleme ===')
if (!problems.length) console.log('  keine, jeder Eintrag hat eine englische Fassung')
else problems.forEach((p) => console.log('  X ' + p))
console.log(`\nERGEBNIS: ${problems.length ? `FEHLGESCHLAGEN (${problems.length})` : 'BESTANDEN'}`)
process.exit(problems.length ? 1 : 0)
