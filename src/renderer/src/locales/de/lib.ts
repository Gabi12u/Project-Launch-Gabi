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
  'contentBlocked.busy': 'An den Mods wird gerade gearbeitet. Warte, bis das fertig ist.'
}
