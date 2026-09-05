/**
 * Update-, Reparatur- und Start-Overlays, die Update-Sperre, die
 * Befehlspalette, die Task-Leiste und Toast-Benachrichtigungen. Gruppiert
 * nach Datei, in der Reihenfolge, in der sie unter components/ liegen.
 */
export default {
  // UpdateOverlay.tsx
  'update.title': 'Launcher-Update',
  'update.noEvents': 'Noch keine Ereignisse.',
  'update.log.checking': '[INFO] Suche nach Updates…',
  'update.log.available': '[SUCCESS] Neue Version gefunden: {version}',
  'update.log.downloading': '[DOWNLOAD] Lade Update herunter…',
  'update.log.downloadProgress': '[DOWNLOAD] {percent}%',
  'update.log.ready': '[SUCCESS] Download abgeschlossen',
  'update.log.installing': '[INSTALL] Installiere Update…',
  'update.log.upToDate': '[SUCCESS] Launch Gabi ist aktuell',
  'update.log.error': '[ERROR] {error}',
  'update.log.errorFallback': 'Update fehlgeschlagen',

  // RepairOverlay.tsx
  'repair.title': 'Reparatur: {name}',
  'repair.preparing': 'Wird vorbereitet…',
  'repair.running': 'Wird ausgeführt…',
  'repair.someFailed': '⚠ Einige Probleme konnten nicht automatisch behoben werden',
  'repair.success': '✓ Reparatur erfolgreich',
  'repair.noOutput': 'Noch keine Ausgabe.',

  // LaunchOverlay.tsx
  'launch.crash.noLog': 'Es liegt kein Protokoll vor, aus dem sich eine Ursache ablesen ließe.',
  'launch.crash.outOfMemory':
    'Dem Spiel ist der Arbeitsspeicher ausgegangen. Mehr zugewiesener Speicher in den Instanz-Einstellungen kann helfen.',
  'launch.crash.javaVersion': 'Die installierte Java-Version passt nicht zu einer der Dateien.',
  'launch.crash.mixinFailed':
    'Ein Mod konnte sich nicht korrekt ins Spiel einklinken. Das deutet meist auf eine Mod hin, die nicht zu dieser Minecraft-Version passt.',
  'launch.crash.modDependency': 'Einer Mod fehlt eine Abhängigkeit, oder zwei Mods stehen sich im Weg.',
  'launch.crash.modIncompatible': 'Eine Mod ist vermutlich nicht mit dieser Minecraft-Version kompatibel.',
  'launch.crash.unexpectedError':
    'Es ist ein unerwarteter Fehler aufgetreten. Die Mods dieser Instanz könnten die Ursache sein.',
  'launch.crash.unknown': 'Die genaue Ursache ließ sich aus dem Protokoll nicht eindeutig bestimmen.',
  'launch.preparing': 'Vorbereitung läuft…',
  'launch.repairAction': 'Mods prüfen & reparieren',
  'launch.starting': 'Wird gestartet…',
  'launch.crashedBadge': 'Minecraft konnte nicht gestartet werden',
  'launch.possibleCause': 'Mögliche Ursache:',
  'launch.startedBadge': 'Minecraft wurde erfolgreich gestartet.',
  'launch.noOutput': 'Noch keine Ausgabe.',

  // UpdateGate.tsx
  'updateGate.title': 'Mods sind veraltet',
  'updateGate.subtitle': '{name} hat {count} {outdatedMod}.',
  'updateGate.outdatedMod.one': 'veraltete Mod',
  'updateGate.outdatedMod.other': 'veraltete Mods',
  'updateGate.notNow': 'Nicht jetzt',
  'updateGate.updateNow': 'Jetzt updaten',
  'updateGate.updated': '{count} {mod} aktualisiert',
  'updateGate.updateFailed': 'Update fehlgeschlagen',
  'updateGate.body':
    'Es gibt neuere Versionen für {count} {mod} dieser Instanz. Du kannst jetzt aktualisieren, oder mit den bisherigen Versionen weiterspielen und später updaten.',

  // Shared between UpdateGate.tsx and CommandPalette.tsx
  'mod.singular': 'Mod',
  'mod.plural': 'Mods',

  // CommandPalette.tsx
  'palette.ariaLabel': 'Befehle',
  'palette.placeholder': 'Instanz starten, Seite öffnen, Aktion ausführen…',
  'palette.noResults': 'Nichts gefunden für „{query}“',
  'palette.navigate': 'navigieren',
  'palette.execute': 'ausführen',
  'palette.close': 'schließen',
  'palette.stopInstance': '{name} beenden',
  'palette.playInstance': '{name} spielen',
  'palette.group.play': 'Spielen',
  'palette.openInstance': '{name} öffnen',
  'palette.openInstanceHint': 'Mods, Welten, Einstellungen',
  'palette.instances': 'Instanzen',
  'palette.newInstance': 'Neue Instanz erstellen',
  'palette.newInstanceHint': 'Strg N',
  'palette.group.actions': 'Aktionen',
  'palette.importModpack': 'Modpack importieren',
  'palette.importModpackHint': '.mrpack oder .zip',
  'palette.home': 'Home',
  'palette.group.navigation': 'Navigation',
  'palette.mods': 'Mods',
  'palette.discover': 'Entdecken',
  'palette.backups': 'Backups',

  // TaskDock.tsx
  'taskDock.expand': 'Ausklappen',
  'taskDock.collapse': 'Einklappen',
  'taskDock.running.one': '{count} Vorgang läuft',
  'taskDock.running.other': '{count} Vorgänge laufen',
  'taskDock.failed.one': '{count} Vorgang fehlgeschlagen',
  'taskDock.failed.other': '{count} Vorgänge fehlgeschlagen',
  'taskDock.cancelled': 'Abgebrochen',
  'taskDock.failedBadge': 'Fehlgeschlagen'
}
