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

## Eigenes Minecraft-Hauptmenü

- [ ] Neu besprechen. Die Beta "Eigene Startseite" ist aus der Oberfläche
      entfernt, der Code liegt unangetastet in `src/main/core/startScreen.ts`
      und `mod/`. Offen ist, welche Form das Vorhaben überhaupt bekommen soll.

## Länger offen

- [ ] Ursache des HTTP-400-Anmeldefehlers ist weiterhin unbekannt, siehe
      `src/shared/knownIssues.ts`.
