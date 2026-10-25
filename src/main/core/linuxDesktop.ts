import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { log } from '../logger'
import { tr } from '@shared/i18n'

const logger = log('linux-desktop')

/**
 * File name of the menu entry, without `.desktop`. Must match `desktopName`
 * in package.json: Electron turns that into the Wayland app id, and a desktop
 * only links a running window to its menu entry, and keeps an icon pinned to
 * the panel, when the two agree.
 */
export const DESKTOP_ID = 'launch-gabi'

/** Marks an entry as written by the launcher itself. */
const OWN_MARKER = 'X-LaunchGabi-Managed=true'

/**
 * The AppImage file the launcher runs from, or null when it does not run
 * from one. Inside an AppImage `process.execPath` points into a mount under
 * /tmp that only exists while the launcher is open, so anything meant to
 * start it later has to point here instead.
 */
export function appImagePath(): string | null {
  if (process.platform !== 'linux') return null
  const file = process.env.APPIMAGE
  // The same check electron-updater makes before it replaces this file.
  if (!file || !isAbsolute(file) || file.includes('\0')) return null
  return file
}

/**
 * The launcher icon as a PNG. The unpacked copy comes first: `asarUnpack`
 * puts `resources/` next to app.asar, and a real file is what the desktop and
 * the window icon want. The rest cover running from source.
 */
export function appIconPng(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png')
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

/** `$XDG_DATA_HOME`, which the spec says to ignore when it is not absolute. */
function dataHome(): string {
  const value = process.env.XDG_DATA_HOME
  return value && isAbsolute(value) ? value : join(homedir(), '.local', 'share')
}

/** A value of type string in a desktop entry: only the backslash needs escaping. */
function entryString(value: string): string {
  return value.replace(/\\/g, '\\\\')
}

/**
 * One argument of an `Exec` key. Quoted, with the characters the quoting rule
 * reserves escaped, then escaped once more as a string value, since the spec
 * applies that rule first. `%` is doubled so no part of a path is read as a
 * field code like `%U`.
 */
export function execArgument(value: string): string {
  const quoted = `"${value.replace(/[\\"`$]/g, (char) => `\\${char}`)}"`
  return entryString(quoted).replace(/%/g, '%%')
}

/**
 * The menu entry for the launcher running from `appImage`. `hidden` keeps it
 * out of the menu while it still names the program for launchgabi:// links
 * and for linking the window to its icon.
 */
export function desktopEntry(options: { appImage: string; icon: string | null; comment: string; hidden?: boolean }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Launch Gabi',
    `Comment=${entryString(options.comment)}`,
    `Exec=${execArgument(options.appImage)} %U`,
    // Hides the entry by itself once the file is gone, instead of leaving a
    // launcher behind that does nothing.
    `TryExec=${entryString(options.appImage)}`,
    ...(options.icon ? [`Icon=${entryString(options.icon)}`] : []),
    'Terminal=false',
    'Categories=Game;',
    // Electron names the X11 window class after the product name. Wayland
    // goes by the file name instead, see DESKTOP_ID.
    'StartupWMClass=Launch Gabi',
    'MimeType=x-scheme-handler/launchgabi;',
    ...(options.hidden ? ['NoDisplay=true'] : []),
    OWN_MARKER,
    ''
  ].join('\n')
}

/**
 * Name of an entry another tool, such as AppImageLauncher or Gear Lever,
 * already made for this AppImage. A second one from the launcher would only
 * put Launch Gabi into the menu twice. Instance shortcuts someone copied in
 * there carry `--launch=` and do not count.
 */
export function foreignEntryFor(directory: string, appImage: string): string | null {
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return null
  }
  for (const name of names) {
    if (!name.endsWith('.desktop') || name === `${DESKTOP_ID}.desktop`) continue
    const file = join(directory, name)
    try {
      if (statSync(file).size > 64 * 1024) continue
      const text = readFileSync(file, 'utf8')
      if (text.includes(OWN_MARKER)) continue
      const starts = text
        .split(/\r?\n/)
        .some((line) => line.startsWith('Exec=') && line.includes(appImage) && !line.includes('--launch='))
      if (starts) return name
    } catch {
      // Unreadable or gone in the meantime: not an entry for this file.
    }
  }
  return null
}

/** Copies the icon where the menu entry points, rewriting it only when it changed. */
function installIcon(home: string): string | null {
  const source = appIconPng()
  if (!source) return null
  const target = join(home, 'icons', 'hicolor', '512x512', 'apps', `${DESKTOP_ID}.png`)
  try {
    const data = readFileSync(source)
    let unchanged = false
    try {
      unchanged = readFileSync(target).equals(data)
    } catch {
      // Not there yet.
    }
    if (!unchanged) {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
    }
    return target
  } catch (err) {
    logger.warn('Symbol für den Menüeintrag konnte nicht abgelegt werden:', err)
    return null
  }
}

/**
 * Puts Launch Gabi into the application menu, once per start.
 *
 * An AppImage brings no menu entry of its own, so the launcher could only be
 * started by opening the file, and an icon pinned to the panel pointed at
 * the file itself. Every update replaced that file under a new name, and the
 * pinned icon was gone. The entry is rewritten whenever the path changes, so
 * a pinned icon, which now belongs to the entry, follows along.
 *
 * Runs before `registerProtocol`: on Linux, Electron registers launchgabi://
 * by naming this entry as the handler.
 */
export function integrateLinuxDesktop(): void {
  const appImage = appImagePath()
  if (!appImage || !app.isPackaged) return
  // A line break cannot be written into an entry at all.
  if (/[\r\n]/.test(appImage)) return

  const home = dataHome()
  const directory = join(home, 'applications')
  const entryPath = join(directory, `${DESKTOP_ID}.desktop`)
  try {
    // Next to an entry another tool made, ours is still written but hidden:
    // Electron registers launchgabi:// by naming exactly this file, and links
    // did nothing when it was left out.
    const foreign = foreignEntryFor(directory, appImage)
    const contents = desktopEntry({
      appImage,
      icon: installIcon(home),
      comment: tr('Minecraft-Launcher mit getrennten Instanzen', 'Minecraft launcher with separate instances'),
      hidden: foreign !== null
    })
    let current = ''
    try {
      current = readFileSync(entryPath, 'utf8')
    } catch {
      // First start, or removed by hand.
    }
    if (current === contents) return

    mkdirSync(directory, { recursive: true })
    writeFileSync(entryPath, contents, { mode: 0o644 })
    logger.info(
      foreign
        ? `Versteckter Eintrag für launchgabi:// geschrieben, im Menü steht schon ${foreign}: ${entryPath}`
        : `Menüeintrag geschrieben: ${entryPath}`
    )
    // Refreshes which program opens launchgabi:// links. Not every system has
    // the tool, and without it the desktop simply notices a little later.
    execFile('update-desktop-database', [directory], { timeout: 10_000 }, () => {})
  } catch (err) {
    logger.warn('Menüeintrag für Linux konnte nicht angelegt werden:', err)
  }
}
