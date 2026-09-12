/**
 * Prueft gegen den echten Forge-Maven, dass die Installer-URL fuer Versionen
 * mit Branch-Suffix (1.7.10, 1.8.9, 1.9.4, ...) wirklich erreichbar ist,
 * nicht nur zusammengesetzt aussieht.
 *
 *   node scripts/test-forge-installer-url.mjs
 *
 * Live nachgemessen: "1.7.10-10.13.4.1614" (ohne Suffix) antwortet mit 404,
 * "1.7.10-10.13.4.1614-1.7.10" (der wirkliche Maven-Pfad) mit 200. Das
 * betrifft den von Forge selbst als "empfohlen" markierten Build fuer
 * mehrere alte, haeufig modifizierte Minecraft-Versionen. Laedt das echte
 * forge.ts, nicht eine Kopie der Logik. Braucht eine Internetverbindung.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-forge-url-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

async function statusOf(url) {
  const res = await fetch(url, { method: 'HEAD' })
  return res.status
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
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/loaders/forge.ts'))})`)

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

  const { resolveForgeMavenVersion, listForgeLikeVersions } = require(out)

  const cases = [
    { mc: '1.7.10', build: '10.13.4.1614', label: 'Forge 1.7.10 empfohlener Build' },
    { mc: '1.8.9', build: '11.15.1.2318', label: 'Forge 1.8.9 empfohlener Build' },
    { mc: '1.9.4', build: '12.17.0.2317', label: 'Forge 1.9.4 empfohlener Build' }
  ]

  for (const c of cases) {
    const full = await resolveForgeMavenVersion(c.mc, c.build)
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
    const status = await statusOf(url)
    check(status === 200, `${c.label}: "${url}" antwortet mit ${status}, erwartet 200`)
    notes.push(`${c.label}: aufgeloest zu "${full}", HTTP ${status}`)

    if (full !== `${c.mc}-${c.build}`) {
      const naiveUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${c.mc}-${c.build}/forge-${c.mc}-${c.build}-installer.jar`
      const naiveStatus = await statusOf(naiveUrl)
      notes.push(`  (zum Vergleich, die alte Zusammensetzung ohne Suffix: HTTP ${naiveStatus})`)
      check(naiveStatus !== 200, 'Die alte, kaputte Zusammensetzung antwortet jetzt auch mit 200, Testfall ueberholt')
    }
  }

  // The recommended build's bare version, as listForgeLikeVersions actually
  // exposes it to the rest of the app, must still match what
  // promotions_slim.json reports, unaffected by this fix.
  const versions = await listForgeLikeVersions('forge', '1.7.10')
  const recommended = versions.find((v) => v.recommended)
  check(Boolean(recommended), 'Forge 1.7.10: kein Eintrag als "recommended" markiert')
  check(
    recommended?.version === '10.13.4.1614',
    `Forge 1.7.10: empfohlene Version ist "${recommended?.version}", erwartet "10.13.4.1614"`
  )
  notes.push(`listForgeLikeVersions meldet die empfohlene Version weiterhin als "${recommended?.version}" (bare Form, unveraendert).`)
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
