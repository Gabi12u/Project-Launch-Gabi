/**
 * Problems that are known but not yet out of the world.
 *
 * The counterpart to the changelog: that one says what is done, this one says
 * what is not. Both exist so a user can find out what is going on without
 * asking, and so nobody has to guess whether a fault they hit is already known.
 *
 * Two rules, and they are the whole point of the file:
 *
 *   1. Nothing goes in here that has not actually been observed. A guess
 *      presented as a known problem is worse than saying nothing at all.
 *   2. An entry leaves only when it is genuinely resolved, not when it becomes
 *      inconvenient. `fixed` is a real state with a version attached, so
 *      "behoben" can be checked rather than believed.
 */

export type IssueState = 'investigating' | 'fixing' | 'fixed' | 'limitation'

export interface KnownIssue {
  id: string
  title: string
  /** Plain language, for someone who is not going to read a stack trace. */
  detail: string
  state: IssueState
  /** ISO date the problem was first noticed. */
  since: string
  /** Empty means it affects every system. */
  platforms?: ('Windows' | 'macOS' | 'Linux')[]
  /** For `fixed`: the version that carries the fix. */
  fixedIn?: string
}

export const ISSUE_STATE_LABEL: Record<IssueState, string> = {
  investigating: 'Wird untersucht',
  fixing: 'Wird behoben',
  fixed: 'Behoben',
  limitation: 'Bekannte Grenze'
}

