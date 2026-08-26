/** Channel names shared by the main process and the preload bridge. */

export const IPC = {
  // window
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',

  // app
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appOpenPath: 'app:open-path',
  appPickDirectory: 'app:pick-directory',
  appPickFile: 'app:pick-file',
  appStats: 'app:stats',

  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',

  // instances
  instanceList: 'instance:list',
  instanceGet: 'instance:get',
  instanceCreate: 'instance:create',
  instanceUpdate: 'instance:update',
  instanceDelete: 'instance:delete',
  instanceDuplicate: 'instance:duplicate',
  instanceImportFolder: 'instance:import-folder',
  instanceOpenFolder: 'instance:open-folder',
  instanceCreateShortcut: 'instance:create-shortcut',
  instanceRepair: 'instance:repair',
  instanceInstall: 'instance:install',
  instanceSetIconImage: 'instance:set-icon-image',
  instanceSetBackground: 'instance:set-background',
  instanceWorlds: 'instance:worlds',
  instanceScreenshots: 'instance:screenshots',
  instanceRecordings: 'instance:recordings',
  instanceDeleteRecording: 'instance:delete-recording',

  // recording
  recordingState: 'recording:state',
  recordingToggle: 'recording:toggle',
  recordingSource: 'recording:source',
  recordingChunk: 'recording:chunk',
  recordingFinished: 'recording:finished',
  recordingFailed: 'recording:failed',
  recordingPoster: 'recording:poster',

  // error reports
  reportsList: 'reports:list',
  reportsClear: 'reports:clear',
  reportsOpenFolder: 'reports:open-folder',
  reportsStatus: 'reports:status',
  reportsFromRenderer: 'reports:from-renderer',

  // launching
  launchPreflight: 'launch:preflight',
  launchStart: 'launch:start',
  launchStop: 'launch:stop',
  launchStatus: 'launch:status',
  launchLogs: 'launch:logs',

  // versions
  versionsMinecraft: 'versions:minecraft',
  versionsLoader: 'versions:loader',

  // java
  javaList: 'java:list',
  javaDetect: 'java:detect',
  javaInstall: 'java:install',
  javaTest: 'java:test',

  // accounts
  accountList: 'account:list',
  accountLoginMicrosoft: 'account:login-microsoft',
  accountLoginOffline: 'account:login-offline',
  accountRemove: 'account:remove',
  accountSetActive: 'account:set-active',
  accountCancelLogin: 'account:cancel-login',

  // content providers
  providerSearch: 'provider:search',
  providerProject: 'provider:project',
  providerVersions: 'provider:versions',
  providerCategories: 'provider:categories',

  // content management
  contentInstall: 'content:install',
  contentRemove: 'content:remove',
  contentToggle: 'content:toggle',
  contentCheckUpdates: 'content:check-updates',
  contentUpdate: 'content:update',
  contentUpdateAll: 'content:update-all',
  contentImportFile: 'content:import-file',
  contentCompatibility: 'content:compatibility',
  contentApplyFix: 'content:apply-fix',

  // modpacks
  modpackImport: 'modpack:import',
  modpackExport: 'modpack:export',
  modpackInstallFromProvider: 'modpack:install-from-provider',

  // backups
  backupList: 'backup:list',
  backupCreate: 'backup:create',
  backupRestore: 'backup:restore',
  backupDelete: 'backup:delete',
  backupOpenFolder: 'backup:open-folder',

  // news
  newsList: 'news:list',

  // tasks
  taskList: 'task:list',
  taskCancel: 'task:cancel',

  // launcher self-update
  updateStatus: 'update:status',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install'
} as const

/** Push channels: main -> renderer. */
export const EVENTS = {
  taskUpdate: 'evt:task-update',
  instanceChanged: 'evt:instance-changed',
  launchStatus: 'evt:launch-status',
  logLine: 'evt:log-line',
  deviceCode: 'evt:device-code',
  accountsChanged: 'evt:accounts-changed',
  notification: 'evt:notification',
  navigate: 'evt:navigate',
  windowState: 'evt:window-state',
  updateStatus: 'evt:update-status',
  /** Main asks the renderer to start capturing, carrying the chosen source. */
  recordingStart: 'evt:recording-start',
  /** Main asks the renderer to stop capturing. */
  recordingStop: 'evt:recording-stop',
  /** Recorder state changed, for the indicator in the interface. */
  recordingState: 'evt:recording-state'
} as const

export type NotificationKind = 'info' | 'success' | 'warning' | 'error'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  message?: string
  /** Optional deep link the renderer should follow when clicked. */
  route?: string
  timeout?: number
}
