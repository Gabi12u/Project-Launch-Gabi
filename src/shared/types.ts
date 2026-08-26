/**
 * Shared type contract between the main process and the renderer.
 * Everything crossing the IPC bridge is described here.
 */

/* ------------------------------------------------------------------ *
 * Instances
 * ------------------------------------------------------------------ */

export type LoaderId = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt'

export type ContentType = 'mod' | 'resourcepack' | 'shaderpack' | 'datapack'

export type ProviderId = 'modrinth' | 'curseforge' | 'local'

/** How the launcher window behaves once the game starts. */
export type LaunchBehaviour = 'keep' | 'hide' | 'close'

export type RecordingQuality = 'low' | 'medium' | 'high'

/** What the recorder is doing right now, mirrored into the interface. */
export interface RecordingState {
  active: boolean
  /** The instance being recorded, null while nothing is running. */
  instanceId: string | null
  /** Epoch milliseconds the current recording started at. */
  startedAt: number | null
  /** Bytes written so far, so the interface can show it growing. */
  bytes: number
}

export interface InstanceSettings {
  /** Absolute path to a java executable. Empty means "managed automatically". */
  javaPath: string
  /** Force a specific Java major version instead of the one Mojang recommends. */
  javaMajorOverride: number | null
  memoryMb: number
  jvmArgs: string
  envVars: string
  preLaunchCommand: string
  wrapperCommand: string
  fullscreen: boolean
  windowWidth: number
  windowHeight: number
  launchBehaviour: LaunchBehaviour
  /** Create a snapshot of the world folder before mods are updated. */
  backupBeforeUpdates: boolean
  /** Check for content updates whenever the instance is opened. */
  autoUpdateContent: boolean
}

export interface InstanceAppearance {
  /** Emoji, or `img:<filename>` for a custom picture stored inside the instance. */
  icon: string
  /** Hex accent colour used across the instance UI. */
  accent: string
  /** `img:<filename>` of a custom background, or null. */
  background: string | null
}

export interface ContentDependency {
  projectId: string
  versionId?: string
  /** Mirrors the Modrinth dependency vocabulary. */
  type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface ContentItem {
  /** Stable local identifier. */
  id: string
  type: ContentType
  provider: ProviderId
  /** File name inside mods/ , resourcepacks/ , shaderpacks/ or datapacks/. */
  fileName: string
  name: string
  /** Human readable version string, e.g. "0.6.13+mc1.21.11". */
  version: string
  versionId?: string
  projectId?: string
  author?: string
  summary?: string
  iconUrl?: string
  pageUrl?: string
  sha1?: string
  size?: number
  /** Disabled content keeps a `.disabled` suffix on disk. */
  enabled: boolean
  gameVersions: string[]
  loaders: string[]
  dependencies: ContentDependency[]
  installedAt: number
  /** Populated by the update checker. */
  update?: AvailableUpdate | null
}

export interface AvailableUpdate {
  versionId: string
  versionNumber: string
  fileName: string
  downloadUrl: string
  sha1?: string
  size?: number
  changelog?: string
  releasedAt?: string
}

export interface PlaySession {
  startedAt: number
  endedAt: number
  durationMs: number
  crashed: boolean
  exitCode: number | null
}

export interface InstanceSource {
  type: 'manual' | 'mrpack' | 'curseforge'
  packName?: string
  packVersion?: string
  projectId?: string
  versionId?: string
}

export interface Instance {
  id: string
  name: string
  description: string
  group: string
  mcVersion: string
  loader: LoaderId
  /** Loader build, e.g. "0.17.2" for Fabric. Empty for vanilla. */
  loaderVersion: string
  appearance: InstanceAppearance
  settings: InstanceSettings
  content: ContentItem[]
  source: InstanceSource
  createdAt: number
  lastPlayed: number | null
  totalPlayMs: number
  sessions: PlaySession[]
  favorite: boolean
  /** True while files are still being installed. */
  installing: boolean
  /** True once the full install has completed at least once. */
  installed: boolean
}

/** Lightweight projection used by list views. */
export interface InstanceSummary {
  id: string
  name: string
  description: string
  group: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string
  appearance: InstanceAppearance
  modCount: number
  memoryMb: number
  lastPlayed: number | null
  totalPlayMs: number
  favorite: boolean
  installing: boolean
  installed: boolean
  running: boolean
  updateCount: number
}

/* ------------------------------------------------------------------ *
 * Instance creation
 * ------------------------------------------------------------------ */

export interface CreateInstanceOptions {
  name: string
  mcVersion: string
  loader: LoaderId
  loaderVersion?: string
  icon?: string
  accent?: string
  description?: string
  group?: string
  memoryMb?: number
}

/* ------------------------------------------------------------------ *
 * Versions & loaders
 * ------------------------------------------------------------------ */

export interface MinecraftVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
  url: string
}

