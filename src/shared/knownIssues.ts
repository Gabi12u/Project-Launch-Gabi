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
  },
  {
    id: 'mod-update-entfernen-wettlauf',
    title: 'Ein Mod aktualisieren und gleichzeitig entfernen konnte den entfernten Mod zurückbringen',
    detail:
      'Die Sperre, die Änderungen an den Mods einer Instanz koordiniert, ist ein Zähler, kein echtes ' +
      'gegenseitiges Ausschließen: sie sagt nur nach außen, dass gerade etwas läuft, hält aber zwei ' +
      'gleichzeitige Aufrufe für denselben Mod nicht auseinander. Lief ein Update für einen Mod noch, ' +
      'während derselbe Mod entfernt wurde, konnte die bereits heruntergeladene, neue Datei liegen ' +
      'bleiben, ohne dass ein Eintrag in der Mod-Liste noch darauf zeigte. Der nächste Ordner-Abgleich ' +
      'fand diese Datei dann als vermeintlich neuen, lokalen Mod wieder und brachte damit genau den Mod ' +
      'zurück, den der Nutzer gerade entfernt hatte. Das ist ein eigener, bisher unbekannter Weg zu ' +
      'demselben Symptom wie der bereits behobene Fehler "Ein entfernter Mod konnte von selbst wieder ' +
      'auftauchen", über einen anderen Auslöser. Update und Entfernen desselben Mods laufen jetzt ' +
      'zwangsläufig nacheinander statt gleichzeitig.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'inhalt-typ-uebergreifende-kollision',
    title: 'Ressourcenpaket, Shaderpaket und Datenpaket mit gleichem Namen konnten sich gegenseitig löschen',
    detail:
      'Der Abgleich, ob eine neu installierte Datei eine bereits vorhandene ersetzt, verglich nur den ' +
      'bloßen Dateinamen, nicht die Art des Inhalts. Ressourcenpakete, Shaderpakete, Datenpakete und ' +
      'Mods liegen zwar in getrennten Ordnern, tragen aber oft generische Namen wie "pack.zip". Traf ' +
      'ein solcher Name zufällig auf einen bereits vorhandenen Inhalt eines völlig anderen Typs, wurde ' +
      'dessen Datei gelöscht und sein Eintrag aus der Liste entfernt, obwohl er mit dem gerade ' +
      'installierten Inhalt nichts zu tun hatte. Der Vergleich berücksichtigt jetzt an allen drei ' +
      'betroffenen Stellen auch den Inhaltstyp.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'abhaengigkeit-anbieter-uebergreifend',
    title: 'Eine fehlende Pflicht-Abhängigkeit eines Mods konnte übersehen werden',
    detail:
      'Beim automatischen Installieren fehlender Abhängigkeiten wurde nur die Projekt-Kennung ' +
      'verglichen, nicht zusätzlich der Anbieter. CurseForge vergibt reine Zahlen als Kennung, ' +
      'Modrinth kurze Zeichenketten; eine zufällige Übereinstimmung zwischen einer CurseForge- und ' +
      'einer Modrinth-Kennung hätte eine tatsächlich fehlende Abhängigkeit fälschlich als bereits ' +
      'installiert gewertet und den Installationsversuch übersprungen, ohne jede Meldung. Genau dieses ' +
      'Risiko wurde an anderer Stelle in der Kompatibilitätsprüfung bereits erkannt und dort ' +
      'entsprechend eingeschränkt, hier aber übersehen. Der Vergleich prüft jetzt auch hier den ' +
      'Anbieter mit.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'absturzerkennung-ignoriert-signal',
    title: 'Ein echter Absturz unter macOS oder Linux wurde nicht als Absturz erkannt',
    detail:
      'Ob ein beendetes Spiel als Absturz gilt, hing nur am Beendigungscode. Ein Prozess, der durch ein ' +
      'Betriebssystem-Signal beendet wird, etwa bei einem echten Speicherzugriffsfehler oder wenn das ' +
      'Betriebssystem ihm mangels Arbeitsspeicher den Prozess entzieht, liefert dabei keinen Code, ' +
      'sondern den Wert für "kein Code". Genau dieser Wert wurde bisher als gewöhnliches, sauberes ' +
      'Ende gewertet. Die Folge: kein Absturz-Hinweis, kein rotes Abzeichen, und in der ' +
      'Sitzungs-Historie stand dauerhaft "kein Absturz", obwohl einer stattgefunden hatte. Betroffen ' +
      'sind ausschließlich macOS und Linux, unter Windows gibt es diese Art Signal nicht. Die Prüfung ' +
      'berücksichtigt jetzt auch das Signal, mit einem eigenen Testlauf gegen einen wirklich per ' +
      'Signal beendeten Prozess bestätigt.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18',
    platforms: ['macOS', 'Linux']
  },
  {
    id: 'start-meldet-erfolg-vor-fehler',
    title: 'Ein fehlgeschlagener Start konnte kurzzeitig als erfolgreich gelten',
    detail:
      'Nach dem Start des Java-Prozesses liefen mehrere Schritte, ohne auf irgendetwas zu warten: die ' +
      'Spielzeit-Erfassung, der Status "läuft" und die Rückmeldung an den Aufruf, der Start sei ' +
      'geglückt. Schlägt der Start aber tatsächlich fehl, etwa weil eine Wrapper- oder Java-Datei ' +
      'zwischenzeitlich verschoben oder gelöscht wurde, meldet Node diesen Fehler erst einen Schritt ' +
      'später, als es die oben genannten, bereits gelaufenen Schritte erwarten konnten. Dadurch wurde ' +
      'kurzzeitig ein Erfolg gemeldet, der letzte Spielzeitpunkt einer Instanz aktualisiert, obwohl das ' +
      'Spiel nie lief, bevor die Statusanzeige sich kurz darauf selbst korrigierte. Mit einem eigenen ' +
      'Testlauf gegen einen wirklich fehlschlagenden Start bestätigt: der Launcher wartet jetzt, bis ' +
      'der Prozess wirklich angelaufen ist, bevor er das als Erfolg wertet.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'eingestellte-java-version-ungeprueft',
    title: 'Eine fest eingestellte, falsche Java-Version führte zu einem unklaren Absturz ohne Hinweis',
    detail:
      'Hat eine Instanz einen eigenen Java-Pfad eingestellt, wird dieser immer verwendet, sofern die ' +
      'Installation dort überhaupt läuft, unabhängig davon, ob es die von dieser Minecraft-Version ' +
      'benötigte Java-Version ist. Die automatische Java-Auswahl prüft genau das sorgfältig und meldet ' +
      'eine Abweichung deutlich, der fest eingestellte Pfad umging diese Prüfung vollständig. Die Folge ' +
      'war ein unklarer technischer Fehler beim Start, ohne jeden Hinweis auf die eigentliche Ursache. ' +
      'Der fest eingestellte Pfad wird weiterhin verwendet, das ändert sich bewusst nicht, aber eine ' +
      'Abweichung wird jetzt protokolliert und dem Nutzer gemeldet.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'instanz-aktualisieren-ungefiltert',
    title: 'Instanz-Änderungen aus der Oberfläche waren im Hauptprozess nicht auf ungefährliche Felder begrenzt',
    detail:
      'Die Funktion, die Namen, Beschreibung, Aussehen und Einstellungen einer Instanz speichert, nahm ' +
      'dafür ein beliebiges Teilobjekt entgegen und schrieb es ungeprüft in die gespeicherte Instanz. ' +
      'Die heutige Oberfläche schickt hier nur unbedenkliche Felder, ein künftiger Fehler an anderer ' +
      'Stelle hätte über denselben Weg aber auch Version, Loader oder den Installationsstatus verändern ' +
      'können, mitten in einer laufenden Installation oder Reparatur, und die gespeicherten Angaben ' +
      'damit von den tatsächlich installierten Dateien abweichen lassen. Die Funktion akzeptiert jetzt ' +
      'nur noch die tatsächlich vorgesehenen Felder.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'verknuepfung-ueberschreibt-fremde-datei',
    title: 'Eine Desktop-Verknüpfung konnte eine andere, gleichnamige Datei überschreiben',
    detail:
      'Der Dateiname einer erzeugten Desktop-Verknüpfung richtete sich ausschließlich nach dem Namen ' +
      'der Instanz, ohne zu prüfen, ob am Zielort schon etwas anderes liegt. Zwei Instanzen mit ' +
      'gleichem oder ähnlichem Namen, oder eine bereits vorhandene, unabhängige Datei mit demselben ' +
      'Namen auf dem Schreibtisch, wurden dadurch stillschweigend überschrieben. Die Verknüpfung prüft ' +
      'jetzt, ob eine bereits vorhandene Datei am Zielort schon zur selben Instanz gehört; ist das ' +
      'nicht der Fall, wird stattdessen ein durchnummerierter Name verwendet.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'aufnahme-falsches-fenster',
    title: 'Bei mehreren gleichzeitig laufenden Instanzen konnte die Aufnahme das falsche Fenster erwischen',
    detail:
      'Die Aufnahme sucht sich ihre Bildquelle über den Fenstertitel, das erste Fenster mit ' +
      '"Minecraft" darin. Liefen mehrere Instanzen gleichzeitig, konnte das ein anderes Fenster sein ' +
      'als das der Instanz, für die die Aufnahme gestartet wurde, ohne jede Fehlermeldung. Die Auswahl ' +
      'bevorzugt jetzt ein Fenster, dessen Titel die Minecraft-Version der gestarteten Instanz enthält. ' +
      'Das verkleinert das Problem für den häufigen Fall unterschiedlicher Versionen deutlich, löst es ' +
      'aber nicht vollständig: laufen zwei Instanzen mit exakt derselben Minecraft-Version gleichzeitig, ' +
      'lässt sich über den Fenstertitel weiterhin nicht zuverlässig zwischen ihnen unterscheiden.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'curseforge-kategorien-verschluckt-fehler',
    title: 'Ein fehlender CurseForge-Schlüssel ließ die Kategorie-Liste einfach leer erscheinen',
    detail:
      'Anders als bei der Suche, die einen fehlenden CurseForge-API-Schlüssel ausdrücklich prüft und ' +
      'meldet, wurde derselbe Fehler beim Laden der Kategorien-Liste still zu einer leeren Liste ' +
      'verschluckt. Ohne hinterlegten Schlüssel zeigte der Kategorie-Filter für CurseForge dadurch ' +
      'einfach nichts an, ohne jede Erklärung, warum. Der fehlende Schlüssel wird jetzt genauso wie bei ' +
      'der Suche gemeldet.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'netzwerk-fehler-unvollstaendig',
    title: 'Fehlermeldungen von Modrinth waren unnötig unklar, Wartezeiten bei Anfrage-Begrenzung wurden ignoriert',
    detail:
      'Zwei verwandte Lücken in derselben Stelle: Erstens las die Fehlerauswertung mehrere bekannte ' +
      'Felder aus einer Fehlerantwort aus, aber nicht das Feld, in dem Modrinth seinen eigentlichen ' +
      'Fehlertext mitschickt, sodass jeder Modrinth-Fehler nur als nackter technischer Code erschien. ' +
      'Zweitens wartete der Launcher bei einer Anfrage-Begrenzung (Fehler 429) immer eine feste, kurze ' +
      'Zeit, statt die von Modrinth oder CurseForge im Antwort-Kopf mitgeschickte, tatsächlich nötige ' +
      'Wartezeit zu beachten, und gab nach rund drei Sekunden auf, obwohl der Dienst kurz darauf schon ' +
      'wieder bereit gewesen wäre. Beides ist jetzt korrigiert.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'cache-verwirft-frische-daten',
    title: 'Ein Schreibfehler beim Zwischenspeichern konnte frisch geladene Daten verwerfen',
    detail:
      'Schlug das Schreiben der zwischengespeicherten Kopie einer Versions-Liste auf die Festplatte ' +
      'fehl, zum Beispiel weil kein Platz mehr da war, wurde das genauso behandelt wie ein ' +
      'fehlgeschlagener Netzwerkabruf: es griff der alte, veraltete Zwischenspeicher, obwohl die ' +
      'eigentliche Abfrage gerade erfolgreich neue Daten geliefert hatte. Ein Schreibfehler beim ' +
      'Zwischenspeichern wird jetzt nur noch protokolliert, die frisch geladenen Daten werden trotzdem ' +
      'verwendet.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'datei-import-verwirft-erfolge',
    title: 'Beim Hinzufügen mehrerer Dateien auf einmal ließ eine kaputte Datei alle anderen verschwinden',
    detail:
      'Wurden mehrere Mod- oder Paket-Dateien auf einmal ausgewählt und schlug der Import einer davon ' +
      'fehl, etwa weil sie beschädigt war, brach der gesamte Vorgang mit einer Fehlermeldung ab. Bereits ' +
      'erfolgreich hinzugefügte Dateien aus derselben Auswahl gingen dabei aus der Rückmeldung verloren, ' +
      'obwohl sie tatsächlich hinzugefügt worden waren. Jede Datei wird jetzt einzeln behandelt: ' +
      'erfolgreiche Dateien werden übernommen, eine fehlgeschlagene wird gemeldet, ohne die anderen zu ' +
      'verwerfen.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'duplikat-fix-zeigt-falsches-element',
    title: 'Der Hinweis auf einen doppelt installierten Mod konnte ein anderes Element hervorheben als der Fix entfernte',
    detail:
      'Bei doppelt installierten Mods hebt die Kompatibilitätsprüfung eines der beiden Elemente hervor, ' +
      'und der zugehörige automatische Fix entfernt eines von ihnen. Welches Element hervorgehoben ' +
      'wurde und welches der Fix tatsächlich entfernte, konnten wegen der Reihenfolge, in der der Code ' +
      'beide Werte ermittelte, auseinanderfallen. Kein Datenverlust, da ohnehin ein echtes Duplikat ' +
      'entfernt wurde, aber potenziell verwirrend. Beide zeigen jetzt zuverlässig auf dasselbe, ältere ' +
      'Element.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'vorstart-befehl-kein-sigkill',
    title: 'Ein Vorstart-Befehl, der ein sanftes Beenden ignoriert, konnte als verwaister Prozess weiterlaufen',
    detail:
      'Läuft ein eingestellter Befehl vor dem eigentlichen Start zu lange oder wird der Start ' +
      'abgebrochen, wurde er bisher nur einmal sanft beendet. Ignoriert oder fängt der Befehl dieses ' +
      'Signal ab, blieb er als unsichtbarer Prozess im Hintergrund am Leben, obwohl der Launcher den ' +
      'Start bereits als beendet oder abgebrochen gemeldet hatte. Genau diese Stufe (erst sanft, dann ' +
      'nach kurzer Frist erzwungen beenden) gibt es beim Beenden des Spiels selbst schon lange, hier ' +
      'fehlte sie noch. Ein Vorstart-Befehl bekommt jetzt dieselbe zweite, erzwingende Stufe.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'download-ohne-pruefsumme-vertraut',
    title: 'Eine unvollständig heruntergeladene Datei ohne Prüfsumme wurde dauerhaft für vollständig gehalten',
    detail:
      'Kam eine heruntergeladene Datei ganz ohne Prüfsumme und ohne bekannte Dateigröße daher, galt sie ' +
      'als vollständig, sobald sie überhaupt nicht leer war. Brach ein Download an dieser Stelle ' +
      'unvollständig ab, etwa durch einen harten Abbruch mitten im Vorgang, wurde die kaputte Datei beim ' +
      'nächsten Start als vorhanden akzeptiert und nie erneut geladen. Für Loader-Bibliotheken bleibt ' +
      'diese Grenze bestehen und ist im Code weiterhin als bekannt vermerkt, dort gibt es keine amtliche ' +
      'Prüfsumme, gegen die verglichen werden könnte. Für den Download der Java-Laufzeit selbst, wo das ' +
      'bisher ebenso zutraf, wird jetzt vorab die tatsächliche Dateigröße bei Adoptium abgefragt und zur ' +
      'Prüfung herangezogen, sowohl beim Herunterladen als auch bei einer bereits vorhandenen Datei.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'java-installation-abbruch-nicht-verdrahtet',
    title: 'Ein Abbruch konnte bei geteilter Java-Installation wirkungslos bleiben',
    detail:
      'Warten zwei Instanzen gleichzeitig auf dieselbe Java-Installation, teilen sie sich einen Download. ' +
      'Brach die zweite Instanz ihren eigenen Start ab, während die erste weiterlief, war ihr ' +
      'Abbruch-Signal nicht mit dem tatsächlich laufenden Download verbunden: der "Abbrechen"-Knopf der ' +
      'zweiten Instanz täuschte Wirkung vor, während im Hintergrund weiter heruntergeladen wurde, und ' +
      'schlimmer noch, die zweite Instanz wartete selbst einfach weiter, bis die geteilte Installation von ' +
      'selbst fertig oder fehlgeschlagen war, ganz gleich, was ihr eigener Abbruch-Knopf sagte. Jede ' +
      'wartende Instanz hat jetzt ihren eigenen, sofort wirksamen Abbruch; die geteilte Installation selbst ' +
      'läuft weiter, solange noch mindestens eine andere Instanz auf sie wartet, und wird nur dann ' +
      'tatsächlich gestoppt, wenn niemand mehr auf sie wartet.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'java-installation-verwirft-bei-umbenennen',
    title: 'Ein einzelner, vorübergehender Dateifehler konnte eine fertige Java-Installation komplett verwerfen',
    detail:
      'Am Ende einer Java-Installation wird der fertig entpackte und geprüfte Ordner an seinen ' +
      'endgültigen Platz verschoben. Schlug genau dieser letzte Schritt einmal fehl, zum Beispiel weil ein ' +
      'Virenschutz eine der frisch entpackten Dateien kurz geöffnet hielt, wurde die gesamte, bereits ' +
      'heruntergeladene und entpackte Installation gelöscht und beim nächsten Versuch komplett neu ' +
      'begonnen, statt nur diesen einen Schritt zu wiederholen. Ein solcher Umbenennungs-Versuch wird ' +
      'jetzt einmal nach kurzer Wartezeit wiederholt, bevor aufgegeben wird, mit einer echten, ' +
      'kurzzeitig gesperrten Datei nachgewiesen.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'fehlende-bibliothek-ohne-download-feld',
    title: 'Die Prüfung auf fehlende Bibliotheken konnte manche Fälle übersehen',
    detail:
      'Die Prüfung, ob für den Start benötigte Java-Bibliotheken tatsächlich vorhanden sind, schaute nur ' +
      'bei Einträgen nach, die eine Download-Adresse mitbringen. Manche Versions-Angaben, bekannt vor ' +
      'allem von Forge und NeoForge, führen Bibliotheken ohne eigene Adresse, weil sie vom Installer ' +
      'selbst an Ort und Stelle abgelegt werden. Fehlte eine solche Datei tatsächlich, wurde sie beim ' +
      'Start stillschweigend übergangen, statt als fehlend gemeldet zu werden, mit einem unklaren Fehler ' +
      'mitten im Spielstart als Folge. Mit einem echten Beispiel dieses genauen Musters bestätigt: von ' +
      'zwei absichtlich fehlenden Bibliotheken meldete die alte Prüfung nur eine, die korrigierte ' +
      'Prüfung beide. Sie schaut jetzt bei jeder benötigten Bibliothek nach, unabhängig davon, ob eine ' +
      'Download-Adresse bekannt ist.',
    state: 'fixed',
    since: '2026-09-11',
    fixedIn: '1.0.18'
  },
  {
    id: 'ordner-abgleich-typ-uebergreifend',
    title: 'Ressourcenpaket, Shaderpaket und Datenpaket mit gleichem Namen konnten beim Ordner-Abgleich vertauscht werden',
    detail:
      'Der laufende Abgleich zwischen der Mod-/Paket-Liste und dem tatsächlichen Ordnerinhalt (unter ' +
      'anderem vor jedem Start, bei jeder Reparatur und jeder Kompatibilitätsprüfung) verglich Dateien ' +
      'nur nach ihrem bloßen Namen, nicht nach ihrem Typ. Ressourcenpaket, Shaderpaket und Datenpaket ' +
      'liegen zwar in getrennten Ordnern, tragen aber oft generische Namen wie "pack.zip". Trugen zwei ' +
      'davon zufällig denselben Namen, wurden ihre Datensätze vertauscht: der eine Ordner zeigte auf die ' +
      'Metadaten des jeweils anderen, mit falschem Typ und geteilter Kennung. Drei verwandte Stellen mit ' +
      'genau diesem Muster wurden bereits behoben, diese vierte, für den laufenden Abgleich zuständige ' +
      'Stelle war noch offen.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'instanz-speichern-vor-bestaetigung-uebernommen',
    title: 'Eine Instanz-Änderung konnte im Speicher gelten, obwohl sie nie auf die Festplatte kam',
    detail:
      'Beim Speichern einer Instanz wurde der Stand im Arbeitsspeicher übernommen, bevor der ' +
      'eigentliche Schreibvorgang auf die Festplatte bestätigt war. Schlug das Schreiben fehl, etwa weil ' +
      'ein Virenschutz oder Indexdienst die Datei kurz gesperrt hielt, blieb der Launcher für den Rest ' +
      'der Sitzung mit dem ungespeicherten Stand weiterlaufen, während die Datei auf der Festplatte noch ' +
      'den alten Stand trug. Erst ein Neustart des Launchers deckte das auf, wenn die Änderung dann ' +
      'kommentarlos wieder verschwunden war. Genau dieses Muster wurde für die allgemeinen Einstellungen ' +
      'bereits einmal gefunden und behoben, für Instanzen aber übersehen. Jetzt wird zuerst geschrieben, ' +
      'erst danach im Speicher übernommen.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'loeschen-verliert-daten-trotz-fehlermeldung',
    title: 'Löschen konnte die Spieldaten einer Instanz unwiderruflich entfernen und trotzdem "fehlgeschlagen" melden',
    detail:
      'Instanz löschen entfernte zuerst den eigentlichen Instanzordner (Welten, Mods, Screenshots) und ' +
      'danach den zugehörigen Sicherungsordner in einem gemeinsamen Versuch. Schlug ausschließlich das ' +
      'Entfernen des Sicherungsordners fehl, etwa weil ein Virenschutz gerade eine Sicherungsdatei ' +
      'offen hielt, meldete der Launcher das Löschen als fehlgeschlagen, obwohl die eigentlichen ' +
      'Spieldaten zu diesem Zeitpunkt bereits unwiderruflich weg waren. Die Instanz blieb dabei in der ' +
      'Bibliothek sichtbar, mit einem inneren Stand, der nicht mehr zu den tatsächlich vorhandenen ' +
      'Dateien passte. Beide Schritte werden jetzt einzeln behandelt: schlägt nur der Sicherungsordner ' +
      'fehl, gilt die Instanz als gelöscht, und lediglich ein übrig gebliebener Sicherungsordner wird ' +
      'protokolliert.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'duplizieren-ohne-sperre-waehrend-kopie',
    title: 'Eine Instanz löschen oder reparieren, während sie gerade dupliziert wird, konnte eine kaputte Kopie erzeugen',
    detail:
      'Bevor eine Instanz dupliziert wird, prüft der Launcher einmalig, ob sie gerade läuft, startet, ' +
      'repariert wird oder an ihren Mods gearbeitet wird. Der eigentliche Kopiervorgang danach, bei ' +
      'großen Modpacks oder Welten durchaus mehrere Sekunden, hielt aber selbst keine Sperre. In diesem ' +
      'Fenster konnte ein Löschen oder eine Reparatur derselben Quell-Instanz beginnen, während noch ' +
      'aus ihrem Ordner kopiert wurde, was eine unvollständige oder inkonsistente Kopie zur Folge haben ' +
      'konnte. Der Kopiervorgang meldet sich jetzt für seine gesamte Dauer selbst als beschäftigt.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'inhalt-hinzufuegen-gross-kleinschreibung',
    title: 'Ein erneut hinzugefügter Mod mit anderer Groß-/Kleinschreibung im Dateinamen konnte doppelt geführt werden',
    detail:
      'Windows und macOS unterscheiden bei Dateinamen nicht zwischen Groß- und Kleinschreibung, der ' +
      'Vergleich beim Hinzufügen eines Inhalts tat es aber doch. Wurde ein bereits erfasster Mod erneut ' +
      'importiert, dabei aber mit anderer Schreibweise seines Dateinamens (etwa "Mod.jar" statt ' +
      '"mod.jar", tatsächlich dieselbe Datei), erkannte der Vergleich den alten Datensatz nicht wieder, ' +
      'und zwei Zeilen für dieselbe physische Datei standen in der Liste, bis der nächste Ordner-Abgleich ' +
      'sie zusammenführte. Der Vergleich ist jetzt wie an anderer Stelle im selben Ablauf ' +
      'groß-/kleinschreibungsunabhängig.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'reparatur-uebergeht-beschaedigte-lokale-datei',
    title: 'Die Reparatur erkannte eine beschädigte, von Hand hinzugefügte Datei, tat aber nichts damit und meldete keinen Fehler',
    detail:
      'Für eine von Hand hinzugefügte Mod-Datei ohne bekannte Quelle prüft die Reparatur die vorhandene ' +
      'Prüfsumme. War die Datei nicht auffindbar, wurde ihr Eintrag korrekt entfernt. War sie aber ' +
      'vorhanden und lediglich beschädigt (Prüfsumme stimmt nicht mehr), geschah gar nichts: keine ' +
      'Reparatur, da es für eine Datei ohne bekannte Quelle nichts zum erneuten Herunterladen gibt, aber ' +
      'auch keine Meldung im Abschlussbericht. Der Bericht konnte dadurch "in Ordnung" oder "repariert" ' +
      'anzeigen, obwohl eine nachweislich beschädigte Datei unangetastet auf der Festplatte blieb. ' +
      'Dieser Fall wird jetzt im Bericht als nicht automatisch reparierbar aufgeführt.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'reparatur-meldet-installiert-trotz-fehler',
    title: 'Die Reparatur markierte eine Instanz als vollständig installiert, selbst wenn einzelne Schritte fehlgeschlagen waren',
    detail:
      'Am Ende einer Reparatur wurde die Instanz immer als vollständig installiert gespeichert, unabhängig ' +
      'davon, ob einer der acht Reparaturschritte selbst als fehlgeschlagen galt. Ein Netzwerkausfall ' +
      'mitten in den Kern-Schritten (Spieldateien, Ressourcen, Java) ließ die Instanz damit tatsächlich ' +
      'unvollständig zurück, während der gespeicherte Zustand trotzdem "vollständig installiert" sagte, ' +
      'im Widerspruch zum eigenen Bericht direkt darunter. Die Markierung hängt jetzt davon ab, ob die ' +
      'Reparatur wirklich ohne Fehlschlag durchlief; bei einem Fehlschlag bleibt der vorherige Stand ' +
      'unverändert, statt fälschlich auf "installiert" gesetzt zu werden.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'reparatur-java-pruefung-veralteter-stand',
    title: 'Eine während einer laufenden Reparatur geänderte Java-Einstellung wurde noch gegen den alten Stand geprüft',
    detail:
      'Die Reparatur las die Instanz-Einstellungen einmal ganz am Anfang und arbeitete für ihre gesamte ' +
      'Dauer, bei größeren Instanzen durchaus mehrere Minuten, mit diesem einen Stand weiter. Änderte ' +
      'jemand währenddessen den fest eingestellten Java-Pfad oder die Java-Versionsvorgabe dieser ' +
      'Instanz, prüfte der Java-Schritt der laufenden Reparatur weiterhin gegen die alte Einstellung und ' +
      'konnte "Java in Ordnung" melden, obwohl die gerade gespeicherte neue Einstellung nie geprüft ' +
      'wurde. Dieser eine Schritt liest die Einstellungen jetzt unmittelbar vor der eigentlichen Prüfung ' +
      'erneut, genau wie es der Mod-Schritt derselben Reparatur schon tat.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'quilt-neueste-version-falsch-ausgewaehlt',
    title: 'Beim Einrichten mit Quilt konnte eine alte Vorabversion statt der neuesten stabilen ausgewählt werden',
    detail:
      'Anders als angenommen liefert Quilts eigener Server für Loader-Versionen kein Feld, das eine ' +
      'Version als stabil kennzeichnet, und die Liste kommt auch nicht in einer sinnvollen Reihenfolge ' +
      'zurück. Live nachgemessen: für eine gewöhnliche Minecraft-Version stand eine alte Beta-Version an ' +
      'erster Stelle, deutlich neuere, echte Veröffentlichungen weiter hinten. Die "neueste stabile ' +
      'Version" wurde bisher aus genau dieser ersten Stelle gelesen, richtete sich beim Einrichten einer ' +
      'neuen Instanz mit Quilt also nach Zufall statt nach der tatsächlich neuesten Version. Die Liste ' +
      'wird jetzt selbst nach Versionsnummer sortiert, und eine echte Vorabversion wird an ihrem ' +
      'Namen erkannt, nicht an einem Feld, das es bei Quilt gar nicht gibt. Fabric ist davon nicht ' +
      'betroffen, dessen eigene Kennzeichnung der empfohlenen Version bleibt maßgeblich.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'forge-installer-url-fuer-alte-versionen-kaputt',
    title: 'Forge-Installation schlug für mehrere ältere, häufig modifizierte Minecraft-Versionen fehl',
    detail:
      'Manche älteren Forge-Veröffentlichungen liegen auf dem offiziellen Server unter einem Pfad mit ' +
      'einem zusätzlichen Namensanhang. Dieser Anhang wurde beim Aufbau der Versionsliste entfernt, um ' +
      'die Version mit der von Forge getrennt geführten Liste "empfohlener" Versionen abzugleichen, aber ' +
      'beim eigentlichen Herunterladen des Installers nie wieder ergänzt. Live nachgemessen: die ' +
      'entstehende Adresse antwortete mit "nicht gefunden", die richtige, mit dem Anhang, mit Erfolg. ' +
      'Betroffen war ausgerechnet die von Forge selbst empfohlene Version für mehrere ältere, unter ' +
      'Mod-Nutzern besonders verbreitete Minecraft-Versionen (unter anderem 1.7.10, 1.8.9, 1.9.4). Wer ' +
      'eine Instanz mit Forge für eine dieser Versionen anlegte, konnte den Installer nicht laden.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'loader-fehler-wird-verschluckt',
    title: 'Eine fehlgeschlagene Abfrage der Mod-Loader-Versionen wurde von Fabric, Quilt, Forge und NeoForge selbst schon verschluckt',
    detail:
      'Der Instanz-Assistent unterscheidet seit Kurzem zwischen "kein Loader für diese Version verfügbar" ' +
      'und "die Abfrage ist fehlgeschlagen", mit einem Hinweis und einer Wiederholen-Schaltfläche für den ' +
      'zweiten Fall. Diese Unterscheidung konnte aber nie greifen: Die vier Funktionen, die die ' +
      'tatsächliche Abfrage für Fabric, Quilt, Forge und NeoForge durchführen, fingen selbst jeden Fehler ' +
      'ab und lieferten still eine leere Liste zurück, bevor der Assistent den Unterschied überhaupt ' +
      'sehen konnte. Eine echte Netzwerkstörung sah für alle vier unterstützten Loader also weiterhin wie ' +
      'ein bloßes Fehlen aus, ganz ohne den vorgesehenen Hinweis. Ein Fehlschlag wird jetzt bis zum ' +
      'Assistenten durchgereicht statt an dieser Stelle verschwiegen.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'safejoin-laufwerkswurzel-bricht',
    title: 'Die zentrale Pfad-Absicherung konnte bei einem Datenverzeichnis direkt auf einer Laufwerkswurzel jeden Pfad ablehnen',
    detail:
      'Die Funktion, die jeden aus nicht vertrauenswürdigen Quellen (Archive, Loader-Metadaten) ' +
      'gebauten Pfad gegen ein Verlassen des erlaubten Ordners prüft, verglich das Ergebnis gegen den ' +
      'erlaubten Ordner mit einem stets angehängten Trennzeichen. Liegt der erlaubte Ordner selbst direkt ' +
      'auf einer Laufwerks- oder Freigabewurzel (zum Beispiel ein eigenes Laufwerk nur für Minecraft-Daten), ' +
      'trägt dessen aufgelöster Pfad bereits ein Trennzeichen, wodurch der Vergleich verdoppelt und in ' +
      'der Folge jeder, auch ein völlig harmloser, Pfad abgelehnt wurde. Kein bekannter Aufrufer nutzt ' +
      'heute ein solches Wurzelverzeichnis, insofern hatte das bisher keine Auswirkung, aber ein eigenes ' +
      'Laufwerk als Datenverzeichnis ist eine reale, naheliegende Einrichtung. Der Vergleich funktioniert ' +
      'jetzt unabhängig davon, ob der erlaubte Ordner selbst schon ein Trennzeichen am Ende trägt.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18'
  },
  {
    id: 'versions-id-reservierter-name',
    title: 'Eine von einem Loader-Metadatenserver gelieferte Versions-Kennung mit reserviertem Windows-Namen konnte die Installation hart abbrechen lassen',
    detail:
      'Windows verweigert bestimmte Namen (etwa "con", "aux", "nul") als Datei- oder Ordnernamen, ' +
      'unabhängig von Groß-/Kleinschreibung oder Dateiendung. Für Instanznamen ist das bereits ' +
      'abgesichert, für die Versions-Kennung, die ein Fabric-/Quilt-Metadatenserver oder ein ' +
      'Forge-Installer-Profil liefert, fehlte dieselbe Absicherung. Eine solche Kennung wird direkt als ' +
      'Ordner- und Dateiname verwendet; träfe sie zufällig oder durch eine manipulierte Quelle auf einen ' +
      'dieser reservierten Namen, bräche die Installation unter Windows mit einer rohen, unverständlichen ' +
      'Dateisystem-Fehlermeldung ab statt mit einer der sonst üblichen, klaren Meldungen. Dieselbe ' +
      'Absicherung wie bei Instanznamen gilt jetzt auch hier.',
    state: 'fixed',
    since: '2026-09-12',
    fixedIn: '1.0.18',
    platforms: ['Windows']
  },
  {
    id: 'schliessen-beendet-laufendes-spiel',
    title: 'Das Launcher-Fenster zu schließen konnte ein laufendes Spiel mit beenden, obwohl es weiterlaufen sollte',
    detail:
      'Der Schließen-Knopf des Fensters führte immer zum vollständigen Beenden des Launchers. Lief dabei ' +
      'gerade eine Instanz, endete Minecraft in der Praxis mit, selbst wenn unter Einstellungen, ' +
      'Spielstart die Option stand, laufende Spiele weiterlaufen zu lassen. Der Knopf hat die Einstellung ' +
      'schlicht nie geprüft. Er tut es jetzt: Läuft mindestens eine Instanz und ist nicht ausdrücklich ' +
      'eingestellt, sie beim Beenden mit zu schließen, wird das Fenster nur noch versteckt statt den ' +
      'Launcher zu beenden, genau wie es beim automatischen Verstecken während des Spielens schon ' +
      'funktioniert. Es taucht von selbst wieder auf, sobald das letzte laufende Spiel beendet wurde.',
    state: 'fixed',
    since: '2026-09-13',
    fixedIn: '1.0.18'
  },
  {
    id: 'fabric-quilt-pruefsumme-verworfen',
    title: 'Eine von Fabric oder Quilt mitgelieferte Prüfsumme wurde nie gelesen',
    detail:
      'Für Bibliotheken, die ihre eigene Maven-Adresse statt eine fertige Download-URL mitbringen, ' +
      'genau der übliche Fall bei Fabric und Quilt, baute der Launcher den Download ohne Prüfsumme und ' +
      'ohne erwartete Größe auf, obwohl beides im selben Datensatz der Loader-Metadaten direkt daneben ' +
      'steht. Der interne Datentyp für diese Bibliotheken kannte die Felder schlicht nicht. Wer den ' +
      'Fabric- oder Quilt-Maven-Server erreichen oder unterwegs abfangen kann, hätte dadurch für die ' +
      'beiden am häufigsten genutzten Loader eine falsche Datei unterschieben können, ohne dass der ' +
      'Launcher es bemerkt hätte. Die Prüfsumme wird jetzt mit übernommen und geprüft, wenn die Quelle ' +
      'sie mitliefert.',
    state: 'fixed',
    since: '2026-09-20',
    fixedIn: '1.0.20'
  },
  {
    id: 'zip-entpacken-ohne-groessendeckel',
    title: 'Ein Modpack mit einer stark komprimierten Datei konnte den Launcher zum Absturz bringen',
    detail:
      'Beim Entpacken der Zusatzdateien eines Modpacks (zum Beispiel eigene Konfigurationen aus einem ' +
      '.mrpack oder einem CurseForge-Paket) wurde jede Datei vollständig in den Arbeitsspeicher entpackt, ' +
      'ohne vorher zu prüfen, wie groß sie nach dem Entpacken tatsächlich wird. Eine einzelne, absichtlich ' +
      'winzige, aber extrem stark komprimierte Datei in einem ganz gewöhnlich aussehenden Modpack hätte so ' +
      'beim Import mehrere Gigabyte Speicher anfordern und den Launcher zum Absturz bringen können. Jede ' +
      'Entpackstelle im Programm prüft die deklarierte Größe jetzt vorher gegen eine Obergrenze.',
    state: 'fixed',
    since: '2026-09-20',
    fixedIn: '1.0.20'
  },
  {
    id: 'instanzbild-pfad-nicht-abgesichert',
    title: 'Ein eigenes Instanz-Icon oder ein eigener Hintergrund konnte theoretisch aus dem vorgesehenen Ordner ausbrechen',
    detail:
      'Die Funktion, die aus dem gespeicherten Verweis eines Icons oder Hintergrundbilds den echten ' +
      'Dateipfad baut, nutzte an dieser einen Stelle einen einfachen Pfad-Zusammenbau statt der im ' +
      'restlichen Programm überall verwendeten, geprüften Funktion dafür. Ein Verweis mit "../"-Anteilen ' +
      'hätte auf eine Datei außerhalb des Icon-Ordners zeigen können. Über die normale Bedienung des ' +
      'Launchers war das nicht auslösbar, nur über einen ungewöhnlichen, von außen erzwungenen Wert. Die ' +
      'Stelle nutzt jetzt dieselbe geprüfte Funktion wie der Rest des Programms.',
    state: 'fixed',
    since: '2026-09-20',
    fixedIn: '1.0.20'
  },
  {
    id: 'java-test-kanal-ohne-einschraenkung',
    title: 'Ein interner, in der Oberfläche nirgends verwendeter Kanal konnte jede beliebige Datei ausführen',
    detail:
      'Ein technischer Kanal, mit dem sich eine Java-Installation an einem bestimmten Pfad prüfen lässt, ' +
      'kontrollierte nur, ob am angegebenen Pfad überhaupt eine Datei liegt, danach wurde sie ausgeführt. ' +
      'Es gab keine Prüfung, ob es sich tatsächlich um eine Java-Installation handelt. Dieser Kanal wurde ' +
      'zu keinem Zeitpunkt von der Oberfläche des Launchers selbst aufgerufen. Da er trotzdem vorhanden ' +
      'war, wurde er vollständig entfernt statt nur eingeschränkt. Die eigentliche Java-Erkennung, die ' +
      'immer nur die eigenen, selbst ermittelten Installationspfade prüft, ist davon nicht betroffen.',
    state: 'fixed',
    since: '2026-09-20',
    fixedIn: '1.0.20'
  },
  {
    id: 'sicherungs-pfad-ohne-instanzpruefung',
    title: 'Drei Funktionen der Datensicherung prüften nicht, ob die angegebene Instanz überhaupt existiert',
    detail:
      'Sicherungen auflisten, eine Sicherung löschen und eine Sicherung wiederherstellen bauten den ' +
      'betroffenen Ordnerpfad direkt aus der übergebenen Instanz-Kennung, ohne vorher wie an anderer ' +
      'Stelle im selben Bereich zu prüfen, dass diese Kennung zu einer wirklich vorhandenen Instanz ' +
      'gehört. Über die normale Bedienung des Launchers war das nicht auslösbar, da dort immer schon eine ' +
      'geöffnete oder aufgelistete, also echte Instanz zugrunde liegt. Alle drei Stellen prüfen jetzt ' +
      'zuerst, ob die Instanz existiert, genau wie es an der vierten, vergleichbaren Stelle schon der ' +
      'Fall war.',
    state: 'fixed',
    since: '2026-09-20',
    fixedIn: '1.0.20'
  },
  {
    id: 'download-umleitung-ohne-ziel-einschraenkung',
    title: 'Ein Download konnte über eine Umleitung auf eine Adresse im eigenen Netzwerk gelenkt werden',
    detail:
      'Wird eine Mod- oder Modpack-Datei von einer Adresse heruntergeladen, die auf eine andere Adresse ' +
      'umleitet, folgte der Launcher dieser Umleitung ohne zu prüfen, wohin sie tatsächlich zeigt. Eine ' +
      'manipulierte Downloadadresse hätte so eine Anfrage an eine Adresse im eigenen Netzwerk des Nutzers ' +
      'auslösen können (zum Beispiel den eigenen Rechner selbst oder ein Gerät im selben Netzwerk), ohne ' +
      'dass davon mehr als eine einzelne, harmlose Anfrage ausging. Umleitungen auf solche Adressen werden ' +
      'jetzt abgelehnt.',
    state: 'fixed',
    since: '2026-09-20',
    fixedIn: '1.0.20'
  },
  {
    id: 'einstellungsdatei-ohne-eingeschraenkte-rechte',
    title: 'Die Einstellungs- und Kontodatei wurden ohne eingeschränkte Dateirechte gespeichert',
    detail:
      'Die Dateien, in denen Einstellungen und Kontodaten liegen, wurden mit den vom Betriebssystem ' +
      'vergebenen Standardrechten geschrieben. Auf einem Rechner, den sich mehrere Benutzerkonten teilen, ' +
      'vor allem unter Linux oder macOS, hätte dadurch ein anderes Benutzerkonto auf demselben Rechner ' +
      'diese Dateien lesen können. Unter Windows ist das durch die übliche Ordnervererbung des eigenen ' +
      'Benutzerprofils deutlich weniger relevant. Beide Dateien werden jetzt nur noch für das eigene ' +
      'Benutzerkonto lesbar geschrieben.',
    state: 'fixed',
    since: '2026-09-20',
    fixedIn: '1.0.20',
    platforms: ['macOS', 'Linux']
  },
  {
    id: 'curseforge-schluessel-unverschluesselt',
    title: 'Der eigene CurseForge-API-Schlüssel liegt unverschlüsselt in der Einstellungsdatei',
    detail:
      'Anders als die Microsoft-Anmeldedaten wird ein eingetragener eigener CurseForge-API-Schlüssel ' +
      'nicht über die Verschlüsselung des Betriebssystems geschützt, sondern als Klartext gespeichert. ' +
      'Das Feld ist nur für Nutzer relevant, die von sich aus einen eigenen Schlüssel eingetragen haben. ' +
      'Eine echte Behebung würde das Speicherformat der Einstellungsdatei ändern und eine Übernahme ' +
      'bereits gespeicherter Schlüssel brauchen, das steht noch aus.',
    state: 'investigating',
    since: '2026-09-20'
  },
  {
    id: 'sicherung-ordner-liste-ohne-pruefung',
    title: 'Die Ordnerliste beim Sichern und Wiederherstellen war nicht auf die echten Sicherungsordner eingeschränkt',
    detail:
      'Welche Unterordner einer Instanz eine Sicherung umfasst (Welten, Konfiguration, Mods und so ' +
      'weiter) wird als kurze Liste von Ordnernamen gespeichert und beim Sichern wie beim ' +
      'Wiederherstellen wieder gelesen. Diese Liste wurde ungeprüft in Dateipfade eingesetzt. Eine ' +
      'Liste mit "../"-Anteilen hätte deshalb sowohl beim Erstellen einer Sicherung einen Ordner ' +
      'außerhalb der Instanz einpacken als auch beim Wiederherstellen einen Ordner außerhalb der ' +
      'Instanz verschieben können. Über die normale Bedienung des Launchers war das nicht auslösbar, ' +
      'da dort immer nur die sechs vorgesehenen Ordnernamen zur Auswahl stehen. Beide Stellen lassen ' +
      'jetzt ausschließlich diese sechs bekannten Namen zu, alles andere wird verworfen.',
    state: 'fixed',
    since: '2026-09-21',
    fixedIn: '1.0.20'
  },
  {
    id: 'instanz-aktualisieren-ohne-feldbeschraenkung',
    title: 'Eine Instanz zu bearbeiten war nicht auf die dafür vorgesehenen Felder eingeschränkt',
    detail:
      'Name, Beschreibung, Gruppe, Aussehen, Einstellungen und Favoritenstatus einer Instanz lassen ' +
      'sich über ein eigenes Bearbeiten-Feld ändern. Die Funktion dahinter übernahm aber tatsächlich ' +
      'jedes Feld, das ihr übergeben wurde, nicht nur diese sechs, weil die Beschränkung nur als ' +
      'Typ-Angabe bestand, aber nicht zur Laufzeit erzwungen wurde. Über die normale Bedienung des ' +
      'Launchers war das nicht auslösbar, da die Oberfläche dort nie mehr als diese sechs Felder ' +
      'sendet. Die Funktion übernimmt jetzt ausschließlich noch diese sechs Felder, unabhängig davon, ' +
      'was sonst noch mitgeschickt wird.',
    state: 'fixed',
    since: '2026-09-21',
    fixedIn: '1.0.20'
  },
  {
    id: 'inhalt-umbenennen-ohne-pruefung',
    title: 'Einen Mod oder ein Paket ein- und auszuschalten prüfte den Dateinamen nicht ab',
    detail:
      'Jede andere Stelle, die eine Mod-, Ressourcenpaket-, Shader- oder Datenpaket-Datei anfasst, ' +
      'reduziert deren Namen zuerst auf einen reinen Dateinamen ohne Ordneranteile. Das Ein- und ' +
      'Ausschalten (das Anhängen bzw. Entfernen der Endung, mit der Minecraft eine deaktivierte Datei ' +
      'erkennt) tat das nicht und baute den Pfad direkt aus dem gespeicherten Namen zusammen. Über die ' +
      'normale Bedienung des Launchers war das nicht auslösbar, da ein Dateiname dort immer schon ' +
      'bereinigt zustande kommt. Diese Stelle nutzt jetzt dieselbe Prüfung wie der Rest des Programms.',
    state: 'fixed',
    since: '2026-09-21',
    fixedIn: '1.0.20'
  },
  {
    id: 'reparatur-abbrechen-wirkungslos',
    title: 'Eine Reparatur ließ sich nicht wirklich abbrechen',
    detail:
      'Ein Klick auf Abbrechen stoppte nur die ersten Schritte einer Reparatur. Das Neuladen von Mods und ' +
      'das Aufräumen liefen im Hintergrund weiter, und die Aufgabenanzeige meldete am Ende sogar „Fertig“. ' +
      'Ab 1.0.20 hält jeder Schritt beim Abbrechen an, und die Anzeige sagt ehrlich, dass abgebrochen wurde.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'reparatur-kaputte-versionsdatei',
    title: 'Die Reparatur konnte eine beschädigte Versionsdatei nicht ersetzen',
    detail:
      'War die Versionsbeschreibung einer Instanz vorhanden, aber beschädigt, erkannte die Reparatur das ' +
      'zwar, ließ die Datei aber liegen. Jeder weitere Versuch scheiterte deshalb an derselben Stelle. ' +
      'Ab 1.0.20 wird eine unlesbare Versionsdatei entfernt und neu geladen.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'reparatur-bericht-verloren',
    title: 'Die Reparatur brach bei einzelnen Fehlern ganz ab, statt sie im Bericht zu nennen',
    detail:
      'Einige Schritte der Reparatur, etwa das Neuanlegen des Natives-Ordners, fingen einen Fehler nicht ' +
      'ab. Eine kurz von einem Virenscanner gesperrte Datei reichte, und statt des Schritt-für-Schritt-' +
      'Berichts erschien nur „Reparatur fehlgeschlagen“. Ab 1.0.20 landet jeder Fehler als eigener Schritt ' +
      'im Bericht, und die übrigen Schritte laufen weiter.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'reparatur-ohne-pruefsumme',
    title: 'Die Reparatur übersah beschädigte Dateien, für die keine Prüfsumme bekannt war',
    detail:
      'Manche Mods von CurseForge und manche Bibliotheken kommen ohne Prüfsumme. Solche Dateien prüfte die ' +
      'Reparatur nur darauf, ob sie vorhanden sind, nicht ob sie heil sind. Ab 1.0.20 vergleicht sie in ' +
      'diesem Fall die Dateigröße und prüft, ob sich ein Jar-Archiv überhaupt öffnen lässt.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'client-jar-fehlt-unklarer-absturz',
    title: 'Eine fehlende Spieldatei führte zu einem unverständlichen Absturz',
    detail:
      'Fehlte die Hauptdatei von Minecraft selbst, etwa nach einem abgebrochenen Download, startete der ' +
      'Launcher das Spiel trotzdem, und Java brach mit einer kryptischen Meldung ab. Ab 1.0.20 wird das vor ' +
      'dem Start erkannt und mit dem Hinweis gemeldet, die Instanz zu reparieren.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'fenstergroesse-alte-versionen',
    title: 'Die eingestellte Fenstergröße wirkte bei Minecraft vor 1.13 nicht',
    detail:
      'Breite und Höhe aus den Instanz-Einstellungen wurden nur an neuere Minecraft-Versionen übergeben. ' +
      'Ältere Versionen starteten immer in ihrer Standardgröße. Ab 1.0.20 gilt die Einstellung für alle ' +
      'Versionen.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'stoppen-fehlgeschlagen-absturz-verschluckt',
    title: 'Ein fehlgeschlagenes Beenden konnte einen späteren Absturz verschleiern',
    detail:
      'Ließ sich ein Spiel über „Stoppen“ nicht beenden, etwa weil ein Schutzprogramm das verhinderte, ' +
      'merkte sich der Launcher trotzdem, dass ein Stopp gewünscht war. Stürzte dasselbe Spiel danach ' +
      'wirklich ab, galt das als gewolltes Beenden, und es erschien keine Absturzmeldung. Ab 1.0.20 wird ' +
      'ein fehlgeschlagenes Beenden gemeldet und nicht mehr als Stopp gezählt.',
    state: 'fixing',
    since: '2026-09-24',
    platforms: ['Windows']
  },
  {
    id: 'java-ersatz-falsche-version',
    title: 'Bei ausgeschalteter Java-Verwaltung konnte ein unpassendes Java gewählt werden',
    detail:
      'Brauchte eine Instanz Java 8 und war nur ein neueres Java bis Version 12 installiert, nahm der ' +
      'Launcher dieses ersatzweise. Genau dieser Sprung lässt alte Forge-Versionen zuverlässig abstürzen. ' +
      'Ab 1.0.20 gibt es für Java 8 keinen Ersatz mehr, sondern eine klare Meldung.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'forge-versionsliste-unsortiert',
    title: 'Die Liste der Forge-Versionen war nicht richtig sortiert',
    detail:
      'Forge liefert seine Versionsliste nicht durchgehend in einer Reihenfolge. Der Launcher verließ sich ' +
      'darauf, und in der Auswahl eines Forge-Builds lagen neue und alte Versionen durcheinander. Ab 1.0.20 ' +
      'sortiert der Launcher die Liste selbst, die neueste steht oben.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'forge-installer-ohne-pruefung',
    title: 'Der Forge-Installer konnte ohne Prüfsumme ausgeführt werden',
    detail:
      'Scheiterte das Abrufen der Prüfsumme für den Forge- oder NeoForge-Installer, lud der Launcher den ' +
      'Installer trotzdem und führte ihn aus. Ab 1.0.20 wird die Prüfsumme mehrfach versucht, und ohne sie ' +
      'bricht die Installation mit einer verständlichen Meldung ab.',
    state: 'fixing',
    since: '2026-09-24'
  },
  {
    id: 'mod-schalten-waehrend-update',
    title: 'Ein Mod, der während eines Updates ein- oder ausgeschaltet wurde, konnte eine verwaiste Datei hinterlassen',
    detail:
      'Während ein Mod aktualisiert wurde, ließ er sich weiter ein- und ausschalten. Fiel beides zusammen, ' +
      'konnte das Update die Änderung überschreiben und eine Datei zurücklassen, die der Launcher danach ' +
      'als fremden Mod aufführte. Ab 1.0.20 warten Umschalten und Update aufeinander.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'duplikat-erkennung-nach-namen',
    title: 'Die Kompatibilitätsprüfung konnte einen fremden, gleichnamigen Mod zum Entfernen vorschlagen',
    detail:
      'Doppelt installierte Mods wurden allein am Namen erkannt. Zwei verschiedene Mods mit gleichem Namen ' +
      'galten so als Dublette, und die angebotene Korrektur hätte einen davon gelöscht. Ab 1.0.20 wird nur ' +
      'dann Entfernen angeboten, wenn es sicher derselbe Mod ist. Bei bloß gleichem Namen gibt es einen ' +
      'Hinweis ohne Löschknopf.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'instanz-kopie-ohne-bild',
    title: 'Eine kopierte Instanz verlor ihr eigenes Symbol und ihren Hintergrund',
    detail:
      'Beim Duplizieren wurden die Spieldateien kopiert, die eigenen Bilder der Instanz aber nicht. Die ' +
      'Kopie zeigte danach das Standardsymbol. Ab 1.0.20 werden Symbol und Hintergrund mitkopiert.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'instanz-kopie-waehrend-modaenderung',
    title: 'Duplizieren konnte mit gleichzeitigen Mod-Änderungen zusammenstoßen',
    detail:
      'Während eine große Instanz kopiert wurde, ließen sich an ihr weiter Mods installieren oder ' +
      'aktualisieren. Das Kopieren konnte dann abbrechen oder eine Kopie mit halb geänderten Mods ' +
      'erzeugen. Ab 1.0.20 warten Mod-Änderungen, bis das Kopieren fertig ist.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'instanz-loeschen-halb',
    title: 'Das Löschen einer Instanz konnte sie halb gelöscht zurücklassen',
    detail:
      'Hielt ein Virenscanner beim Löschen kurz eine Datei fest, brach das Löschen mittendrin ab. Der ' +
      'Launcher zeigte die Instanz danach weiter vollständig an, obwohl ein Teil ihrer Dateien schon fehlte. ' +
      'Ab 1.0.20 wird das Löschen mehrfach versucht, und nach einem Fehlschlag zeigt die Liste den ' +
      'tatsächlichen Stand.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'mod-abgleich-bricht-ab',
    title: 'Der Abgleich der Mod-Liste brach ab, wenn währenddessen eine Datei verschwand',
    detail:
      'Wurde eine Datei im Mods-Ordner genau während des Abgleichs gelöscht oder verschoben, etwa durch ' +
      'eine Cloud-Synchronisierung, brach der gesamte Abgleich ab. Ab 1.0.20 wird diese eine Datei ' +
      'übersprungen.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'gross-kleinschreibung-doppelte-mods',
    title: 'Zwei Mod-Dateien, die sich nur in Groß- und Kleinschreibung unterschieden, wurden verwechselt',
    detail:
      'Lagen zwei solche Dateien im selben Ordner, bekamen beide denselben Eintrag. Entfernen oder ' +
      'Umschalten des einen traf dann beide Einträge, obwohl nur eine Datei geändert wurde. Ab 1.0.20 ' +
      'bekommt jede Datei ihren eigenen Eintrag.',
    state: 'fixing',
    since: '2026-09-22',
    platforms: ['macOS', 'Linux']
  },
  {
    id: 'update-nach-rueckstufung',
    title: 'Nach einem bewussten Zurückstufen wurden keine Updates mehr angezeigt',
    detail:
      'Wer über „Version wählen“ eine ältere Version eines Mods installierte, bekam für diesen Mod danach ' +
      'oft nie wieder ein Update angezeigt. Verglichen wurde mit dem Installationszeitpunkt statt mit dem ' +
      'Erscheinungsdatum der installierten Version. Ab 1.0.20 zählt das Erscheinungsdatum.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'versionswechsel-alte-datei-bleibt',
    title: 'Beim Wechsel der Mod-Version konnte die alte Datei liegen bleiben',
    detail:
      'Wurde die alte Datei beim Wechsel auf eine andere Version kurz gesperrt, blieb sie neben der neuen ' +
      'liegen. Zwei Dateien desselben Mods lassen Minecraft beim nächsten Start abstürzen. Ab 1.0.20 wird ' +
      'das Löschen wiederholt, und gelingt es nicht, bleibt die neue Datei nicht halb eingetragen zurück.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'modrinth-abhaengigkeit-verschwindet',
    title: 'Eine benötigte Abhängigkeit konnte ohne Warnung wegfallen',
    detail:
      'Verwies ein Modrinth-Mod auf eine Abhängigkeit, deren Version inzwischen zurückgezogen war, fiel ' +
      'diese Abhängigkeit still aus der Liste. Die Warnung, dass ohne sie das Spiel womöglich nicht startet, ' +
      'erschien deshalb nie. Ab 1.0.20 erscheint sie.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'curseforge-modpack-fehlende-dateien-still',
    title: 'Ein CurseForge-Modpack-Import verschwieg fehlende Mods',
    detail:
      'Waren einzelne Dateien eines Modpacks bei CurseForge nicht mehr erhältlich, stand das nur kurz in ' +
      'der Aufgabenanzeige und war verschwunden, bevor der Import fertig war. Ab 1.0.20 bleibt dazu eine ' +
      'Meldung stehen, die die fehlenden Mods nennt.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'import-version-ungeprueft',
    title: 'Die Minecraft-Version aus importierten Modpacks und Ordnern wurde nicht geprüft',
    detail:
      'Beim Import wurde die angegebene Minecraft-Version ungeprüft übernommen und später als Ordnername ' +
      'verwendet. Ein präpariertes Modpack hätte darüber Pfade außerhalb des Launcher-Ordners ansprechen ' +
      'können. Ab 1.0.20 werden solche Angaben abgelehnt.',
    state: 'fixing',
    since: '2026-09-24'
  },
  {
    id: 'import-installiert-ohne-spieldateien',
    title: 'Eine importierte Instanz konnte als installiert gelten, obwohl Spieldateien fehlten',
    detail:
      'Beim Import liefen zwei Einrichtungen nebeneinander, eine für Minecraft selbst und eine für die ' +
      'Mods. Scheiterte die erste, konnte die zweite die Instanz trotzdem als fertig markieren, und der ' +
      'erste Start schlug ohne erkennbaren Grund fehl. Ab 1.0.20 gilt eine Instanz erst als installiert, ' +
      'wenn beides geklappt hat.',
    state: 'fixing',
    since: '2026-09-24'
  },
  {
    id: 'kopie-haengt-bei-einrichtung',
    title: 'Eine Kopie, die während der Einrichtung entstand, hing dauerhaft',
    detail:
      'Wurde eine Instanz dupliziert, während sie noch eingerichtet wurde, zeigte die Kopie für immer ' +
      '„wird eingerichtet“. Ab 1.0.20 ist Duplizieren erst nach der Einrichtung möglich.',
    state: 'fixing',
    since: '2026-09-24'
  },
  {
    id: 'wiederherstellung-rueckabwicklung-unvollstaendig',
    title: 'Nach einer abgebrochenen Wiederherstellung konnten Reste zurückbleiben',
    detail:
      'Scheiterte eine Wiederherstellung, meldete der Launcher in manchen Fällen, der vorherige Stand sei ' +
      'zurückgeholt, obwohl halb entpackte Ordner zurückgeblieben waren. Ab 1.0.20 nennt die Meldung genau, ' +
      'was nicht aufgeräumt werden konnte.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'sicherung-folgt-verknuepfungen',
    title: 'Sicherungen mit verknüpften Ordnern ließen sich nicht wiederherstellen',
    detail:
      'Enthielt ein gesicherter Ordner eine Verknüpfung, die aus der Instanz herauszeigte, wurde die ' +
      'Sicherung trotzdem als erfolgreich erstellt, ließ sich später aber nie wiederherstellen. Ab 1.0.20 ' +
      'werden solche Verknüpfungen beim Sichern übersprungen und gemeldet.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'wiederherstellung-entpackt-alles',
    title: 'Eine Wiederherstellung konnte mehr schreiben, als vorher gesichert worden war',
    detail:
      'Beim Wiederherstellen wurde immer das ganze Archiv entpackt, geschützt und zurückgerollt wurden aber ' +
      'nur die Ordner aus dem Verzeichnis der Sicherung. Bei älteren Sicherungen konnte beides auseinander ' +
      'liegen. Ab 1.0.20 wird nur entpackt, was auch geschützt ist.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'sicherungen-behalten-nicht-rueckwirkend',
    title: 'Eine kleinere Anzahl aufzubewahrender Sicherungen wirkte erst später',
    detail:
      'Wurde die Zahl der aufzubewahrenden automatischen Sicherungen gesenkt, blieben ältere Sicherungen ' +
      'liegen, bis für dieselbe Instanz die nächste entstand. Ab 1.0.20 wird sofort aufgeräumt.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'aufnahme-falsche-instanz',
    title: 'Bei zwei laufenden Spielen nahm die Aufnahmetaste das falsche auf',
    detail:
      'Liefen zwei Instanzen gleichzeitig, nahm die Taste immer die zuerst gestartete auf, nicht die zuletzt ' +
      'gestartete, die man meist gerade spielt. Die Meldung nannte die Instanz nicht. Ab 1.0.20 wird die ' +
      'zuletzt gestartete aufgenommen und in der Meldung genannt.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'verknuepfungen-zwei-links-verloren',
    title: 'Zwei kurz hintereinander geöffnete Launch-Gabi-Links: der erste ging verloren',
    detail:
      'Kamen während des Programmstarts zwei Links oder Verknüpfungen fast gleichzeitig an, überschrieb der ' +
      'zweite den ersten. Ab 1.0.20 werden beide der Reihe nach ausgeführt.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'datenverzeichnis-ungueltig-gespeichert',
    title: 'Ein nicht beschreibbarer Datenordner wurde trotzdem übernommen',
    detail:
      'Wählte man in den Einstellungen einen Datenordner, in den der Launcher nicht schreiben darf, wurde ' +
      'die Wahl trotzdem gespeichert. Danach wirkten alle Instanzen verschwunden. Ab 1.0.20 wird der Ordner ' +
      'vorher geprüft, und bei einem Problem bleibt der alte bestehen.',
    state: 'fixing',
    since: '2026-09-24'
  },
  {
    id: 'anmeldung-verschluesselung-wechsel',
    title: 'Eine unnötige Neuanmeldung, wenn sich die Verschlüsselung des Systems änderte',
    detail:
      'Ob die Anmeldedaten verschlüsselt gespeichert sind, wurde für zwei getrennte Schlüssel nur einmal ' +
      'vermerkt. Stand die Verschlüsselung des Systems, etwa der Schlüsselbund unter Linux, einmal zur ' +
      'Verfügung und einmal nicht, passte der Vermerk nicht mehr, und man musste sich neu anmelden. Ab ' +
      '1.0.20 wird das für jeden Schlüssel einzeln vermerkt.',
    state: 'fixing',
    since: '2026-09-24',
    platforms: ['Linux']
  },
  {
    id: 'startseite-wieder-aktiviert',
    title: 'Die eigene Startseite schaltete sich nach dem Abwählen in Minecraft wieder ein',
    detail:
      'Wer das Startseiten-Paket in Minecraft selbst deaktivierte, bekam es beim nächsten Start ' +
      'stillschweigend wieder aktiviert. Ab 1.0.20 respektiert der Launcher diese Wahl.',
    state: 'fixing',
    since: '2026-09-24'
  },
  {
    id: 'escape-schliesst-zwei-fenster',
    title: 'Escape in der Schnellsuche schloss auch das Fenster darunter',
    detail:
      'War ein Fenster offen, zum Beispiel die Microsoft-Anmeldung, und darüber die Schnellsuche (Strg+K), ' +
      'schloss Escape beide auf einmal und brach die Anmeldung ab. Ab 1.0.20 schließt Escape nur die ' +
      'Schnellsuche.',
    state: 'fixing',
    since: '2026-09-24'
  },
  {
    id: 'zahlen-mit-punkt',
    title: 'Größenangaben zeigten einen Punkt statt eines Kommas',
    detail:
      'Datei- und Speichergrößen erschienen als „1.5 GB“ statt „1,5 GB“. Ab 1.0.20 stehen sie in deutscher ' +
      'Schreibweise da.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'assistent-ungueltige-kombination',
    title: 'Im Assistenten ließ sich eine Instanz mit einer nicht vorhandenen Loader-Version anlegen',
    detail:
      'Während der Assistent noch prüfte, welche Loader es für eine Minecraft-Version gibt, ließ sich die ' +
      'Instanz bereits anlegen, auch mit einer Kombination, die es gar nicht gibt. Ab 1.0.20 geht es erst ' +
      'weiter, wenn die Prüfung fertig und die Wahl gültig ist.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'assistent-snapshot-bleibt',
    title: 'Im Assistenten blieb nach dem Ausblenden der Snapshots eine Snapshot-Version gewählt',
    detail:
      'War eine Snapshot-Version gewählt und wurden die Snapshots danach ausgeblendet, blieb sie unsichtbar ' +
      'gewählt und wurde so angelegt. Ab 1.0.20 springt die Wahl dann auf die neueste reguläre Version.',
    state: 'fixing',
    since: '2026-09-22'
  },
  {
    id: 'arbeitsspeicher-regler-ohne-grenze',
    title: 'Der Arbeitsspeicher-Regler erlaubte mehr, als der Rechner hat',
    detail:
      'Die Regler für den Arbeitsspeicher gingen je nach Stelle bis 16 oder 32 GB, unabhängig vom ' +
      'eingebauten Speicher. Ab 1.0.20 enden alle Regler beim tatsächlich vorhandenen Arbeitsspeicher.',
    state: 'fixing',
    since: '2026-09-24'
  }
]

/** Everything that is not done yet, newest first. */
export function openIssues(): KnownIssue[] {
  return KNOWN_ISSUES.filter((issue) => issue.state !== 'fixed')
}
