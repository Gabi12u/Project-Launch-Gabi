/**
 * Prueft den Menueeintrag, den der Launcher unter Linux selbst anlegt:
 *
 *   node scripts/test-linux-desktop.mjs
 *
 * 1. `execArgument` setzt jeden Pfad so in `Exec=`, dass er nach den Regeln
 *    der Desktop-Entry-Spezifikation genau als derselbe Pfad zurueckkommt,
 *    auch mit Leerzeichen, Anfuehrungszeichen, $, Backslash und %.
 * 2. `foreignEntryFor` erkennt einen Eintrag, den ein anderes Werkzeug fuer
 *    dieselbe AppImage-Datei angelegt hat, aber weder den eigenen noch eine
 *    hineinkopierte Instanz-Verknuepfung.
 * 3. `integrateLinuxDesktop` legt Eintrag und Symbol an, laesst beide beim
 *    naechsten Start unveraendert, schreibt den Pfad nach einem Umbenennen
 *    der Datei neu und legt keinen zweiten Eintrag neben einen fremden.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-linux-desktop-'))

const problems = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

/** Reads one quoted Exec argument back the way a desktop environment does. */
function parseExecArgument(raw) {
  // String rule first: \\ \s \n \t \r.
  let text = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const next = raw[++i]
      text += { s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' }[next] ?? `\\${next}`
    } else {
      text += raw[i]
    }
  }
  // Then the field codes, %% being a literal percent sign.
  text = text.replace(/%%/g, '%')
  if (!text.startsWith('"') || !text.endsWith('"')) return null
  // Then the quoting rule inside the double quotes.
  const inner = text.slice(1, -1)
  let value = ''
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length && '"`$\\'.includes(inner[i + 1])) value += inner[++i]
    else value += inner[i]
  }
  return value
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
       app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: true,
              getName: () => 'launch-gabi', getAppPath: () => ${JSON.stringify(root)} },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] },
       ipcMain: { handle() {}, on() {} }, Notification: class {}, net: {}
     }`
  )
  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [join(root, 'src/main/core/linuxDesktop.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    logLevel: 'error'
  })
  const desktop = require(out)

  // --- 1. Exec quoting survives the round trip ---------------------------
  const tricky = [
    '/home/gabi/Launch Gabi/launch-gabi-linux-x86_64.AppImage',
    '/home/gabi/"quoted"/a.AppImage',
    '/home/gabi/$HOME/`id`/a.AppImage',
    '/home/gabi/back\\slash/a.AppImage',
    '/home/gabi/100%U/a.AppImage'
  ]
  for (const path of tricky) {
    const raw = desktop.execArgument(path)
    check(parseExecArgument(raw) === path, `Exec-Argument fuer ${path} kommt als ${parseExecArgument(raw)} zurueck`)
    check(!/%[a-zA-Z]/.test(raw.replace(/%%/g, '')), `Exec-Argument fuer ${path} enthaelt einen Feldcode: ${raw}`)
  }

  const entry = desktop.desktopEntry({ appImage: tricky[0], icon: '/tmp/icon.png', comment: 'Kommentar' })
  const lines = entry.split('\n')
  check(lines[0] === '[Desktop Entry]', 'Eintrag beginnt nicht mit [Desktop Entry]')
  check(lines.some((l) => l === `Exec=${desktop.execArgument(tricky[0])} %U`), 'Exec-Zeile fehlt oder ist falsch')
  check(lines.some((l) => l === `TryExec=${tricky[0]}`), 'TryExec-Zeile fehlt')
  check(lines.includes('StartupWMClass=Launch Gabi'), 'StartupWMClass fehlt')
  check(lines.includes('MimeType=x-scheme-handler/launchgabi;'), 'launchgabi:// ist nicht eingetragen')
  check(entry.endsWith('\n'), 'Eintrag endet nicht mit einem Zeilenumbruch')

  // package.json and the module have to agree, or Wayland never links the
  // window to the entry.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  check(pkg.desktopName === `${desktop.DESKTOP_ID}.desktop`, `desktopName in package.json ist ${pkg.desktopName}`)

  // --- 2. Foreign entries -------------------------------------------------
  const appImage = '/home/gabi/Applications/launch-gabi-linux-x86_64.AppImage'
  const apps = join(work, 'apps')
  mkdirSync(apps, { recursive: true })
  writeFileSync(join(apps, 'launch-gabi.desktop'), `[Desktop Entry]\nExec="${appImage}" %U\n`)
  writeFileSync(join(apps, 'minecraft-pack.desktop'), `[Desktop Entry]\nExec="${appImage}" --launch=pack\n`)
  writeFileSync(join(apps, 'own-copy.desktop'), `[Desktop Entry]\nExec="${appImage}" %U\nX-LaunchGabi-Managed=true\n`)
  writeFileSync(join(apps, 'other.desktop'), '[Desktop Entry]\nExec=/usr/bin/firefox %u\n')
  check(desktop.foreignEntryFor(apps, appImage) === null, 'eigener Eintrag oder Instanz-Verknuepfung als fremd erkannt')
  writeFileSync(join(apps, 'appimagekit_abc-Launch_Gabi.desktop'), `[Desktop Entry]\r\nExec=${appImage} %U\r\n`)
  check(
    desktop.foreignEntryFor(apps, appImage) === 'appimagekit_abc-Launch_Gabi.desktop',
    'Eintrag von AppImageLauncher nicht erkannt'
  )
  check(desktop.foreignEntryFor(join(work, 'missing'), appImage) === null, 'fehlender Ordner wirft oder meldet etwas')

  // --- 3. The whole integration ------------------------------------------
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'linux' })
  try {
    const dataHome = join(work, 'share')
    process.env.XDG_DATA_HOME = dataHome
    process.env.APPIMAGE = '/home/gabi/Downloads/launch-gabi-1.0.22-linux-x86_64.AppImage'

    desktop.integrateLinuxDesktop()
    const entryPath = join(dataHome, 'applications', 'launch-gabi.desktop')
    const iconPath = join(dataHome, 'icons', 'hicolor', '512x512', 'apps', 'launch-gabi.png')
    check(existsSync(entryPath), 'Menueeintrag wurde nicht angelegt')
    check(existsSync(iconPath), 'Symbol wurde nicht abgelegt')
    if (existsSync(iconPath)) {
      check(readFileSync(iconPath).equals(readFileSync(join(root, 'resources', 'icon.png'))), 'Symbol ist nicht das Launcher-Symbol')
    }
    const first = existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : ''
    check(first.includes(`Exec="${process.env.APPIMAGE}" %U`), 'Eintrag zeigt nicht auf die AppImage-Datei')
    // Escaped as a string value; only matters for the backslashes of a Windows test run.
    check(first.includes(`Icon=${iconPath.split('\\').join('\\\\')}`), 'Eintrag zeigt nicht auf das abgelegte Symbol')

    // A second start with the same file leaves both alone.
    const before = existsSync(entryPath) ? statSync(entryPath).mtimeMs : 0
    const iconBefore = existsSync(iconPath) ? statSync(iconPath).mtimeMs : 0
    await new Promise((resolve) => setTimeout(resolve, 30))
    desktop.integrateLinuxDesktop()
    check(existsSync(entryPath) && statSync(entryPath).mtimeMs === before, 'unveraenderter Eintrag wurde neu geschrieben')
    check(existsSync(iconPath) && statSync(iconPath).mtimeMs === iconBefore, 'unveraendertes Symbol wurde neu geschrieben')

    // After an update under a new name the entry follows the file.
    process.env.APPIMAGE = '/home/gabi/Downloads/launch-gabi-linux-x86_64.AppImage'
    desktop.integrateLinuxDesktop()
    const moved = existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : ''
    check(moved.includes(`Exec="${process.env.APPIMAGE}" %U`), 'Eintrag folgt der umbenannten Datei nicht')

    // Next to an entry another tool made, the launcher adds only a hidden one,
    // which launchgabi:// links still need.
    const otherHome = join(work, 'share-foreign')
    mkdirSync(join(otherHome, 'applications'), { recursive: true })
    writeFileSync(
      join(otherHome, 'applications', 'appimagekit_abc-Launch_Gabi.desktop'),
      `[Desktop Entry]\nExec=${process.env.APPIMAGE} %U\n`
    )
    process.env.XDG_DATA_HOME = otherHome
    desktop.integrateLinuxDesktop()
    const hiddenPath = join(otherHome, 'applications', 'launch-gabi.desktop')
    const hidden = existsSync(hiddenPath) ? readFileSync(hiddenPath, 'utf8') : ''
    check(hidden.includes('NoDisplay=true'), 'Eintrag neben einem fremden fehlt oder steht sichtbar im Menü')
    check(hidden.includes('MimeType=x-scheme-handler/launchgabi;'), 'versteckter Eintrag ohne launchgabi://')
    check(!first.includes('NoDisplay=true'), 'eigener Eintrag ohne fremden ist versteckt')

    // Outside an AppImage nothing is written at all.
    const plainHome = join(work, 'share-plain')
    process.env.XDG_DATA_HOME = plainHome
    delete process.env.APPIMAGE
    desktop.integrateLinuxDesktop()
    check(!existsSync(plainHome), 'ohne AppImage trotzdem etwas angelegt')
  } finally {
    Object.defineProperty(process, 'platform', realPlatform)
  }
} catch (err) {
  problems.push(`Abbruch: ${err?.stack || err}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (problems.length) {
  console.error(`FEHLER (${problems.length}):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('Linux-Menueeintrag: alles in Ordnung')