export interface LoaderVersion {
  version: string
  stable: boolean
  /** Only present for Forge / NeoForge where builds are tied to a game version. */
  gameVersion?: string
  recommended?: boolean
}

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

export type AccountType = 'microsoft' | 'offline'

export interface Account {
  id: string
  type: AccountType
  username: string
  uuid: string
  /** Undefined for offline accounts. */
  expiresAt?: number
  skinUrl?: string
  active: boolean
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresIn: number
  message: string
}

/* ------------------------------------------------------------------ *
 * Java
 * ------------------------------------------------------------------ */

export interface JavaRuntime {
  path: string
  version: string
  major: number
  vendor: string
  arch: string
  /** True when Launch Gabi downloaded and owns this runtime. */
  managed: boolean
}

/* ------------------------------------------------------------------ *
 * Providers (Modrinth / CurseForge)
 * ------------------------------------------------------------------ */

export interface SearchQuery {
  query: string
  type: ContentType | 'modpack'
  gameVersion?: string
  loader?: LoaderId
  /** Which platforms to query. */
  providers: ProviderId[]
  sort: 'relevance' | 'downloads' | 'follows' | 'updated' | 'newest'
  offset: number
  limit: number
  categories?: string[]
}

export interface SearchResultItem {
  provider: 'modrinth' | 'curseforge'
  projectId: string
  slug: string
  name: string
  summary: string
  author: string
  iconUrl?: string
  downloads: number
  follows?: number
  updatedAt?: string
  categories: string[]
  gameVersions: string[]
  loaders: string[]
  pageUrl: string
  type: ContentType | 'modpack'
}

export interface SearchResponse {
  items: SearchResultItem[]
  total: number
  /** Providers that failed, so the UI can show a soft warning. */
  errors: { provider: string; message: string }[]
}

export interface ProjectVersion {
  provider: 'modrinth' | 'curseforge'
  versionId: string
  projectId: string
  name: string
  versionNumber: string
  releaseType: 'release' | 'beta' | 'alpha'
  gameVersions: string[]
  loaders: string[]
  downloadUrl: string
  fileName: string
  sha1?: string
  size?: number
  releasedAt: string
  changelog?: string
  dependencies: ContentDependency[]
}

export interface ProjectDetails extends SearchResultItem {
  description: string
  gallery: { url: string; title?: string }[]
  license?: string
  sourceUrl?: string
  issuesUrl?: string
  discordUrl?: string
  wikiUrl?: string
  donationUrls?: { platform: string; url: string }[]
  versions: ProjectVersion[]
}

/* ------------------------------------------------------------------ *
 * Compatibility
 * ------------------------------------------------------------------ */

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface CompatibilityIssue {
  id: string
  severity: IssueSeverity
  title: string
  detail: string
  /** Local content this issue refers to. */
  contentId?: string
  /** Set when the issue can be resolved without user input. */
  fix?: {
    kind: 'install-dependency' | 'disable-content' | 'remove-content' | 'update-content'
    label: string
    /** Payload interpreted by the fixer in the main process. */
    projectId?: string
    provider?: 'modrinth' | 'curseforge'
    contentId?: string
    versionId?: string
  }
}

export interface CompatibilityReport {
  instanceId: string
  checkedAt: number
  issues: CompatibilityIssue[]
  /** True when nothing blocks the launch. */
  launchable: boolean
}

/* ------------------------------------------------------------------ *
 * Backups
 * ------------------------------------------------------------------ */

export interface BackupEntry {
  id: string
  instanceId: string
  instanceName: string
  name: string
  fileName: string
  createdAt: number
  size: number
  /** What triggered the backup. */
  reason: 'manual' | 'automatic' | 'pre-update' | 'pre-repair'
  /** Which folders were captured. */
  includes: string[]
}

/* ------------------------------------------------------------------ *
 * Tasks & progress
 * ------------------------------------------------------------------ */

export type TaskState = 'running' | 'done' | 'failed' | 'cancelled'

/** Where the launcher's own update stands. */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  /** Applying a previously downloaded update; the launcher restarts next. */
  | 'installing'
  | 'error'
  /** Running unpackaged, where there is nothing to update. */
  | 'disabled'

export interface UpdateStatus {
  state: UpdateState
  /** Version of the update, once one is known. */
  version?: string
  /** Release notes, when the feed provides them as plain text. */
  notes?: string
  /** Download progress, 0..100. */
  percent?: number
  bytesPerSecond?: number
  error?: string
  /** Human readable one-liner for the UI. */
  detail?: string
  currentVersion: string
}

