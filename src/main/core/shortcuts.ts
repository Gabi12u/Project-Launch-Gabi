import { app, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../paths'
import { log } from '../logger'
import { getInstance } from './instances'
import { icoFromDataUrls } from './ico'

const logger = log('shortcuts')

/**
 * Collapses anything that would end the current line.
 *
 * Instance names are user supplied and only trimmed at the edges, so a pasted
 * name carrying a newline would break out of a `Name=` key in a .desktop file,
 * or out of the `rem`/`#` comment in the generated start scripts — turning the
 * rest of the name into its own directive or shell command.
 */
function singleLine(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim()
}

/** Characters Windows refuses in file names, plus anything line-breaking. */
function safeFileName(name: string): string {
  return singleLine(name).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Instanz'
}

/**
 * Path of the executable a shortcut should point at. In development the app
 * runs through Electron, so the shortcut targets the Electron binary with the
 * project folder as its first argument.
 */
function launchTarget(): { target: string; baseArgs: string[] } {
  if (app.isPackaged) {
    return { target: process.execPath, baseArgs: [] }
  }
  return { target: process.execPath, baseArgs: [app.getAppPath()] }
}

/**
 * Falls back to the Launch Gabi application icon.
 *
 * The first candidate is the packaged one — `extraResources` in
 * electron-builder.yml copies `build/icon.ico` there, because the build folder
 * itself is excluded from the package. The rest cover running from source.
 */
function appIconPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.ico'),
    join(app.getAppPath(), 'build', 'icon.ico'),
    join(app.getAppPath(), 'resources', 'icon.ico')
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

/**
 * Writes the instance icon as an .ico next to the instance so Windows has
 * something to show. `iconImages` are PNG data URLs rendered by the UI.
 */
/**
 * Writes the largest supplied icon out as a PNG.
 *
 * The `.ico` container `writeInstanceIcon` builds is a Windows format, while a
 * freedesktop `.desktop` entry wants a plain image path. Without this the Linux
 * branch left `Icon=` out entirely and every instance shortcut fell back to the
 * generic default, even though Windows got a proper per-instance icon from the
 * very same data.
 */
export function writeInstancePng(instanceId: string, iconImages: string[]): string | null {
  if (iconImages.length === 0) return null
  try {
    // The list runs smallest to largest, and a desktop entry is drawn at
    // whatever size the environment picks, so hand over the most detailed one.
    const source = iconImages[iconImages.length - 1]
    const base64 = source.slice(source.indexOf(',') + 1)
    if (!base64) return null

    const dir = paths.icons(instanceId)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'shortcut.png')
    writeFileSync(file, Buffer.from(base64, 'base64'))
    return file
  } catch (err) {
    logger.warn(`PNG-Symbol für ${instanceId} konnte nicht geschrieben werden:`, err)
    return null
  }
}

export function writeInstanceIcon(instanceId: string, iconImages: string[]): string | null {
  if (iconImages.length === 0) return null
  try {
    const dir = paths.icons(instanceId)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'shortcut.ico')
    writeFileSync(file, icoFromDataUrls(iconImages))
    return file
  } catch (err) {
    logger.warn(`Icon für ${instanceId} konnte nicht erzeugt werden:`, err)
    return null
  }
}

/**
 * Creates a desktop shortcut that starts Launch Gabi and immediately launches
 * the given instance through the `--launch` argument.
 *
 * The shortcut carries the instance name only — the desktop already shows an
 * icon, so repeating the launcher name in every label just adds noise.
 */
