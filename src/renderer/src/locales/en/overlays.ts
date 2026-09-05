export default {
  // UpdateOverlay.tsx
  'update.title': 'Launcher Update',
  'update.noEvents': 'No events yet.',
  'update.log.checking': '[INFO] Checking for updates…',
  'update.log.available': '[SUCCESS] New version found: {version}',
  'update.log.downloading': '[DOWNLOAD] Downloading update…',
  'update.log.downloadProgress': '[DOWNLOAD] {percent}%',
  'update.log.ready': '[SUCCESS] Download complete',
  'update.log.installing': '[INSTALL] Installing update…',
  'update.log.upToDate': '[SUCCESS] Launch Gabi is up to date',
  'update.log.error': '[ERROR] {error}',
  'update.log.errorFallback': 'Update failed',

  // RepairOverlay.tsx
  'repair.title': 'Repair: {name}',
  'repair.preparing': 'Preparing…',
  'repair.running': 'Running…',
  'repair.someFailed': '⚠ Some problems could not be fixed automatically',
  'repair.success': '✓ Repair successful',
  'repair.noOutput': 'No output yet.',

  // LaunchOverlay.tsx
  'launch.crash.noLog': 'There is no log available from which a cause could be determined.',
  'launch.crash.outOfMemory':
    'The game ran out of memory. Allocating more memory in the instance settings might help.',
  'launch.crash.javaVersion': 'The installed Java version does not match one of the files.',
  'launch.crash.mixinFailed':
    'A mod could not hook into the game correctly. This usually points to a mod that does not match this Minecraft version.',
  'launch.crash.modDependency': 'A mod is missing a dependency, or two mods are conflicting with each other.',
  'launch.crash.modIncompatible': 'A mod is likely not compatible with this Minecraft version.',
  'launch.crash.unexpectedError': 'An unexpected error occurred. The mods in this instance could be the cause.',
  'launch.crash.unknown': 'The exact cause could not be clearly determined from the log.',
  'launch.preparing': 'Preparing…',
  'launch.repairAction': 'Check & repair mods',
  'launch.starting': 'Starting…',
  'launch.crashedBadge': 'Minecraft could not be started',
  'launch.possibleCause': 'Possible cause:',
  'launch.startedBadge': 'Minecraft started successfully.',
  'launch.noOutput': 'No output yet.',

  // UpdateGate.tsx
  'updateGate.title': 'Mods are outdated',
  'updateGate.subtitle': '{name} has {count} {outdatedMod}.',
  'updateGate.outdatedMod.one': 'outdated mod',
  'updateGate.outdatedMod.other': 'outdated mods',
  'updateGate.notNow': 'Not now',
  'updateGate.updateNow': 'Update now',
  'updateGate.updated': '{count} {mod} updated',
  'updateGate.updateFailed': 'Update failed',
  'updateGate.body':
    'There are newer versions available for {count} {mod} in this instance. You can update now, or keep playing with the current versions and update later.',

  // Shared between UpdateGate.tsx and CommandPalette.tsx
  'mod.singular': 'mod',
  'mod.plural': 'mods',

  // CommandPalette.tsx
  'palette.ariaLabel': 'Commands',
  'palette.placeholder': 'Start an instance, open a page, run an action…',
  'palette.noResults': 'No results for "{query}"',
  'palette.navigate': 'navigate',
  'palette.execute': 'run',
  'palette.close': 'close',
  'palette.stopInstance': 'Stop {name}',
  'palette.playInstance': 'Play {name}',
  'palette.group.play': 'Play',
  'palette.openInstance': 'Open {name}',
  'palette.openInstanceHint': 'Mods, worlds, settings',
  'palette.instances': 'Instances',
  'palette.newInstance': 'Create new instance',
  'palette.newInstanceHint': 'Ctrl N',
  'palette.group.actions': 'Actions',
  'palette.importModpack': 'Import modpack',
  'palette.importModpackHint': '.mrpack or .zip',
  'palette.home': 'Home',
  'palette.group.navigation': 'Navigation',
  'palette.mods': 'Mods',
  'palette.discover': 'Discover',
  'palette.backups': 'Backups',

  // TaskDock.tsx
  'taskDock.expand': 'Expand',
  'taskDock.collapse': 'Collapse',
  'taskDock.running.one': '{count} operation running',
  'taskDock.running.other': '{count} operations running',
  'taskDock.failed.one': '{count} operation failed',
  'taskDock.failed.other': '{count} operations failed',
  'taskDock.cancelled': 'Cancelled',
  'taskDock.failedBadge': 'Failed'
}
