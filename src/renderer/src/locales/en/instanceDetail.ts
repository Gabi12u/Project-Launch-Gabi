export default {
  // instanceDetail: translation keys for this area go here.

  // Tabs (main navigation within the instance detail page)
  'tabs.overview': 'Overview',
  'tabs.content': 'Installed',
  'tabs.browse': 'Find content',
  'tabs.worlds': 'Worlds',
  'tabs.recordings': 'Recordings',
  'tabs.logs': 'Log',
  'tabs.settings': 'Settings',

  // Header (hero section: back button, badges, play controls)
  'header.allInstances': 'All instances',
  'header.modsBadge': '{count} mods',
  'header.ramBadge': 'RAM: {value}',
  'header.updatesBadge': '{count} updates',
  'header.installingBadge': 'Setting up',
  'header.stopButton': 'STOP',
  'header.startingLabel': 'STARTING…',
  'header.playLabel': 'PLAY',

  // Action bar
  'actions.folder': 'Folder',
  'actions.desktopShortcut': 'Desktop shortcut',
  'actions.repair': 'Repair',
  'actions.exportFailed': 'Export failed',
  'actions.exportModpack': 'Export as modpack',
  'actions.backupCreatedTitle': 'Backup created',
  'actions.backupCreatedMessage': 'Worlds and configuration have been backed up.',
  'actions.backupFailed': 'Backup failed',
  'actions.backupButton': 'Back up',

  // Delete instance confirm dialog
  'dialog.deleteInstanceTitle': 'Delete instance?',
  'dialog.deleteInstanceConfirm': 'Delete permanently',
  'dialog.deleteInstanceMessage':
    'will be permanently deleted along with all mods, worlds, screenshots and backups. This cannot be undone.',

  // Top-level errors
  'errors.loadFailed': 'Instance could not be loaded',
  'errors.checkFailed': 'Check failed',
  'errors.instanceDeletedTitle': 'Instance deleted',
  'errors.deleteFailed': 'Instance could not be deleted',

  // Overview tab
  'overview.preflightTitle': 'Before you start',
  'overview.recheckButton': 'Check again',
  'overview.loaderLabel': 'Loader',
  'overview.javaLoadingValue': 'Loading',
  'overview.javaManagedHint': 'managed',
  'overview.javaSystemHint': 'system',
  'overview.javaOnDemandHint': 'on demand',
  'overview.ramLabel': 'RAM',
  'overview.ramOfHint': 'of {total}',
  'overview.modsLabel': 'Mods',
  'overview.modsInstalledHint': '{count} installed',
  'overview.resourcepacksLabel': 'Resourcepacks',
  'overview.shaderLabel': 'Shaders',
  'overview.downloadSizeLabel': 'Still to download',
  'overview.compatibilityTitle': 'Mod compatibility',
  'overview.statsTitle': 'Statistics',
  'overview.totalPlaytimeLabel': 'Total playtime',
  'overview.sessionsLabel': 'Sessions',
  'overview.lastPlayedLabel': 'Last played',
  'overview.lastSessionLabel': 'Last session',
  'overview.crashBadge': 'Crash (code {code})',

  // Content tabs (mod/resourcepack/shaderpack/datapack segmented control)
  'contentTabs.mod': 'Mods',
  'contentTabs.resourcepack': 'Resourcepacks',
  'contentTabs.shaderpack': 'Shaders',
  'contentTabs.datapack': 'Data Packs',

  // Content tab (installed content management)
  'content.updatesAvailableTitle': '{count} {word} available',
  'content.upToDateTitle': 'Everything up to date',
  'content.updatesAvailableMessage': 'You can update one at a time or all at once.',
  'content.checkUpdatesFailed': 'Update check failed',
  'content.modsUpdatedTitle': '{count} {word} updated',
  'content.updateFailed': 'Update failed',
  'content.itemUpdatedTitle': '{name} updated',
  'content.filterPlaceholder': 'Filter…',
  'content.checkUpdatesButton': 'Check for updates',
  'content.installUpdatesButton': 'Install {count} {word}',
  'content.filesAddedTitle': '{count} {word} added',
  'content.importFailed': 'Import failed',
  'content.addFileButton': 'Add file',
  'content.emptyTitle': 'Nothing installed',
  'content.emptyMessage':
    'All {type} for this instance will show up here. Use the "Find content" tab to install some.',
  'content.itemRemovedTitle': '{name} removed',
  'content.activateFailed': 'Activation failed',
  'content.deactivateFailed': 'Deactivation failed',
  'content.removeFailed': 'Removal failed',
  'content.confirmUpdateTitle': 'Update mod',
  'content.confirmUpdateMessage': 'Only update "{name}" to {version}? The current file will be removed in the process.',
  'content.confirmUpdateYes': 'Yes, update',
  'content.updateWord': 'Update',
  'content.activate': 'Activate',
  'content.deactivate': 'Deactivate',
  'content.menuUpdateToLabel': 'Update to {version}',
  'content.menuNoUpdateLabel': 'No update available',
  'content.menuAlreadyUpToDateReason': 'This entry is already up to date.',
  'content.menuChooseVersionLabel': 'Choose version…',
  'content.menuNoVersionListReason': 'This file was added by hand, there is no version list.',
  'content.menuOpenPageLabel': 'Open project page',
  'content.menuNoPageReason': 'No page is set for this entry.',
  'content.providerLocal': 'LOCAL',
  'content.projectPageAria': 'Project page',
  'content.onLabel': 'On',
  'content.offLabel': 'Off',

  // Content word forms (used with pluralise())
  'content.updateWord.one': 'update',
  'content.updateWord.many': 'updates',
  'content.modWord.one': 'mod',
  'content.modWord.many': 'mods',
  'content.fileWord.one': 'file',
  'content.fileWord.many': 'files',

  // Worlds tab
  'worlds.emptyTitle': 'No worlds yet',
  'worlds.emptyMessage':
    'As soon as you create a world in this instance, it will show up here, including its size and last save.',
  'worlds.lastPlayedLabel': 'Last: {time}',

  // Recordings tab
  'recordings.emptyTitle': 'Nothing recorded yet',
  'recordings.emptyMessage':
    'Press F2 in game for a screenshot or the recording hotkey for a video. Both will show up here.',
  'recordings.deletedTitle': 'Recording deleted',
  'recordings.deleteFailed': 'Recording could not be deleted',
  'recordings.openAria': 'Open {kind} {time}',
  'recordings.kindClip': 'recording',
  'recordings.kindShot': 'screenshot',
  'recordings.videoFallback': 'Video',
  'recordings.deleteButtonTitle': 'Delete recording',
  'recordings.confirmDeleteMessage': '{fileName} will be permanently deleted. This cannot be undone.',

  // Logs tab
  'logs.filterAll': 'All',
  'logs.filterWarnings': 'Warnings',
  'logs.filterErrors': 'Errors',
  'logs.autoScrollButton': 'Auto-scroll',
  'logs.copyButton': 'Copy log',
  'logs.clearButton': 'Clear',
  'logs.emptyMessage': 'No output yet. Start the instance to see the live log.',
  'logs.bufferHint': '{count} lines in buffer. The full log is in the instance folder under logs/latest.log.'
}
