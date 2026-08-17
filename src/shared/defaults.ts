import type { InstanceSettings, LauncherSettings, LoaderId } from './types'

/** JVM flags that behave well for modded Minecraft on modern JDKs. */
export const DEFAULT_JVM_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1'
].join(' ')

export const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = {
  dataDirectory: '',
  defaultMemoryMb: 4096,
  defaultJvmArgs: DEFAULT_JVM_ARGS,
  javaAutoManage: true,
  language: 'de',
  theme: 'midnight',
  accentColor: '#7c5cff',
  reduceMotion: false,
  launchBehaviour: 'keep',
  startMinimized: false,
  launchOnStartup: false,
  concurrentDownloads: 8,
  downloadThrottleKbps: 0,
  checkContentUpdatesOnStart: true,
  autoUpdate: true,
  autoInstallUpdates: true,
  autoInstallDependencies: true,
  notifyOnUpdates: true,
  notifyOnGameExit: false,
  automaticBackups: false,
  automaticBackupKeep: 5,
  curseForgeApiKey: '',
  // Client id of the official Minecraft launcher application. Replace it with
  // your own Azure application id before shipping Launch Gabi publicly.
  microsoftClientId: '00000000402b5328',
  showSnapshots: false,
  discordRichPresence: false,
  onboarded: false
}

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = {
  javaPath: '',
  javaMajorOverride: null,
  memoryMb: 4096,
  jvmArgs: DEFAULT_JVM_ARGS,
  envVars: '',
  preLaunchCommand: '',
  wrapperCommand: '',
  fullscreen: false,
  windowWidth: 1280,
  windowHeight: 720,
  launchBehaviour: 'keep',
  backupBeforeUpdates: true,
  autoUpdateContent: false
}

export const LOADERS: { id: LoaderId; name: string; blurb: string; accent: string }[] = [
  {
    id: 'vanilla',
    name: 'Vanilla',
    blurb: 'Reines Minecraft ohne Mod-Unterstützung.',
    accent: '#5ec26a'
  },
  {
    id: 'fabric',
    name: 'Fabric',
    blurb: 'Leichtgewichtig und schnell aktualisiert. Beste Wahl für Performance-Mods.',
    accent: '#c8a165'
  },
  {
    id: 'neoforge',
    name: 'NeoForge',
    blurb: 'Moderner Forge-Nachfolger für aktuelle Versionen.',
    accent: '#e07a3f'
  },
  {
    id: 'forge',
    name: 'Forge',
    blurb: 'Der Klassiker mit der größten Mod-Bibliothek.',
    accent: '#4b6fa8'
  },
  {
    id: 'quilt',
    name: 'Quilt',
    blurb: 'Fabric-kompatibler Fork mit erweitertem Mod-System.',
    accent: '#9a5cc6'
  }
]

/** Emoji offered by the instance icon picker. */
export const ICON_CHOICES = [
  '🟩', '⛏️', '🗡️', '🛡️', '🏹', '🧪', '💎', '🔥', '❄️', '🌊',
  '🌋', '🌙', '⭐', '⚡', '🍎', '🐉', '🐺', '🐝', '🦊', '🐲',
  '🏰', '🗿', '🧱', '📦', '🎯', '🎮', '🚀', '👑', '💀', '🧿'
]

/** Accent presets used by the instance customiser. */
export const ACCENT_CHOICES = [
  '#7c5cff',
  '#4f7bff',
  '#22c6f2',
  '#25d0a1',
  '#5ec26a',
  '#f2c33d',
  '#ff8a3d',
  '#ff5c7a',
  '#e254d8',
  '#9aa4c4'
]