export interface TaskProgress {
  id: string
  title: string
  detail: string
  /** 0..1, or null for indeterminate work. */
  progress: number | null
  state: TaskState
  instanceId?: string
  error?: string
  startedAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 * Launch
 * ------------------------------------------------------------------ */

export type LaunchPhase =
  | 'idle'
  | 'preparing'
  | 'checking'
  | 'downloading'
  | 'installing-java'
  | 'launching'
  | 'running'
  | 'stopped'
  | 'crashed'

export interface LaunchStatus {
  instanceId: string
  phase: LaunchPhase
  detail: string
  progress: number | null
  pid?: number
  startedAt?: number
  exitCode?: number | null
}

export interface LogLine {
  instanceId: string
  stream: 'stdout' | 'stderr' | 'launcher'
  level: 'info' | 'warn' | 'error' | 'debug'
  text: string
  time: number
}

/** Everything shown on the pre-launch performance panel. */
export interface LaunchPreflight {
  instanceId: string
  mcVersion: string
  loader: LoaderId
  loaderVersion: string
  memoryMb: number
  systemMemoryMb: number
  java: { major: number; version: string; path: string; managed: boolean } | null
  modCount: number
  enabledModCount: number
  resourcePackCount: number
  shaderCount: number
  datapackCount: number
  downloadSizeMb: number
  compatibility: CompatibilityReport
  account: Account | null
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export type ThemeId =
  | 'midnight'
  | 'nebula'
  | 'abyss'
  | 'aurora'
  // Gradient palette added in 1.0.2. All dark: the launcher's text and surface
  // tokens are built for a dark ground, so a light theme needs its own token
  // set rather than just another background pair.
  | 'cobalt'
  | 'indigo'
  | 'violet'
  | 'prism'
  | 'orchid'
  | 'dusk'
  | 'sunset'
  | 'ember'
  | 'rust'
  | 'moss'
  | 'fern'
  | 'pine'
  | 'lagoon'
  | 'slate'
export type LanguageId = 'de' | 'en'

export interface LauncherSettings {
  dataDirectory: string
  defaultMemoryMb: number
  defaultJvmArgs: string
  javaAutoManage: boolean
  language: LanguageId
  theme: ThemeId
  accentColor: string
  reduceMotion: boolean
  launchBehaviour: LaunchBehaviour
  startMinimized: boolean
  launchOnStartup: boolean
  concurrentDownloads: number
  downloadThrottleKbps: number
  checkContentUpdatesOnStart: boolean
  /** Download launcher updates in the background as soon as they appear. */
  autoUpdate: boolean
  /**
   * Apply an already downloaded update while the launcher is starting, then
   * relaunch. Only ever installs what is already on disk, so startup never
   * waits for a transfer.
   */
  autoInstallUpdates: boolean
  autoInstallDependencies: boolean
  notifyOnUpdates: boolean
  notifyOnGameExit: boolean
  automaticBackups: boolean
  automaticBackupKeep: number
  /** Recording is offered at all. Off means the hotkey is never registered. */
  recordingEnabled: boolean
  /** Accelerator in Electron's notation, for instance `F9` or `Ctrl+Shift+R`. */
  recordingHotkey: string
  recordingQuality: RecordingQuality
  /** Record the system's sound output alongside the picture. */
  recordingAudio: boolean
  /** Safety net: a forgotten recording stops itself after this many minutes. */
  recordingMaxMinutes: number
  /**
   * The version whose changelog the user has already seen.
   *
   * Compared against the running version to put a marker on the changelog
   * entry after an update, so a release does not pass unnoticed.
   */
  lastSeenVersion: string
  curseForgeApiKey: string
  /** Azure application (client) id used for the Microsoft login. */
  microsoftClientId: string
  showSnapshots: boolean
  discordRichPresence: boolean
  onboarded: boolean
}

/* ------------------------------------------------------------------ *
 * News / Discover
 * ------------------------------------------------------------------ */

export interface NewsItem {
  id: string
  title: string
  summary: string
  imageUrl?: string
  url: string
  date: string
  tag: string
}

/* ------------------------------------------------------------------ *
 * Stats
 * ------------------------------------------------------------------ */

export interface LauncherStats {
  totalInstances: number
  totalPlayMs: number
  totalMods: number
  diskUsageBytes: number
  mostPlayed: { instanceId: string; name: string; playMs: number }[]
  recentSessions: (PlaySession & { instanceId: string; instanceName: string })[]
}
