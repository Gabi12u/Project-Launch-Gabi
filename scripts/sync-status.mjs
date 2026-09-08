/**
 * Copies the newest changelog entry into the status page.
 *
 * The page shows the latest fixes, and the launcher's own list is the single
 * source for those. Typing them twice guarantees they drift apart, and the
 * version on the public page is the one that would be wrong. This reads the
 * real `changelog.ts` and rewrites the block between the AUTO markers.
 *
 * The English wording comes along the same way, through `changelogEn.ts` and
 * `knownIssuesEn.ts`. Those already know how to fall back to German for
 * anything not yet translated, so bundling them is enough to get a complete
 * English list rather than a partial one.
 *
 * Run before tagging a release:
 *   node scripts/sync-status.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const page = join(root, 'status', 'index.html')

// Compiled rather than parsed. `changelog.ts` is TypeScript, and picking the
// first entry out of it with a regular expression would break the first time
// someone reformats the file.
const temp = mkdtempSync(join(tmpdir(), 'sync-status-'))

/** Bundles one shared TypeScript module through esbuild and imports it. */
async function bundleModule(sourceFile, outName) {
  const outfile = join(temp, outName)
  // Through Node, not through the `.bin` shim. On Windows that shim is a
  // `.cmd`, which newer Node refuses to spawn directly, and this way the same
  // line works on all three systems.
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      join(root, 'src', 'shared', sourceFile),
      '--bundle',
      '--format=esm',
      `--outfile=${outfile}`
    ],
    { stdio: 'pipe' }
  )
  return import(pathToFileURL(outfile).href)
}

// The fixed set of kinds and states. Both are closed unions in the shared
// types, so listing them here is as stable as importing the type would be.
const CHANGE_KINDS = ['new', 'improved', 'fixed']
const ISSUE_STATES = ['investigating', 'fixing', 'fixed', 'limitation']

try {
  const { CHANGELOG } = await bundleModule('changelog.ts', 'changelog.mjs')
  const latest = CHANGELOG[0]
  if (!latest) throw new Error('CHANGELOG ist leer.')

  // The known-issues list travels the same way, so the page can never claim a
  // problem is solved while the list in the repository still says otherwise.
  const { KNOWN_ISSUES, ISSUE_STATE_LABEL } = await bundleModule('knownIssues.ts', 'issues.mjs')

  // English text never gets typed a second time here: `changelogLocalized`,
  // `changeKindLabel`, `knownIssuesLocalized` and `issueStateLabel` are the
  // only source for it.
  const { changelogLocalized, changeKindLabel } = await bundleModule(
    'changelogEn.ts',
    'changelog-en.mjs'
  )
  const { knownIssuesLocalized, issueStateLabel } = await bundleModule(
    'knownIssuesEn.ts',
    'issues-en.mjs'
  )

  const latestEn = changelogLocalized('en')[0]
  const issuesEn = knownIssuesLocalized('en')

  const kindLabelEn = Object.fromEntries(
    CHANGE_KINDS.map((kind) => [kind, changeKindLabel('en', kind)])
  )
  const issueLabelEn = Object.fromEntries(
    ISSUE_STATES.map((state) => [state, issueStateLabel('en', state)])
  )

  const block =
    `  // AUTO-START: erzeugt von scripts/sync-status.mjs, nicht von Hand aendern.\n` +
    `  var LATEST = ${JSON.stringify(latest, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  var LATEST_EN = ${JSON.stringify(latestEn, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  var KIND_LABEL_EN = ${JSON.stringify(kindLabelEn, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  // AUTO-ENDE\n`

  const issueBlock =
    `  // AUTO-ISSUES-START: erzeugt von scripts/sync-status.mjs, nicht von Hand aendern.\n` +
    `  var ISSUES = ${JSON.stringify(KNOWN_ISSUES, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  var ISSUE_LABEL = ${JSON.stringify(ISSUE_STATE_LABEL, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  var ISSUES_EN = ${JSON.stringify(issuesEn, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  var ISSUE_LABEL_EN = ${JSON.stringify(issueLabelEn, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  // AUTO-ISSUES-ENDE\n`

  /** Swaps one marked block, leaving everything around it untouched. */
  function replaceBlock(source, startMark, endMark, replacement) {
    const from = source.indexOf(startMark)
    const to = source.indexOf(endMark)
    if (from === -1 || to === -1) {
      throw new Error(`Die Markierung ${startMark.trim()} fehlt in status/index.html.`)
    }
    return source.slice(0, from) + replacement + source.slice(source.indexOf('\n', to) + 1)
  }

  let html = readFileSync(page, 'utf8')
  html = replaceBlock(html, '  // AUTO-START', '  // AUTO-ENDE', block)
  html = replaceBlock(html, '  // AUTO-ISSUES-START', '  // AUTO-ISSUES-ENDE', issueBlock)
  writeFileSync(page, html, 'utf8')

  const open = KNOWN_ISSUES.filter((issue) => issue.state !== 'fixed').length
  console.log(
    `status/index.html auf Version ${latest.version} gebracht: ` +
      `${latest.changes.length} Aenderungen, ${KNOWN_ISSUES.length} bekannte Probleme, ${open} davon offen.`
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
