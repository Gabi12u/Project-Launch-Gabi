# Offene Punkte

Was noch aussteht, aufgeschrieben damit es nicht untergeht. Erledigtes wird
gestrichen oder entfernt, nicht heimlich umgeschrieben.

## Import-Assistent (gebaut, wartet auf Freigabe)

**Stand 2026-09-10: Die neue Oberfläche geht erst raus, wenn Gabriel sie
gesehen und bestätigt hat.** Bis dahin bleibt sie hier stehen. Wie beim
Oberflächen-Umbau weiter unten gilt: eine Version, die getaggt wird, darf
diesen Assistenten nicht nebenbei mitnehmen, solange die Freigabe fehlt.

Was fertig und geprüft ist:

- [x] Analyse getrennt vom Import. `analyzeInstanceFolder()` und
      `analyzeModpackFile()` lesen nur und liefern Quelle, Version, Loader,
      Zählungen und Befunde, bevor irgendetwas angelegt wird.
- [x] Drei zusätzliche Quellformate: Modrinth App, Lunar Client, Feather
      Client. Die letzten beiden führen keine eigene Beschreibung mit, ihre
      Version wird geschätzt, und genau das steht dann auch im Bericht.
- [x] Prüfung nach dem Import (`importCheck.ts`): Versionsprofil, Loader,
      Mods am richtigen Ort, Kompatibilität. Als Befundliste, nicht als
      grüner Haken. Repariert absichtlich nichts.
- [x] Ende-zu-Ende geprüft mit echten Ordnern und echten Archiven:
      `scripts/test-import-run.mjs` und `scripts/test-import-packs.mjs`.
      Der Import kopiert nachweislich, und der Quellordner bleibt Byte für
      Byte unverändert.

Was noch offen ist:

- [ ] **Gabriel schaut sich den Assistenten an und gibt ihn frei.** Ohne das
      passiert nichts weiter damit.
- [ ] Die Oberfläche wurde nie im laufenden Launcher gesehen, nur gebaut und
      typgeprüft. Kein Playwright im Projekt, und dafür eines einzuziehen
      wäre für diesen einen Zweck zu viel.
- [ ] Der eigentliche Modpack-Import (nicht die Analyse) lädt jeden Mod
      einzeln herunter. Ungeprüft, weil dafür Netz und bei CurseForge ein
      API-Schlüssel gebraucht wird.
- [ ] Lunar und Feather sind am Pfad erkannt, nicht an einer Datei. Ob das
      bei echten Installationen dieser beiden Clients trägt, hat noch
      niemand mit einer echten Installation ausprobiert.

## Mod-Netzwerk-Analyse (geplant, noch nicht angefangen)

Plan liegt vor, Stufe 1 ohne Java-Agent, Stufe 2 mit. Wird erst angefangen,
wenn der Import-Assistent freigegeben ist.

## Reparatur, Update- und Startfenster (aus 1.0.16, noch nicht veröffentlicht)

**Beim Prüfen des Renderer-Codes am 2026-09-11 gefunden, bevor das hier
rausgeht zu beheben:**

- [ ] Das Startfenster kann sich festfahren. `startInstance` öffnet das
      Fenster, bevor der Startbefehl losgeht. Lehnt `launchInstance` den Start
      noch vor dem ersten Statusschritt ab (Instanz wird repariert, an den Mods
      wird gearbeitet, eine Sicherung läuft, oder das Spiel läuft schon), dann
      bekommt das Fenster nie einen Status, bleibt auf `busy` und sperrt
      Escape, Klick daneben und das Kreuz. Nur ein Neustart hilft. Das Fenster
      muss erst öffnen, wenn der erste Status da ist, oder der Fehlerfall muss
      es selbst wieder schließen.
- [ ] Der Import-Assistent (`startImport` in `lib/actions.ts`) öffnet das
      Fenster erst nach der Analyse, nicht davor. Der `analyzing`-Zustand im
      `ImportWizard` ist damit toter Code, nach dem Dateidialog steht die
      Oberfläche mehrere Sekunden still, und ein zweiter Klick öffnet einen
      zweiten Dialog. Gehört zum Import-Assistenten weiter oben, wird dort
      mitbehoben.

Gebaut und typgeprüft, aber **nie gegen einen echten Fehlerfall gelaufen**:

- [ ] Reparatur-Fenster gegen eine wirklich kaputte Instanz testen: fehlende
      Datei, beschädigte Datei, doppelte Mod, Mod ohne passende Version.
      Bisher nur die Entscheidungslogik einzeln geprüft, nie der ganze
      Durchlauf mit sichtbarem Live-Log.