export const KNOWN_ISSUES: KnownIssue[] = [
  {
    id: 'launcher-schwarz-bei-spielstart',
    title: 'Launcher wird beim Spielstart komplett schwarz und reagiert nicht mehr',
    detail:
      'Startet man Minecraft aus dem Launcher heraus, wird das Launcher-Fenster vollständig schwarz ' +
      'und lässt sich danach nicht mehr bedienen. Die Ursache ist noch nicht gefunden.',
    state: 'investigating',
    since: '2026-09-02'
  },
  {
    id: 'login-http-400',
    title: 'Anmeldung endet mit Fehler 400',
    detail:
      'Bei einzelnen Konten bricht die Microsoft-Anmeldung ganz am Ende mit einem Fehler 400 ab. ' +
      'Die Ursache ist noch nicht gefunden: mehrere Verdachtsfälle wurden geprüft und haben sich ' +
      'als falsch herausgestellt oder betrafen nur einen anderen, inzwischen behobenen Fall. Seit ' +
      'Version 1.0.11 wird ein solcher Fehlschlag protokolliert, vorher verschwand er spurlos. Seit ' +
      '1.0.14 liest der Launcher an der Stelle, an der der Fehler vermutlich auftritt, auch aus, was ' +
      'Microsoft selbst als Grund nennt, statt nur die nichtssagende Zahl 400 zu zeigen. Tritt der ' +
      'Fehler erneut auf, sollte die Meldung jetzt mehr verraten. Wer das erlebt, hilft uns mit einem ' +
      'Screenshot sehr weiter.',
    state: 'investigating',
    since: '2026-08-25'
  },
  {
    id: 'anmeldung-falsches-system',
    title: 'Anmeldung konnte nach einer geänderten Einstellung dauerhaft scheitern',
    detail:
      'Beim Erneuern der Anmeldung im Hintergrund nutzte der Launcher die Anwendungs-ID, die gerade ' +
      'in den Einstellungen steht, nicht die, mit der sich das Konto ursprünglich angemeldet hatte. ' +
      'Wurde diese Einstellung geändert oder über "Einstellungen zurücksetzen" zurückgesetzt, ging ' +
      'jede weitere Erneuerung an das falsche System und scheiterte von da an immer mit Fehler 400, ' +
      'nur bei diesem einen Konto und ohne ersichtlichen Grund.',
    state: 'fixed',
    since: '2026-09-01',
    fixedIn: '1.0.14'
  },
  {
    id: 'vorstart-befehl-haengt',
    title: 'Ein hängender Vorstart-Befehl blockierte die Instanz dauerhaft',
    detail:
      'Wer in den Einstellungen einen eigenen Befehl vor dem Spielstart hinterlegt, dessen Instanz ' +
      'blieb auf unbestimmte Zeit auf "startet gerade" stehen, falls dieser Befehl selbst hängen ' +
      'blieb, etwa weil er auf eine Netzwerkantwort wartete. Weder eine Zeitgrenze noch der ' +
      'Abbrechen-Knopf griffen dabei, und die Instanz ließ sich bis zum Neustart des Launchers weder ' +
      'starten noch reparieren noch an ihren Mods ändern.',
    state: 'fixed',
    since: '2026-09-01',
    fixedIn: '1.0.14'
  },
  {
    id: 'fehlerbericht-datenschutz-luecken',
    title: 'Einzelne Daten in Fehlerberichten wurden nicht zuverlässig entfernt',
    detail:
      'Beim Säubern eines Fehlerberichts vor dem Versenden fehlte eine Regel gegen IP-Adressen, ' +
      'obwohl der Zustimmungsdialog genau das verspricht. Dazu blieb ein Windows-Benutzername mit ' +
      'Umlaut oder ähnlichen Zeichen am Rand unerkannt, eine E-Mail-Adresse konnte durch die ' +
      'Reihenfolge der Regeln unvollständig entfernt werden statt ganz zu verschwinden, und ein ' +
      'großgeschriebener Pfad wie C:\\USERS\\... rutschte durch.',
    state: 'fixed',
    since: '2026-09-01',
    fixedIn: '1.0.14'
  },
  {
    id: 'wiederherstellung-riskant',
    title: 'Wiederherstellen einer Sicherung kann Daten verlieren',
    detail:
      'Vor dem Einspielen schiebt der Launcher den bestehenden Stand zur Seite und holt ihn zurück, ' +
      'falls das Entpacken scheitert. Scheitert dabei das Zurückholen selbst, etwa weil Windows einen ' +
      'Ordner noch belegt, wurde der beiseitegelegte Stand trotzdem gelöscht und die Meldung behauptete, ' +
      'alles sei zurückgeholt. Dazu ließ sich das Spiel während einer Wiederherstellung starten, mitten ' +
      'in einen halb entpackten Weltordner hinein, und der Abbrechen-Knopf blieb wirkungslos. ' +
      'Unmittelbar vor jeder Wiederherstellung wird weiterhin automatisch eine vollständige Sicherung ' +
      'des Vorzustands angelegt.',
    state: 'fixed',
    since: '2026-08-31',
    fixedIn: '1.0.14'
  },
  {
    id: 'instanz-startet-nie-wieder',
    title: 'Eine Instanz lässt sich plötzlich nicht mehr starten',
    detail:
      'Bricht die Vorbereitung eines Starts sehr früh ab, blieb die Markierung "startet gerade" stehen. ' +
      'Danach ließ sich diese Instanz weder starten noch ihre Mods ändern, ohne erkennbaren Grund und ' +
      'ohne Fehlermeldung, bis der Launcher neu gestartet wurde. Weil interne Kennungen gelöschter ' +
      'Instanzen später erneut vergeben werden, konnte eine neu angelegte Instanz das Problem erben.',
    state: 'fixed',
    since: '2026-08-31',
    fixedIn: '1.0.14'
  },
  {
    id: 'reparatur-verwirft-mods',
    title: 'Die Reparatur kann frisch installierte Mods verwerfen',
    detail:
      'Die Reparaturfunktion merkt sich die Modliste zu Beginn und schreibt sie am Ende vollständig ' +
      'zurück. Wurde währenddessen ein Mod installiert oder aktualisiert, und das dauert bei großen ' +
      'Downloads durchaus Minuten, verschwand dessen Eintrag wieder. Die Datei blieb liegen und wurde ' +
      'später als unbekannter lokaler Mod ohne Herkunft und Version neu erfasst.',
    state: 'fixed',
    since: '2026-08-31',
    fixedIn: '1.0.14'
  },
  {
    id: 'aufnahme-abgeschnitten',
    title: 'Aufnahmen können am Ende abgeschnitten werden',
    detail:
      'Wird der Launcher geschlossen, während eine Aufnahme läuft, konnte er sich beenden, bevor die ' +
      'Datei fertig geschrieben war. Das letzte Stück fehlte dann, und weil das Fenster bereits zu war, ' +
      'ohne jede Meldung. Läuft die Festplatte während einer Aufnahme voll, blieb die Aufnahme zudem ' +
      'hängen, statt sauber abzubrechen.',
    state: 'fixed',
    since: '2026-08-31',
    fixedIn: '1.0.14'
  },
  {
    id: 'instanz-loeschen-waehrend-arbeit',
    title: 'Löschen während Start oder Mod-Arbeit war möglich',
    detail:
      'Das Löschen einer Instanz prüfte nur, ob das Spiel bereits läuft. Ein gerade laufender Start oder ' +
      'eine laufende Mod-Installation hielten es nicht auf, sodass Ordner verschwanden, während noch ' +
      'hineingeschrieben wurde.',
    state: 'fixed',
    since: '2026-08-31',
    fixedIn: '1.0.14'
  },
  {
    id: 'update-hinweis-einmalig',
    title: 'Der Hinweis auf ein fertiges Update ließ sich leicht verpassen',
    detail:
      'Ein heruntergeladenes Update meldete sich genau einmal mit einer Einblendung, die nach wenigen ' +
      'Sekunden von selbst verschwand, und danach nie wieder. Wer den Launcher im Hintergrund offen ' +
      'lässt, erfuhr davon nur noch, wenn er von sich aus in die Einstellungen sah.',
    state: 'fixed',
    since: '2026-08-31',
    fixedIn: '1.0.14'
  },
  {
    id: 'mods-doppelt',
    title: 'Mods erscheinen doppelt in der Liste',
    detail:
      'Beim Aktualisieren konnte derselbe Mod zweimal in der Liste auftauchen. Grund war ein ' +
      'Zeitfenster: die neue Datei lag bereits auf der Platte, war aber noch nicht eingetragen, ' +
      'und ein Abgleich in genau diesem Moment hielt sie für einen unbekannten zweiten Mod. ' +
      'Ausgelöst wurde das von ganz gewöhnlichen Handlungen wie dem Öffnen der Instanzseite.',
    state: 'fixed',
    since: '2026-08-30',
    fixedIn: '1.0.14'
  },
  {
    id: 'einfrieren-linux',
    title: 'Der Launcher friert zeitweise komplett ein',
    detail:
      'Mehrere Vorgänge durchsuchten Ordner blockierend und liefen dabei von selbst, etwa die ' +
      'Speicherplatzanzeige nach jeder Sitzung und das Aufräumen bei jedem Start. Solange das ' +
      'lief, reagierte das Fenster gar nicht. Betroffen sind alle Systeme, unter Linux fällt es ' +
      'stärker auf, weil dort häufiger verschlüsselte oder über Netzwerk eingebundene ' +
      'Benutzerordner im Spiel sind.',
    state: 'fixed',
    since: '2026-08-30',
    fixedIn: '1.0.14'
  },
  {
    id: 'wrapper-exec',
    title: 'Wrapper-Befehl kann das Spiel aus der Verfolgung nehmen',
    detail:
      'Startet ein eigener Wrapper-Befehl Java im Hintergrund, statt sich per exec davon ersetzen ' +
      'zu lassen, hält der Launcher das Spiel für beendet, sobald der Wrapper fertig ist. ' +
      'Mod-Änderungen sind dann nicht mehr gesperrt. Reparieren lässt sich das nicht: es gibt ' +
      'keinen verlässlichen Weg zu einem abgekoppelten Prozess. Der Fall wird ab 1.0.14 erkannt ' +
      'und gemeldet, und das Feld in den Einstellungen nennt die Bedingung.',
    state: 'limitation',
    since: '2026-08-30',
    platforms: ['Linux']
  },
  {
    id: 'mac-linux-ungetestet',
    title: 'macOS und Linux sind kaum erprobt',
    detail:
      'Es gibt Installationsdateien für beide Systeme, und sie werden bei jeder Version gebaut. ' +
      'Ob Anmeldung und Spielstart dort durchgehend funktionieren, hat aber noch niemand ' +
      'systematisch geprüft. Unter macOS fehlt zusätzlich eine Signatur, deshalb erscheint beim ' +
      'ersten Start eine Warnung des Systems und die automatische Aktualisierung greift dort nicht.',
    state: 'limitation',
    since: '2026-08-17',
    platforms: ['macOS', 'Linux']
  }
]

/** Everything that is not done yet, newest first. */
export function openIssues(): KnownIssue[] {
  return KNOWN_ISSUES.filter((issue) => issue.state !== 'fixed')
}
