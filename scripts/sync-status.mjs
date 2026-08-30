/**
 * Copies the newest changelog entry into the status page.
 *
 * The page shows the latest fixes, and the launcher's own list is the single
 * source for those. Typing them twice guarantees they drift apart, and the
 * version on the public page is the one that would be wrong. This reads the
 * real `changelog.ts` and rewrites the block between the AUTO markers.
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
const bundle = join(temp, 'changelog.mjs')

try {
  // Through Node, not through the `.bin` shim. On Windows that shim is a
  // `.cmd`, which newer Node refuses to spawn directly, and this way the same
  // line works on all three systems.
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      join(root, 'src', 'shared', 'changelog.ts'),
      '--bundle',
      '--format=esm',
      `--outfile=${bundle}`
    ],
    { stdio: 'pipe' }
  )

  const { CHANGELOG } = await import(pathToFileURL(bundle).href)
  const latest = CHANGELOG[0]
  if (!latest) throw new Error('CHANGELOG ist leer.')

  const block =
    `  // AUTO-START: erzeugt von scripts/sync-status.mjs, nicht von Hand aendern.\n` +
    `  var LATEST = ${JSON.stringify(latest, null, 2).replace(/\n/g, '\n  ')};\n` +
    `  // AUTO-ENDE\n`

  const html = readFileSync(page, 'utf8')
  const from = html.indexOf('  // AUTO-START')
  const to = html.indexOf('  // AUTO-ENDE')
  if (from === -1 || to === -1) {
    throw new Error('Die AUTO-Markierungen fehlen in status/index.html.')
  }

  const after = html.indexOf('\n', to) + 1
  writeFileSync(page, html.slice(0, from) + block + html.slice(after), 'utf8')

  console.log(
    `status/index.html auf Version ${latest.version} gebracht ` +
      `(${latest.changes.length} Eintraege).`
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