- [ ] Start-Fenster gegen einen echten Absturz testen. Die Ursachen-Erkennung
      ist eine begrenzte Heuristik (Speicher, Mixin, fehlende Abhängigkeit,
      Versions-Konflikt) und wurde nur gegen Beispieltexte geprüft, nie gegen
      ein echtes Absturzprotokoll.
- [ ] Update-Fenster gegen ein echtes Launcher-Update testen. Der Zustand
      kommt aus dem vorhandenen Updater, das Fenster selbst hat aber noch nie
      einen echten Download begleitet.
- [ ] Randfälle aus dem Prompt, die noch niemand ausprobiert hat: kein
      Internet, Datei gesperrt, Reparatur mitten drin abgebrochen, Launcher
      während eines Updates geschlossen.

## Oberflächen-Umbau (pausiert, Richtung offen)

**Stand 2026-09-03: Gabriel findet das ältere Aussehen besser.** Das Vorhaben
liegt damit auf Eis, bis die Richtung geklärt ist. Nichts davon ist
zurückgenommen, der aktuelle Stand auf `main` zeigt den neuen Look.

**2026-09-04: bewusst nicht in 1.0.17.** Diese Version kommt aus einem
eigenen Zweig, der bei `v1.0.16` beginnt und nur die Anmelde-Fixes
trägt. Kein Nutzer bekommt die neue Optik, solange hier nicht
entschieden ist. Solange das so bleibt, muss jede weitere Version
denselben Weg nehmen oder die Frage vorher klären.

Zu klären, bevor hier weitergearbeitet wird:

- [ ] Soll der Umbau zurückgenommen werden, ganz oder teilweise? Der alte
      Zustand liegt in `d9480c1` und davor, ein Zurücknehmen wäre also
      unkompliziert.
- [ ] Falls er bleibt: was genau war am alten besser? Vermutlich der ruhige,
      aber lebendige Hintergrund und die weicheren Karten, die beim Umbau
      bewusst flach gemacht wurden.

Schon umgesetzt und auf `main`:

- [x] Navigation als Leiste oben, umschaltbar auf die alte Seitenspalte
      unter Einstellungen, Darstellung.
- [x] Neue Seiten Resource Packs, Shader (jeweils nur aktive Instanz),
      Downloads und News. "Entdecken" ist ein Reiter in "Mods", Backups ein
      Abschnitt in den Einstellungen.
- [x] Instanzen als Liste mit Chips, grünem Start-Knopf und Menü, dazu die
      Panels für aktuelle Instanz und Speicher.
- [x] "Duplizieren" ist jetzt erreichbar, gab es im Hintergrund längst.
- [x] Zier-Effekte entfernt: driftende Farbfelder, Würfel, Bodengitter,
      Zeiger-Beleuchtung, 3D-Neigung, Parallaxe, Verlaufsschrift, Glühen
      hinter Symbolen, Verlauf auf dem Primärknopf.

Noch nicht angefasst:

- [ ] Sidebar-Fuß: Launcher-Version und Status.
- [ ] RAM und Speicherverbrauch auf den Instanzkarten selbst.
- [ ] Instanz-Detailseite und Einstellungen sind noch im alten Aufbau.
- [ ] Das Logo bleibt unangetastet, in jeder Variante.

## Eigenes Minecraft-Hauptmenü

- [ ] Neu besprechen. Die Beta "Eigene Startseite" ist aus der Oberfläche
      entfernt, der Code liegt unangetastet in `src/main/core/startScreen.ts`
      und `mod/`. Offen ist, welche Form das Vorhaben überhaupt bekommen soll.

## Eigene Anwendungs-ID bei Microsoft, erledigt

Der Launcher meldete sich mit `00000000402b5328` an, der Anwendung des
offiziellen Minecraft-Launchers, nicht unserer. Microsoft wies sie für
fremde Programme zunehmend ab, und genau das war der HTTP-400-Fehler
beim Anmelden. Seit 2026-09-08 gibt es eine eigene Registrierung
(`ddf22ce8-a28e-4da9-bd5f-f723e77140ce`), am 2026-09-11 von Hand
nachgemessen statt vermutet, mit `node scripts/test-azure-login.mjs`:
Gerätecode, Anmeldung, Xbox Live, Xbox-Freigabe und Minecraft selbst
laufen alle fünf sauber durch. Das erwartete Freigabeformular bei
Mojang war entgegen der Erwartung gar nicht nötig, der frühere
403-Fehler war offenbar vorübergehend. Die ID steckt jetzt als Standard
in `src/shared/defaults.ts`, und wer den Launcher schon installiert
hat, wird beim nächsten Start automatisch umgestellt
(`src/main/store.ts`, `sanitize()`). Eintrag `login-http-400` in
`src/shared/knownIssues.ts` steht auf `fixed`, `fixedIn: '1.0.18'`.

Zum Nachlesen: https://minecraft.wiki/w/Microsoft_authentication