export function createDesktopShortcut(instanceId: string, iconImages: string[] = []): string {
  const instance = getInstance(instanceId)
  const desktop = app.getPath('desktop')
  const { target, baseArgs } = launchTarget()

  const fileName = safeFileName(instance.name)
  const args = [...baseArgs, `--launch=${instanceId}`].join(' ')

  if (process.platform === 'win32') {
    const linkPath = join(desktop, `${fileName}.lnk`)

    const generated = writeInstanceIcon(instanceId, iconImages)
    const icon = generated ?? appIconPath() ?? target

    const ok = shell.writeShortcutLink(linkPath, 'create', {
      target,
      args,
      description: `${singleLine(instance.name)} — Minecraft ${instance.mcVersion} (${instance.loader}) über Launch Gabi`,
      cwd: app.getAppPath(),
      icon,
      iconIndex: 0
    })

    if (!ok) throw new Error('Windows hat das Anlegen der Verknüpfung abgelehnt.')
    logger.info(`Verknüpfung erstellt: ${linkPath} (Icon: ${icon})`)
    return linkPath
  }

  if (process.platform === 'linux') {
    const linkPath = join(desktop, `${fileName}.desktop`)
    const iconFile = writeInstancePng(instanceId, iconImages) ?? appIconPath()
    const contents = [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${fileName}`,
      `Comment=${singleLine(instance.name)} - Minecraft ${instance.mcVersion}`,
      `Exec="${target}" ${args}`,
      ...(iconFile ? [`Icon=${iconFile}`] : []),
      'Terminal=false',
      'Categories=Game;'
    ].join('\n')

    writeFileSync(linkPath, contents, { mode: 0o755 })
    logger.info(`Verknüpfung erstellt: ${linkPath}`)
    return linkPath
  }

  // macOS: a small shell script is the closest thing to a one-click shortcut.
  const scriptPath = join(desktop, `${fileName}.command`)
  writeFileSync(scriptPath, `#!/bin/sh\n"${target}" ${args}\n`, { mode: 0o755 })
  logger.info(`Startskript erstellt: ${scriptPath}`)
  return scriptPath
}

/* ------------------------------------------------------------------ *
 * Deep links & CLI arguments
 * ------------------------------------------------------------------ */

export interface LaunchIntent {
  instanceId: string
}

/**
 * Reads `--launch=<id>` from a command line, as used by desktop shortcuts.
 */
export function parseLaunchArgs(argv: string[]): LaunchIntent | null {
  for (const arg of argv) {
    const match = /^--launch=(.+)$/.exec(arg)
    if (match) return { instanceId: match[1] }
  }
  return null
}

/**
 * Parses `launchgabi://` URLs.
 *
 *   launchgabi://launch/<instanceId>
 *   launchgabi://instance/<instanceId>
 *   launchgabi://install/<provider>/<projectId>
 */
export interface DeepLink {
  action: 'launch' | 'instance' | 'install' | 'unknown'
  instanceId?: string
  provider?: 'modrinth' | 'curseforge'
  projectId?: string
}

export function parseDeepLink(url: string): DeepLink {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'launchgabi:') return { action: 'unknown' }

    const segments = [parsed.hostname, ...parsed.pathname.split('/')].filter(Boolean)
    const [action, ...rest] = segments

    switch (action) {
      case 'launch':
        return { action: 'launch', instanceId: rest[0] }
      case 'instance':
        return { action: 'instance', instanceId: rest[0] }
      case 'install':
        return {
          action: 'install',
          provider: rest[0] === 'curseforge' ? 'curseforge' : 'modrinth',
          projectId: rest[1]
        }
      default:
        return { action: 'unknown' }
    }
  } catch {
    return { action: 'unknown' }
  }
}

/** Registers `launchgabi://` with the operating system. */
export function registerProtocol(): void {
  if (process.defaultApp) {
    // In development the interpreter needs the project path passed along.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('launchgabi', process.execPath, [app.getAppPath()])
    }
  } else {
    app.setAsDefaultProtocolClient('launchgabi')
  }
}

/** Writes a small .bat/.sh helper into the instance folder for power users. */
export function writeLaunchScript(instanceId: string): string {
  const instance = getInstance(instanceId)
  const { target, baseArgs } = launchTarget()
  const dir = paths.instance(instanceId)
  mkdirSync(dir, { recursive: true })

  if (process.platform === 'win32') {
    const file = join(dir, 'start.bat')
    writeFileSync(
      file,
      `@echo off\r\nrem Startet ${singleLine(instance.name)} direkt\r\nstart "" "${target}" ${[...baseArgs, `--launch=${instanceId}`].join(' ')}\r\n`,
      'utf8'
    )
    return file
  }

  const file = join(dir, 'start.sh')
  writeFileSync(
    file,
    `#!/bin/sh\n# Startet ${singleLine(instance.name)} direkt\n"${target}" ${[...baseArgs, `--launch=${instanceId}`].join(' ')}\n`,
    { mode: 0o755 }
  )
  return file
}
