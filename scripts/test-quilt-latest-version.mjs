/**
 * Prueft gegen die echte Quilt- und Fabric-API, dass "neueste Version"
 * wirklich die neueste ist, nicht ein zufaelliger, unsortierter erster
 * Eintrag.
 *
 *   node scripts/test-quilt-latest-version.mjs
 *
 * Quilts eigene API liefert kein "stable"-Feld (anders als der Code bisher
 * annahm) und die Reihenfolge der Eintraege ist nicht sortiert: eine echte
 * Abfrage fuer 1.20.1 lieferte "0.20.0-beta.9" als ersten Eintrag, obwohl
 * deutlich neuere, echte Releases existieren. Dieser Test braucht eine
 * Internetverbindung und prueft gegen den echten Dienst, nicht gegen eine
 * Kopie der Antwort.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-quilt-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })

  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `const path = ${JSON.stringify(userData)}
     module.exports = {
       app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: class {},
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/loaders/fabric.ts'))})`)

  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    logLevel: 'error'
  })

  const { listFabricLikeVersions, resolveLatestFabricLike } = require(out)

  /* ------------------------------------------------------------------ *
   * Quilt: the actually broken case.
   * ------------------------------------------------------------------ */
  const quiltVersions = await listFabricLikeVersions('quilt', '1.20.1')
  check(quiltVersions.length > 10, `Quilt: nur ${quiltVersions.length} Versionen zurueck, API-Antwort unerwartet klein`)

  const quiltLatest = await resolveLatestFabricLike('quilt', '1.20.1')
  check(!/beta|alpha|rc|pre/i.test(quiltLatest), `Quilt "neueste stabile Version" ist "${quiltLatest}", sieht nach Vorabversion aus`)

  // The list itself must come back sorted newest-first, since the version
  // picker in the wizard reads straight off this array.
  const numbers = (v) => v.split(/[-+]/)[0].split('.').map((n) => Number(n) || 0)
  const cmp = (a, b) => {
    const pa = numbers(a)
    const pb = numbers(b)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] ?? 0) - (pa[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  let sorted = true
  for (let i = 1; i < quiltVersions.length; i++) {
    if (cmp(quiltVersions[i - 1].version, quiltVersions[i].version) > 0) {
      sorted = false
      break
    }
  }
  check(sorted, 'Quilt-Versionsliste ist nicht absteigend sortiert')
  notes.push(`Quilt 1.20.1: ${quiltVersions.length} Versionen, "neueste stabile" ist ${quiltLatest}, erster Eintrag der Liste ist ${quiltVersions[0]?.version}`)

  /* ------------------------------------------------------------------ *
   * Fabric: must keep picking the API's own curated "stable" entry, not
   * regress to a pure version-number guess.
   * ------------------------------------------------------------------ */
  const fabricVersions = await listFabricLikeVersions('fabric', '1.20.1')
  const apiStable = fabricVersions.find((v) => v.stable)
  const fabricLatest = await resolveLatestFabricLike('fabric', '1.20.1')
  check(Boolean(apiStable), 'Fabric-API liefert keine als stabil markierte Version, kann nicht vergleichen')
  check(
    fabricLatest === apiStable?.version,
    `Fabric "neueste stabile Version" ist "${fabricLatest}", API markiert aber "${apiStable?.version}" als stabil`
  )
  notes.push(`Fabric 1.20.1: "neueste stabile" ist ${fabricLatest}, stimmt mit dem von Fabric selbst markierten Eintrag ueberein.`)
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
