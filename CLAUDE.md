# Arbeitsregeln für dieses Projekt

Diese Datei wird bei jeder Sitzung automatisch geladen. Was hier steht, gilt
ohne Nachfrage.

## Gefundene Fehler gehören auf die Statusseite

**Sobald ein Fehler gefunden wird, den ein Nutzer bemerken kann, wird er in
`src/shared/knownIssues.ts` eingetragen. Ohne Ausnahme, ohne Nachfrage, und
bevor mit dem Reparieren begonnen wird.**

Danach immer:

```
node scripts/sync-status.mjs
```

Das schreibt die Liste in `status/index.html`. Ein Push auf `main` rollt die
Seite automatisch nach https://status.launchgabi.com aus.

**Warum:** Die Statusseite ist das Einzige, woran ein Nutzer erkennen kann, ob
ein Problem bekannt ist. Ein Fehler, der still repariert wird, hilft niemandem,
der ihn heute hat. Und ein Eintrag, der erst nach der Reparatur entsteht, wird
regelmäßig vergessen.

**Was hineingehört:** alles, was in einer **veröffentlichten** Version
auftreten kann, plus dauerhafte Grenzen. Ein Fehler, der beim Entwickeln
entstanden und vor dem Release wieder verschwunden ist, hat dort nichts zu
suchen, denn kein Nutzer kann ihn je erlebt haben.

**Was nicht hineingehört:** Aufräumarbeiten, toter Code, Dinge in der
Release-Kette, Vermutungen. Die Datei sagt in ihrem eigenen Kopf, warum: eine
als bekannt ausgegebene Vermutung ist schlimmer als Schweigen.

**Zustände:** `investigating`, `fixing`, `fixed` (dann mit `fixedIn`),
`limitation`. Ein Eintrag verschwindet nie, weil er unbequem ist. Er wird
`fixed`, mit der Version, in der die Reparatur wirklich steckt. Solange diese
Version noch nicht veröffentlicht ist, schreibt die Seite von selbst "Behoben,
kommt mit x.y.z".

## Wann überhaupt eine Version getaggt wird

Committen und Pushen auf `main` ist jederzeit normal und braucht keine
Rückfrage. Ein echtes Release, Version hochzählen und taggen, nicht von
selbst für jede kleine Erweiterung vorschlagen. Erst wenn ein Stück Arbeit
für sich genommen wirklich groß und abgeschlossen ist, oder wenn
ausdrücklich danach gefragt wird ("release es" oder Gleichwertiges).
Gehört eine Erweiterung erkennbar zu einem größeren, noch laufenden
Vorhaben, damit warten oder nachfragen, statt anzunehmen.

## Bevor eine Version getaggt wird

1. Eintrag in `src/shared/changelog.ts`, `version` exakt wie `package.json`
2. `node scripts/sync-status.mjs`
3. Offene Einträge in `knownIssues.ts` durchsehen: Was diese Version behebt,
   wird auf `fixed` mit `fixedIn` gesetzt

## Sprache

Alles, was ein Nutzer sieht, ist Deutsch. Kommentare im Code sind Englisch.
**Keine Gedankenstriche**, weder Geviert noch Halbgeviert, in keinem Text.
Sätze stattdessen umschreiben.

## Werkzeuge auf dieser Maschine

Nicht im PATH, immer mit vollem Pfad aufrufen:

- `gh`: `C:\Program Files\GitHub CLI\gh.exe`
- `git`: `C:\Program Files\Git\cmd\git.exe`

## Der `mod/`-Ordner ist ein eigenes Projekt

Seit 2026-09-02 liegt unter `mod/` ein echter Fabric-Mod für Minecraft
selbst, kein Teil des Launchers. Java statt TypeScript, Gradle statt npm,
eigener `.gitignore`. Zielt auf eine feste Minecraft-Version (aktuell
1.21.11), anders als das Ressourcenpaket der "eigenen Startseite", das für
jede Version gleichzeitig funktioniert. Details in `mod/README.md`.

`npm run build`, `npm run typecheck` und alles unter `scripts/` betreffen
nur den Launcher und lassen `mod/` unberührt. Ein Bau dort läuft über
`mod/gradlew build`, braucht ein installiertes Java 21 und lädt beim
ersten Mal Minecraft selbst herunter, dauert also einige Minuten.
