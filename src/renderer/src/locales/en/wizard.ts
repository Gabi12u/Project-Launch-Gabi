export default {
  // Create Instance Wizard
  'createInstance.header.title': 'New Instance',
  'createInstance.header.subtitle': 'Set up your own Minecraft installation in three steps.',

  'createInstance.steps.version': 'Version',
  'createInstance.steps.loader': 'Mod Loader',
  'createInstance.steps.details': 'Details',

  'createInstance.actions.create': 'CREATE INSTANCE',

  'createInstance.toast.versionsLoadError': 'Could not load version list',
  'createInstance.toast.createdTitle': 'Instance created',
  'createInstance.toast.createdBody': '{name} is being set up in the background.',
  'createInstance.toast.createError': 'Could not create instance',

  'createInstance.version.searchPlaceholder': 'Search version, e.g. 1.21.11',
  'createInstance.version.snapshots': 'Snapshots',
  'createInstance.version.loadErrorHint':
    'The version list could not be loaded. This is usually due to the internet connection.',

  'createInstance.loader.hint':
    'The mod loader determines which mods you can install. Without a loader, Minecraft runs unmodified. Greyed-out loaders are not yet available for {version}.',
  'createInstance.loader.checkingTitle': 'Availability is still being checked…',
  'createInstance.loader.checkingInline': 'checking…',
  'createInstance.loader.alwaysAvailable': 'Always available',
  'createInstance.loader.versionCountSingular': 'version',
  'createInstance.loader.versionCountPlural': 'versions',
  'createInstance.loader.notAvailableFor': 'Not available for {version}',
  'createInstance.loader.versionLabel': 'Loader version',
  'createInstance.loader.recommended': ' · recommended',
  'createInstance.loader.stable': ' · stable',
  'createInstance.loader.beta': ' · beta',
  'createInstance.loader.recommendedHint':
    'When in doubt, go with the recommended version, it is the best tested.',

  'createInstance.details.nameLabel': 'Name',
  'createInstance.details.groupLabel': 'Group (optional)',
  'createInstance.details.groupPlaceholder': 'e.g. Modded',
  'createInstance.details.memoryLabel': 'Memory: {memory}',
  'createInstance.details.memoryHint': '2-4 GB is enough for Vanilla, more like 6-8 GB for large modpacks.',
  'createInstance.details.iconLabel': 'Icon',
  'createInstance.details.accentLabel': 'Accent color',

  // Onboarding
  'onboarding.toast.welcomeTitle': 'Welcome to Launch Gabi',
  'onboarding.toast.welcomeBody': 'Now create your first instance.',
  'onboarding.toast.setupError': 'Setup failed',

  'onboarding.welcome.title': 'Great to have you here.',
  'onboarding.welcome.description1':
    'Launch Gabi manages any number of separate Minecraft installations. Each one has its own version, its own mods and its own worlds, so nothing interferes with anything else.',
  'onboarding.welcome.description2':
    'You do not need to worry about Java, mod loader or dependencies. The launcher takes care of that in the background.',
  'onboarding.welcome.startButton': 'Start setup',

  'onboarding.appearance.title': 'How should it look?',
  'onboarding.appearance.hint': 'You can change this anytime later.',
  'onboarding.appearance.accentLabel': 'Accent color',
  'onboarding.appearance.memoryLabel': 'Default memory: {memory}',
  'onboarding.appearance.memoryHint':
    '2-4 GB is enough for Vanilla. Large modpacks run smoothest with 6-8 GB.',
  'onboarding.appearance.javaAutoTitle': 'Manage Java automatically',
  'onboarding.appearance.javaAutoDesc':
    'Launch Gabi downloads the right Java version itself, you do not need to install anything.',

  'onboarding.account.title': 'Your account',
  'onboarding.account.hint':
    'You need a Microsoft account for online servers. An offline profile is enough to try it out.',
  'onboarding.account.signedInAs': '{name} is signed in',
  'onboarding.account.multipleProfiles': '{count} profiles saved.',
  'onboarding.account.allReady': 'All set.',
  'onboarding.account.manageButton': 'Manage',
  'onboarding.account.addButton': 'Add account',
  'onboarding.account.skipHint': 'You can skip this step and sign in later anytime via the sidebar.',

  'onboarding.finishButton': 'Let\'s go',

  // Account modal
  'account.modal.title': 'Accounts',
  'account.modal.subtitle':
    'Sign in with Microsoft to play online, or use an offline profile to try it out.',

  'account.toast.loggedInTitle': 'Signed in',
  'account.toast.loggedInBody': 'Welcome, {name}!',
  'account.toast.loginError': 'Sign-in failed',
  'account.toast.offlineCreatedTitle': 'Offline profile created',
  'account.toast.offlineCreateError': 'Could not create profile',

  'account.loginMicrosoftButton': 'Sign in with Microsoft',
  'account.or': 'or',
  'account.offlineProfileLabel': 'Offline profile',
  'account.usernamePlaceholder': 'Player name',
  'account.createOfflineButton': 'Create',
  'account.offlineProfileHint':
    'Offline profiles only work on servers without online mode and in singleplayer worlds.',

  'account.type.microsoft': 'Microsoft account',
  'account.type.offline': 'Offline profile',
  'account.sessionExpired': 'Session expired',
  'account.active': 'Active',
  'account.selectButton': 'Select',

  'account.deviceCode.title': 'Signing in with Microsoft',
  'account.deviceCode.instructions':
    'Open the page, sign in with your Microsoft account and enter the code below there. It will continue automatically here afterwards.',
  'account.deviceCode.openPageButton': 'Open sign-in page',
  'account.deviceCode.copyCodeLabel': 'Copy code',
  'account.deviceCode.waiting': 'Waiting for confirmation… ({minutes}:{seconds} left)',

  // Import wizard
  'import.title.analysis': 'Review import',
  'import.title.done': 'Import finished',
  'import.title.failed': 'Import not finished',
  'import.subtitle.analyzing': 'Reading the folder…',
  'import.subtitle.importing': 'Creating the instance and copying the files…',
  'import.subtitle.done': 'The instance is set up and ready to start.',
  'import.subtitle.donePartial': 'The instance was created, but some points are still open.',
  'import.subtitle.failed': 'Nothing was broken, the original files are untouched.',
  'import.analyzing': 'Collecting what is there…',
  'import.importing': 'Taking the files over. This can take a while for large instances.',
  'import.counts.mods': 'Mods',
  'import.counts.worlds': 'Worlds',
  'import.counts.resourcePacks': 'Resource packs',
  'import.counts.shaderPacks': 'Shaders',
  'import.counts.configs': 'Configs',
  'import.create': 'Create instance',
  'import.tryAnyway': 'Import anyway',
  'import.retry': 'Try again',
  'import.blockerHint':
    'An import is still possible. Whatever was not recognised can be set by hand afterwards in the instance settings.',
  'import.doneHint': 'The original files were only read, none of them were changed or deleted.',
  'import.failedTitle': 'The import could not be finished',
  'import.failedFound': 'This was found regardless:',
  'import.check.unavailable': 'The check after the import did not complete',
  'import.check.unavailableDetail':
    'The instance was created. Whether everything is complete will show on the first start.'
}
