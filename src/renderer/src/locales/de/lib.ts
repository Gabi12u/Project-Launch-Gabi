/**
 * Strings for the non-view helpers under src/renderer/src/lib/ — format.ts,
 * actions.ts, store.ts, hooks.ts. Seeded first with format.ts, since
 * updateHeadline() and greeting() are shared by several views and had to
 * exist before those views could be translated.
 */
export default {
  'update.checking': 'Suche nach Updates…',
  'update.available': 'Version {version} verfügbar',
  'update.downloading': 'Wird geladen… {percent}%',
  'update.ready': 'Version {version} ist bereit',
  'update.installing': 'Version {version} wird installiert, der Launcher startet gleich neu…',
  'update.upToDate': 'Launch Gabi ist aktuell',
  'update.error': 'Update-Prüfung fehlgeschlagen',
  'update.disabled': 'Updates nur in der installierten Version',
  'update.current': 'Version {version}',

  'greeting.night': 'Gute Nacht',
  'greeting.morning': 'Guten Morgen',
  'greeting.day': 'Guten Tag',
  'greeting.evening': 'Guten Abend',

  'contentBlocked.running': 'Nicht möglich, solange Minecraft läuft.',
  'contentBlocked.starting': 'Nicht möglich, die Instanz wird gerade gestartet.',
  'contentBlocked.busy': 'An den Mods wird gerade gearbeitet. Warte, bis das fertig ist.',

  'action.repairDoneTitle': 'Reparatur abgeschlossen',
  'action.repairSummary': '{checked} {checkedLabel} geprüft, {repaired} erneuert',
  'action.repairSummaryFailedSuffix': ', {failed} {failedLabel} fehlgeschlagen',
  'action.repairFile': 'Datei',
  'action.repairFiles': 'Dateien',
  'action.repairStep': 'Schritt',
  'action.repairSteps': 'Schritte',
  'action.repairFailed': 'Reparatur fehlgeschlagen',
  'action.noAccountTitle': 'Kein Account',
  'action.noAccountMessage': 'Melde dich zuerst mit Microsoft an oder lege ein Offline-Profil an.',
  'action.cannotStartTitle': '{name} kann nicht starten',
  'action.modsProblemMessage': 'Es gibt Probleme mit den Mods. Schließe den offenen Hinweis, dann zeigen wir sie dir.',
  'action.outdatedModsMessage': 'Es gibt veraltete Mods bei einer anderen Instanz. Schließe den offenen Hinweis, dann zeigen wir sie dir.',
  'action.startFailed': '{name} konnte nicht gestartet werden',
  'action.stopFailed': 'Minecraft konnte nicht beendet werden',
  'action.shortcutFailed': 'Verknüpfung konnte nicht erstellt werden',
  'action.importStartedTitle': 'Import gestartet',
  'action.modpackImportMessage': '{name} wird eingerichtet.',
  'action.modpackImportFailed': 'Modpack konnte nicht importiert werden',
  'action.folderImportMessage': '{name} wird übernommen. Welten, Mods und Einstellungen werden kopiert.',
  'action.folderImportFailed': 'Ordner konnte nicht importiert werden',
  'action.genericError': 'Es ist ein Fehler aufgetreten',
  'action.instancesLoadFailed': 'Instanzen konnten nicht geladen werden',
  'action.accountsLoadFailed': 'Accounts konnten nicht geladen werden',
  'action.settingsSaveFailed': 'Einstellung konnte nicht gespeichert werden'
}
