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
    id: 'mod-entfernen-kommt-zurueck',
    title: 'Ein entfernter Mod konnte von selbst wieder auftauchen',
    detail:
      'Entfernen war die einzige Änderung an den Mods einer Instanz, die nicht mit einem gleichzeitigen ' +
      'Abgleich der Mod-Liste mit der Festplatte zusammengehalten wurde. Fiel ein Entfernen genau in einen ' +
      'solchen Abgleich, etwa durch das Öffnen der Instanzseite oder eine Update-Prüfung, konnte der ' +
      'Abgleich den gerade entfernten Mod anhand seines noch nicht verschwundenen Standes erneut in die ' +
      'Liste schreiben. Seit 1.0.16 hält das Entfernen den Abgleich zurück, bis es fertig ist, genau wie ' +
      'es Installieren und Aktualisieren schon immer taten. Die Reparaturfunktion räumt bei dieser ' +
      'Gelegenheit auch schon vorhandene Dubletten aus früheren Fällen auf.',
    state: 'fixed',
    since: '2026-09-02',
    fixedIn: '1.0.16'
  },
  {
    id: 'launcher-schwarz-bei-spielstart',
    title: 'Launcher wird beim Spielstart komplett schwarz und reagiert nicht mehr',
    detail:
      'Startet man Minecraft aus dem Launcher heraus, konnte das Launcher-Fenster vollständig schwarz ' +
      'werden und ließ sich danach nicht mehr bedienen. Ursache war ein Absturz oder Hänger der ' +
      'Programmoberfläche selbst, für den es keine Erholung gab: das Fenster blieb bestehen, zeigte aber ' +
      'nur noch seine leere Hintergrundfarbe und reagierte auf nichts mehr, ohne dass der Launcher das ' +
      'bemerkte oder von selbst behob. Was genau die Oberfläche in diesem Moment zum Absturz brachte, ist ' +
      'nicht abschließend geklärt. Seit 1.0.16 lädt sich der Launcher in diesem Fall von selbst neu.',
    state: 'fixed',
    since: '2026-09-02',
    fixedIn: '1.0.16'
  },
  {
    id: 'gamepass-keine-lizenz',
    title: 'Game Pass wurde als "keine Lizenz" abgewiesen',
    detail:
      'Wer Minecraft über den Xbox Game Pass hat, konnte sich nicht anmelden: der Launcher meldete ' +
      '"Dieses Konto besitzt keine Minecraft-Java-Edition-Lizenz". Der Grund lag nicht am Konto. ' +
      'Der Launcher fragte bei Microsoft eine Liste der Berechtigungen ab und wertete eine leere ' +
      'Liste als fehlenden Besitz. Diese Liste kommt bei Game Pass aber nicht verlässlich gefüllt ' +
      'zurück, auch wenn das Konto spielen darf. Ab jetzt entscheidet das Spielerprofil: liefert ' +
      'Microsoft einen Spielernamen, kann das Konto spielen. Fehlt der Name noch, steht jetzt auch ' +
      'der richtige Weg dabei, und der ist bei Game Pass ein anderer als bei einem Kauf.',
    state: 'fixed',
    since: '2026-09-04',
    fixedIn: '1.0.17'
  },
  {
    id: 'login-http-400',
    title: 'Anmeldung endet mit Fehler 400',
    detail:
      'Bei einzelnen Konten bricht die Microsoft-Anmeldung mit einem Fehler 400 ab. Aus einem ' +
      'Fehlerbericht aus 1.0.16 ist jetzt bekannt, was dahintersteckt: Microsoft antwortet beim ' +
      'Abfragen des Anmeldecodes mit "invalid_grant". Gemessen am echten Anmeldedienst heißt das ' +
      'entweder, dass der Code abgelaufen ist, oder dass die Anmeldung im Browser nicht bis zum ' +
      'Ende durchgelaufen ist. Beides ist endgültig, der Code wird danach nicht mehr angenommen. ' +
      'Der Launcher hat diesen Fall bisher nicht erkannt und die rohe technische Zeile angezeigt, ' +
      'statt zu sagen, was zu tun ist. Das ist behoben: es erscheint jetzt eine verständliche ' +
      'Meldung samt technischem Code, und der Bericht enthält, wie lange der Versuch lief. Das ' +
      'steckt in 1.0.17. Inzwischen liegt auch ein starker Verdacht auf der Ursache vor: der ' +
      'Launcher meldet sich mit der Anwendungs-ID des offiziellen Minecraft-Launchers an, weil ' +
      'eine eigene erst von Mojang freigegeben werden muss. Microsoft lässt diese gemeinsame ' +
      'Anwendung für fremde Programme zunehmend nicht mehr zu, und die Ablehnung kommt genau ' +
      'dann, wenn jemand die Anmeldung im Browser abgeschlossen hat. Seit dem 8. September gibt ' +
      'es eine eigene Anwendung, und der Anmeldeweg ist damit einmal von Hand durchgemessen ' +
      'worden: Gerätecode, Anmeldung, Xbox Live und die Xbox-Freigabe laufen sauber durch, erst ' +
      'Minecraft selbst weist eine noch nicht freigegebene Anwendung ab. Die Freigabe ist ' +
      'beantragt und steht noch aus. Solange sie fehlt, bleibt es bei der gemeinsamen Anwendung, ' +
      'und der Fehler kann weiter auftreten.',
    state: 'fixing',
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
  },
  {
    id: 'windows-ungesigniert',
    title: 'Windows warnt beim ersten Start vor dem Programm',
    detail:
      'Launch Gabi hat kein Code-Signing-Zertifikat für Windows. Ein solches Zertifikat kostet ' +
      'laufend Geld, und für ein privates, kostenloses Projekt wurde bewusst darauf verzichtet, ' +
      'eines zu kaufen. Ohne Signatur stuft der SmartScreen-Filter von Windows jede neue Version ' +
      'zunächst als unbekannt ein und zeigt beim allerersten Start die Meldung "Windows hat den PC ' +
      'geschützt" mit dem Hinweis "Unbekannter Herausgeber". Das ist keine Fehlfunktion des ' +
      'Launchers, sondern eine dauerhafte Folge der fehlenden Signatur, die mit jeder neuen Version ' +
      'erneut erscheint. Wer die Meldung sieht, klickt auf "Weitere Informationen" und danach auf ' +
      '"Trotzdem ausführen", danach startet Launch Gabi ganz normal.',
    state: 'limitation',
    since: '2026-09-08',
    platforms: ['Windows']
  },
  {
    id: 'tokens-ohne-verschluesselung',
    title: 'Fehlende Verschlüsselung von Anmeldetoken war unsichtbar',
    detail:
      'Der Launcher verschlüsselt das Microsoft-Anmeldetoken vor dem Speichern über die ' +
      'Verschlüsselung des Betriebssystems. Bietet das System diese nicht an, was vor allem auf ' +
      'manchen Linux-Installationen ohne eingerichteten Schlüsselbund vorkommen kann, legt der ' +
      'Launcher das Token stattdessen als Klartext ab. Bisher stand das nur in der internen ' +
      'Protokolldatei, die kein Nutzer normalerweise öffnet. Jetzt erscheint in diesem Fall eine ' +
      'Benachrichtigung, und der Kontobereich der Einstellungen zeigt dauerhaft einen Hinweis, ' +
      'solange mindestens ein gespeichertes Konto betroffen ist. An der zugrunde liegenden Grenze ' +
      'ändert das nichts: ohne eine Verschlüsselung des Systems bleibt der Klartext die einzige ' +
      'Alternative dazu, die Anmeldung gar nicht erst zu speichern.',
    state: 'limitation',
    since: '2026-09-08'
  },
  {
    id: 'update-deaktivierte-mod-wird-aktiv',
    title: 'Aktualisieren einer deaktivierten Mod schaltet sie wieder ein',
    detail:
      'Wird eine ausgeschaltete Mod aktualisiert, landet die neu heruntergeladene Datei auf der ' +
      'Festplatte ohne die Endung ".disabled", obwohl der interne Eintrag weiterhin "ausgeschaltet" ' +
      'sagt. Der nächste Abgleich mit dem Ordnerinhalt richtet sich nach der echten Datei und trägt ' +
      'die Mod als eingeschaltet ein, ohne dass eine Meldung erscheint. Eine Mod, die bewusst wegen ' +
      'eines Absturzes oder einer Unverträglichkeit ausgeschaltet wurde, kann dadurch nach einer ' +
      'automatischen Aktualisierung unbemerkt wieder mitladen und denselben Fehler erneut auslösen.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'java-tausch-nicht-atomar',
    title: 'Ein Java-Wechsel kann sowohl die alte als auch die neu geladene Version vernichten',
    detail:
      'Beim Einspielen einer heruntergeladenen Java-Version wird der bisherige Ordner zuerst gelöscht ' +
      'und danach der frisch entpackte Ordner an seine Stelle verschoben. Schlägt dieser zweite ' +
      'Schritt fehl, zum Beispiel weil ein Virenscanner oder ein Backup-Programm in diesem Moment ' +
      'eine Datei im neuen Ordner offen hält, ist die alte, bisher funktionierende Installation ' +
      'bereits weg, und der Aufräumschritt danach entfernt zusätzlich den neuen Ordner. Beide Stände ' +
      'sind dann verloren, und die Java-Version muss vollständig neu heruntergeladen werden.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'alte-assets-ohne-pruefung',
    title: 'Sehr alte Minecraft-Versionen prüfen kopierte Dateien nicht auf Vollständigkeit',
    detail:
      'Für Minecraft-Versionen vor 1.6 werden Assets in eine ältere Ordnerstruktur kopiert. Dabei ' +
      'wird nur geprüft, ob am Ziel bereits eine Datei liegt, nicht ob sie vollständig ist. Bricht der ' +
      'Launcher während dieses Kopiervorgangs ab, etwa durch einen Absturz oder einen Stromausfall, ' +
      'bleibt eine unvollständige Datei liegen und wird bei jedem weiteren Start als bereits erledigt ' +
      'übersprungen. Bemerkbar macht sich das nur bei sehr alten Versionen, als fehlender Sound oder ' +
      'fehlende Textur, ohne dass eine Fehlermeldung erscheint.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'loeschen-ohne-reparatur-sperre',
    title: 'Löschen einer Instanz prüft nicht, ob gerade eine Reparatur läuft',
    detail:
      'Vor dem Löschen einer Instanz prüft der Launcher, ob sie gerade läuft, startet, an ihren Mods ' +
      'gearbeitet wird oder eine Sicherung eingespielt wird. Eine laufende Reparatur gehört nicht zu ' +
      'diesen Prüfungen. Wird eine Instanz genau während ihrer eigenen Reparatur gelöscht, schreibt ' +
      'die Reparatur weiter in den bereits entfernten Ordner und legt ihn dabei teilweise wieder an. ' +
      'Da freigewordene interne Kennungen später erneut vergeben werden, kann eine neu angelegte ' +
      'Instanz auf einen nicht leeren, aus alten Resten bestehenden Ordner treffen.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'reparatur-wiederherstellung-ungesperrt',
    title: 'Reparatur und Wiederherstellung einer Sicherung können sich gegenseitig stören',
    detail:
      'Eine Reparatur prüft nicht, ob für dieselbe Instanz gerade eine Sicherung eingespielt wird, und ' +
      'eine Wiederherstellung prüft umgekehrt nicht, ob gerade repariert wird oder an den Mods ' +
      'gearbeitet wird. Werden beide Vorgänge gleichzeitig für dieselbe Instanz angestoßen, schreiben ' +
      'sie in dieselben Unterordner wie Welten und Einstellungen. Je nach Zeitpunkt kann das zu halb ' +
      'geschriebenen Welt- oder Konfigurationsdateien führen.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'reparatur-trifft-fremde-instanz',
    title: 'Reparatur einer Instanz kann den Start einer anderen mit derselben Minecraft-Version stören',
    detail:
      'Native Bibliotheken werden pro Minecraft-Version in einem gemeinsamen Ordner abgelegt, den sich ' +
      'alle Instanzen mit dieser Version teilen. Die Reparatur erkennt nur eine bereits laufende ' +
      'Instanz als "in Benutzung", nicht eine, die sich gerade mitten im Start befindet, etwa während ' +
      'die nativen Bibliotheken entpackt oder ein eigener Vorstart-Befehl noch läuft. Wird in diesem ' +
      'Zeitfenster eine andere Instanz mit derselben Version repariert, leert die Reparatur den ' +
      'gemeinsamen Ordner, und die startende Instanz kann ohne ihre nativen Bibliotheken abstürzen, ' +
      'obwohl an ihr selbst nichts verändert wurde.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'duplizieren-ohne-sperre',
    title: 'Duplizieren einer Instanz prüft überhaupt keine Sperre',
    detail:
      'Anders als Löschen prüft das Duplizieren einer Instanz nicht, ob sie gerade läuft, gestartet ' +
      'wird, an ihren Mods gearbeitet wird oder eine Sicherung eingespielt wird, bevor der Ordner ' +
      'kopiert wird. Läuft währenddessen einer dieser Vorgänge, kann die entstehende Kopie fehlende, ' +
      'halb geschriebene oder widersprüchliche Dateien enthalten, ohne dass eine Meldung erscheint. ' +
      'Bemerkbar wird das erst, wenn die Kopie später gestartet wird.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'mod-umschalten-ohne-sperre',
    title: 'Eine Mod ein- oder auszuschalten umgeht die Sperre für Inhalts-Änderungen',
    detail:
      'Installieren, Entfernen, Aktualisieren und Reparieren von Inhalten halten während ihrer Laufzeit ' +
      'dieselbe Sperre, damit sie sich nicht gegenseitig überschreiben. Eine Mod ein- oder ' +
      'auszuschalten hält diese Sperre nicht und wird auch von der Prüfung im entsprechenden Befehl ' +
      'nicht erfasst. Geschieht das genau während im Hintergrund eine Installation, Aktualisierung ' +
      'oder Reparatur derselben Instanz läuft, überschreibt wer zuletzt speichert die Änderung des ' +
      'jeweils anderen Vorgangs, ohne Warnung.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'versionspruefung-wirkungslos',
    title: 'Eine Prüfung beim Auffinden installierter Loader-Versionen ist wirkungslos',
    detail:
      'Beim Auffinden eines bereits installierten Loader-Ordners soll eine Prüfung ausschließen, dass ' +
      'ein Ordner einer anderen Instanz mit derselben Loader-Version, aber einer anderen Minecraft-' +
      'Version, fälschlich verwendet wird. Durch die Reihenfolge, in der zwei Bedingungen verknüpft ' +
      'sind, greift diese Prüfung in der Praxis nie: das Ergebnis fällt unabhängig vom Vergleich mit ' +
      'der Minecraft-Version immer positiv aus. In der Praxis selten, weil Forge- und NeoForge-' +
      'Versionsnummern meist eindeutig einer Minecraft-Version zugeordnet sind, aber im ungünstigen ' +
      'Fall würde eine Instanz mit dem Versionsprofil der falschen Minecraft-Version starten.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  }
]

/** Everything that is not done yet, newest first. */
export function openIssues(): KnownIssue[] {
  return KNOWN_ISSUES.filter((issue) => issue.state !== 'fixed')
}
