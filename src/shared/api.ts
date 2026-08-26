/**
 * The typed surface of `window.gabi`, shared by the preload bridge and the
 * renderer. The preload script forwards every call over IPC, so this file is
 * the single source of truth for what the renderer may call.
 */

import type { AppNotification } from './ipc'
import type {
  Account,
  BackupEntry,
  CompatibilityIssue,
  CompatibilityReport,
  ContentItem,
  ContentType,
  CreateInstanceOptions,
  DeviceCodePrompt,
  Instance,
  InstanceSummary,
  JavaRuntime,
  LaunchPreflight,
  LaunchStatus,
  LauncherSettings,
  LauncherStats,
  LoaderId,
  LoaderVersion,
  LogLine,
  MinecraftVersion,
  NewsItem,
  ProjectDetails,
  ProjectVersion,
  RecordingState,
  SearchQuery,
  SearchResponse,
  TaskProgress,
  UpdateStatus
} from './types'

/**
 * What `onInstanceChanged` delivers. A create or update sends the full summary;
 * a delete has nothing left to describe and sends only the id.
 */
export type InstanceChange =
  | (InstanceSummary & { deleted?: false })
  | { id: string; deleted: true }

export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  arch: string
  dataDirectory: string
  logDirectory: string
  systemMemoryMb: number
}

/** An instance plus the absolute paths of its custom images. */
export interface InstanceDetail extends Instance {
  resolvedIcon: string | null
  resolvedBackground: string | null
}

export interface WorldInfo {
  name: string
  folder: string
  sizeBytes: number
  lastPlayed: number
}

export interface ScreenshotInfo {
  file: string
  takenAt: number
  /** Inlined image data so the renderer needs no file access. */
  dataUrl: string | null
}

/** A finished recording sitting in the instance's `recordings` folder. */
export interface RecordingInfo {
  file: string
  fileName: string
  recordedAt: number
  sizeBytes: number
  /** Milliseconds, taken from the length the recorder reported. */
  durationMs: number
  /**
   * Inlined still frame grabbed shortly after the recording started.
   *
   * Videos are far too large to hand to the renderer whole, so the grid shows
   * this and opens the real file in the system player on click.
   */
  posterDataUrl: string | null
}

/** What the renderer needs to start capturing, decided in the main process. */
export interface RecordingRequest {
  /** Generation counter, returned with every message so late slices from a
   *  finished recording cannot be written into the next one. */
  sessionId: number
  instanceId: string
  /** desktopCapturer source id of the window or screen to capture. */
  sourceId: string
  /** Whether the source is a single window or a whole screen. */
  sourceKind: 'window' | 'screen'
  audio: boolean
  videoBitsPerSecond: number
  /** Frames per second to ask the capture for. */
  fps: number
  maxDurationMs: number
}

/** One recorded fault, already stripped of anything personal. */
export interface ErrorReport {
  id: string
  at: number
  version: string
  platform: string
  area: string
  message: string
  detail: string
}

export interface RepairReport {
  instanceId: string
  checkedFiles: number
  repairedFiles: number
  steps: { label: string; status: 'ok' | 'repaired' | 'failed'; detail: string }[]
}

export interface FilePickerOptions {
  title?: string
  filters?: { name: string; extensions: string[] }[]
  multi?: boolean
}

export interface InstallContentRequest {
  instanceId: string
  provider: 'modrinth' | 'curseforge'
  projectId: string
  versionId?: string
  type?: ContentType
  skipDependencies?: boolean
}

export type Unsubscribe = () => void

