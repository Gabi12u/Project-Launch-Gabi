/**
 * Strings for the navigation frame (top bar, sidebar, title bar) and the
 * home dashboard. Keys shared across several of those components (running
 * status, window controls, the command palette, account fallback text) sit
 * without a component prefix; keys used by only one component are grouped
 * under that component's name.
 */
export default {
  // Shared: running / update status text used by Home, TopBar and TitleBar.
  'status.running': 'Minecraft is running',
  'status.updateReady': 'Update ready',
  'status.updateDownloading': 'Update downloading',
  'status.devMode': 'Development mode',
  'status.upToDate': 'Up to date',
  'status.noInstance': 'no instance',
  'status.launcherLabel': 'Launcher',
  'status.label': 'Status',
  'status.title': 'CURRENT STATUS',

  // Shared: window controls (TopBar, TitleBar).
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',

  // Shared: command palette button (TopBar, TitleBar).
  'commandPalette.ariaLabel': 'Search commands',
  'commandPalette.shortcut': 'Ctrl + K',

  // Shared: recording indicator (TopBar, TitleBar).
  'recording.stopTitle': 'Stop recording',
  'recording.stopAriaLabel': 'Stop recording, running for {elapsed}',

  // Shared: account fallback text (TopBar, Sidebar).
  'account.none': 'No account',
  'account.offlineProfile': 'Offline profile',
  'account.signInPrompt': 'Click to sign in',

  // TopBar only.
  'topbar.updateWaitingTitle': 'Update to {version} is waiting',
  'topbar.runningMany': '{count} running',

  // TitleBar only.
  'titlebar.runningMany': '{count} instances running',
  'titlebar.taskOne': 'Task',
  'titlebar.taskMany': 'Tasks',

  // Sidebar only.
  'sidebar.searchPlaceholder': 'Search…',
  'sidebar.searchShortcut': 'Ctrl K',
  'sidebar.brandActiveCount': '{count} active',
  'sidebar.updateWaitingRestartTitle': 'Update to {version} is waiting for a restart',

  // Home: hero section.
  'hero.welcomeBack': 'Welcome back, {name}!',
  'hero.welcomeBackGeneric': 'Welcome back!',
  'hero.subReady': 'Ready for your next adventure?',
  'hero.subEmpty': 'Create your first instance and get started.',
  'hero.playStarting': 'Starting…',
  'hero.playStart': 'Start Minecraft',
  'hero.createInstance': 'Create instance',
  'hero.importModpack': 'Import modpack',

  // Home: empty state.
  'empty.title': 'No instance yet',
  'empty.message':
    'An instance is a self-contained Minecraft installation with its own version, its own mods and its own worlds.',

  // Home: instance tile row.
  'instances.title': 'Your instances',
  'instances.viewAll': 'All instances',
  'instances.newInstance': 'New instance',

  // Home: news panel.
  'news.title': 'NEWS',
  'news.empty': 'No news right now.',
  'news.viewAll': 'All news',

  // Home: overview stats.
  'overview.title': 'Overview',
  'overview.instances': 'Instances',
  'overview.playtime': 'Play time',
  'overview.totalMods': 'Total mods',
  'overview.diskUsage': 'Storage used',

  // Home: delete-instance confirmation.
  'deleteInstance.title': 'Delete instance',
  'deleteInstance.message':
    'This instance will be deleted along with all worlds, mods and settings. This cannot be undone.',
  'deleteInstance.confirm': 'Delete permanently',

  // ui.tsx: CopyButton.
  'copyButton.copied': 'Copied'
}
