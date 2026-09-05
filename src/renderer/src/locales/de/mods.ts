/**
 * Strings for the Mods view (src/renderer/src/views/Mods.tsx) and the
 * Discover view (src/renderer/src/views/Discover.tsx), which is embedded as
 * the "Verfügbar" tab inside Mods.
 */
export default {
  'page.title': 'Mods',
  'page.subtitle': 'Was installiert ist, und was es bei Modrinth und CurseForge zu holen gibt.',

  'tabs.installed': 'Installiert',
  'tabs.discover': 'Verfügbar',

  'unit.instance': 'Instanz',
  'unit.instances': 'Instanzen',
  'unit.update': 'Update',
  'unit.updates': 'Updates',
  'unit.mod': 'Mod',
  'unit.mods': 'Mods',
  'unit.entry': 'Eintrag',
  'unit.entries': 'Einträge',

  'toast.loadFailed': 'Mods konnten nicht geladen werden',
  'toast.checkFailedTitle': '{count} {unit} nicht prüfbar',
  'toast.checkFailedBody': '{count} {unit} in den übrigen gefunden. Fehlgeschlagen: {names}{more}',
  'toast.andMore': ' und weitere',
  'toast.updatesFoundTitle': '{count} {unit} gefunden',
  'toast.upToDateTitle': 'Alles aktuell',
  'toast.updatesFoundBody': 'Du kannst sie einzeln oder pro Instanz installieren.',
  'toast.checkError': 'Update-Prüfung fehlgeschlagen',
  'toast.updatedTitle': '{count} {unit} aktualisiert',
  'toast.skippedBusy': 'Übersprungen, weil gerade in Benutzung: {names}',
  'toast.updatedWithFailuresTitle': '{count} {unit} aktualisiert, {failedCount} fehlgeschlagen',
  'toast.updateFailedBody': 'Nicht aktualisiert: {names}{more}. Grund: {reason}',
  'toast.updateError': 'Update fehlgeschlagen',
  'toast.itemUpdated': '{name} aktualisiert',

  'actions.checkUpdates': 'Auf Updates prüfen',
  'actions.installUpdates': '{count} {unit} installieren',
  'actions.projectPage': 'Projektseite',
  'actions.openInInstance': 'In der Instanz öffnen',

  'hints.allBusy': 'Alle betroffenen Instanzen laufen gerade oder werden bearbeitet.',

  'empty.noInstances.title': 'Keine Instanzen',
  'empty.noInstances.message':
    'Sobald du eine Instanz mit Mods hast, siehst du hier alles auf einen Blick.',
  'empty.noInstances.action': 'Zu den Instanzen',
  'empty.noMods.title': 'Noch keine Mods installiert',
  'empty.noMods.message':
    'Hier sammeln sich alle Mods, Resourcepacks und Shader aus deinen Instanzen. Such dir unter „Entdecken“ etwas aus, Launch Gabi installiert Abhängigkeiten automatisch mit.',
  'empty.noMods.action': 'Mods entdecken',
  'empty.noUpdates.message': 'Für keine deiner Instanzen liegen Updates vor.',
  'empty.nothingFound.title': 'Nichts gefunden',
  'empty.nothingFound.message': 'Keine Inhalte passen zu diesem Filter.',

  'filters.searchPlaceholder': 'Mods durchsuchen…',
  'filters.allInstances': 'Alle Instanzen',
  'filters.onlyUpdates': 'Nur mit Update',

  'summary.main': '{count} {unit} über sämtliche Instanzen',
  'summary.withUpdates': ', {count} {unit} verfügbar',

  'badge.update': 'Update',
  'badge.disabled': 'Deaktiviert',
  'provider.local': 'LOKAL',

  'discover.title': 'Entdecken',
  'discover.subtitle':
    'Modpacks, Mods, Shader und Resourcepacks von Modrinth und CurseForge, alles in einer Suche.',
  'discover.targetLabel': 'Ziel-Instanz:',
  'discover.emptyNoInstance.title': 'Erst eine Instanz, dann die Mods',
  'discover.emptyNoInstance.message':
    'Mods werden immer in eine bestimmte Instanz installiert. Lege zuerst eine an. Modpacks kannst du auch ohne Instanz installieren, sie bringen ihre eigene mit.',
  'discover.emptyNoInstance.action': 'Instanz erstellen',
  'discover.targetSummary': 'Ziel: {name} · Minecraft {version} · {loader}',
  'discover.modpackHint': 'Modpacks bringen ihre eigene Instanz mit und ignorieren die Auswahl.'
}
