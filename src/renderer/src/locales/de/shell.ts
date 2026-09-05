/**
 * Strings for the navigation frame (top bar, sidebar, title bar) and the
 * home dashboard. Keys shared across several of those components (running
 * status, window controls, the command palette, account fallback text) sit
 * without a component prefix; keys used by only one component are grouped
 * under that component's name.
 */
export default {
  // Shared: running / update status text used by Home, TopBar and TitleBar.
  'status.running': 'Minecraft läuft',
  'status.updateReady': 'Update bereit',
  'status.updateDownloading': 'Update wird geladen',
  'status.devMode': 'Entwicklungsmodus',
  'status.upToDate': 'Auf dem neuesten Stand',
  'status.noInstance': 'keine Instanz',
  'status.launcherLabel': 'Launcher',
  'status.label': 'Status',
  'status.title': 'AKTUELLER STATUS',

  // Shared: window controls (TopBar, TitleBar).
  'window.minimize': 'Minimieren',
  'window.maximize': 'Maximieren',
  'window.restore': 'Wiederherstellen',

  // Shared: command palette button (TopBar, TitleBar).
  'commandPalette.ariaLabel': 'Befehle suchen',
  'commandPalette.shortcut': 'Strg + K',

  // Shared: recording indicator (TopBar, TitleBar).
  'recording.stopTitle': 'Aufnahme beenden',
  'recording.stopAriaLabel': 'Aufnahme beenden, läuft seit {elapsed}',

  // Shared: account fallback text (TopBar, Sidebar).
  'account.none': 'Kein Account',
  'account.offlineProfile': 'Offline-Profil',
  'account.signInPrompt': 'Zum Anmelden klicken',

  // TopBar only.
  'topbar.updateWaitingTitle': 'Update auf {version} wartet',
  'topbar.runningMany': '{count} laufen',

  // TitleBar only.
  'titlebar.runningMany': '{count} Instanzen laufen',
  'titlebar.taskOne': 'Vorgang',
  'titlebar.taskMany': 'Vorgänge',

  // Sidebar only.
  'sidebar.searchPlaceholder': 'Suchen…',
  'sidebar.searchShortcut': 'Strg K',
  'sidebar.brandActiveCount': '{count} aktiv',
  'sidebar.updateWaitingRestartTitle': 'Update auf {version} wartet auf einen Neustart',

  // Home: hero section.
  'hero.welcomeBack': 'Willkommen zurück, {name}!',
  'hero.welcomeBackGeneric': 'Willkommen zurück!',
  'hero.subReady': 'Bereit für dein nächstes Abenteuer?',
  'hero.subEmpty': 'Lege deine erste Instanz an und leg los.',
  'hero.playStarting': 'Startet…',
  'hero.playStart': 'Minecraft starten',
  'hero.createInstance': 'Instanz erstellen',
  'hero.importModpack': 'Modpack importieren',

  // Home: empty state.
  'empty.title': 'Noch keine Instanz',
  'empty.message':
    'Eine Instanz ist eine eigenständige Minecraft-Installation mit eigener Version, eigenen Mods und eigenen Welten.',

  // Home: instance tile row.
  'instances.title': 'Deine Instanzen',
  'instances.viewAll': 'Alle Instanzen',
  'instances.newInstance': 'Neue Instanz',

  // Home: news panel.
  'news.title': 'NEUIGKEITEN',
  'news.empty': 'Gerade keine Meldungen.',
  'news.viewAll': 'Alle News',

  // Home: overview stats.
  'overview.title': 'Überblick',
  'overview.instances': 'Instanzen',
  'overview.playtime': 'Spielzeit',
  'overview.totalMods': 'Mods insgesamt',
  'overview.diskUsage': 'Speicherplatz',

  // Home: delete-instance confirmation.
  'deleteInstance.title': 'Instanz löschen',
  'deleteInstance.message':
    'Diese Instanz wird mit allen Welten, Mods und Einstellungen gelöscht. Das lässt sich nicht rückgängig machen.',
  'deleteInstance.confirm': 'Endgültig löschen',

  // ui.tsx: CopyButton.
  'copyButton.copied': 'Kopiert'
}
