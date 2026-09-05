export default {
  // instanceSettings: translation keys for this area go here.

  // InstanceSettings.tsx - Appearance
  'settings.appearanceTitle': 'Appearance',
  'settings.appearanceHint': 'Name, icon and color of this instance.',
  'settings.nameLabel': 'Name',
  'settings.groupLabel': 'Group',
  'settings.groupPlaceholder': 'e.g. Modded',
  'settings.descriptionLabel': 'Description',
  'settings.descriptionPlaceholder': 'What is this instance about?',
  'settings.iconLabel': 'Icon',
  'settings.customImageButton': 'Custom image',
  'settings.iconSetToast': 'Icon set',
  'settings.backgroundImageButton': 'Background image',
  'settings.backgroundSetToast': 'Background set',
  'settings.removeBackgroundButton': 'Remove background',
  'settings.accentColorLabel': 'Accent color',

  // InstanceSettings.tsx - Performance
  'settings.performanceTitle': 'Performance',
  'settings.performanceHint': 'Memory and Java settings for this instance.',
  'settings.memoryLabel': 'Memory: {value}',
  'settings.memoryHint':
    'More is not automatically better. Beyond 8 GB most modpacks see no benefit, and it can even slow down garbage collection.',
  'settings.javaVersionLabel': 'Java version',
  'settings.javaAutoOption': 'Manage automatically (recommended)',
  'settings.javaOptionLabel': 'Java {major} · {version}',
  'settings.javaManagedSuffix': '(managed)',
  'settings.javaRedetectAria': 'Search again',
  'settings.javaSearchDoneToast': 'Java search complete',
  'settings.javaAutoHint':
    'Automatic means Launch Gabi picks the Java version Mojang specifies for {version} and downloads it itself if needed.',
  'settings.jvmArgsLabel': 'JVM arguments',
  'settings.jvmArgsHint':
    'The default contains proven G1GC flags for modded Minecraft. Only change this if you know what you are doing.',

  // InstanceSettings.tsx - Window & Start
  'settings.windowTitle': 'Window & Start',
  'settings.fullscreenLabel': 'Start in fullscreen',
  'settings.fullscreenHint': 'Minecraft starts directly in fullscreen mode.',
  'settings.windowWidthLabel': 'Window width',
  'settings.windowHeightLabel': 'Window height',
  'settings.launchBehaviourLabel': 'Launcher behaviour on start',
  'settings.keepOpenOption': 'Keep launcher open',
  'settings.hideOption': 'Hide launcher',
  'settings.minimizeOption': 'Minimize launcher',
  'settings.backupBeforeUpdatesLabel': 'Back up before mod updates',
  'settings.backupBeforeUpdatesHint':
    'Automatically creates a backup of the worlds before mods are updated.',

  // InstanceSettings.tsx - Advanced
  'settings.advancedTitle': 'Advanced',
  'settings.advancedHint': 'Only needed for special cases like recording tools or custom start scripts.',
  'settings.envVarsLabel': 'Environment variables',
  'settings.envVarsPlaceholder': 'KEY=VALUE\nMESA_GL_VERSION_OVERRIDE=4.5',
  'settings.preLaunchLabel': 'Command before start',
  'settings.preLaunchPlaceholder': 'e.g. a script that prepares something',
  'settings.wrapperLabel': 'Wrapper command',
  'settings.wrapperPlaceholder': 'e.g. gamemoderun',
  'settings.wrapperHint':
    'Is placed in front of the Java call. The command must take over Java itself, meaning replace it via exec, and must not start it in the background. Otherwise the launcher considers the game finished as soon as the wrapper exits, and mod changes are then no longer locked.',

  // InstanceSettings.tsx - Save
  'settings.unsavedChanges': 'There are unsaved changes.',
  'settings.savedToastTitle': 'Saved',
  'settings.savedToastMessage': '{name} has been updated.',
  'settings.saveFailedToast': 'Save failed',

  // InstanceContent.tsx
  'content.resourcepackTitle': 'Resource Packs',
  'content.resourcepackSubtitle': 'Textures and sounds of the current instance',
  'content.resourcepackEmpty': 'No resource packs in this instance yet.',
  'content.shaderpackTitle': 'Shaders',
  'content.shaderpackSubtitle': 'Shaders of the current instance',
  'content.shaderpackEmpty': 'No shaders in this instance yet.',
  'content.blockedRunning': 'Minecraft is currently running.',
  'content.blockedBusy': 'The content is currently being worked on.',
  'content.noInstanceTitle': 'No instance',
  'content.noInstanceMessage': 'Create an instance first, then its content will appear here.',
  'content.emptyTitle': 'Nothing installed',
  'content.emptyMessage': '{empty} You can find and install some under "Mods".',
  'content.disabledBadge': 'Disabled',
  'content.updateBadge': 'Update',
  'content.activateFailedToast': 'Activation failed',
  'content.deactivateFailedToast': 'Deactivation failed',
  'content.projectPageAria': 'Project page',
  'content.itemRemovedToast': '{name} removed',
  'content.removeFailedToast': 'Removal failed',

  // Backups.tsx - Labels (Records)
  'backups.reasonManual': 'Manual',
  'backups.reasonAutomatic': 'Automatic',
  'backups.reasonPreUpdate': 'Before mod update',
  'backups.reasonPreRepair': 'Before repair',
  'backups.folderSaves': 'Worlds',
  'backups.folderConfig': 'Configuration',
  'backups.folderMods': 'Mods',
  'backups.folderResourcepacks': 'Resourcepacks',
  'backups.folderShaderpacks': 'Shaders',
  'backups.folderScreenshots': 'Screenshots',

  // Backups.tsx - Header
  'backups.pageTitle': 'Backups',
  'backups.subtitleCount': '{count} {word} · {size} used',
  'backups.unitOne': 'Backup',
  'backups.unitMany': 'Backups',
  'backups.subtitleEmpty': 'Back up your worlds before tinkering with mods.',
  'backups.createButton': 'Create backup',
  'backups.allInstancesOption': 'All instances',

  // Backups.tsx - List
  'backups.emptyTitle': 'No backups',
  'backups.emptyMessage':
    'A backup packs the worlds and configuration of an instance into an archive. Useful before you update mods or make bigger changes.',
  'backups.createFirstButton': 'Create first backup',
  'backups.goToInstancesButton': 'Go to instances',
  'backups.restoreButton': 'Restore',
  'backups.openFolderAria': 'Open folder',
  'backups.loadFailedToast': 'Backups could not be loaded',

  // Backups.tsx - Confirm restore
  'backups.restoreConfirmTitle': 'Restore backup?',
  'backups.folderWordOne': 'The folder',
  'backups.folderWordMany': 'The folders',
  'backups.inConnector': 'in',
  'backups.verbWordOne': 'will',
  'backups.verbWordMany': 'will',
  'backups.restoreMessageTail':
    '{verb} be replaced by the state from {date}. The current state will be backed up automatically first.',
  'backups.restoredToastTitle': 'Restored',
  'backups.restoreFailedToast': 'Restore failed',

  // Backups.tsx - Confirm delete
  'backups.deleteConfirmTitle': 'Delete backup?',
  'backups.deleteMessageTail': '({size}) will be permanently deleted.',
  'backups.deleteFailedToast': 'Delete failed',

  // Backups.tsx - Create backup (Modal)
  'backups.createdToastTitle': 'Backup created',
  'backups.createFailedToast': 'Backup failed',
  'backups.modalSubtitle': 'Choose what should be backed up.',
  'backups.instanceLabel': 'Instance',
  'backups.nameLabel': 'Name (optional)',
  'backups.namePlaceholder': 'e.g. Before the big overhaul',
  'backups.contentsLabel': 'Contents',
  'backups.contentsHint':
    'Worlds and configuration are usually enough. Including mods makes the archive noticeably bigger.',

  // Downloads.tsx
  'downloads.pageTitle': 'Downloads',
  'downloads.pageSubtitle': 'Running and recently completed operations',
  'downloads.launcherCardTitle': 'Launcher',
  'downloads.emptyTitle': 'Nothing in progress',
  'downloads.emptyMessage': 'Installations, updates and repairs appear here while they are running.',
  'downloads.runningTitle': 'Currently running',
  'downloads.recentTitle': 'Recent',
  'downloads.statusFailed': 'Failed',
  'downloads.statusCancelled': 'Cancelled',

  // News.tsx
  'news.pageTitle': 'News',
  'news.pageSubtitle': 'News about Minecraft and Launch Gabi',
  'news.emptyTitle': 'No news',
  'news.emptyMessage': 'There is currently no news. Without an internet connection this page stays empty.',

  // ReportConsent.tsx
  'reportConsent.title': 'May we see errors?',
  'reportConsent.subtitle': 'Decide once, change anytime.',
  'reportConsent.declineButton': 'No, thanks',
  'reportConsent.acceptButton': 'Yes, send errors',
  'reportConsent.intro':
    'If something goes wrong in the launcher, a short report can automatically be sent to the developers. This helps us find errors that nobody would otherwise ever report.',
  'reportConsent.sentTitle': 'What is sent',
  'reportConsent.sentItem1': 'The error message and where in the program it occurred',
  'reportConsent.sentItem2': 'Your Launch Gabi version and your operating system',
  'reportConsent.notSentTitle': 'What is not sent',
  'reportConsent.notSentItem1': 'Your Minecraft name, your UUID and your login credentials',
  'reportConsent.notSentItem2': 'Your Windows username, not even hidden in file paths',
  'reportConsent.notSentItem3': 'Your IP address is not stored',
  'reportConsent.notSentItem4': 'Nothing from your worlds, mods or screenshots',
  'reportConsent.footerHint':
    'Reports are always also saved on your machine, so you can check yourself what was sent. Found under Settings, Error reports.'
}
