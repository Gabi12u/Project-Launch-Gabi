import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { totalmem } from 'node:os'
import { IPC, EVENTS} from '@shared/ipc'
import type {
  CompatibilityIssue,
  ContentItem,
  ContentType,
  CreateInstanceOptions,
  InstancePatch,
  LauncherSettings,
  LoaderId,
  SearchQuery
} from '@shared/types'
import { ensureRootLayout, paths, safeJoin } from './paths'
import { getSettings, resetSettings, saveSettings } from './store'
import { tr } from '@shared/i18n'
import { emit, getMainWindow, notify } from './events'
import { log, getLogDirectory } from './logger'
import { cancelTask, listTasks } from './tasks'

import { listMinecraftVersions } from './core/mojang'
import { listLoaderVersions } from './loaders'
import { detectJavaRuntimes, installJava, invalidateJavaCache } from './core/java'
import {
  createInstance,
  deleteInstance,
  duplicateInstance,
  getInstance,
  installInstance,
  invalidateInstanceCache,
  listScreenshots,
  listSummaries,
  listWorlds,
  resolveInstanceImage,
  setInstanceImage,
  syncContentWithDisk,
  toggleContent,
  updateInstance
} from './core/instances'
import {
  dropLogBuffer,
  getLogBuffer,
  getStatus,
  isStarting,
  launchInstance,
  preflight,
  stopInstance
} from './core/launch'
import { isRunning, runningCount, startingCount } from './core/running'
import {
  applyFix,
  applyUpdate,
  checkUpdates,
  importContentFile,
  installContent,
  removeContent,
  setDatapackWorlds,
  updateAll
} from './core/content'
import { checkCompatibility } from './core/compat'
import {
  clearReports,
  listReports,
  reportError,
  reportingConfigured,
  reportsFolder
} from './core/reports'
import {
  appendChunk,
  deleteRecording,
  failRecording,
  finishRecording,
  getRecordingState,
  listRecordings,
  savePoster,
  syncRecordingHotkey,
  toggleRecording
} from './core/recording'
import {
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
  backupFolder,
  pruneAllAutomaticBackups
} from './core/backups'
import { repairInstance } from './core/repair'
import {
  analyzeModpackFile,
  exportMrpack,
  importModpack,
  installModpackFromProvider
} from './core/modpack'
import { analyzeInstanceFolder, importInstanceFolder } from './core/instanceFolder'
import { verifyImportedInstance } from './core/importCheck'
import { createDesktopShortcut } from './core/shortcuts'
import { getCategories, getProject, getVersions, searchAll } from './providers'
import {
  cancelLogin,
  createOfflineAccount,
  listAccounts,
  loginWithMicrosoft,
  removeAccount,
  setActiveAccount
} from './auth/microsoft'
import { getNews, getStats } from './core/news'
import { checkForUpdates, downloadUpdate, getUpdateStatus, installUpdate } from './core/updater'
import { isGameLogWebContents, showLauncherWindow } from './gameLogWindow'

const logger = log('ipc')

/**
 * Channels the separate live-log window is allowed to invoke.
 *
 * The preload exposes every channel to every window alike, log window
 * included, since it shares the exact same bundle as the main window. Without
 * this, a compromised log-window renderer could call anything the main
 * window can: remove accounts, delete instances, change settings, all of it.
 * Kept to exactly what `GameLogWindow.tsx` actually calls (`launch.logs`,
 * `launch.stop`, `settings.get` for the theme); everything else throws.
 *
 * Covers the `handle()` channels only. The few `ipcMain.on` window channels
 * below are not gated: minimize, maximize and close act on the sending window
 * itself, and `window:show-launcher` exists for the log window's own button.
 */
const GAME_LOG_ALLOWED_CHANNELS = new Set<string>([IPC.launchLogs, IPC.launchStop, IPC.launchStatus, IPC.settingsGet])

