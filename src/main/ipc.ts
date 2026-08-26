import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { totalmem } from 'node:os'
import { IPC, EVENTS} from '@shared/ipc'
import type {
  CompatibilityIssue,
  ContentItem,
  ContentType,
  CreateInstanceOptions,
  Instance,
  LauncherSettings,
  LoaderId,
  SearchQuery
} from '@shared/types'
import { ensureRootLayout, paths, safeJoin } from './paths'
import { getSettings, resetSettings, saveSettings } from './store'
import { emit, getMainWindow, notify } from './events'
import { log, getLogDirectory } from './logger'
import { cancelTask, listTasks } from './tasks'

import { listMinecraftVersions } from './core/mojang'
import { listLoaderVersions } from './loaders'
import { detectJavaRuntimes, installJava, invalidateJavaCache, probeJava } from './core/java'
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
import { isRunning } from './core/running'
import {
  applyFix,
  applyUpdate,
  checkUpdates,
  importContentFile,
  installContent,
  removeContent,
  updateAll
} from './core/content'
import { checkCompatibility } from './core/compat'
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
import { createBackup, deleteBackup, listBackups, restoreBackup, backupFolder } from './core/backups'
import { repairInstance } from './core/repair'
import { exportMrpack, importModpack, installModpackFromProvider } from './core/modpack'
import { importInstanceFolder } from './core/instanceFolder'
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

const logger = log('ipc')

/** Wraps a handler so renderer-side errors arrive as readable messages. */
function handle<T extends unknown[], R>(
  channel: string,
  fn: (...args: T) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
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
function openLauncherPath(target: string): Promise<string> {
  const resolved = resolve(target)
  const roots = [paths.root(), getLogDirectory()].map((dir) => resolve(dir))

  const inside = roots.some((dir) => resolved === dir || resolved.startsWith(dir + sep))
  if (!inside) {
    throw new Error('Dieser Pfad liegt außerhalb der Launcher-Ordner.')
  }
  // openPath never rejects: it resolves with an error string, or '' on
  // success. Handing that straight back reported a missing folder or a broken
  // file association to the renderer as if it had worked.
  return shell.openPath(resolved).then((message) => {
    if (message) throw new Error(`Ordner konnte nicht geöffnet werden: ${message}`)
    return ''
  })
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
      `${action} ist nicht möglich, solange Minecraft läuft. Beende das Spiel und versuche es dann erneut.`
    )
  }
}

