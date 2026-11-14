/**
 * Prueft, wie der Launcher die Loader-Angaben einer fabric.mod.json liest.
 *
 *   node scripts/test-fabric-version.mjs
 *
 * Modrinth und CurseForge sagen nicht, welchen Fabric Loader ein Mod
 * braucht, nur die Datei selbst (">=0.19.5"). Danach entscheidet der
 * Launcher, ob ein Update oder eine Installation zur Instanz passt.
 */
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-fabric-version-'))
const problems = []

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [join(root, 'src/main/core/fabricVersion.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared') },
    logLevel: 'error'
  })
  const { satisfiesFabricDependency, describeFabricDependency } = require(out)

  // [Loader-Version, Angabe, erwartet]
  const cases = [
    ['0.19.3', '>=0.19.5', false],
    ['0.19.5', '>=0.19.5', true],
    ['0.20.1', '>=0.19.5', true],
    ['0.19.5', '*', true],
    ['0.19.5', '>0.19.5', false],
    ['0.19.5', '<0.20', true],
    ['0.19.5', '>=0.15.0 <0.19.0', false],
    ['0.16.9', '>=0.15.0 <0.19.0', true],
    ['0.19.5', '~0.19.2', true],
    ['0.20.0', '~0.19.2', false],
    ['0.20.0', '^0.19.2', true],
    ['1.0.0', '^0.19.2', false],
    ['0.19.5', '0.19.x', true],
    ['0.18.1', '0.19.x', false],
    ['0.19.5', '0.19.5', true],
    ['0.19.5', ['>=0.20.0', '0.19.5'], true],
    ['0.19.3', ['>=0.20.0', '>=0.19.5'], false],
    ['0.19.5', '>=0.19.5-beta.1', true],
    ['0.19.5-beta.1', '>=0.19.5', false],
    // Unreadable forms count as unknown, never as unmet.
    ['0.19.5', 'irgendwas', null],
    ['0.19.5', ['>=0.20.0', 'irgendwas'], null]
  ]
  for (const [version, predicate, expected] of cases) {
    const got = satisfiesFabricDependency(version, predicate)
    if (got !== expected) problems.push(`${version} gegen ${JSON.stringify(predicate)}: ${got}, erwartet ${expected}`)
  }
  const words = describeFabricDependency('>=0.19.5')
  if (!/0\.19\.5 (oder neuer|or later)/.test(words)) problems.push(`Beschreibung: ${words}`)
  console.log(`${cases.length} Angaben geprueft, ">=0.19.5" heisst "${words}"`)
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (problems.length) {
  console.log('\nPROBLEME:')
  for (const p of problems) console.log(`  - ${p}`)
  console.log('\nERGEBNIS: FEHLGESCHLAGEN')
  process.exit(1)
}
console.log('\nERGEBNIS: BESTANDEN')
