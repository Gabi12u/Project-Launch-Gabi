export default {
  // instanceSettings: hier folgen die Übersetzungsschlüssel dieses Bereichs.

  // InstanceSettings.tsx - Darstellung
  'settings.appearanceTitle': 'Darstellung',
  'settings.appearanceHint': 'Name, Icon und Farbe dieser Instanz.',
  'settings.nameLabel': 'Name',
  'settings.groupLabel': 'Gruppe',
  'settings.groupPlaceholder': 'z. B. Modded',
  'settings.descriptionLabel': 'Beschreibung',
  'settings.descriptionPlaceholder': 'Worum geht es in dieser Instanz?',
  'settings.iconLabel': 'Icon',
  'settings.customImageButton': 'Eigenes Bild',
  'settings.iconSetToast': 'Icon gesetzt',
  'settings.backgroundImageButton': 'Hintergrundbild',
  'settings.backgroundSetToast': 'Hintergrund gesetzt',
  'settings.removeBackgroundButton': 'Hintergrund entfernen',
  'settings.accentColorLabel': 'Akzentfarbe',

  // InstanceSettings.tsx - Leistung
  'settings.performanceTitle': 'Leistung',
  'settings.performanceHint': 'Arbeitsspeicher und Java-Einstellungen für diese Instanz.',
  'settings.memoryLabel': 'Arbeitsspeicher: {value}',
  'settings.memoryHint':
    'Mehr ist nicht automatisch besser. Über 8 GB bringt bei den meisten Modpacks nichts mehr und kann die Garbage Collection sogar verlangsamen.',
  'settings.javaVersionLabel': 'Java-Version',
  'settings.javaAutoOption': 'Automatisch verwalten (empfohlen)',
  'settings.javaOptionLabel': 'Java {major} · {version}',
  'settings.javaManagedSuffix': '(verwaltet)',
  'settings.javaRedetectAria': 'Neu suchen',
  'settings.javaSearchDoneToast': 'Java-Suche abgeschlossen',
  'settings.javaAutoHint':
    'Automatisch bedeutet: Launch Gabi wählt die von Mojang für {version} vorgegebene Java-Version und lädt sie bei Bedarf selbst herunter.',
  'settings.jvmArgsLabel': 'JVM-Argumente',
  'settings.jvmArgsHint':
    'Die Voreinstellung enthält bewährte G1GC-Flags für modded Minecraft. Nur ändern, wenn du weißt, was du tust.',

  // InstanceSettings.tsx - Fenster & Start
  'settings.windowTitle': 'Fenster & Start',
  'settings.fullscreenLabel': 'Vollbild starten',
  'settings.fullscreenHint': 'Minecraft startet direkt im Vollbildmodus.',
  'settings.windowWidthLabel': 'Fensterbreite',
  'settings.windowHeightLabel': 'Fensterhöhe',
  'settings.launchBehaviourLabel': 'Launcher-Verhalten beim Start',
  'settings.keepOpenOption': 'Launcher offen lassen',
  'settings.hideOption': 'Launcher ausblenden',
  'settings.minimizeOption': 'Launcher minimieren',
  'settings.backupBeforeUpdatesLabel': 'Vor Mod-Updates sichern',
  'settings.backupBeforeUpdatesHint':
    'Legt automatisch eine Sicherung der Welten an, bevor Mods aktualisiert werden.',

  // InstanceSettings.tsx - Erweitert
  'settings.advancedTitle': 'Erweitert',
  'settings.advancedHint': 'Nur nötig für Spezialfälle wie Aufnahme-Tools oder eigene Startskripte.',
  'settings.envVarsLabel': 'Umgebungsvariablen',
  'settings.envVarsPlaceholder': 'KEY=VALUE\nMESA_GL_VERSION_OVERRIDE=4.5',
  'settings.preLaunchLabel': 'Befehl vor dem Start',
  'settings.preLaunchPlaceholder': 'z. B. ein Skript, das etwas vorbereitet',
  'settings.wrapperLabel': 'Wrapper-Befehl',
  'settings.wrapperPlaceholder': 'z. B. gamemoderun',
  'settings.wrapperHint':
    'Wird dem Java-Aufruf vorangestellt. Der Befehl muss Java selbst übernehmen, also per exec ersetzen, und darf es nicht im Hintergrund starten. Sonst hält der Launcher das Spiel für beendet, sobald der Wrapper fertig ist, und Mod-Änderungen sind dann nicht mehr gesperrt.',

  // InstanceSettings.tsx - Speichern
  'settings.unsavedChanges': 'Es gibt ungespeicherte Änderungen.',
  'settings.savedToastTitle': 'Gespeichert',
  'settings.savedToastMessage': '{name} wurde aktualisiert.',
  'settings.saveFailedToast': 'Speichern fehlgeschlagen',

  // InstanceContent.tsx
  'content.resourcepackTitle': 'Resource Packs',
  'content.resourcepackSubtitle': 'Texturen und Klänge der aktuellen Instanz',
  'content.resourcepackEmpty': 'Noch keine Resource Packs in dieser Instanz.',
  'content.shaderpackTitle': 'Shader',
  'content.shaderpackSubtitle': 'Shader der aktuellen Instanz',
  'content.shaderpackEmpty': 'Noch keine Shader in dieser Instanz.',
  'content.blockedRunning': 'Minecraft läuft gerade.',
  'content.blockedBusy': 'An den Inhalten wird gerade gearbeitet.',
  'content.noInstanceTitle': 'Keine Instanz',
  'content.noInstanceMessage': 'Lege zuerst eine Instanz an, dann erscheinen hier ihre Inhalte.',
  'content.emptyTitle': 'Nichts installiert',
  'content.emptyMessage': '{empty} Über „Mods" lassen sich welche finden und installieren.',
  'content.disabledBadge': 'Deaktiviert',
  'content.updateBadge': 'Update',
  'content.activateFailedToast': 'Aktivieren fehlgeschlagen',
  'content.deactivateFailedToast': 'Deaktivieren fehlgeschlagen',
  'content.projectPageAria': 'Projektseite',
  'content.itemRemovedToast': '{name} entfernt',
  'content.removeFailedToast': 'Entfernen fehlgeschlagen',

  // Backups.tsx - Bezeichnungen (Records)
  'backups.reasonManual': 'Manuell',
  'backups.reasonAutomatic': 'Automatisch',
  'backups.reasonPreUpdate': 'Vor Mod-Update',
  'backups.reasonPreRepair': 'Vor Reparatur',
  'backups.folderSaves': 'Welten',
  'backups.folderConfig': 'Konfiguration',
  'backups.folderMods': 'Mods',
  'backups.folderResourcepacks': 'Resourcepacks',
  'backups.folderShaderpacks': 'Shader',
  'backups.folderScreenshots': 'Screenshots',

  // Backups.tsx - Kopfzeile
  'backups.pageTitle': 'Backups',
  'backups.subtitleCount': '{count} {word} · {size} belegt',
  'backups.unitOne': 'Sicherung',
  'backups.unitMany': 'Sicherungen',
  'backups.subtitleEmpty': 'Sichere deine Welten, bevor du an Mods schraubst.',
  'backups.createButton': 'Sicherung erstellen',
  'backups.allInstancesOption': 'Alle Instanzen',

  // Backups.tsx - Liste
  'backups.emptyTitle': 'Keine Sicherungen',
  'backups.emptyMessage':
    'Eine Sicherung packt Welten und Konfiguration einer Instanz in ein Archiv. Praktisch, bevor du Mods aktualisierst oder etwas Größeres umbaust.',
  'backups.createFirstButton': 'Erste Sicherung erstellen',
  'backups.goToInstancesButton': 'Zu den Instanzen',
  'backups.restoreButton': 'Wiederherstellen',
  'backups.openFolderAria': 'Ordner öffnen',
  'backups.loadFailedToast': 'Sicherungen konnten nicht geladen werden',

  // Backups.tsx - Wiederherstellen bestätigen
  'backups.restoreConfirmTitle': 'Sicherung wiederherstellen?',
  'backups.folderWordOne': 'Der Ordner',
  'backups.folderWordMany': 'Die Ordner',
  'backups.inConnector': 'in',
  'backups.verbWordOne': 'wird',
  'backups.verbWordMany': 'werden',
  'backups.restoreMessageTail':
    '{verb} durch den Stand vom {date} ersetzt. Der aktuelle Stand wird vorher automatisch gesichert.',
  'backups.restoredToastTitle': 'Wiederhergestellt',
  'backups.restoreFailedToast': 'Wiederherstellung fehlgeschlagen',

  // Backups.tsx - Löschen bestätigen
  'backups.deleteConfirmTitle': 'Sicherung löschen?',
  'backups.deleteMessageTail': '({size}) wird endgültig gelöscht.',
  'backups.deleteFailedToast': 'Löschen fehlgeschlagen',

  // Backups.tsx - Sicherung erstellen (Modal)
  'backups.createdToastTitle': 'Sicherung erstellt',
  'backups.createFailedToast': 'Sicherung fehlgeschlagen',
  'backups.modalSubtitle': 'Wähle aus, was gesichert werden soll.',
  'backups.instanceLabel': 'Instanz',
  'backups.nameLabel': 'Bezeichnung (optional)',
  'backups.namePlaceholder': 'z. B. Vor dem großen Umbau',
  'backups.contentsLabel': 'Inhalte',
  'backups.contentsHint':
    'Welten und Konfiguration reichen meist. Mods mitzusichern macht das Archiv deutlich größer.',

  // Downloads.tsx
  'downloads.pageTitle': 'Downloads',
  'downloads.pageSubtitle': 'Laufende und zuletzt abgeschlossene Vorgänge',
  'downloads.launcherCardTitle': 'Launcher',
  'downloads.emptyTitle': 'Nichts unterwegs',
  'downloads.emptyMessage': 'Installationen, Updates und Reparaturen erscheinen hier, solange sie laufen.',
  'downloads.runningTitle': 'Läuft gerade',
  'downloads.recentTitle': 'Zuletzt',
  'downloads.statusFailed': 'Fehlgeschlagen',
  'downloads.statusCancelled': 'Abgebrochen',

  // News.tsx
  'news.pageTitle': 'News',
  'news.pageSubtitle': 'Neues rund um Minecraft und Launch Gabi',
  'news.emptyTitle': 'Keine Meldungen',
  'news.emptyMessage': 'Gerade liegen keine Neuigkeiten vor. Ohne Internetverbindung bleibt diese Seite leer.',

  // ReportConsent.tsx
  'reportConsent.title': 'Dürfen wir Fehler sehen?',
  'reportConsent.subtitle': 'Einmal entscheiden, jederzeit änderbar.',
  'reportConsent.declineButton': 'Nein, danke',
  'reportConsent.acceptButton': 'Ja, Fehler senden',
  'reportConsent.intro':
    'Wenn im Launcher etwas schiefgeht, kann automatisch ein kurzer Bericht an die Entwicklung gehen. Damit finden wir Fehler, von denen sonst nie jemand erfährt.',
  'reportConsent.sentTitle': 'Was gesendet wird',
  'reportConsent.sentItem1': 'Die Fehlermeldung und wo im Programm sie aufgetreten ist',
  'reportConsent.sentItem2': 'Die Version von Launch Gabi und dein Betriebssystem',
  'reportConsent.notSentTitle': 'Was nicht gesendet wird',
  'reportConsent.notSentItem1': 'Dein Minecraft-Name, deine UUID und deine Zugangsdaten',
  'reportConsent.notSentItem2': 'Dein Windows-Benutzername, auch nicht versteckt in Dateipfaden',
  'reportConsent.notSentItem3': 'Deine IP-Adresse wird nicht gespeichert',
  'reportConsent.notSentItem4': 'Nichts aus deinen Welten, Mods oder Screenshots',
  'reportConsent.footerHint':
    'Berichte werden immer auch bei dir gespeichert, damit du selbst nachsehen kannst, was gesendet wurde. Zu finden unter Einstellungen, Fehlerberichte.'
}
