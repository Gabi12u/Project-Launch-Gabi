/**
 * Strings for the mod/content browser, the compatibility check and the
 * version picker (src/renderer/src/components/ContentBrowser.tsx,
 * CompatibilityPanel.tsx, VersionPicker.tsx).
 */
export default {
  // ContentBrowser.tsx
  'type.mod': 'Mods',
  'type.resourcepack': 'Resourcepacks',
  'type.shaderpack': 'Shader',
  'type.datapack': 'Data Packs',
  'type.modpack': 'Modpacks',

  'search.placeholder': '{type} durchsuchen…',
  'search.failed': 'Suche fehlgeschlagen',

  'sort.relevance': 'Relevanz',
  'sort.downloads': 'Downloads',
  'sort.updated': 'Aktualisiert',

  'filter.onlyMatching': 'Nur passend für {version}',

  'results.count': '{count} Treffer',

  'curseforge.notConnected.title': 'CurseForge ist nicht verbunden',
  'curseforge.notConnected.detail':
    'Für die CurseForge-Suche wird ein kostenloser API-Schlüssel benötigt. Du kannst ihn in den Einstellungen unter „Inhalte“ eintragen. Modrinth funktioniert auch ohne.',

  'empty.title': 'Nichts gefunden',
  'empty.versionFiltered':
    'Für Minecraft {version} gibt es dazu nichts. Schalte den Versionsfilter aus, um breiter zu suchen.',
  'empty.tryOther': 'Versuche einen anderen Suchbegriff.',

  loadMore: 'Mehr laden',

  'project.byAuthor': 'von {author}',
  'status.installed': 'Installiert',

  'install.modpackStarted': 'Modpack wird installiert',
  'install.success': '{name} installiert',
  'install.withDeps': 'Inklusive {count} Abhängigkeiten.',
  'install.failed': '{name} konnte nicht installiert werden',

  'project.loadFailed': 'Projekt konnte nicht geladen werden',

  'modal.openOn': 'Auf {provider} öffnen',
  'modal.installSelected': 'Diese Version installieren',
  'modal.installLatest': 'Neueste installieren',

  'versions.heading': 'Versionen',
  'versions.onlyCompatible': 'Nur kompatible',
  'versions.none.title': 'Keine passende Version',
  'versions.none.detail':
    'Für Minecraft {version}{loaderSuffix} gibt es keine Veröffentlichung. Schalte den Filter aus, um alle Versionen zu sehen.',

  // CompatibilityPanel.tsx
  'fixed.title': 'Problem behoben',
  'fix.failed': 'Das Problem konnte nicht behoben werden',
  'fixAll.done.one': '1 Problem wurde automatisch behoben.',
  'fixAll.done.many': '{count} Probleme wurden automatisch behoben.',
  'fixAll.partial': '{done} von {total} Problemen behoben, dann trat ein Fehler auf',
  'fixAll.failed': 'Nicht alle Probleme konnten behoben werden',

  checking: 'Mods werden geprüft…',
  'allGood.title': 'Alles in Ordnung',
  'allGood.detail': 'Keine Konflikte, keine fehlenden Abhängigkeiten.',

  'issue.singular': 'Problem',
  'issue.plural': 'Probleme',
  'hint.singular': 'Hinweis',
  'hint.plural': 'Hinweise',
  launchable: 'Start möglich',

  'panel.fixAll': 'Alle automatisch beheben',

  'gate.title': '⚠️ Problem gefunden',
  'gate.subtitle': '{name} kann so nicht gestartet werden.',
  'gate.launchAnyway': 'Trotzdem starten',
  'gate.fixAll': 'Automatisch beheben',
  'gate.fixedToast.title': 'Probleme behoben',
  'gate.fixedToast.detail': 'Die Instanz kann jetzt gestartet werden.',
  'gate.fixFailed': 'Automatische Reparatur fehlgeschlagen',

  // VersionPicker.tsx
  'picker.title': 'Version wählen: {name}',
  'picker.subtitle': 'Aktuell installiert: {version}',
  'picker.loadFailed': 'Versionen konnten nicht geladen werden',
  'picker.installSuccess': '{name} {version} installiert',
  'picker.installFailed': 'Version konnte nicht gewechselt werden',
  'picker.localNoVersions':
    'Diese Datei wurde von Hand hinzugefügt, es gibt daher keine Versionsliste.',
  'picker.noVersions': 'Für dieses Projekt wurden keine Versionen gefunden.',
  'picker.filter.label': 'Nur passende zu Minecraft {version}',
  'picker.filter.andLoader': 'und {loader}',
  'picker.filter.hidden': '({count} ausgeblendet)',
  'picker.noneMatch':
    'Keine passende Version. Nimm den Haken heraus, um alle zu sehen, dann kann die Instanz aber abstürzen.',
  'status.incompatible': 'Passt nicht',
  'status.active': 'Aktiv',
  'action.apply': 'Einsetzen',
  'picker.incompatibleTooltip':
    'Passt nicht zu dieser Instanz. Nimm den Haken oben heraus, um es trotzdem zu tun.'
}