export function registerIpc(): void {
  /* ---------------------------------------------------------------- *
   * Window
   * ---------------------------------------------------------------- */

  ipcMain.on(IPC.windowMinimize, () => getMainWindow()?.minimize())
  ipcMain.on(IPC.windowClose, () => getMainWindow()?.close())
  ipcMain.on(IPC.windowMaximize, () => {
    const win = getMainWindow()
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
    if (!/^https?:\/\//i.test(url)) throw new Error('Nur http(s)-Links werden geöffnet.')
    return shell.openExternal(url)
  })

  handle(IPC.appOpenPath, (path: string) => openLauncherPath(path))

  handle(IPC.appPickDirectory, async (title?: string) => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: title ?? 'Ordner auswählen',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle(
    IPC.appPickFile,
    async (options: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: options?.title ?? 'Datei auswählen',
        filters: options?.filters,
        properties: options?.multi ? ['openFile', 'multiSelections'] : ['openFile']
      })
      return result.canceled ? [] : result.filePaths
    }
  )

  handle(IPC.appStats, () => getStats())

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  handle(IPC.settingsGet, () => getSettings())

  handle(IPC.settingsSet, (patch: Partial<LauncherSettings>) => {
    const previous = getSettings()
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
    return next
  })

  handle(IPC.settingsReset, () => {
    const next = resetSettings()
    syncRecordingHotkey()
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

  handle(IPC.instanceUpdate, (id: string, patch: Partial<Instance>) => updateInstance(id, patch))

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
        title: 'Instanz-Ordner auswählen',
        message: 'Wähle den Ordner einer Instanz (Prism, MultiMC oder ein .minecraft-Ordner).',
        buttonLabel: 'Importieren',
        properties: ['openDirectory']
      })
      if (result.canceled) return null
      target = result.filePaths[0]
    }
    return importInstanceFolder(target)
  })

  handle(IPC.instanceOpenFolder, (id: string, sub?: string) => {
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
      'Verknüpfung erstellt',
      `${getInstance(id).name} liegt jetzt auf dem Desktop. Ein Doppelklick startet direkt das Spiel.`
    )
    return path
  })

  handle(IPC.instanceRepair, (id: string) => repairInstance(id))

  handle(IPC.instanceInstall, (id: string, force?: boolean) => installInstance(id, force))

  handle(IPC.instanceSetIconImage, async (id: string) => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Instanz-Icon auswählen',
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null
    setInstanceImage(id, result.filePaths[0], 'icon')
    return resolveInstanceImage(id, getInstance(id).appearance.icon)
  })

  handle(IPC.instanceSetBackground, async (id: string) => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Hintergrundbild auswählen',
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null
    setInstanceImage(id, result.filePaths[0], 'background')
    return resolveInstanceImage(id, getInstance(id).appearance.background)
  })

  handle(IPC.instanceWorlds, (id: string) => listWorlds(id))

  handle(IPC.instanceRecordings, async (id: string) => {
    const clips = listRecordings(id)
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

  handle(IPC.recordingState, () => getRecordingState())
  handle(IPC.recordingToggle, (instanceId?: string) => toggleRecording(instanceId))
  handle(IPC.recordingChunk, (data: ArrayBuffer) => appendChunk(data))
  handle(IPC.recordingPoster, (data: ArrayBuffer) => savePoster(data))
  handle(IPC.recordingFinished, (durationMs: number) => finishRecording(durationMs))
  handle(IPC.recordingFailed, (message: string) => failRecording(message))

  handle(IPC.instanceScreenshots, async (id: string) => {
    const shots = listScreenshots(id)
    // Inline the images so the renderer needs no file:// access.
    return Promise.all(
      shots.map(async (shot) => {
        try {
          const buffer = await readFile(shot.file)
          const mime = extname(shot.file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
          return {
            ...shot,
            dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
          }
        } catch {
          return { ...shot, dataUrl: null }
        }
      })
    )
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
  handle(IPC.javaTest, (path: string) => probeJava(path))

  /* ---------------------------------------------------------------- *
   * Accounts
   * ---------------------------------------------------------------- */

  // Every one of these changes accounts.json, and the preload has always
  // exposed onAccountsChanged for exactly this — but nothing ever emitted it,
  // so only the window that made the change saw the new list and every other
  // view kept showing a stale one.
  const announce = <T,>(accounts: T): T => {
    emit(EVENTS.accountsChanged, accounts)
    return accounts
  }

  handle(IPC.accountList, () => listAccounts())
  handle(IPC.accountLoginMicrosoft, async () => announce(await loginWithMicrosoft()))
  handle(IPC.accountLoginOffline, async (username: string) =>
    announce(await createOfflineAccount(username))
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
    }) => {
      requireStopped(options.instanceId, 'Mods installieren')
      const installed = await installContent(options)
      if (installed.length > 1) {
        notify(
          'success',
          `${installed[0].name} installiert`,
          `${installed.length - 1} Abhängigkeit${installed.length > 2 ? 'en' : ''} wurde${installed.length > 2 ? 'n' : ''} automatisch ergänzt.`
        )
      }
      return installed
    }
  )

  handle(IPC.contentRemove, (instanceId: string, contentId: string) => {
    requireStopped(instanceId, 'Entfernen')
    return removeContent(instanceId, contentId)
  })

  handle(IPC.contentToggle, (instanceId: string, contentId: string, enabled: boolean) => {
    requireStopped(instanceId, enabled ? 'Aktivieren' : 'Deaktivieren')
    return toggleContent(instanceId, contentId, enabled)
  })

  handle(IPC.contentCheckUpdates, (instanceId: string) => checkUpdates(instanceId))

  handle(IPC.contentUpdate, (instanceId: string, contentId: string) => {
    requireStopped(instanceId, 'Aktualisieren')
    return applyUpdate(instanceId, contentId)
  })

  handle(IPC.contentUpdateAll, (instanceId: string) => {
    requireStopped(instanceId, 'Aktualisieren')
    return updateAll(instanceId)
  })

  handle(IPC.contentImportFile, async (instanceId: string, type: ContentType) => {
    requireStopped(instanceId, 'Dateien hinzufuegen')
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: 'Dateien hinzufügen',
      filters: [{ name: type === 'mod' ? 'Mods' : 'Archive', extensions: type === 'mod' ? ['jar'] : ['zip'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []

    const items: ContentItem[] = []
    for (const file of result.filePaths) {
      items.push(await importContentFile(instanceId, file, type))
    }
    return items
  })

  handle(IPC.contentCompatibility, (instanceId: string) => checkCompatibility(instanceId))

  handle(
    IPC.contentApplyFix,
    async (instanceId: string, fix: NonNullable<CompatibilityIssue['fix']>) => {
      requireStopped(instanceId, 'Automatisch beheben')
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
        title: 'Modpack importieren',
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

  handle(IPC.modpackExport, async (instanceId: string) => {
    const instance = getInstance(instanceId)
    const win = getMainWindow()

    const result = await dialog.showSaveDialog(win as BrowserWindow, {
      title: 'Modpack exportieren',
      defaultPath: `${instance.name.replace(/[\\/:*?"<>|]/g, '-')}.mrpack`,
      filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }]
    })
    if (result.canceled || !result.filePath) return null

    const file = await exportMrpack(instanceId, { targetFile: result.filePath })
    notify('success', 'Export abgeschlossen', file)
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
