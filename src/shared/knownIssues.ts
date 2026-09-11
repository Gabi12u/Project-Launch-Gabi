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
      'Bei einzelnen Konten brach die Microsoft-Anmeldung mit einem Fehler 400 ab. Ursache war, ' +
      'dass der Launcher sich mit der Anwendungs-ID des offiziellen Minecraft-Launchers anmeldete: ' +
      'Microsoft lässt diese gemeinsame Anwendung für fremde Programme zunehmend nicht mehr zu, und ' +
      'die Ablehnung kam genau in dem Moment, in dem jemand die Anmeldung im Browser abgeschlossen ' +
      'hatte. Seit 1.0.17 zeigt der Launcher diesen Fall wenigstens verständlich an, mit einer ' +
      'lesbaren Meldung samt technischem Code statt der rohen Fehlerzeile. Seit dem 8. September ' +
      '2026 gibt es eine eigene Anwendung, und am 11. September 2026 ist von Hand nachgemessen ' +
      'worden, dass der gesamte Anmeldeweg mit ihr durchläuft: Gerätecode, Anmeldung, Xbox Live, ' +
      'Xbox-Freigabe und Minecraft selbst nehmen sie ohne Weiteres an, ganz ohne das ursprünglich ' +
      'erwartete Freigabeformular. Wer den Launcher schon installiert hat, wird beim nächsten Start ' +
      'automatisch auf die eigene Anwendung umgestellt. Eine bereits angemeldete Sitzung ist davon ' +
      'nicht betroffen und läuft unter der Anwendung weiter, mit der sie sich ursprünglich angemeldet ' +
      'hat.',
    state: 'fixed',
    since: '2026-08-25',
    fixedIn: '1.0.18'
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
      '"Trotzdem ausführen", danach startet Launch Gabi ganz normal. Dieselbe fehlende Signatur hat ' +
      'eine zweite, weniger sichtbare Folge: Der eingebaute Updater prüft Updates normalerweise auch ' +
      'per Authenticode-Signatur, bevor er sie installiert. Ohne Zertifikat gibt es keine solche ' +
      'Signatur zu prüfen, diese zweite Kontrolle bleibt also wirkungslos. Es bleibt beim Abgleich der ' +
      'Prüfsumme aus der Versionsdatei, die aus demselben Release stammt wie die Installationsdatei ' +
      'selbst und deshalb keine unabhängige zweite Quelle ist.',
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
  },
  {
    id: 'konten-falscher-typ-nach-login',
    title: 'Nach einer Anmeldung konnte die Kontenliste abstürzen',
    detail:
      'Nach einer erfolgreichen Microsoft-Anmeldung oder dem Anlegen eines Offline-Profils schickte ' +
      'der Launcher intern das neue Konto allein statt der vollständigen Kontenliste an die ' +
      'Oberfläche, obwohl genau diese Liste als Ergebnis erwartet wird. Seitenleiste, Kopfzeile und ' +
      'der Einrichtungsassistent lesen aus dieser Liste sofort Dinge wie "das aktive Konto finden" ' +
      'oder "wie viele Konten gibt es", was bei einem einzelnen Konto statt einer Liste zum Absturz ' +
      'der gesamten Oberfläche führen kann. Betroffen wäre damit ausgerechnet der Moment, den jede ' +
      'neue Person beim ersten Öffnen des Launchers durchläuft.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'forge-installer-pfad-traversal',
    title: 'Ein manipulierter Forge- oder NeoForge-Installer konnte Dateien an beliebiger Stelle ablegen',
    detail:
      'Beim Einrichten von Forge oder NeoForge liest der Launcher eine Liste von Datenpfaden aus dem ' +
      'Installer selbst und entpackt sie in einen eigenen Arbeitsordner. Ein Pfad, der mit einem ' +
      'Schrägstrich beginnt, wurde dabei ungeprüft übernommen, während der Launcher an vergleichbaren ' +
      'Stellen im selben Code bewusst eine Schutzfunktion gegen genau solche Pfade einsetzt. Ein ' +
      'Installer mit einem entsprechend präparierten Pfad hätte eine Datei außerhalb des vorgesehenen ' +
      'Ordners ablegen können, zum Beispiel im Autostart-Ordner von Windows. Der Installer selbst ' +
      'kommt von der offiziellen Forge- beziehungsweise NeoForge-Adresse, das Risiko besteht also nur, ' +
      'wenn diese Quelle selbst kompromittiert wäre.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'loader-versionid-pfad-traversal',
    title: 'Eine unbereinigte Kennung aus dem Netz konnte beim Einrichten eines Loaders einen Pfad verlassen',
    detail:
      'Fabric, Quilt, Forge und NeoForge liefern beim Einrichten eine Versionskennung, aus der der ' +
      'Launcher sowohl einen Ordnernamen als auch einen Dateinamen bildet, ohne diese Kennung vorher ' +
      'zu bereinigen. Käme diese Kennung von einem kompromittierten Metadatenserver oder einem ' +
      'manipulierten Installer mit eingebauten Schrägstrichen, hätte die dabei erzeugte Datei ' +
      'außerhalb des vorgesehenen Ordners für Versionsdaten landen können.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'ordner-oeffnen-ohne-instanzpruefung',
    title: 'Ordner öffnen prüfte die übergebene Instanz nicht und konnte dadurch ein Programm starten',
    detail:
      'Die Befehle zum Öffnen des Sicherungs- oder Instanzordners bauten den Zielpfad direkt aus der ' +
      'übergebenen Kennung, ohne zu prüfen, dass diese Kennung wirklich zu einer bestehenden Instanz ' +
      'gehört. Unter Windows öffnet das verwendete Systemwerkzeug eine ausführbare Datei nicht nur an, ' +
      'es startet sie. Mit einer entsprechend aufgebauten Kennung ließe sich dadurch eine Datei ' +
      'starten, die irgendwo im Datenverzeichnis liegt, etwa eine der vom Launcher selbst verwalteten ' +
      'Java-Versionen. Genau diese Prüfung gibt es an einer benachbarten Stelle im selben Code bereits, ' +
      'dort wurde sie schon einmal bewusst ergänzt, hier fehlte sie noch.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'instanzlisten-ohne-existenzpruefung',
    title: 'Welten, Screenshots und Aufnahmen wurden ohne Prüfung der Instanz aufgelistet',
    detail:
      'Anders als fast jeder andere Befehl rund um eine Instanz prüften die Befehle zum Auflisten von ' +
      'Welten, Bildschirmfotos und Aufnahmen nicht zuerst, ob die übergebene Kennung überhaupt zu einer ' +
      'bestehenden Instanz gehört. Bei einer gelöschten Instanz, deren Ordner aus irgendeinem Grund ' +
      'noch auf der Platte liegt, könnten dadurch Inhalte gelesen und angezeigt werden, die eigentlich ' +
      'nicht mehr zugänglich sein sollten.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'installation-ohne-sperre',
    title: 'Eine Instanz neu einrichten prüfte keine der üblichen Sperren',
    detail:
      'Reparatur und Wiederherstellung prüfen vor Beginn ausführlich, ob die Instanz gerade läuft, ' +
      'startet oder anderweitig beschäftigt ist, mit der ausdrücklichen Begründung, dass sonst ' +
      'gemeinsam genutzte Dateien beschädigt werden könnten. Die vergleichbare Funktion zum erneuten ' +
      'Einrichten einer Instanz hat keine dieser Prüfungen, obwohl sie dieselben Dateien anfasst. Wird ' +
      'sie ausgelöst, während dieselbe Instanz bereits läuft, könnten Bibliotheken oder native Dateien ' +
      'unter einem laufenden Spiel weggeschrieben werden.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'curseforge-seitengroesse-falsch',
    title: 'Die Versionsabfrage bei CurseForge sah oft nur die letzten fünfzig Dateien',
    detail:
      'Beim Abfragen aller Dateien eines Projekts bei CurseForge verlangte der Launcher fälschlich ' +
      'zweihundert Einträge pro Seite. CurseForge liefert an dieser Stelle aber nie mehr als fünfzig, ' +
      'unabhängig davon, wie viele angefragt werden. Dadurch brach die Abfrage immer nach der ersten ' +
      'Seite ab, bei einem Projekt mit vielen Dateien sah der Launcher nur die fünfzig zuletzt ' +
      'hochgeladenen, über alle Minecraft-Versionen und Loader hinweg gemischt. Fehlte die passende ' +
      'Datei für die gewünschte Version darunter, installierte der Launcher entweder eine falsche oder ' +
      'meldete fälschlich, es gebe keine passende Version. Ein Kommentar im selben Code beschreibt ' +
      'genau dieses Problem bereits als behoben, nur eben mit der falschen Zahl.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'einstellungen-vor-speichern-uebernommen',
    title: 'Eine geänderte Einstellung galt schon, bevor sie wirklich gespeichert war',
    detail:
      'Beim Speichern einer Einstellung übernahm der Launcher den neuen Stand sofort im Arbeitsspeicher, ' +
      'bevor das Schreiben auf die Festplatte bestätigt war. Schlägt dieses Schreiben fehl, zum ' +
      'Beispiel weil Windows die Datei kurzzeitig durch einen Virenscanner oder die Suchindizierung ' +
      'sperrt, denkt der Launcher für den Rest der Sitzung, die Änderung sei aktiv, obwohl auf der ' +
      'Platte weiterhin der alte Stand liegt. Nach einem Neustart ist die Änderung dann kommentarlos ' +
      'wieder weg. Besonders unangenehm beim Datenverzeichnis: Ein fehlgeschlagenes Schreiben ließ den ' +
      'Launcher sofort so tun, als läge alles am neuen Ort, ohne dass die dafür nötigen Vorbereitungen ' +
      'tatsächlich stattgefunden hätten.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'forge-abbruch-stoppt-prozess-nicht',
    title: 'Abbrechen einer Forge-Installation stoppte den laufenden Java-Prozess nicht',
    detail:
      'Während der letzten Schritte einer Forge- oder NeoForge-Installation laufen kurze Java-Prozesse, ' +
      'die Dateien zusammenbauen. Anders als bei Downloads im selben Vorgang wurde ein Abbruch-Wunsch ' +
      'nicht an diese Prozesse weitergereicht. Bricht jemand die Installation währenddessen ab, meldet ' +
      'die Oberfläche den Vorgang zwar als beendet, der Java-Prozess läuft aber im Hintergrund weiter ' +
      'und schreibt dabei in Ordner, die von mehreren Instanzen gemeinsam genutzt werden.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'beschaedigter-installer-blockiert-dauerhaft',
    title: 'Ein beschädigt heruntergeladener Forge-Installer blockierte jeden weiteren Versuch',
    detail:
      'Kann die Prüfsumme eines Forge- oder NeoForge-Installers nicht abgerufen werden, lässt der ' +
      'Launcher die Installation bewusst trotzdem weiterlaufen, ungeprüft. War die heruntergeladene ' +
      'Datei dabei tatsächlich beschädigt, aber nicht leer, etwa weil statt der echten Datei eine ' +
      'Fehlerseite passender Größe ausgeliefert wurde, blieb diese beschädigte Datei im Zwischenspeicher ' +
      'liegen und wurde von da an bei jedem weiteren Versuch als bereits vorhanden angenommen. Jeder ' +
      'erneute Versuch schlug dadurch auf dieselbe Weise fehl, bis jemand den Zwischenspeicher von Hand ' +
      'leerte.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'log-dateien-mit-benutzername',
    title: 'Protokolldateien enthalten den Windows-Benutzernamen, anders als Fehlerberichte',
    detail:
      'Fehlerberichte entfernen bewusst und ausdrücklich Namen, Pfade und andere persönliche Angaben, ' +
      'bevor sie irgendwohin geschickt werden. Die normale Protokolldatei, die beim Spielstart, bei ' +
      'einer Java-Installation oder beim Anlegen einer Verknüpfung mitschreibt, tut das nicht: Sie ' +
      'enthält volle Dateipfade, und die enthalten unter Windows den Benutzernamen. Wer sein Protokoll ' +
      'für eine Fehlersuche weitergibt, gibt damit unbeabsichtigt auch seinen Windows-Namen preis. ' +
      'Zusätzlich fehlt eine Größenbegrenzung, eine sehr lange Sitzung kann die Datei unbegrenzt ' +
      'wachsen lassen.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'geraetecode-anzeige-vertauscht',
    title: 'Ein angezeigter Anmeldecode konnte zu einer schon abgebrochenen Anmeldung gehören',
    detail:
      'Bricht jemand eine gerade laufende Microsoft-Anmeldung ab und startet sofort eine neue, etwa für ' +
      'ein zweites Konto, kann in seltenen Fällen die Antwort der ersten, bereits abgebrochenen ' +
      'Anmeldung noch eintreffen und den bereits angezeigten neuen Anmeldecode überschreiben. Die ' +
      'eigentliche Anmeldung bleibt davon unberührt und läuft weiterhin für das richtige Konto, es ' +
      'kommt zu keiner Vermischung von Konten oder Tokens. Es kann aber kurzzeitig ein Code angezeigt ' +
      'werden, der zu nichts mehr gehört und im Browser eingegeben ins Leere liefe.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'plattform-antwort-unzureichend-abgesichert',
    title: 'Unerwartete Antworten von Modrinth oder CurseForge waren nicht überall abgesichert',
    detail:
      'An mehreren Stellen beim Abfragen von Modrinth und CurseForge verließ sich der Launcher darauf, ' +
      'dass bestimmte Felder in der Antwort immer vorhanden und richtig sortierbar sind, obwohl an ' +
      'vergleichbaren Stellen im selben Code bereits bekannt ist, dass das nicht garantiert ist, ' +
      'insbesondere bei älteren Einträgen. Fehlt ein solches Feld, kann die gesamte Versionsliste eines ' +
      'Projekts abbrechen, statt nur den einen betroffenen Eintrag zu verwerfen. Zusätzlich sortierte ' +
      'ein fehlendes Veröffentlichungsdatum die betroffene Version an eine unvorhersehbare Stelle statt ' +
      'zuverlässig ans Ende, und eine Zuordnungstabelle bei CurseForge ordnete eine Abhängigkeitsart ' +
      'falsch zu, was aktuell aber noch keine sichtbare Auswirkung hat.',
    state: 'fixed',
    since: '2026-09-08',
    fixedIn: '1.0.18'
  },
  {
    id: 'oberflaeche-ohne-auffangnetz',
    title: 'Die Oberfläche hat kein Auffangnetz gegen unerwartete Daten aus dem Main-Prozess',
    detail:
      'Der Konten-Fehler weiter oben in dieser Liste hatte eine tiefere Ursache, die für sich genommen ' +
      'bestehen bleibt: Die Oberfläche prüft an keiner Stelle, ob eine über IPC ankommende Antwort ' +
      'wirklich die erwartete Form hat, bevor sie sie in den gemeinsamen Zustand übernimmt. Es gab im ' +
      'gesamten Programm zudem keine Auffangebene für unerwartete Fehler beim Zeichnen der Oberfläche. ' +
      'Warf irgendeine Stelle einen Fehler, weil eine Annahme über die Form von Daten nicht zutraf, ' +
      'wurde der gesamte Bildschirm leer, ohne Möglichkeit zur Erholung außer einem Neustart. Das war die ' +
      'Lücke, durch die der behobene Konten-Fehler überhaupt zum Absturz werden konnte. Seit 1.0.18 fängt ' +
      'eine solche Auffangebene jeden Fehler beim Zeichnen ab: die betroffene Ansicht zeigt einen ' +
      'Hinweis mit der technischen Meldung und einen Weg zurück zur Startseite, der Rest des Fensters ' +
      '(Navigation, laufende Vorgänge, offene Fenster) bleibt bedienbar. Bricht etwas außerhalb der ' +
      'eigentlichen Ansicht, fängt eine zweite, äußere Ebene das ganze Fenster auf. Ungelöst bleibt der ' +
      'andere Teil des ursprünglichen Befunds: einzelne IPC-Antworten werden weiterhin nicht auf ihre Form ' +
      'geprüft, bevor sie übernommen werden. Ein solcher Fehler führt jetzt also nicht mehr zu einem ' +
      'leeren Fenster, kann aber weiterhin auftreten.',
    state: 'fixed',
    since: '2026-09-10',
    fixedIn: '1.0.18'
  },
  {
    id: 'update-erneut-suchen-verdeckt-fertiges-update',
    title: 'Erneut nach Updates suchen konnte ein bereits fertiges Update verdecken',
    detail:
      'Ist ein Update bereits heruntergeladen und wartet auf den Neustart, blieb der Knopf "Jetzt ' +
      'suchen" in den Einstellungen trotzdem anklickbar. Der automatische Hintergrund-Check hatte eine ' +
      'ausdrückliche Absicherung dagegen, ein bereits fertiges Update nicht zurück auf "wird geprüft" zu ' +
      'stellen, die manuelle Suche über diesen Knopf hatte dieselbe Absicherung nicht. Eine erneute Suche ' +
      'in diesem Moment konnte den Hinweis auf das wartende Update und den Neustart-Knopf verschwinden ' +
      'lassen, obwohl das heruntergeladene Update unverändert bereitlag. Die Absicherung gilt jetzt für ' +
      'beide Wege gleichermaßen, und ein Klick auf "Jetzt suchen" in diesem Zustand meldet stattdessen, ' +
      'dass ein Update bereits bereitliegt oder gerade lädt.',
    state: 'fixed',
    since: '2026-09-10',
    fixedIn: '1.0.18'
  },
  {
    id: 'lokaler-bau-mit-absturzprotokollen',
    title: 'Ein von Hand erstellter Installer kann Absturzprotokolle mit dem eigenen Benutzernamen enthalten',
    detail:
      'Wird der Launcher nicht über die offizielle Veröffentlichung, sondern von Hand auf dem eigenen ' +
      'Rechner gebaut, während im selben Ordner zufällig Absturzprotokolle liegen (zum Beispiel von der ' +
      'Java-Werkzeugkette des mod-Ordners), schlossen die Bauvorgaben diese Dateien nicht zuverlässig ' +
      'aus. Solche Protokolle können den Windows-Benutzernamen und lokale Pfade enthalten. Nachgemessen ' +
      'statt vermutet, mit electron-builders eigenem Datei-Filter statt nur gelesenem Muster: Die zuvor ' +
      'ergänzte Ausschlussregel schließt ein Absturzprotokoll im Projektstamm, dort wo es tatsächlich ' +
      'entsteht, zuverlässig aus, ebenso eines, das versehentlich im mod-Ordner landet. Die offizielle, ' +
      'veröffentlichte Version war davon ohnehin nie betroffen: Sie entsteht auf einem sauberen Rechner ' +
      'über die automatische Veröffentlichung und kann solche Dateien gar nicht erst enthalten.',
    state: 'fixed',
    since: '2026-09-10',
    fixedIn: '1.0.18',
    platforms: ['Windows']
  },
  {
    id: 'aufgabenanzeige-bleibt-stehen',
    title: 'Die Aufgabenanzeige verschwindet nicht mehr, sobald einmal ein Vorgang fertig ist',
    detail:
      'Die kleine Anzeige unten für laufende Vorgänge (Herunterladen, Reparieren, Installieren) soll einen ' +
      'fertigen Eintrag noch etwa drei Sekunden zeigen und dann ausblenden. Der Timer dafür wird jedoch ' +
      'durch die eigene Zustandsänderung sofort wieder abgeräumt, bevor er auslösen kann. Ein fertiger oder ' +
      'abgebrochener Vorgang bleibt dadurch dauerhaft in der Anzeige stehen, und die Anzeige selbst geht für ' +
      'den Rest der Sitzung nicht mehr weg. Fehlgeschlagene Vorgänge haben zusätzlich keinen Knopf zum ' +
      'Wegklicken, nur laufende. Der Hauptprozess vergisst einen alten Vorgang zwar nach kurzer Zeit, sagt ' +
      'das der Oberfläche aber nicht, also wächst die Liste im Hintergrund eine Sitzung lang weiter.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'rechtsklickmenue-beim-scrollen',
    title: 'Das Rechtsklick-Menü bleibt beim Scrollen stehen und kann die falsche Instanz treffen',
    detail:
      'Öffnet man mit Rechtsklick das Menü an einer Instanz oder einem Mod und scrollt dann die Liste, ' +
      'wandert der Inhalt darunter weg, das Menü bleibt aber an seiner Stelle. Es steht dann über einer ' +
      'anderen Zeile als der, für die es geöffnet wurde. Wählt man jetzt einen Eintrag wie "Reparieren" ' +
      'oder "Favorit", wirkt er auf die ursprüngliche Instanz, nicht auf die, über der das Menü gerade zu ' +
      'sehen ist. Das Menü schließt sich bei einer Größenänderung des Fensters, aber nicht beim Scrollen. ' +
      'Nebenbei springt die Tastaturauswahl im Menü bei jeder Aktualisierung im Hintergrund zurück auf den ' +
      'ersten Eintrag.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'konto-entfernen-ohne-rueckfrage',
    title: 'Ein Konto lässt sich mit einem einzigen Klick ohne Rückfrage entfernen',
    detail:
      'Im Konten-Fenster steht neben jedem Konto ein Mülleimer-Symbol. Ein Klick darauf entfernt das Konto ' +
      'sofort, ohne Sicherheitsabfrage und ohne die Möglichkeit, es rückgängig zu machen. Trifft man das ' +
      'Symbol versehentlich, ist das Konto weg und muss über die vollständige Microsoft-Anmeldung neu ' +
      'hinzugefügt werden. Schlägt das Entfernen im Hintergrund fehl, gibt es dazu keine Rückmeldung.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'fehlerbericht-frage-wegklicken',
    title: 'Die Frage nach Fehlerberichten wegzuklicken schaltet sie dauerhaft ab',
    detail:
      'Beim ersten Start nach dem Einrichten fragt der Launcher einmalig, ob Fehlerberichte gesendet werden ' +
      'dürfen. Schließt man dieses Fenster mit Escape, mit einem Klick daneben oder über das Kreuz, statt ' +
      'einen der beiden Knöpfe zu benutzen, wird das genauso gewertet wie ein ausdrückliches "Nein, danke": ' +
      'Fehlerberichte werden abgeschaltet, und die Frage kommt nicht wieder. Wer das Fenster nur wegklicken ' +
      'und später entscheiden wollte, muss die Einstellung von Hand unter Einstellungen, Fehlerberichte ' +
      'wieder einschalten.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'einstellungen-schreiben-bei-jeder-aenderung',
    title: 'Schieberegler und das Feld für JVM-Argumente schreiben bei jeder kleinsten Änderung auf die Festplatte',
    detail:
      'Die Schieberegler in den Einstellungen (Arbeitsspeicher, gleichzeitige Downloads, Anzahl ' +
      'automatischer Sicherungen) und das Textfeld für die JVM-Argumente speichern jede Zwischenstufe ' +
      'sofort. Einen Regler von einem Ende zum anderen zu ziehen löst dutzende einzelne Schreibvorgänge ' +
      'aus, jeder Buchstabe im Argumente-Feld einen weiteren. Jeder davon ist ein vollständiges, sicherndes ' +
      'Neuschreiben der Einstellungsdatei im Hauptprozess. Auf einer langsamen Festplatte oder wenn ein ' +
      'Virenschutz jede Datei mitprüft, ruckelt der Regler dadurch spürbar und die Oberfläche stockt kurz. ' +
      'Die Datei geht dabei nicht kaputt, die Schreibvorgänge laufen nacheinander ab.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'escape-schliesst-mehrere-fenster',
    title: 'Escape schließt zwei übereinanderliegende Fenster auf einmal',
    detail:
      'Jedes Fenster im Launcher hört für sich auf die Escape-Taste, ohne zu prüfen, ob es das oberste ist. ' +
      'Sind zwei Fenster übereinander offen, etwa die Detailansicht eines Mods und darüber die Auswahl ' +
      'einer bestimmten Version, schließt ein Druck auf Escape beide gleichzeitig, statt nur das obere. Man ' +
      'landet dann nicht wieder in der Detailansicht, sondern ganz aus dem Vorgang heraus.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'entdecken-modpack-nicht-als-installiert',
    title: 'In "Entdecken" wird ein bereits installiertes Modpack nicht als installiert erkannt',
    detail:
      'Auf der Seite "Entdecken" vergleicht der Launcher die angezeigten Modpacks mit den vorhandenen ' +
      'Instanzen in zwei unterschiedlichen Schreibweisen der Projektkennung. Der Vergleich geht deshalb nie ' +
      'auf. Ein Modpack, das man bereits als Instanz installiert hat, wird weiter mit "Installieren" ' +
      'angezeigt statt mit "Installiert", und der Knopf bleibt anklickbar. Ein zweiter Klick legt eine ' +
      'zweite, vollständige Instanz desselben Modpacks an.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'loader-abfrage-ohne-fehlerhinweis',
    title: 'Schlägt die Abfrage der Mod-Loader fehl, erscheinen alle Loader als nicht verfügbar',
    detail:
      'Beim Anlegen einer Instanz fragt der Assistent für die gewählte Minecraft-Version ab, welche ' +
      'Mod-Loader es dafür gibt (Fabric, NeoForge, Forge, Quilt). Schlägt eine dieser Abfragen fehl, zum ' +
      'Beispiel bei kurzer Netzunterbrechung oder wenn der Metadaten-Dienst nicht erreichbar ist, wird der ' +
      'betroffene Loader stillschweigend als "keine Version verfügbar" geführt. Fallen alle vier Abfragen ' +
      'aus, sieht es so aus, als gäbe es für diese Minecraft-Version überhaupt keinen Loader. Einen Hinweis, ' +
      'dass die Abfrage nur fehlgeschlagen ist und ein erneuter Versuch helfen könnte, gibt es nicht.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  }
]

/** Everything that is not done yet, newest first. */
export function openIssues(): KnownIssue[] {
  return KNOWN_ISSUES.filter((issue) => issue.state !== 'fixed')
}