/** Wraps a handler so renderer-side errors arrive as readable messages. */
function handle<T extends unknown[], R>(
  channel: string,
  fn: (...args: T) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (isGameLogWebContents(event.sender.id) && !GAME_LOG_ALLOWED_CHANNELS.has(channel)) {
      logger.error(`Log-Fenster hat verbotenen Kanal aufgerufen: ${channel}`)
      throw new Error(tr('Dieser Kanal steht dem Log-Fenster nicht zur Verfügung.', 'This channel is not available to the log window.'))
    }
    try {
      return await fn(...(args as T))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`${channel} fehlgeschlagen:`, err)
      // Rethrowing keeps the renderer's promise rejected with a clean message.
      throw new Error(message)
    }
  })
}

/**
 * Opens a path with the OS shell, but only inside launcher-owned folders.
 *
 * `shell.openPath` hands the target to the shell's default handler, which on
 * Windows *runs* an .exe or .bat instead of opening it. Everything the
 * renderer legitimately opens — data directory, logs, worlds, screenshots,
 * backups — lives under one of these two roots, so anything else is refused
 * rather than executed.
 */
const OPENABLE_FILE = /\.(png|jpe?g|gif|webp|bmp|mp4|webm|mkv|mov|txt|log|json|toml|cfg|properties|zip|mrpack)$/i

