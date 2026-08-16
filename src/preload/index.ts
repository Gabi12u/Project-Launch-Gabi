import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, IPC } from '@shared/ipc'

/** Wraps `ipcRenderer.invoke` so call sites read like plain async functions. */
const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>

/**
 * Subscribes to a push channel and returns the unsubscribe function.
 * Payloads are typed on the renderer side through `@shared/api`.
 */
function on(channel: string, listener: (payload: never) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
    listener(args[0] as never)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    maximize: () => ipcRenderer.send(IPC.windowMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    isMaximized: call(IPC.windowIsMaximized)
  },

  app: {
    info: call(IPC.appInfo),
    openExternal: call(IPC.appOpenExternal),
    openPath: call(IPC.appOpenPath),
    pickDirectory: call(IPC.appPickDirectory),
    pickFile: call(IPC.appPickFile),
    stats: call(IPC.appStats)
  },

  settings: {
    get: call(IPC.settingsGet),
    set: call(IPC.settingsSet),
    reset: call(IPC.settingsReset)
  },

  instances: {
    list: call(IPC.instanceList),
    get: call(IPC.instanceGet),
    create: call(IPC.instanceCreate),
    update: call(IPC.instanceUpdate),
    remove: call(IPC.instanceDelete),
    duplicate: call(IPC.instanceDuplicate),
    openFolder: call(IPC.instanceOpenFolder),
    createShortcut: call(IPC.instanceCreateShortcut),
    repair: call(IPC.instanceRepair),
    install: call(IPC.instanceInstall),
    setIconImage: call(IPC.instanceSetIconImage),
    setBackground: call(IPC.instanceSetBackground),
    worlds: call(IPC.instanceWorlds),
    screenshots: call(IPC.instanceScreenshots)
  },

  launch: {
    preflight: call(IPC.launchPreflight),
    start: call(IPC.launchStart),
    stop: call(IPC.launchStop),
    status: call(IPC.launchStatus),
    logs: call(IPC.launchLogs)
  },

  versions: {
    minecraft: call(IPC.versionsMinecraft),
    loader: call(IPC.versionsLoader)
  },

  java: {
    list: call(IPC.javaList),
    detect: call(IPC.javaDetect),
    install: call(IPC.javaInstall),
    test: call(IPC.javaTest)
  },

  accounts: {
    list: call(IPC.accountList),
    loginMicrosoft: call(IPC.accountLoginMicrosoft),
    loginOffline: call(IPC.accountLoginOffline),
    remove: call(IPC.accountRemove),
    setActive: call(IPC.accountSetActive),
    cancelLogin: call(IPC.accountCancelLogin)
  },

  providers: {
    search: call(IPC.providerSearch),
    project: call(IPC.providerProject),
    versions: call(IPC.providerVersions),
    categories: call(IPC.providerCategories)
  },

  content: {
    install: call(IPC.contentInstall),
    remove: call(IPC.contentRemove),
    toggle: call(IPC.contentToggle),
    checkUpdates: call(IPC.contentCheckUpdates),
    update: call(IPC.contentUpdate),
    updateAll: call(IPC.contentUpdateAll),
    importFile: call(IPC.contentImportFile),
    compatibility: call(IPC.contentCompatibility),
    applyFix: call(IPC.contentApplyFix)
  },

  modpacks: {
    import: call(IPC.modpackImport),
    export: call(IPC.modpackExport),
    installFromProvider: call(IPC.modpackInstallFromProvider)
  },

  backups: {
    list: call(IPC.backupList),
    create: call(IPC.backupCreate),
    restore: call(IPC.backupRestore),
    remove: call(IPC.backupDelete),
    openFolder: call(IPC.backupOpenFolder)
  },

  news: {
    list: call(IPC.newsList)
  },

  tasks: {
    list: call(IPC.taskList),
    cancel: call(IPC.taskCancel)
  },

  updates: {
    status: call(IPC.updateStatus),
    check: call(IPC.updateCheck),
    download: call(IPC.updateDownload),
    install: call(IPC.updateInstall)
  },

  events: {
    onTask: (fn: (payload: never) => void) => on(EVENTS.taskUpdate, fn),
    onInstanceChanged: (fn: (payload: never) => void) => on(EVENTS.instanceChanged, fn),
    onLaunchStatus: (fn: (payload: never) => void) => on(EVENTS.launchStatus, fn),
    onLogLine: (fn: (payload: never) => void) => on(EVENTS.logLine, fn),
    onDeviceCode: (fn: (payload: never) => void) => on(EVENTS.deviceCode, fn),
    onAccountsChanged: (fn: (payload: never) => void) => on(EVENTS.accountsChanged, fn),
    onNotification: (fn: (payload: never) => void) => on(EVENTS.notification, fn),
    onNavigate: (fn: (payload: never) => void) => on(EVENTS.navigate, fn),
    onWindowState: (fn: (payload: never) => void) => on(EVENTS.windowState, fn),
    onUpdateStatus: (fn: (payload: never) => void) => on(EVENTS.updateStatus, fn)
  }
}

// contextIsolation is on, so the API has to go through the bridge.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('gabi', api)
  } catch (error) {
    console.error('Bridge konnte nicht exponiert werden:', error)
  }
} else {
  // @ts-expect-error fallback for a non-isolated context
  window.gabi = api
}
