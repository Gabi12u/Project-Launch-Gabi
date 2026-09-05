export default {
  // instanceDetail: hier folgen die Übersetzungsschlüssel dieses Bereichs.

  // Tabs (main navigation within the instance detail page)
  'tabs.overview': 'Übersicht',
  'tabs.content': 'Installiert',
  'tabs.browse': 'Inhalte finden',
  'tabs.worlds': 'Welten',
  'tabs.recordings': 'Aufnahmen',
  'tabs.logs': 'Log',
  'tabs.settings': 'Einstellungen',

  // Header (hero section: back button, badges, play controls)
  'header.allInstances': 'Alle Instanzen',
  'header.modsBadge': '{count} Mods',
  'header.ramBadge': 'RAM: {value}',
  'header.updatesBadge': '{count} Updates',
  'header.installingBadge': 'Wird eingerichtet',
  'header.stopButton': 'BEENDEN',
  'header.startingLabel': 'STARTET…',
  'header.playLabel': 'PLAY',

  // Action bar
  'actions.folder': 'Ordner',
  'actions.desktopShortcut': 'Desktop-Verknüpfung',
  'actions.repair': 'Reparieren',
  'actions.exportFailed': 'Export fehlgeschlagen',
  'actions.exportModpack': 'Als Modpack exportieren',
  'actions.backupCreatedTitle': 'Sicherung erstellt',
  'actions.backupCreatedMessage': 'Welten und Konfiguration wurden gesichert.',
  'actions.backupFailed': 'Sicherung fehlgeschlagen',
  'actions.backupButton': 'Sichern',

  // Delete instance confirm dialog
  'dialog.deleteInstanceTitle': 'Instanz löschen?',
  'dialog.deleteInstanceConfirm': 'Endgültig löschen',
  'dialog.deleteInstanceMessage':
    'wird mit allen Mods, Welten, Screenshots und Sicherungen unwiderruflich gelöscht. Das lässt sich nicht rückgängig machen.',

  // Top-level errors
  'errors.loadFailed': 'Instanz konnte nicht geladen werden',
  'errors.checkFailed': 'Prüfung fehlgeschlagen',
  'errors.instanceDeletedTitle': 'Instanz gelöscht',
  'errors.deleteFailed': 'Instanz konnte nicht gelöscht werden',

  // Overview tab
  'overview.preflightTitle': 'Vor dem Start',
  'overview.recheckButton': 'Neu prüfen',
  'overview.loaderLabel': 'Loader',
  'overview.javaLoadingValue': 'Wird geladen',
  'overview.javaManagedHint': 'verwaltet',
  'overview.javaSystemHint': 'System',
  'overview.javaOnDemandHint': 'bei Bedarf',
  'overview.ramLabel': 'RAM',
  'overview.ramOfHint': 'von {total}',
  'overview.modsLabel': 'Mods',
  'overview.modsInstalledHint': '{count} installiert',
  'overview.resourcepacksLabel': 'Resourcepacks',
  'overview.shaderLabel': 'Shader',
  'overview.downloadSizeLabel': 'Noch zu laden',
  'overview.compatibilityTitle': 'Mod-Kompatibilität',
  'overview.statsTitle': 'Statistik',
  'overview.totalPlaytimeLabel': 'Gesamte Spielzeit',
  'overview.sessionsLabel': 'Sitzungen',
  'overview.lastPlayedLabel': 'Zuletzt gespielt',
  'overview.lastSessionLabel': 'Letzte Sitzung',
  'overview.crashBadge': 'Absturz (Code {code})',

  // Content tabs (mod/resourcepack/shaderpack/datapack segmented control)
  'contentTabs.mod': 'Mods',
  'contentTabs.resourcepack': 'Resourcepacks',
  'contentTabs.shaderpack': 'Shader',
  'contentTabs.datapack': 'Data Packs',

  // Content tab (installed content management)
  'content.updatesAvailableTitle': '{count} {word} verfügbar',
  'content.upToDateTitle': 'Alles aktuell',
  'content.updatesAvailableMessage': 'Du kannst einzeln oder alle auf einmal aktualisieren.',
  'content.checkUpdatesFailed': 'Update-Prüfung fehlgeschlagen',
  'content.modsUpdatedTitle': '{count} {word} aktualisiert',
  'content.updateFailed': 'Update fehlgeschlagen',
  'content.itemUpdatedTitle': '{name} aktualisiert',
  'content.filterPlaceholder': 'Filtern…',
  'content.checkUpdatesButton': 'Auf Updates prüfen',
  'content.installUpdatesButton': '{count} {word} installieren',
  'content.filesAddedTitle': '{count} {word} hinzugefügt',
  'content.importFailed': 'Import fehlgeschlagen',
  'content.addFileButton': 'Datei hinzufügen',
  'content.emptyTitle': 'Nichts installiert',
  'content.emptyMessage':
    'Hier landen alle {type} dieser Instanz. Nutze den Tab „Inhalte finden", um welche zu installieren.',
  'content.itemRemovedTitle': '{name} entfernt',
  'content.activateFailed': 'Aktivieren fehlgeschlagen',
  'content.deactivateFailed': 'Deaktivieren fehlgeschlagen',
  'content.removeFailed': 'Entfernen fehlgeschlagen',
  'content.confirmUpdateTitle': 'Mod aktualisieren',
  'content.confirmUpdateMessage': 'Nur „{name}" auf {version} aktualisieren? Die bisherige Datei wird dabei entfernt.',
  'content.confirmUpdateYes': 'Ja, aktualisieren',
  'content.updateWord': 'Update',
  'content.activate': 'Aktivieren',
  'content.deactivate': 'Deaktivieren',
  'content.menuUpdateToLabel': 'Auf {version} aktualisieren',
  'content.menuNoUpdateLabel': 'Kein Update verfügbar',
  'content.menuAlreadyUpToDateReason': 'Dieser Eintrag ist bereits aktuell.',
  'content.menuChooseVersionLabel': 'Version wählen…',
  'content.menuNoVersionListReason': 'Diese Datei wurde von Hand hinzugefügt, es gibt keine Versionsliste.',
  'content.menuOpenPageLabel': 'Projektseite öffnen',
  'content.menuNoPageReason': 'Für diesen Eintrag ist keine Seite hinterlegt.',
  'content.providerLocal': 'LOKAL',
  'content.projectPageAria': 'Projektseite',
  'content.onLabel': 'An',
  'content.offLabel': 'Aus',

  // Content word forms (used with pluralise())
  'content.updateWord.one': 'Update',
  'content.updateWord.many': 'Updates',
  'content.modWord.one': 'Mod',
  'content.modWord.many': 'Mods',
  'content.fileWord.one': 'Datei',
  'content.fileWord.many': 'Dateien',

  // Worlds tab
  'worlds.emptyTitle': 'Noch keine Welten',
  'worlds.emptyMessage':
    'Sobald du in dieser Instanz eine Welt erstellst, erscheint sie hier, inklusive Größe und letztem Spielstand.',
  'worlds.lastPlayedLabel': 'Zuletzt: {time}',

  // Recordings tab
  'recordings.emptyTitle': 'Noch nichts aufgenommen',
  'recordings.emptyMessage':
    'Drücke im Spiel F2 für einen Screenshot oder die Aufnahmetaste für ein Video. Beides taucht dann hier auf.',
  'recordings.deletedTitle': 'Aufnahme gelöscht',
  'recordings.deleteFailed': 'Aufnahme konnte nicht gelöscht werden',
  'recordings.openAria': '{kind} {time} öffnen',
  'recordings.kindClip': 'Aufnahme',
  'recordings.kindShot': 'Screenshot',
  'recordings.videoFallback': 'Video',
  'recordings.deleteButtonTitle': 'Aufnahme löschen',
  'recordings.confirmDeleteMessage': '{fileName} wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.',

  // Logs tab
  'logs.filterAll': 'Alles',
  'logs.filterWarnings': 'Warnungen',
  'logs.filterErrors': 'Fehler',
  'logs.autoScrollButton': 'Auto-Scroll',
  'logs.copyButton': 'Log kopieren',
  'logs.clearButton': 'Leeren',
  'logs.emptyMessage': 'Noch keine Ausgabe. Starte die Instanz, um das Live-Log zu sehen.',
  'logs.bufferHint': '{count} Zeilen im Puffer. Das vollständige Log liegt im Instanzordner unter logs/latest.log.'
}