export interface GabiApi {
  window: {
    minimize(): void
    maximize(): void
    close(): void
    isMaximized(): Promise<boolean>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<string>
    pickDirectory(title?: string): Promise<string | null>
    pickFile(options?: FilePickerOptions): Promise<string[]>
    stats(): Promise<LauncherStats>
  }
  settings: {
    get(): Promise<LauncherSettings>
    set(patch: Partial<LauncherSettings>): Promise<LauncherSettings>
    reset(): Promise<LauncherSettings>
  }
  instances: {
    list(): Promise<InstanceSummary[]>
    get(id: string): Promise<InstanceDetail>
    create(options: CreateInstanceOptions): Promise<Instance>
    update(id: string, patch: Partial<Instance>): Promise<Instance>
    remove(id: string): Promise<InstanceSummary[]>
    duplicate(id: string, name?: string): Promise<Instance>
    /**
     * Takes over an instance folder written by another launcher (Prism,
     * MultiMC) or a plain `.minecraft`. Opens a folder picker when no path is
     * given, and resolves to `null` when the user cancels.
     */
    importFolder(sourceDir?: string): Promise<Instance | null>
    openFolder(id: string, sub?: string): Promise<string>
    /** `iconImages` are PNG data URLs the renderer draws for the .ico file. */
    createShortcut(id: string, iconImages?: string[]): Promise<string>
    repair(id: string): Promise<RepairReport>
    install(id: string, force?: boolean): Promise<void>
    setIconImage(id: string): Promise<string | null>
    setBackground(id: string): Promise<string | null>
    worlds(id: string): Promise<WorldInfo[]>
    screenshots(id: string): Promise<ScreenshotInfo[]>
    recordings(id: string): Promise<RecordingInfo[]>
    deleteRecording(id: string, file: string): Promise<void>
  }
  reports: {
    list(): Promise<ErrorReport[]>
    clear(): Promise<void>
    openFolder(): Promise<string>
    /** Whether a destination is configured at all. */
    status(): Promise<{ configured: boolean }>
    /** The renderer hands its own uncaught errors over here. */
    record(area: string, message: string, detail: string): Promise<void>
  }
  recording: {
    /** Current state, for painting the indicator on first render. */
    state(): Promise<RecordingState>
    /** Starts or stops, the same thing the hotkey does. */
    toggle(instanceId?: string): Promise<RecordingState>
    /** Renderer reports a slice of encoded video. Resolves once written. */
    chunk(sessionId: number, data: ArrayBuffer): Promise<void>
    /** Renderer reports the still frame for the grid. */
    poster(sessionId: number, data: ArrayBuffer): Promise<void>
    /** Renderer reports a clean finish, with the length it measured. */
    finished(sessionId: number, durationMs: number): Promise<void>
    /** Renderer reports that capturing failed and why. */
    failed(sessionId: number, message: string): Promise<void>
  }
  launch: {
    preflight(id: string): Promise<LaunchPreflight>
    start(id: string, options?: { ignoreIssues?: boolean }): Promise<void>
    stop(id: string): Promise<void>
    status(id: string): Promise<LaunchStatus>
    logs(id: string): Promise<LogLine[]>
  }
  versions: {
    minecraft(includeSnapshots?: boolean): Promise<MinecraftVersion[]>
    loader(loader: LoaderId, mcVersion: string): Promise<LoaderVersion[]>
  }
  java: {
    list(force?: boolean): Promise<JavaRuntime[]>
    detect(): Promise<JavaRuntime[]>
    install(major: number): Promise<JavaRuntime>
    test(path: string): Promise<JavaRuntime | null>
  }
  accounts: {
    list(): Promise<Account[]>
    loginMicrosoft(): Promise<Account>
    loginOffline(username: string): Promise<Account>
    remove(id: string): Promise<Account[]>
    setActive(id: string): Promise<Account[]>
    cancelLogin(): Promise<void>
  }
  providers: {
    search(query: SearchQuery): Promise<SearchResponse>
    project(provider: 'modrinth' | 'curseforge', projectId: string): Promise<ProjectDetails>
    versions(
      provider: 'modrinth' | 'curseforge',
      projectId: string,
      gameVersion?: string,
      loader?: LoaderId
    ): Promise<ProjectVersion[]>
    categories(provider: 'modrinth' | 'curseforge', type: ContentType | 'modpack'): Promise<string[]>
  }
  content: {
    install(request: InstallContentRequest): Promise<ContentItem[]>
    remove(instanceId: string, contentId: string): Promise<Instance>
    toggle(instanceId: string, contentId: string, enabled: boolean): Promise<Instance>
    checkUpdates(instanceId: string): Promise<Instance>
    update(instanceId: string, contentId: string): Promise<ContentItem | null>
    updateAll(instanceId: string): Promise<number>
    importFile(instanceId: string, type: ContentType): Promise<ContentItem[]>
    compatibility(instanceId: string): Promise<CompatibilityReport>
    applyFix(
      instanceId: string,
      fix: NonNullable<CompatibilityIssue['fix']>
    ): Promise<CompatibilityReport>
  }
  modpacks: {
    import(filePath?: string): Promise<Instance | null>
    export(instanceId: string): Promise<string | null>
    installFromProvider(
      provider: 'modrinth' | 'curseforge',
      projectId: string,
      versionId?: string
    ): Promise<Instance>
  }
  backups: {
    list(instanceId?: string): Promise<BackupEntry[]>
    create(instanceId: string, options?: { name?: string; includes?: string[] }): Promise<BackupEntry>
    restore(instanceId: string, backupId: string): Promise<void>
    remove(instanceId: string, backupId: string): Promise<BackupEntry[]>
    openFolder(instanceId: string): Promise<string>
  }
  news: {
    list(limit?: number): Promise<NewsItem[]>
  }
  tasks: {
    list(): Promise<TaskProgress[]>
    cancel(id: string): Promise<void>
  }
  /** The launcher updating itself, not the mods inside an instance. */
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus>
    /** Quits and restarts into the new version. */
    install(): Promise<void>
  }
  events: {
    onTask(fn: (task: TaskProgress) => void): Unsubscribe
    /**
     * A delete carries only the id — the instance is gone, so there is no
     * summary left to send. Modelled as a union rather than an optional flag
     * so a listener has to narrow on `deleted` before reading any other field.
     */
    onInstanceChanged(fn: (change: InstanceChange) => void): Unsubscribe
    onLaunchStatus(fn: (status: LaunchStatus) => void): Unsubscribe
    onLogLine(fn: (line: LogLine) => void): Unsubscribe
    onDeviceCode(fn: (prompt: DeviceCodePrompt | null) => void): Unsubscribe
    onAccountsChanged(fn: (accounts: Account[]) => void): Unsubscribe
    onNotification(fn: (notification: AppNotification) => void): Unsubscribe
    onNavigate(fn: (route: string) => void): Unsubscribe
    onWindowState(fn: (state: { maximized: boolean }) => void): Unsubscribe
    onUpdateStatus(fn: (status: UpdateStatus) => void): Unsubscribe
    onRecordingStart(fn: (request: RecordingRequest) => void): Unsubscribe
    onRecordingStop(fn: (sessionId: number) => void): Unsubscribe
    onRecordingState(fn: (state: RecordingState) => void): Unsubscribe
  }
}

declare global {
  interface Window {
    gabi: GabiApi
  }
}
