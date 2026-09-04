# Offene Punkte

Was noch aussteht, aufgeschrieben damit es nicht untergeht. Erledigtes wird
gestrichen oder entfernt, nicht heimlich umgeschrieben.

## Reparatur, Update- und Startfenster (aus 1.0.16, noch nicht veröffentlicht)

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

- [ ] **Ein Azure-Verzeichnis.** Ein privates Microsoft-Konto hat keins.
      Über `portal.azure.com`, Mandanten verwalten, Erstellen ist es am
      2026-09-04 nicht gelungen. Bleibt `azure.microsoft.com/free`, das
      verlangt eine Karte zur Identitätsprüfung, bucht aber nichts ab.
- [ ] **Anwendung registrieren.** App registrations, New registration,
      Name `Launch Gabi`, bei den Kontotypen "Any organizational
      directory and personal Microsoft accounts", Redirect URI leer.
      Danach unter Authentication "Allow public client flows" auf Yes.
- [ ] **Freigabe bei Mojang beantragen**, mit der neuen Anwendungs-ID:
      https://aka.ms/mce-reviewappid
      Ohne diese Freigabe antwortet `api.minecraftservices.com` mit 403.
      Der Launcher erklärt diesen Fall seit 1.0.18 im Klartext.
- [ ] **Erst danach** die ID als Standard in `src/shared/defaults.ts`
      eintragen. Vorher wäre sie für alle Nutzer eine Verschlechterung.

Zum Nachlesen: https://minecraft.wiki/w/Microsoft_authentication

## Länger offen

- [ ] Ursache des HTTP-400-Anmeldefehlers ist damit sehr wahrscheinlich
      gefunden, aber erst bewiesen, wenn eine eigene, freigegebene
      Anwendungs-ID läuft. Siehe `src/shared/knownIssues.ts`.