function openLauncherPath(target: string): Promise<string> {
  const resolved = resolve(target)
  // The reports folder sits in userData next to the logs, not under the data
  // directory, so it needs naming here or the button to open it is refused.
  const roots = [paths.root(), getLogDirectory(), reportsFolder()].map((dir) => resolve(dir))

  const inside = roots.some((dir) => resolved === dir || resolved.startsWith(dir.endsWith(sep) ? dir : dir + sep))
  if (!inside) {
    throw new Error(tr('Dieser Pfad liegt außerhalb der Launcher-Ordner.', 'This path is outside the launcher folders.'))
  }
  // The data folder is a setting, so the roots above alone could be moved to
  // anywhere. Folders and a fixed set of harmless file types are all the
  // launcher ever opens; programs and scripts are refused whatever the root.
  try {
    if (statSync(resolved).isFile() && !OPENABLE_FILE.test(resolved)) {
      throw new Error(tr('Diese Datei öffnet der Launcher nicht.', 'The launcher does not open this file.'))
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
  }
  // openPath never rejects: it resolves with an error string, or '' on
  // success. Handing that straight back reported a missing folder or a broken
  // file association to the renderer as if it had worked.
  return shell.openPath(resolved).then((message) => {
    if (message) throw new Error(tr(`Ordner konnte nicht geöffnet werden: ${message}`, `Folder could not be opened: ${message}`))
    return ''
  })
}

/** A small JPEG of a screenshot as a data URL, or null if it cannot be read. */
async function screenshotPreview(file: string): Promise<string | null> {
  const size = { width: 480, height: 270 }
  let image: Electron.NativeImage | null = null
  try {
    // The system's own thumbnailer is fast and never decodes the full
    // picture. Only Windows and macOS have one.
    image = await nativeImage.createThumbnailFromPath(file, size)
  } catch {
    image = null
  }
  if (!image || image.isEmpty()) {
    const full = nativeImage.createFromBuffer(await readFile(file).catch(() => Buffer.alloc(0)))
    image = full.isEmpty() ? null : full.resize({ width: size.width, quality: 'good' })
  }
  if (!image || image.isEmpty()) return null
  return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`
}

/**
 * Refuses a change to an instance's mods while its game is up.
 *
 * Minecraft reads the mods folder once at startup and keeps those jars open.
 * Enabling, removing or updating one mid-session does nothing to the running
 * game at best, and on Windows the file is locked so the operation fails
 * halfway, leaving the folder and content.json describing different things.
 * The instance would then look fine and refuse to start next time.
 *
 * Applied at the IPC boundary because that is where every user-triggered
 * change arrives, the automatic compatibility fixes included.
 */
function requireStopped(instanceId: string, action: string): void {
  if (isRunning(instanceId) || isStarting(instanceId)) {
    throw new Error(
      tr(
        `${action} ist nicht möglich, solange Minecraft läuft. Beende das Spiel und versuche es dann erneut.`,
        `${action} is not possible while Minecraft is running. Close the game and then try again.`
      )
    )
  }
}

export function registerIpc(): void {
  /* ---------------------------------------------------------------- *
   * Window
   * ---------------------------------------------------------------- */

  // Resolves to whichever window's renderer actually sent the request rather
  // than always the main one, so the same three channels also work for the
  // separate live-log window: without this, its own minimize/close buttons
  // would have reached right past it and controlled the main window instead.
  const senderWindow = (event: Electron.IpcMainEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender) ?? getMainWindow()

  ipcMain.on(IPC.windowMinimize, (event) => senderWindow(event)?.minimize())
  ipcMain.on(IPC.windowClose, (event) => senderWindow(event)?.close())
  ipcMain.on(IPC.windowShowLauncher, () => showLauncherWindow())
  ipcMain.on(IPC.windowMaximize, (event) => {
    const win = senderWindow(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle(IPC.windowIsMaximized, () => getMainWindow()?.isMaximized() ?? false)

  /* ---------------------------------------------------------------- *
   * App
   * ---------------------------------------------------------------- */

  handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    dataDirectory: paths.root(),
    logDirectory: getLogDirectory(),
    systemMemoryMb: Math.round(totalmem() / 1024 / 1024)
  }))

  handle(IPC.appOpenExternal, (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error(tr('Nur http(s)-Links werden geöffnet.', 'Only http(s) links are opened.'))
    return shell.openExternal(url)
  })

  handle(IPC.appOpenPath, (path: string) => openLauncherPath(path))

  handle(IPC.appPickDirectory, async (title?: string) => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: title ?? tr('Ordner auswählen', 'Choose folder'),
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle(
    IPC.appPickFile,
    async (options: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: options?.title ?? tr('Datei auswählen', 'Choose file'),
        filters: options?.filters,
        properties: options?.multi ? ['openFile', 'multiSelections'] : ['openFile']
      })
      return result.canceled ? [] : result.filePaths
    }
  )

  handle(IPC.appStats, () => getStats())

  handle(IPC.appRelaunch, () => {
    // A restart would cut off a launch that is still preparing, and with
    // "close with the game" it would take a running game down with it.
    if (runningCount() + startingCount() > 0) {
      throw new Error(
        tr(
          'Beende zuerst alle laufenden Spiele, dann startet der Launcher neu.',
          'Close all running games first, then the launcher restarts.'
        )
      )
    }
    if (listTasks().some((task) => task.state === 'running')) {
      throw new Error(
        tr(
          'Warte, bis alle Downloads und Aufgaben fertig sind, dann startet der Launcher neu.',
          'Wait until all downloads and tasks are finished, then the launcher restarts.'
        )
      )
    }
    // The old process's own arguments are passed on by default, and a start
    // through an instance shortcut (--launch=) or a launchgabi:// link would
    // then run that instance again after a mere language switch.
    const args = process.argv
      .slice(1)
      .filter((arg) => arg !== '--' && !arg.startsWith('--launch=') && !arg.startsWith('launchgabi://') && arg !== '--updated')
    // Inside an AppImage, execPath points into a mount that is gone by then.
    app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE, args } : { args })
    app.quit()
  })

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  handle(IPC.settingsGet, () => getSettings())

  handle(IPC.settingsSet, (patch: Partial<LauncherSettings>) => {
    const previous = getSettings()
    // A running game keeps its files under the old root; switching underneath
    // it leaves the launcher unable to find, stop or log it.
    if (
      patch.dataDirectory !== undefined &&
      patch.dataDirectory !== previous.dataDirectory &&
      runningCount() + startingCount() > 0
    ) {
      throw new Error(tr('Der Datenordner lässt sich nur wechseln, solange kein Spiel läuft.', 'The data folder can only be changed while no game is running.'))
    }
    // Same for a download, an instance still being set up, an import or a
    // backup: they keep writing into the old folder and then cannot find their
    // instance in the new one, which made a freshly created instance vanish.
    if (
      patch.dataDirectory !== undefined &&
      patch.dataDirectory !== previous.dataDirectory &&
      listTasks().some((task) => task.state === 'running')
    ) {
      throw new Error(
        tr(
          'Der Datenordner lässt sich erst wechseln, wenn alle Downloads und Aufgaben fertig sind.',
          'The data folder can only be changed once all downloads and tasks are finished.'
        )
      )
    }
    const next = saveSettings(patch)

    // Compared against the stored result rather than the patch: `saveSettings`
    // refuses an empty directory and keeps the previous one, and reacting to
    // the patch alone would invalidate caches for a move that never happened.
    if (next.dataDirectory !== previous.dataDirectory) {
      ensureRootLayout()
      invalidateJavaCache()
      // Every `paths.*()` call resolves against the new root from here on, so
      // anything still holding instances read out of the old one has to go.
      invalidateInstanceCache()
      logger.info(`Datenverzeichnis gewechselt zu ${next.dataDirectory}`)
    }

    // A new key or a switched-off recorder has to reach the OS right away,
    // otherwise the change only takes effect at the next launch.
    if (
      next.recordingHotkey !== previous.recordingHotkey ||
      next.recordingEnabled !== previous.recordingEnabled
    ) {
      syncRecordingHotkey()
    }

    // A lower keep count should take effect right away, not only the next
    // time each instance happens to create a fresh automatic backup. Kept off
    // the reply: this is best effort housekeeping, not something the settings
    // save should ever fail over.
    if (next.automaticBackupKeep < previous.automaticBackupKeep) {
      try {
        pruneAllAutomaticBackups()
      } catch (err) {
        logger.warn('Automatische Sicherungen nach geänderter Aufbewahrung nicht aufgeräumt:', err)
      }
    }
    return next
  })

  handle(IPC.settingsReset, () => {
    const previous = getSettings()
    const next = resetSettings()
    syncRecordingHotkey()
    if (next.automaticBackupKeep < previous.automaticBackupKeep) {
      try {
        pruneAllAutomaticBackups()
      } catch (err) {
        logger.warn('Automatische Sicherungen nach Zurücksetzen nicht aufgeräumt:', err)
      }
    }
    return next
  })

  /* ---------------------------------------------------------------- *
   * Instances
   * ---------------------------------------------------------------- */

  handle(IPC.instanceList, () => listSummaries())

  handle(IPC.instanceGet, async (id: string) => {
    await syncContentWithDisk(id)
    const instance = getInstance(id)
    return {
      ...instance,
      // Resolve custom images to absolute paths the renderer can display.
      resolvedIcon: resolveInstanceImage(id, instance.appearance.icon),
      resolvedBackground: resolveInstanceImage(id, instance.appearance.background)
    }
  })

  handle(IPC.instanceCreate, (options: CreateInstanceOptions) => createInstance(options))

  handle(IPC.instanceUpdate, (id: string, patch: InstancePatch) => updateInstance(id, patch))

  handle(IPC.instanceDelete, (id: string) => {
    deleteInstance(id)
    // Only after the delete succeeded — it throws when the folder is locked,
    // and the instance is then still there with its log worth keeping.
    dropLogBuffer(id)
    return listSummaries()
  })

  handle(IPC.instanceDuplicate, (id: string, name?: string) => duplicateInstance(id, name))

  handle(IPC.instanceImportFolder, async (sourceDir?: string) => {
    let target = sourceDir
    if (!target) {
      const win = getMainWindow()
      // A folder, not a file: the modpack picker cannot select one, which is
      // why an instance that already exists on disk had no way in at all.
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: tr('Instanz-Ordner auswählen', 'Choose instance folder'),
        message: tr('Wähle den Ordner einer Instanz (Prism, MultiMC oder ein .minecraft-Ordner).', 'Choose the folder of an instance (Prism, MultiMC or a .minecraft folder).'),
        buttonLabel: tr('Importieren', 'Import'),
        properties: ['openDirectory']
      })
      if (result.canceled) return null
      target = result.filePaths[0]
    }
    return importInstanceFolder(target)
  })

  handle(IPC.instanceOpenFolder, (id: string, sub?: string) => {
    // The id must belong to a real instance before it is joined into a path at
    // all. `paths.gameDir`/`paths.instance` are plain `join`s, and an id with
    // ".." segments can cancel out the "instances" folder and land inside a
    // different launcher-owned folder (e.g. a managed Java install under
    // `paths.java()`), which the root check in `openLauncherPath` alone would
    // not catch. `getInstance` throws on an unknown id, and a real instance id
    // out of `slugify()` in instances.ts can never contain a slash or a dot.
    getInstance(id)
    // Both arguments come from the renderer, so `sub` goes through safeJoin and
    // the result is checked against the launcher root by openLauncherPath.
    const gameDir = paths.gameDir(id)
    const target = sub ? safeJoin(gameDir, sub) : gameDir
    return openLauncherPath(existsSync(target) ? target : paths.instance(id))
  })

  handle(IPC.instanceCreateShortcut, (id: string, iconImages?: string[]) => {
    const path = createDesktopShortcut(id, iconImages ?? [])
    notify(
      'success',
      tr('Verknüpfung erstellt', 'Shortcut created'),
      tr(
        `${getInstance(id).name} liegt jetzt auf dem Desktop. Ein Doppelklick startet direkt das Spiel.`,
        `${getInstance(id).name} is now on your desktop. Double-clicking it starts the game right away.`
      )
    )
    return path
  })

  handle(IPC.instanceRepair, (id: string) => repairInstance(id))

  handle(IPC.instanceInstall, (id: string, force?: boolean) => installInstance(id, force))

  handle(IPC.instanceSetIconImage, async (id: string) => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: tr('Instanz-Icon auswählen', 'Choose instance icon'),
      filters: [{ name: tr('Bilder', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null
    setInstanceImage(id, result.filePaths[0], 'icon')
    return resolveInstanceImage(id, getInstance(id).appearance.icon)
  })

  handle(IPC.instanceSetBackground, async (id: string) => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: tr('Hintergrundbild auswählen', 'Choose background image'),
      filters: [{ name: tr('Bilder', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null
    setInstanceImage(id, result.filePaths[0], 'background')
    return resolveInstanceImage(id, getInstance(id).appearance.background)
  })

  handle(IPC.instanceWorlds, (id: string) => listWorlds(id))

  handle(IPC.instanceRecordings, async (id: string) => {
    const clips = await listRecordings(id)
    // Only the preview picture is inlined. A video is tens of megabytes and
    // goes to the system player through `openPath` instead.
    return Promise.all(
      clips.map(async ({ posterFile, ...clip }) => {
        if (!posterFile) return { ...clip, posterDataUrl: null }
        try {
          const buffer = await readFile(posterFile)
          return { ...clip, posterDataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` }
        } catch {
          return { ...clip, posterDataUrl: null }
        }
      })
    )
  })

  handle(IPC.instanceDeleteRecording, (id: string, file: string) => {
    deleteRecording(id, file)
  })

  /* ---------------------------------------------------------------- *
   * Recording
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * Error reports
   * ---------------------------------------------------------------- */

  handle(IPC.reportsList, () => listReports())
  handle(IPC.reportsClear, () => clearReports())
  handle(IPC.reportsOpenFolder, () => openLauncherPath(reportsFolder()))
  handle(IPC.reportsStatus, () => ({ configured: reportingConfigured() }))
  handle(IPC.recordingState, () => getRecordingState())

  handle(IPC.reportsFromRenderer, (area: string, message: string, detail: string) => {
    // Rebuilt as an Error so the renderer's stack survives the crossing and
    // the scrubbing treats it exactly like a main-process fault.
    const error = new Error(String(message))
    error.stack = String(detail || '')
    // Free text from the renderer, printed outside the report's code block.
    const safeArea = String(area).replace(/[^a-z0-9:_-]/gi, '').slice(0, 40) || 'unknown'
    reportError(`renderer:${safeArea}`, error)
  })
  handle(IPC.recordingToggle, (instanceId?: string) => toggleRecording(instanceId))
  handle(IPC.recordingChunk, (sessionId: number, data: ArrayBuffer) => appendChunk(sessionId, data))
  handle(IPC.recordingPoster, (sessionId: number, data: ArrayBuffer) => savePoster(sessionId, data))
  handle(IPC.recordingFinished, (sessionId: number, durationMs: number) => finishRecording(durationMs, sessionId))
  handle(IPC.recordingFailed, (sessionId: number, message: string) => failRecording(message, sessionId))

  handle(IPC.instanceScreenshots, async (id: string) => {
    const shots = await listScreenshots(id)
    // Inline the images so the renderer needs no file:// access. As small
    // previews: the full pictures, up to 40 of them at several megabytes
    // each, made the tab slow and cost hundreds of megabytes. A click opens
    // the original file in the system's own viewer anyway.
    return Promise.all(shots.map(async (shot) => ({ ...shot, dataUrl: await screenshotPreview(shot.file) })))
  })

  /* ---------------------------------------------------------------- *
   * Launching
   * ---------------------------------------------------------------- */

  handle(IPC.launchPreflight, (id: string) => preflight(id))

  handle(IPC.launchStart, (id: string, options?: { ignoreIssues?: boolean }) =>
    launchInstance({ instanceId: id, ignoreIssues: options?.ignoreIssues })
  )

  handle(IPC.launchStop, (id: string) => stopInstance(id))

  handle(IPC.launchStatus, (id: string) => getStatus(id))

  handle(IPC.launchLogs, (id: string) => getLogBuffer(id))

  /* ---------------------------------------------------------------- *
   * Versions
   * ---------------------------------------------------------------- */

  handle(IPC.versionsMinecraft, (includeSnapshots?: boolean) =>
    listMinecraftVersions(includeSnapshots ?? getSettings().showSnapshots)
  )

  handle(IPC.versionsLoader, (loader: LoaderId, mcVersion: string) =>
    listLoaderVersions(loader, mcVersion)
  )

  /* ---------------------------------------------------------------- *
   * Java
   * ---------------------------------------------------------------- */

  handle(IPC.javaList, (force?: boolean) => detectJavaRuntimes(force))
  handle(IPC.javaDetect, () => detectJavaRuntimes(true))
  handle(IPC.javaInstall, (major: number) => installJava(major))

  /* ---------------------------------------------------------------- *
   * Accounts
   * ---------------------------------------------------------------- */

  // Every one of these changes accounts.json, and the preload has always
  // exposed onAccountsChanged for exactly this — but nothing ever emitted it,
  // so only the window that made the change saw the new list and every other
  // view kept showing a stale one.
  //
  // `removeAccount`/`setActiveAccount` already return the full, current
  // `Account[]`, so this is exactly what the event contract promises.
  const announce = <T,>(accounts: T): T => {
    emit(EVENTS.accountsChanged, accounts)
    return accounts
  }

  // `loginWithMicrosoft`/`createOfflineAccount` return a single new `Account`,
  // not the list. The renderer's onAccountsChanged listener always expects
  // `Account[]` and calls array methods on it right away, so sending the lone
  // account through `announce` crashed every window as soon as a login
  // finished. This keeps the handler's own return value (the single account,
  // which the login dialog needs to know which one just signed in) separate
  // from the broadcast, which fetches and sends the complete list instead.
  const announceOne = <T,>(account: T): T => {
    emit(EVENTS.accountsChanged, listAccounts())
    return account
  }

  handle(IPC.accountList, () => listAccounts())
  handle(IPC.accountLoginMicrosoft, async () => announceOne(await loginWithMicrosoft()))
  handle(IPC.accountLoginOffline, async (username: string) =>
    announceOne(await createOfflineAccount(username))
  )
  handle(IPC.accountRemove, async (id: string) => announce(await removeAccount(id)))
  handle(IPC.accountSetActive, async (id: string) => announce(await setActiveAccount(id)))
  handle(IPC.accountCancelLogin, () => cancelLogin())

  /* ---------------------------------------------------------------- *
   * Providers
   * ---------------------------------------------------------------- */

  handle(IPC.providerSearch, (query: SearchQuery) => searchAll(query))

  handle(IPC.providerProject, (provider: 'modrinth' | 'curseforge', projectId: string) =>
    getProject(provider, projectId)
  )

  handle(
    IPC.providerVersions,
    (provider: 'modrinth' | 'curseforge', projectId: string, gameVersion?: string, loader?: LoaderId) =>
      getVersions(provider, projectId, gameVersion, loader)
  )

  handle(IPC.providerCategories, (provider: 'modrinth' | 'curseforge', type: ContentType | 'modpack') =>
    getCategories(provider, type)
  )

  /* ---------------------------------------------------------------- *
   * Content
   * ---------------------------------------------------------------- */

  handle(
    IPC.contentInstall,
    async (options: {
      instanceId: string
      provider: 'modrinth' | 'curseforge'
      projectId: string
      versionId?: string
      type?: ContentType
      skipDependencies?: boolean
      worlds?: string[]
    }) => {
      requireStopped(options.instanceId, tr('Mods installieren', 'Installing mods'))
      const installed = await installContent(options)
      if (installed.length > 1) {
        notify(
          'success',
          tr(`${installed[0].name} installiert`, `${installed[0].name} installed`),
          tr(
            `${installed.length - 1} Abhängigkeit${installed.length > 2 ? 'en' : ''} wurde${installed.length > 2 ? 'n' : ''} automatisch ergänzt.`,
            `${installed.length - 1} ${installed.length > 2 ? 'dependencies were' : 'dependency was'} added automatically.`
          )
        )
      }
      return installed
    }
  )

  handle(IPC.contentRemove, (instanceId: string, contentId: string) => {
    requireStopped(instanceId, tr('Entfernen', 'Removing'))
    return removeContent(instanceId, contentId)
  })

  handle(IPC.contentToggle, (instanceId: string, contentId: string, enabled: boolean) => {
    requireStopped(instanceId, enabled ? tr('Aktivieren', 'Enabling') : tr('Deaktivieren', 'Disabling'))
    return toggleContent(instanceId, contentId, enabled)
  })

  handle(IPC.contentSetDatapackWorlds, (instanceId: string, contentId: string, worlds: string[]) => {
    requireStopped(instanceId, tr('Welten zuordnen', 'Assigning worlds'))
    return setDatapackWorlds(instanceId, contentId, worlds)
  })

  handle(IPC.contentCheckUpdates, (instanceId: string) => checkUpdates(instanceId))

  handle(IPC.contentUpdate, (instanceId: string, contentId: string) => {
    requireStopped(instanceId, tr('Aktualisieren', 'Updating'))
    return applyUpdate(instanceId, contentId)
  })

  handle(IPC.contentUpdateAll, (instanceId: string) => {
    requireStopped(instanceId, tr('Aktualisieren', 'Updating'))
    return updateAll(instanceId)
  })

  handle(IPC.contentImportFile, async (instanceId: string, type: ContentType) => {
    requireStopped(instanceId, tr('Dateien hinzufügen', 'Adding files'))
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: tr('Dateien hinzufügen', 'Add files'),
      filters: [{ name: type === 'mod' ? 'Mods' : tr('Archive', 'Archives'), extensions: type === 'mod' ? ['jar'] : ['zip'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []

    // Each file stands on its own. One corrupted jar used to throw straight
    // out of the loop and lose the return value entirely, so files already
    // imported before it, side effects and all, vanished from what the
    // caller saw with nothing pointing at what actually happened.
    const items: ContentItem[] = []
    const failed: string[] = []
    for (const file of result.filePaths) {
      try {
        items.push(await importContentFile(instanceId, file, type))
      } catch (err) {
        logger.error(`Import von ${file} fehlgeschlagen:`, err)
        failed.push(basename(file))
      }
    }
    if (failed.length > 0) {
      notify(
        'warning',
        items.length > 0 ? tr('Nicht alle Dateien importiert', 'Not all files imported') : tr('Import fehlgeschlagen', 'Import failed'),
        failed.join(', ')
      )
    }
    return items
  })

  handle(IPC.contentCompatibility, (instanceId: string) => checkCompatibility(instanceId))

  handle(
    IPC.contentApplyFix,
    async (instanceId: string, fix: NonNullable<CompatibilityIssue['fix']>) => {
      requireStopped(instanceId, tr('Automatisch beheben', 'Automatic fixing'))
      await applyFix(instanceId, fix)
      return checkCompatibility(instanceId)
    }
  )

  /* ---------------------------------------------------------------- *
   * Modpacks
   * ---------------------------------------------------------------- */

  handle(IPC.modpackImport, async (filePath?: string) => {
    let target = filePath
    if (!target) {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: tr('Modpack importieren', 'Import modpack'),
        filters: [
          { name: 'Modpacks', extensions: ['mrpack', 'zip'] },
          { name: 'Modrinth Modpack', extensions: ['mrpack'] },
          { name: 'CurseForge Modpack', extensions: ['zip'] }
        ],
        properties: ['openFile']
      })
      if (result.canceled) return null
      target = result.filePaths[0]
    }
    return importModpack(target)
  })

  /* ---------------------------------------------------------------- *
   * Import analysis
   *
   * Read-only counterparts to the two importers above: they open the same
   * pickers but only look, so the wizard can show what was recognised and
   * let the user decide before an instance exists.
   * ---------------------------------------------------------------- */

  handle(IPC.importAnalyzeFolder, async (sourceDir?: string) => {
    let target = sourceDir
    if (!target) {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: tr('Instanz-Ordner auswählen', 'Choose instance folder'),
        message: tr('Wähle den Ordner einer Instanz (Prism, MultiMC, CurseForge, Modrinth oder ein .minecraft-Ordner).', 'Choose the folder of an instance (Prism, MultiMC, CurseForge, Modrinth or a .minecraft folder).'),
        buttonLabel: tr('Analysieren', 'Analyze'),
        properties: ['openDirectory']
      })
      if (result.canceled) return null
      target = result.filePaths[0]
    }
    return analyzeInstanceFolder(target)
  })

  handle(IPC.importAnalyzeFile, async (filePath?: string) => {
    let target = filePath
    if (!target) {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: tr('Modpack auswählen', 'Choose modpack'),
        buttonLabel: tr('Analysieren', 'Analyze'),
        filters: [
          { name: 'Modpacks', extensions: ['mrpack', 'zip'] },
          { name: 'Modrinth Modpack', extensions: ['mrpack'] },
          { name: 'CurseForge Modpack', extensions: ['zip'] }
        ],
        properties: ['openFile']
      })
      if (result.canceled) return null
      target = result.filePaths[0]
    }
    return analyzeModpackFile(target)
  })

  handle(IPC.importVerify, (instanceId: string) => {
    // Throws on an unknown id before any path is built from it, the same
    // guard every other instance-scoped handler takes.
    getInstance(instanceId)
    return verifyImportedInstance(instanceId)
  })

  handle(IPC.modpackExport, async (instanceId: string) => {
    const instance = getInstance(instanceId)
    const win = getMainWindow()

    const result = await dialog.showSaveDialog(win as BrowserWindow, {
      title: tr('Modpack exportieren', 'Export modpack'),
      defaultPath: `${instance.name.replace(/[\\/:*?"<>|]/g, '-')}.mrpack`,
      filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }]
    })
    if (result.canceled || !result.filePath) return null

    const file = await exportMrpack(instanceId, { targetFile: result.filePath })
    notify('success', tr('Export abgeschlossen', 'Export finished'), file)
    return file
  })

  handle(
    IPC.modpackInstallFromProvider,
    (provider: 'modrinth' | 'curseforge', projectId: string, versionId?: string) =>
      installModpackFromProvider(provider, projectId, versionId)
  )

  /* ---------------------------------------------------------------- *
   * Backups
   * ---------------------------------------------------------------- */

  handle(IPC.backupList, (instanceId?: string) => listBackups(instanceId))

  handle(
    IPC.backupCreate,
    (instanceId: string, options?: { name?: string; includes?: string[] }) =>
      createBackup(instanceId, options)
  )

  handle(IPC.backupRestore, (instanceId: string, backupId: string) =>
    restoreBackup(instanceId, backupId)
  )

  handle(IPC.backupDelete, async (instanceId: string, backupId: string) => {
    await deleteBackup(instanceId, backupId)
    return listBackups(instanceId)
  })

  handle(IPC.backupOpenFolder, (instanceId: string) => openLauncherPath(backupFolder(instanceId)))

  /* ---------------------------------------------------------------- *
   * News & tasks
   * ---------------------------------------------------------------- */

  handle(IPC.newsList, (limit?: number) => getNews(limit))
  handle(IPC.taskList, () => listTasks())
  handle(IPC.taskCancel, (id: string) => cancelTask(id))

  /* ----------------------------------------------------------------- *
   * Launcher self-update
   * ---------------------------------------------------------------- */

  handle(IPC.updateStatus, () => getUpdateStatus())
  handle(IPC.updateCheck, () => checkForUpdates(true))
  handle(IPC.updateDownload, () => downloadUpdate())
  handle(IPC.updateInstall, () => installUpdate())

  logger.info('IPC-Kanäle registriert')
}
