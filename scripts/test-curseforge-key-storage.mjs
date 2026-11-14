/**
 * Prueft, dass der eigene CurseForge-Schluessel verschluesselt gespeichert wird.
 *
 *   node scripts/test-curseforge-key-storage.mjs
 *
 * Der Schluessel stand bisher als Klartext in launcher.json, anders als die
 * Anmeldedaten, die die Verschluesselung des Systems schuetzt. Jeder Abschnitt
 * stellt einen Start des Launchers nach (frisch gebautes Modul). Die
 * Verschluesselung des Systems wird nachgebaut und laesst sich abschalten,
 * wie auf manchen Linux-Desktops.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-cfkey-'))
const problems = []
const notes = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
}

const KEY = '$2a$10$geheimerSchluesselFuerTests1234567890'
globalThis.__lgCrypt = true

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  let n = 0

  /** One start of the launcher: a fresh build of store.ts on `userData`. */
  function start(userData) {
    const tag = `${++n}`
    const shim = join(work, `shim-${tag}.js`)
    writeFileSync(
      shim,
      `const path = ${JSON.stringify(userData)}
       module.exports = {
         app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
         safeStorage: {
           isEncryptionAvailable: () => globalThis.__lgCrypt === true,
           encryptString: (s) => Buffer.from('ENC:' + [...s].reverse().join('')),
           decryptString: (b) => {
             const t = b.toString()
             if (!t.startsWith('ENC:')) throw new Error('nicht entschluesselbar')
             return [...t.slice(4)].reverse().join('')
           }
         },
         shell: {}, dialog: {}, BrowserWindow: class {},
         ipcMain: { handle() {}, on() {} },
         desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
       }`
    )
    const entry = join(work, `entry-${tag}.js`)
    writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/store.ts'))})`)
    const out = join(work, `bundle-${tag}.cjs`)
    esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: out,
      alias: { '@shared': join(root, 'src/shared'), electron: shim },
      logLevel: 'error'
    })
    return require(out)
  }
  const fresh = () => mkdtempSync(join(work, 'user-'))
  const disk = (userData) => readFileSync(join(userData, 'launcher.json'), 'utf8')
  const previous = (userData) => {
    const file = join(userData, 'launcher.json.previous')
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }

  // --- 1. A key typed in is stored encrypted, and read back after a restart ---
  {
    const ud = fresh()
    let store = start(ud)
    store.getSettings()
    store.saveSettings({ onboarded: true })
    store.saveSettings({ curseForgeApiKey: KEY })
    check(!disk(ud).includes(KEY), 'Eingetragener Schluessel steht im Klartext in launcher.json')
    check(!previous(ud).includes(KEY), 'Eingetragener Schluessel steht im Klartext in launcher.json.previous')
    check(store.getSettings().curseForgeApiKey === KEY, 'Im laufenden Launcher fehlt der Schluessel')
    store = start(ud)
    check(store.getSettings().curseForgeApiKey === KEY, `Nach Neustart: "${store.getSettings().curseForgeApiKey}"`)
    check(!('curseForgeApiKeySecure' in store.getSettings()), 'Das verschluesselte Feld geht mit an die Oberflaeche')
    store.saveSettings({ theme: 'nebula' })
    check(!disk(ud).includes(KEY) && start(ud).getSettings().curseForgeApiKey === KEY, 'Eine andere Einstellung hat den Schluessel verloren oder offengelegt')
    notes.push('Eingetragen: verschluesselt auf der Platte, lesbar im Launcher, auch nach Neustart')
  }

  // --- 2. A key stored readable by an older version is moved over at start ---
  {
    const ud = fresh()
    writeFileSync(join(ud, 'launcher.json'), JSON.stringify({ onboarded: true, theme: 'aurora', curseForgeApiKey: KEY }))
    writeFileSync(join(ud, 'launcher.json.previous'), JSON.stringify({ onboarded: true, curseForgeApiKey: KEY }))
    const store = start(ud)
    check(store.getSettings().curseForgeApiKey === KEY, 'Alter Klartext-Schluessel ist im Launcher verloren')
    check(!disk(ud).includes(KEY), 'Alter Klartext-Schluessel wurde beim Start nicht verschluesselt')
    check(!previous(ud).includes(KEY), 'Die Kopie launcher.json.previous behaelt den Klartext')
    check(JSON.parse(disk(ud)).theme === 'aurora', 'Die Umstellung hat andere Einstellungen veraendert')
    check(start(ud).getSettings().curseForgeApiKey === KEY, 'Nach der Umstellung und einem Neustart fehlt der Schluessel')
    notes.push('Klartext aus 1.0.25: beim ersten Start verschluesselt, auch in der Kopie')
  }

  // --- 3. Clearing the key removes it for good -----------------------------
  {
    const ud = fresh()
    const store = start(ud)
    store.saveSettings({ curseForgeApiKey: KEY })
    store.saveSettings({ curseForgeApiKey: '' })
    check(!disk(ud).includes('curseForgeApiKeySecure') && start(ud).getSettings().curseForgeApiKey === '', 'Ein geloeschter Schluessel kam zurueck')
  }

  // --- 4. Reset keeps the key, still encrypted ------------------------------
  {
    const ud = fresh()
    const store = start(ud)
    store.saveSettings({ curseForgeApiKey: KEY, theme: 'violet' })
    store.resetSettings()
    check(!disk(ud).includes(KEY) && start(ud).getSettings().curseForgeApiKey === KEY, 'Zuruecksetzen hat den Schluessel verloren oder offengelegt')
  }

  // --- 5. Without system encryption it stays readable, as before ------------
  {
    const ud = fresh()
    globalThis.__lgCrypt = false
    const store = start(ud)
    store.saveSettings({ curseForgeApiKey: KEY })
    check(disk(ud).includes(KEY) && start(ud).getSettings().curseForgeApiKey === KEY, 'Ohne Verschluesselung ging der Schluessel verloren')
    globalThis.__lgCrypt = true
    notes.push('Ohne Verschluesselung des Systems: bleibt lesbar gespeichert wie bisher')
  }

  // --- 6. Encryption ready only later (Linux before the app is ready) -------
  {
    const ud = fresh()
    start(ud).saveSettings({ curseForgeApiKey: KEY })
    globalThis.__lgCrypt = false
    const store = start(ud)
    store.getSettings()
    // A save before the key could be read must not drop it.
    store.saveSettings({ theme: 'cobalt' })
    globalThis.__lgCrypt = true
    check(store.getSettings().curseForgeApiKey === KEY, 'Spaet verfuegbare Verschluesselung: Schluessel nicht nachgeladen')
    check(start(ud).getSettings().curseForgeApiKey === KEY, 'Eine Speicherung vor dem Entschluesseln hat den Schluessel verloren')
  }

  // --- 7. A key that cannot be decrypted (other user or machine) -----------
  {
    const ud = fresh()
    writeFileSync(join(ud, 'launcher.json'), JSON.stringify({ onboarded: true, curseForgeApiKey: '', curseForgeApiKeySecure: Buffer.from('fremd').toString('base64') }))
    const store = start(ud)
    check(store.getSettings().curseForgeApiKey === '' && store.getSettings().onboarded === true, 'Ein nicht entschluesselbarer Schluessel brachte die Einstellungen durcheinander')
  }
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // a locked temp folder is no test failure
  }
}

for (const note of notes) console.log(`  - ${note}`)
if (problems.length) {
  console.log('\nPROBLEME:')
  for (const p of problems) console.log(`  - ${p}`)
  console.log('\nERGEBNIS: FEHLGESCHLAGEN')
  process.exit(1)
}
console.log('\nERGEBNIS: BESTANDEN')
