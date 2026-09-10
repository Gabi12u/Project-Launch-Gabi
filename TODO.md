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

## Eigene Anwendungs-ID bei Microsoft

Der Launcher benutzt `00000000402b5328`. Das ist die Anwendung des
offiziellen Minecraft-Launchers, nicht unsere. Microsoft weist sie für
fremde Programme zunehmend ab, und genau das ist der HTTP-400-Fehler beim
Anmelden: nach etwa 70 Sekunden, also direkt nachdem der Nutzer im
Browser fertig ist, verweigert Microsoft das Token mit `invalid_grant`
und "grant the client application access to the requested scope".

Der Weg dorthin, in dieser Reihenfolge:

- [x] **Ein Azure-Verzeichnis.** Ein privates Microsoft-Konto hat keins.
      Über `portal.azure.com`, Mandanten verwalten, Erstellen ist es am
      2026-09-04 nicht gelungen. Über `azure.microsoft.com/free` dann
      am 2026-09-08 doch: das Konto hat seitdem ein `Default Directory`,
      und darin wird registriert. Ein neuer Mandant war nie nötig, der
      kostenlose Zugang legt eins von selbst an. Eine App-Registrierung
      kostet nichts und braucht kein Abonnement.
- [x] **Anwendung registrieren.** Am 2026-09-08 erledigt. Name
      `Launch Gabi`, Kontotypen "Alle Konten von Entra ID-Mandanten und
      persönliche Microsoft-Konten", Redirect URI leer, unter
      Authentifizierung "Öffentliche Clientflows zulassen" auf Ja.

      Anwendungs-ID: `ddf22ce8-a28e-4da9-bd5f-f723e77140ce`

      Kein Geheimnis, sie gehört später ohnehin in `defaults.ts` und
      damit in jede Installation. Unter "Zertifikate & Geheimnisse"
      wurde bewusst nichts angelegt: der Gerätecode-Weg braucht keins,
      und ein Programm auf fremden Rechnern kann keines hüten.

      Azure warnt auf der Übersicht, dass Endnutzer mehrmandantenfähigen
      Apps ohne geprüften Herausgeber nicht zustimmen können. Für uns
      unerheblich, weil der Launcher ausschliesslich den `consumers`-
      Endpunkt anspricht, also nur persönliche Konten. Sollte sich das
      doch als Hürde zeigen, ist der Kontotyp "Nur persönliche Konten"
      der Ausweg, eine Auswahl im selben Aufklappmenü.
- [ ] **Freigabe bei Mojang beantragen**, mit der neuen Anwendungs-ID:
      https://aka.ms/mce-reviewappid
      Ohne diese Freigabe antwortet `api.minecraftservices.com` mit 403.
      Der Launcher erklärt diesen Fall seit 1.0.18 im Klartext.

      Am 2026-09-08 nachgemessen statt vermutet, mit
      `node scripts/test-azure-login.mjs`. Gerätecode, Anmeldung, Xbox
      Live und XSTS laufen mit der eigenen ID sauber durch, die
      Registrierung ist also richtig eingestellt. Erst Minecraft lehnt
      ab, mit genau dieser Antwort:

          403  "Invalid app registration, see
                https://aka.ms/AppRegInfo for more information"

      Damit ist die Freigabe die einzige verbleibende Hürde, und das
      Formular ist keine Rateaktion.

      Am 2026-09-08 abgeschickt. Antwort kommt per Mail, dauert Tage bis
      Wochen. Wenn sie da ist: nochmal `test-azure-login.mjs` laufen
      lassen, und erst bei fünf grünen Haken weitergehen.
- [ ] **Erst danach** die ID als Standard in `src/shared/defaults.ts`
      eintragen. Vorher wäre sie für alle Nutzer eine Verschlechterung.

Zum Nachlesen: https://minecraft.wiki/w/Microsoft_authentication

## Länger offen

- [ ] Ursache des HTTP-400-Anmeldefehlers ist damit sehr wahrscheinlich
      gefunden, aber erst bewiesen, wenn eine eigene, freigegebene
      Anwendungs-ID läuft. Siehe `src/shared/knownIssues.ts`.
