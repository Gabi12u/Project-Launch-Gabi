export default {
  'language.title': 'Language',
  'language.hint': 'The language of the interface. More languages will be added in future releases.',

  // Page header and section navigation.
  'page.title': 'Settings',
  'page.subtitle': 'Everything that applies to all instances.',
  'nav.general': 'General',
  'nav.appearance': 'Appearance',
  'nav.java': 'Java & Performance',
  'nav.content': 'Content',
  'nav.accounts': 'Accounts',
  'nav.recording': 'Recordings',
  'nav.backups': 'Backups',
  'nav.updates': 'Updates',
  'nav.changelog': "What's New",
  'nav.reports': 'Error Reports',
  'nav.advanced': 'Advanced',
  'nav.about': 'About',

  // General
  'general.start.title': 'Startup',
  'general.startMinimized.label': 'Start minimized',
  'general.startMinimized.hint': 'Launch Gabi starts in the background, without a window.',
  'general.launchBehaviour.label': 'Behaviour when the game starts',
  'general.launchBehaviour.keep': 'Keep launcher open',
  'general.launchBehaviour.hide': 'Hide launcher',
  'general.launchBehaviour.close': 'Minimize launcher',
  'general.launchBehaviour.hint': 'Used as the default; each instance can deviate from it.',
  'general.notifications.title': 'Notifications',
  'general.checkContentUpdatesOnStart.label': 'Check for mod updates on startup',
  'general.checkContentUpdatesOnStart.hint':
    'Checks all instances in the background as soon as the launcher starts.',
  'general.notifyOnUpdates.label': 'Notify about available updates',
  'general.notifyOnGameExit.label': 'Notify when Minecraft exits',
  'general.notifyOnGameExit.hint': 'Shows a short summary after every session.',
  'general.dataDirectory.title': 'Storage Location',
  'general.dataDirectory.hint':
    'This is where instances, versions, libraries and Java runtimes live.',
  'general.dataDirectory.pickerTitle': 'Choose data directory',
  'general.dataDirectory.changeButton': 'Change',
  'general.dataDirectory.openFolderAria': 'Open folder',
  'general.dataDirectory.changedToastTitle': 'Directory changed',
  'general.dataDirectory.changedToastMessage':
    'Existing data was not moved. Copy it yourself if needed.',

  // Appearance
  'appearance.navigation.title': 'Navigation',
  'appearance.navigation.hint':
    'Whether the navigation sits as a bar above the window or as a column at the side. Both show the same entries.',
  'appearance.navigation.top': 'Top',
  'appearance.navigation.side': 'Side',
  'appearance.theme.title': 'Theme',
  'appearance.theme.hint': 'Sets the background mood of the launcher.',
  'appearance.accentColor.title': 'Accent Color',
  'appearance.motion.title': 'Motion',
  'appearance.reduceMotion.label': 'Reduce animations',
  'appearance.reduceMotion.hint':
    'Turns off transitions and effects, useful on weaker hardware.',

  // Java & performance
  'java.management.title': 'Java Management',
  'java.autoManage.label': 'Manage Java automatically',
  'java.autoManage.hint':
    'Launch Gabi downloads the right Java version itself. Without this option you have to install Java manually.',
  'java.installations.title': 'Detected Installations',
  'java.installations.rescan': 'Search Again',
  'java.installations.scanDoneToast': 'Search complete',
  'java.installations.scanFailedToast': 'Java search failed',
  'java.installations.empty': 'No Java installation found yet.',
  'java.installations.entryTitle': 'Java {major}',
  'java.installations.managedBadge': 'managed',
  'java.installations.downloadButton': 'Download Java {major}',
  'java.installations.installedToast': 'Java {major} installed',
  'java.installations.installFailedToast': 'Java {major} could not be installed',
  'java.defaults.title': 'Defaults for New Instances',
  'java.defaults.memoryLabel': 'Memory: {value}',
  'java.defaults.memoryHint': 'Your system has {value} of RAM. Leave at least 2 to 4 GB for Windows.',
  'java.defaults.jvmArgsLabel': 'JVM Arguments',
  'java.downloads.title': 'Downloads',
  'java.downloads.concurrentLabel': 'Concurrent Downloads: {value}',
  'java.downloads.concurrentHint':
    'More is faster, but puts more strain on your connection and disk.',

  // Content
  'content.modManagement.title': 'Mod Management',
  'content.autoInstallDeps.label': 'Automatically install dependencies',
  'content.autoInstallDeps.hint':
    'Missing libraries such as Fabric API are installed automatically without asking.',
  'content.showSnapshots.label': 'Show snapshots in the version list',
  'content.curseforge.hint':
    'Modrinth works without signing in. For CurseForge, the platform requires its own API key, which you can create for free.',
  'content.curseforge.apiKeyPlaceholder': 'Paste API key',
  'content.curseforge.createKey': 'Create Key',
  'content.autoBackups.title': 'Automatic Backups',
  'content.autoBackups.label': 'Back up automatically',
  'content.autoBackups.hint': 'Regularly creates backups of your worlds.',
  'content.autoBackups.keepLabel': 'Number of automatic backups kept: {value}',

  // Accounts
  'accounts.title': 'Microsoft Login',
  'accounts.introBeforeDomain':
    'Launch Gabi signs in using the device code flow; your password is never entered into the launcher. By default it uses the application ID of the official Minecraft launcher, which runs through',
  'accounts.introAfterDomain':
    '. If you enter your own Azure application ID in GUID format here instead, Launch Gabi automatically switches to the Azure AD flow.',
  'accounts.clientIdPlaceholder': 'Azure Client ID',
  'accounts.tokenStorage.title': 'Where are tokens stored?',
  'accounts.tokenStorage.detail':
    "Access and refresh tokens are stored encrypted in your user profile and protected by your operating system's encryption. They leave your computer only towards Microsoft and Mojang.",

  // Recording
  'recording.inGame.title': 'Recording In-Game',
  'recording.inGame.hint':
    'One key starts the recording, the same key stops it again. You can find the finished videos on the instance under the Recordings tab, together with your screenshots.',
  'recording.enabled.label': 'Allow recordings',
  'recording.enabled.hint':
    'When this is off, the key is not bound at all and stays available to other programs.',
  'recording.hotkey.label': 'Recording Key',
  'recording.hotkey.hint':
    'The key applies system-wide, but only while an instance is running. Afterwards it is free again for other programs.',
  'recording.quality.title': 'Quality',
  'recording.quality.label': 'Video Quality',
  'recording.quality.low.label': 'Economical',
  'recording.quality.low.hint': '30 frames, small files. Easiest on your computer.',
  'recording.quality.medium.label': 'Balanced',
  'recording.quality.medium.hint': '30 frames in good quality. Costs little performance.',
  'recording.quality.high.label': 'Sharp',
  'recording.quality.high.hint':
    '60 frames. Only if your computer has headroom, otherwise the recording will stutter.',
  'recording.audio.label': 'Record audio too',
  'recording.audio.hint':
    'Records what comes out of the speakers. This does not work on every system; the recording then continues without sound.',
  'recording.maxDuration.label': 'Maximum Duration: {minutes} minutes',
  'recording.maxDuration.hint':
    'After this, the recording stops by itself. A safety net in case you forget to stop it.',
  'recording.active.title': 'Currently Running',
  'recording.active.hint': 'Recording in progress, {bytes} written so far.',
  'recording.active.stopButton': 'Stop Recording',
  'recording.tips.title': 'Good to Know',
  'recording.tips.windowOpen':
    'The launcher window must stay open. If the instance behaviour is set to close, recording is not possible.',
  'recording.tips.fullscreen':
    'In true fullscreen, Minecraft sometimes delivers no image. Borderless windowed mode always works.',
  'recording.tips.space':
    'Videos need a lot of space. The maximum duration above keeps that in check.',

  // Updates
  'updates.title': 'Launcher Updates',
  'updates.statusLoading': 'Loading status…',
  'updates.checkNow': 'Check Now',
  'updates.restartAndInstall': 'Restart & Install',
  'updates.behaviour.title': 'Behaviour',
  'updates.autoDownload.label': 'Automatically download updates',
  'updates.autoDownload.hint':
    'New versions are downloaded quietly in the background while you use the launcher.',
  'updates.autoInstall.label': 'Automatically install on startup',
  'updates.autoInstall.hint':
    'Once an update has finished downloading, it is applied the next time you open the launcher and the launcher restarts. Nothing is downloaded during this, so startup stays fast.',

  // Changelog
  'changelog.title': "What's Changed",
  'changelog.hint':
    'After every update, this shows what was added and what was fixed. Older entries remain.',
  'changelog.yourVersion': 'Your Version',

  // Error reports
  'reports.title': 'Report Errors',
  'reports.hint':
    'If something goes wrong in the launcher, the error is recorded here. On request it is also sent to the developers, so that errors nobody would otherwise hear about get noticed.',
  'reports.autoSend.label': 'Send errors automatically',
  'reports.autoSend.hintConfigured':
    'Without your name, your UUID or your login credentials. Your IP address is not stored.',
  'reports.autoSend.hintNotConfigured':
    'This version has no recipient configured, so nothing is sent. Reports are only stored on your device.',
  'reports.local.title': 'What Stays With You',
  'reports.local.hint':
    'Every report is also stored locally, regardless of whether it is sent. This way you can always look up what a report contains and pass it on yourself.',
  'reports.local.empty': 'Nothing has been recorded so far. That is the good news.',
  'reports.local.versionLabel': 'Version {version}',
  'reports.local.noDetails': 'No further details.',
  'reports.local.collapse': 'Collapse',
  'reports.local.view': 'View',
  'reports.local.copyTitle': 'Copy as text, to pass on',
  'reports.local.copiedToast': 'Report copied',
  'reports.local.clipboardUnavailable': 'Clipboard not available',
  'reports.local.openFolder': 'Open Folder',
  'reports.local.deleteAll': 'Delete All',
  'reports.local.deletedToast': 'Error reports deleted',
  'reports.local.deleteFailedToast': 'Delete failed',

  // Advanced
  'advanced.logs.title': 'Logs',
  'advanced.logs.hint':
    'If something goes wrong, you will find the launcher logs here. They contain no login credentials.',
  'advanced.logs.openButton': 'Open Log Folder',
  'advanced.reset.title': 'Reset',
  'advanced.reset.hint':
    'Resets all launcher settings to their defaults. Instances, worlds and accounts are kept.',
  'advanced.reset.button': 'Reset Settings',
  'advanced.reset.confirmTitle': 'Reset settings?',
  'advanced.reset.confirmLabel': 'Reset',
  'advanced.reset.confirmMessage':
    'All launcher settings return to their defaults. Your instances, worlds and accounts remain untouched.',
  'advanced.reset.doneToast': 'Reset complete',

  // About
  'about.version': 'Version',
  'about.platform': 'Platform',
  'about.memory': 'Memory',
  'about.disclaimer':
    'Launch Gabi is not an official product of Mojang or Microsoft. Minecraft is a trademark of Mojang AB. Mod content comes from Modrinth and CurseForge and is subject to the licenses of their respective authors.'
}
