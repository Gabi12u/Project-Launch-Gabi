/**
 * Strings for the Settings view (src/renderer/src/views/Settings.tsx).
 *
 * `language.*` was seeded first because the language switch itself has to
 * work before it is worth translating everything around it.
 */
export default {
  'language.title': 'Sprache',
  'language.hint':
    'Die Sprache der Benutzeroberfläche. Weitere Sprachen kommen mit künftigen Versionen dazu.',

  // Page header and section navigation.
  'page.title': 'Einstellungen',
  'page.subtitle': 'Alles, was für alle Instanzen gilt.',
  'nav.general': 'Allgemein',
  'nav.appearance': 'Darstellung',
  'nav.java': 'Java & Leistung',
  'nav.content': 'Inhalte',
  'nav.accounts': 'Accounts',
  'nav.recording': 'Aufnahmen',
  'nav.backups': 'Sicherungen',
  'nav.updates': 'Updates',
  'nav.changelog': 'Neuerungen',
  'nav.reports': 'Fehlerberichte',
  'nav.advanced': 'Erweitert',
  'nav.about': 'Über',

  // General
  'general.start.title': 'Start',
  'general.startMinimized.label': 'Minimiert starten',
  'general.startMinimized.hint': 'Launch Gabi startet im Hintergrund, ohne Fenster.',
  'general.launchBehaviour.label': 'Verhalten beim Spielstart',
  'general.launchBehaviour.keep': 'Launcher offen lassen',
  'general.launchBehaviour.hide': 'Launcher ausblenden',
  'general.launchBehaviour.close': 'Launcher minimieren',
  'general.launchBehaviour.hint': 'Gilt als Voreinstellung; jede Instanz kann davon abweichen.',
  'general.notifications.title': 'Benachrichtigungen',
  'general.checkContentUpdatesOnStart.label': 'Beim Start auf Mod-Updates prüfen',
  'general.checkContentUpdatesOnStart.hint':
    'Prüft im Hintergrund alle Instanzen, sobald der Launcher startet.',
  'general.notifyOnUpdates.label': 'Über verfügbare Updates informieren',
  'general.notifyOnGameExit.label': 'Melden, wenn Minecraft beendet wird',
  'general.notifyOnGameExit.hint': 'Zeigt nach jeder Sitzung eine kurze Zusammenfassung.',
  'general.dataDirectory.title': 'Speicherort',
  'general.dataDirectory.hint':
    'Hier liegen Instanzen, Versionen, Bibliotheken und Java-Laufzeiten.',
  'general.dataDirectory.pickerTitle': 'Datenverzeichnis wählen',
  'general.dataDirectory.changeButton': 'Ändern',
  'general.dataDirectory.openFolderAria': 'Ordner öffnen',
  'general.dataDirectory.changedToastTitle': 'Verzeichnis geändert',
  'general.dataDirectory.changedToastMessage':
    'Vorhandene Daten wurden nicht verschoben. Kopiere sie bei Bedarf selbst.',

  // Appearance
  'appearance.navigation.title': 'Navigation',
  'appearance.navigation.hint':
    'Ob die Navigation als Leiste über dem Fenster liegt oder als Spalte an der Seite. Beide zeigen dieselben Einträge.',
  'appearance.navigation.top': 'Oben',
  'appearance.navigation.side': 'Seitlich',
  'appearance.theme.title': 'Theme',
  'appearance.theme.hint': 'Bestimmt die Hintergrundstimmung des Launchers.',
  'appearance.accentColor.title': 'Akzentfarbe',
  'appearance.motion.title': 'Bewegung',
  'appearance.reduceMotion.label': 'Animationen reduzieren',
  'appearance.reduceMotion.hint':
    'Schaltet Übergänge und Effekte ab, hilfreich auf schwächerer Hardware.',

  // Java & performance
  'java.management.title': 'Java-Verwaltung',
  'java.autoManage.label': 'Java automatisch verwalten',
  'java.autoManage.hint':
    'Launch Gabi lädt die passende Java-Version selbst herunter. Ohne diese Option musst du Java manuell installieren.',
  'java.installations.title': 'Gefundene Installationen',
  'java.installations.rescan': 'Neu suchen',
  'java.installations.scanDoneToast': 'Suche abgeschlossen',
  'java.installations.scanFailedToast': 'Java-Suche fehlgeschlagen',
  'java.installations.empty': 'Noch keine Java-Installation gefunden.',
  'java.installations.entryTitle': 'Java {major}',
  'java.installations.managedBadge': 'verwaltet',
  'java.installations.downloadButton': 'Java {major} laden',
  'java.installations.installedToast': 'Java {major} installiert',
  'java.installations.installFailedToast': 'Java {major} konnte nicht installiert werden',
  'java.defaults.title': 'Standardwerte für neue Instanzen',
  'java.defaults.memoryLabel': 'Arbeitsspeicher: {value}',
  'java.defaults.memoryHint':
    'Dein System hat {value} RAM. Lass mindestens 2-4 GB für Windows übrig.',
  'java.defaults.jvmArgsLabel': 'JVM-Argumente',
  'java.downloads.title': 'Downloads',
  'java.downloads.concurrentLabel': 'Gleichzeitige Downloads: {value}',
  'java.downloads.concurrentHint':
    'Mehr ist schneller, belastet aber Verbindung und Festplatte stärker.',

  // Content
  'content.modManagement.title': 'Mod-Verwaltung',
  'content.autoInstallDeps.label': 'Abhängigkeiten automatisch installieren',
  'content.autoInstallDeps.hint':
    'Fehlende Bibliotheken wie Fabric API werden ohne Nachfrage mitinstalliert.',
  'content.showSnapshots.label': 'Snapshots in der Versionsliste zeigen',
  'content.curseforge.hint':
    'Modrinth funktioniert ohne Anmeldung. Für CurseForge verlangt die Plattform einen eigenen API-Schlüssel, den du kostenlos erstellen kannst.',
  'content.curseforge.apiKeyPlaceholder': 'API-Schlüssel einfügen',
  'content.curseforge.createKey': 'Schlüssel erstellen',
  'content.autoBackups.title': 'Automatische Sicherungen',
  'content.autoBackups.label': 'Automatisch sichern',
  'content.autoBackups.hint': 'Legt regelmäßig Sicherungen der Welten an.',
  'content.autoBackups.keepLabel': 'Anzahl aufbewahrter automatischer Sicherungen: {value}',

  // Accounts
  'accounts.title': 'Microsoft-Anmeldung',
  'accounts.introBeforeDomain':
    'Launch Gabi meldet sich über den Geräte-Code-Ablauf an, dein Passwort wird nie im Launcher eingegeben. Voreingestellt ist die Anwendungs-ID des offiziellen Minecraft-Launchers, die über',
  'accounts.introAfterDomain':
    ' läuft. Trägst du hier stattdessen eine eigene Azure-Anwendungs-ID im GUID-Format ein, wechselt Launch Gabi automatisch auf den Azure-AD-Ablauf.',
  'accounts.clientIdPlaceholder': 'Azure Client-ID',
  'accounts.tokenStorage.title': 'Wo werden Tokens gespeichert?',
  'accounts.tokenStorage.detail':
    'Zugriffs- und Aktualisierungstoken liegen verschlüsselt in deinem Benutzerprofil und werden über die Verschlüsselung des Betriebssystems geschützt. Sie verlassen deinen Rechner nur Richtung Microsoft und Mojang.',

  // Recording
  'recording.inGame.title': 'Aufnehmen im Spiel',
  'recording.inGame.hint':
    'Eine Taste startet die Aufnahme, dieselbe Taste beendet sie wieder. Die fertigen Videos findest du bei der Instanz im Reiter Aufnahmen, zusammen mit deinen Screenshots.',
  'recording.enabled.label': 'Aufnahmen erlauben',
  'recording.enabled.hint':
    'Ist das aus, wird die Taste gar nicht erst belegt und steht anderen Programmen zur Verfügung.',
  'recording.hotkey.label': 'Aufnahmetaste',
  'recording.hotkey.hint':
    'Die Taste gilt systemweit, aber nur solange eine Instanz läuft. Danach ist sie wieder frei für andere Programme.',
  'recording.quality.title': 'Qualität',
  'recording.quality.label': 'Bildqualität',
  'recording.quality.low.label': 'Sparsam',
  'recording.quality.low.hint': '30 Bilder, kleine Dateien. Schont den Rechner am meisten.',
  'recording.quality.medium.label': 'Ausgewogen',
  'recording.quality.medium.hint': '30 Bilder in guter Qualität. Kostet wenig Leistung.',
  'recording.quality.high.label': 'Scharf',
  'recording.quality.high.hint':
    '60 Bilder. Nur wenn dein Rechner Luft hat, sonst ruckelt die Aufnahme.',
  'recording.audio.label': 'Ton mit aufnehmen',
  'recording.audio.hint':
    'Nimmt auf, was aus den Lautsprechern kommt. Klappt nicht auf jedem System, dann läuft die Aufnahme ohne Ton weiter.',
  'recording.maxDuration.label': 'Höchstdauer: {minutes} Minuten',
  'recording.maxDuration.hint':
    'Danach hört die Aufnahme von selbst auf. Die Bremse für den Fall, dass du das Beenden vergisst.',
  'recording.active.title': 'Läuft gerade',
  'recording.active.hint': 'Es wird aufgenommen, bereits {bytes} geschrieben.',
  'recording.active.stopButton': 'Aufnahme beenden',
  'recording.tips.title': 'Gut zu wissen',
  'recording.tips.windowOpen':
    'Das Launcher-Fenster muss offen bleiben. Steht bei der Instanz das Verhalten auf Schließen, kann nicht aufgenommen werden.',
  'recording.tips.fullscreen':
    'Im echten Vollbild liefert Minecraft manchmal kein Bild. Der randlose Fenstermodus funktioniert immer.',
  'recording.tips.space': 'Videos brauchen viel Platz. Die Höchstdauer oben hält das im Rahmen.',

  // Updates
  'updates.title': 'Launcher-Updates',
  'updates.statusLoading': 'Status wird geladen…',
  'updates.checkNow': 'Jetzt suchen',
  'updates.restartAndInstall': 'Neu starten & installieren',
  'updates.behaviour.title': 'Verhalten',
  'updates.autoDownload.label': 'Updates automatisch herunterladen',
  'updates.autoDownload.hint':
    'Neue Versionen werden still im Hintergrund geladen, während du den Launcher benutzt.',
  'updates.autoInstall.label': 'Beim Start automatisch installieren',
  'updates.autoInstall.hint':
    'Ist ein Update fertig geladen, wird es beim nächsten Öffnen eingespielt und der Launcher startet neu. Es wird dabei nichts heruntergeladen, der Start bleibt schnell.',

  // Changelog
  'changelog.title': 'Was sich geändert hat',
  'changelog.hint':
    'Nach jedem Update steht hier, was dazugekommen ist und was repariert wurde. Ältere Einträge bleiben stehen.',
  'changelog.yourVersion': 'Deine Version',

  // Error reports
  'reports.title': 'Fehler melden',
  'reports.hint':
    'Geht im Launcher etwas schief, wird der Fehler hier festgehalten. Auf Wunsch geht er zusätzlich an die Entwicklung, damit Fehler auffallen, von denen sonst niemand erfährt.',
  'reports.autoSend.label': 'Fehler automatisch senden',
  'reports.autoSend.hintConfigured':
    'Ohne deinen Namen, deine UUID und deine Zugangsdaten. Deine IP-Adresse wird nicht gespeichert.',
  'reports.autoSend.hintNotConfigured':
    'In dieser Version ist kein Empfänger hinterlegt, es wird nichts gesendet. Berichte werden nur bei dir gespeichert.',
  'reports.local.title': 'Was bei dir liegt',
  'reports.local.hint':
    'Jeder Bericht wird auch lokal abgelegt, unabhängig davon, ob gesendet wird. So kannst du jederzeit nachlesen, was ein Bericht enthält, und ihn selbst weitergeben.',
  'reports.local.empty': 'Bisher wurde nichts festgehalten. Das ist die gute Nachricht.',
  'reports.local.versionLabel': 'Version {version}',
  'reports.local.noDetails': 'Keine weiteren Angaben.',
  'reports.local.collapse': 'Zuklappen',
  'reports.local.view': 'Ansehen',
  'reports.local.copyTitle': 'Als Text kopieren, zum Weitergeben',
  'reports.local.copiedToast': 'Bericht kopiert',
  'reports.local.clipboardUnavailable': 'Zwischenablage nicht verfügbar',
  'reports.local.openFolder': 'Ordner öffnen',
  'reports.local.deleteAll': 'Alle löschen',
  'reports.local.deletedToast': 'Fehlerberichte gelöscht',
  'reports.local.deleteFailedToast': 'Löschen fehlgeschlagen',

  // Advanced
  'advanced.logs.title': 'Protokolle',
  'advanced.logs.hint':
    'Bei Problemen findest du hier die Launcher-Logs. Sie enthalten keine Zugangsdaten.',
  'advanced.logs.openButton': 'Log-Ordner öffnen',
  'advanced.reset.title': 'Zurücksetzen',
  'advanced.reset.hint':
    'Setzt alle Launcher-Einstellungen auf die Voreinstellung zurück. Instanzen, Welten und Accounts bleiben erhalten.',
  'advanced.reset.button': 'Einstellungen zurücksetzen',
  'advanced.reset.confirmTitle': 'Einstellungen zurücksetzen?',
  'advanced.reset.confirmLabel': 'Zurücksetzen',
  'advanced.reset.confirmMessage':
    'Alle Launcher-Einstellungen kehren zur Voreinstellung zurück. Deine Instanzen, Welten und Accounts bleiben unangetastet.',
  'advanced.reset.doneToast': 'Zurückgesetzt',

  // About
  'about.version': 'Version',
  'about.platform': 'Plattform',
  'about.memory': 'Arbeitsspeicher',
  'about.disclaimer':
    'Launch Gabi ist kein offizielles Produkt von Mojang oder Microsoft. Minecraft ist eine Marke von Mojang AB. Mod-Inhalte stammen von Modrinth und CurseForge und unterliegen den Lizenzen der jeweiligen Autoren.'
}
