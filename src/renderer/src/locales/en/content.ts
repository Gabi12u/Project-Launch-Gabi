export default {
  // ContentBrowser.tsx
  'type.mod': 'Mods',
  'type.resourcepack': 'Resource Packs',
  'type.shaderpack': 'Shaders',
  'type.datapack': 'Data Packs',
  'type.modpack': 'Modpacks',

  'search.placeholder': 'Search {type}…',
  'search.failed': 'Search failed',

  'sort.relevance': 'Relevance',
  'sort.downloads': 'Downloads',
  'sort.updated': 'Updated',

  'filter.onlyMatching': 'Only matching {version}',

  'results.count': '{count} results',

  'curseforge.notConnected.title': 'CurseForge is not connected',
  'curseforge.notConnected.detail':
    'CurseForge search needs a free API key. You can enter it in Settings under "Content". Modrinth works without one.',

  'empty.title': 'Nothing found',
  'empty.versionFiltered':
    'There is nothing for Minecraft {version}. Turn off the version filter to search more broadly.',
  'empty.tryOther': 'Try a different search term.',

  loadMore: 'Load more',

  'project.byAuthor': 'by {author}',
  'status.installed': 'Installed',

  'install.modpackStarted': 'Modpack is being installed',
  'install.success': '{name} installed',
  'install.withDeps': 'Including {count} dependencies.',
  'install.failed': '{name} could not be installed',

  'project.loadFailed': 'Project could not be loaded',

  'modal.openOn': 'Open on {provider}',
  'modal.installSelected': 'Install this version',
  'modal.installLatest': 'Install latest',

  'versions.heading': 'Versions',
  'versions.onlyCompatible': 'Only compatible',
  'versions.none.title': 'No matching version',
  'versions.none.detail':
    'There is no release for Minecraft {version}{loaderSuffix}. Turn off the filter to see all versions.',

  // CompatibilityPanel.tsx
  'fixed.title': 'Issue fixed',
  'fix.failed': 'The issue could not be fixed',
  'fixAll.done.one': '1 issue was fixed automatically.',
  'fixAll.done.many': '{count} issues were fixed automatically.',
  'fixAll.partial': '{done} of {total} issues fixed, then an error occurred',
  'fixAll.failed': 'Not all issues could be fixed',

  checking: 'Checking mods…',
  'allGood.title': 'Everything is fine',
  'allGood.detail': 'No conflicts, no missing dependencies.',

  'issue.singular': 'Issue',
  'issue.plural': 'Issues',
  'hint.singular': 'Note',
  'hint.plural': 'Notes',
  launchable: 'Ready to launch',

  'panel.fixAll': 'Fix all automatically',

  'gate.title': '⚠️ Issue found',
  'gate.subtitle': '{name} cannot be started like this.',
  'gate.launchAnyway': 'Start anyway',
  'gate.fixAll': 'Fix automatically',
  'gate.fixedToast.title': 'Issues fixed',
  'gate.fixedToast.detail': 'The instance can now be started.',
  'gate.fixFailed': 'Automatic repair failed',

  // VersionPicker.tsx
  'picker.title': 'Choose version: {name}',
  'picker.subtitle': 'Currently installed: {version}',
  'picker.loadFailed': 'Versions could not be loaded',
  'picker.installSuccess': '{name} {version} installed',
  'picker.installFailed': 'Version could not be changed',
  'picker.localNoVersions': 'This file was added manually, so there is no version list.',
  'picker.noVersions': 'No versions were found for this project.',
  'picker.filter.label': 'Only matching Minecraft {version}',
  'picker.filter.andLoader': 'and {loader}',
  'picker.filter.hidden': '({count} hidden)',
  'picker.noneMatch':
    'No matching version. Remove the checkmark to see all of them, but the instance may then crash.',
  'status.incompatible': 'Not compatible',
  'status.active': 'Active',
  'action.apply': 'Install',
  'picker.incompatibleTooltip':
    'Does not match this instance. Remove the checkmark above to do it anyway.'
}
