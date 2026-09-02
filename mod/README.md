# Launch Gabi, modernes Hauptmenü

Ein echter Fabric-Mod für Minecraft, kein Teil des Launchers. Modernisiert
Minecrafts eigenes Hauptmenü (Singleplayer, Multiplayer, Realms, die
Knöpfe daneben) im selben Stil wie die "eigene Startseite" des Launchers,
mit echten Knöpfen, Hover-Effekten und einem Layout, das mit zusätzlichen
Mod-Knöpfen umgehen kann. Das ist etwas grundlegend anderes als das
Ressourcenpaket: nicht nur Bilder, sondern echter Code, der ins Spiel
eingreift.

**Stand:** erste sichtbare Stufe. Knöpfe tragen die eigene Glas-Optik aus
der "eigenen Startseite" (als Mod-eigene Textur, nicht über das separate
Ressourcenpaket), jeder Knopf leuchtet beim Überfahren weich auf und blitzt
kurz bei Klick, Tooltips haben denselben Glas-Rahmen statt der grauen
Vanilla-Box, und ein durchscheinendes Panel liegt hinter der Knopf-Spalte
im Hauptmenü, das automatisch mitwächst, wenn ein anderer Mod dort einen
zusätzlichen zentrierten Knopf einfügt. Was noch fehlt: Bildschirmübergänge,
eigene Icons, ein eigenes Navigationselement.

## Warum ein eigener Ordner, eigenes Projekt

Das hier ist Java, nicht TypeScript, mit einem komplett eigenen
Werkzeugkasten (Gradle, Fabric Loom). Der Launcher selbst (`src/`, `out/`,
`resources/`) wird davon nicht berührt und bleibt unverändert.

Anders als das Ressourcenpaket ist ein Mod immer an eine Minecraft-Version
gebunden. Dieses Projekt zielt auf **1.21.11**, die Standardversion des
Launchers. Eine andere Version zu unterstützen heißt: das Projekt dafür
extra bauen, nicht einfach mitnehmen.

## Bauen

Braucht ein installiertes Java 21 (per `java -version` prüfbar), sonst
nichts, der Gradle-Wrapper lädt den Rest selbst herunter, auch Minecraft
und die Mappings, deshalb dauert der erste Bau mehrere Minuten.

```
./gradlew build
```

Auf Windows in PowerShell: `.\gradlew.bat build`. Das fertige Mod liegt
danach unter `build/libs/launchgabi-menu-<version>.jar`.

## Testen

1. In Launch Gabi eine **neue, eigene** Instanz anlegen, Loader **Fabric**,
   Minecraft-Version **1.21.11**. Nicht die bestehende Hauptinstanz nehmen,
   damit nichts durcheinanderkommt, falls hier mal etwas schiefgeht.
2. Die gebaute `.jar`-Datei aus `build/libs/` in den `mods`-Ordner dieser
   Instanz legen.
3. Die Instanz starten und das Hauptmenü ansehen.

## Aufbau

- `src/client/java/.../mixin/` — die eigentlichen Eingriffe ins Spiel,
  über Mixin. Nur clientseitig, ein Hauptmenü existiert nur beim Spieler,
  nie auf einem Server.
- `src/client/resources/launchgabi_menu.client.mixins.json` — listet jede
  Mixin-Klasse auf. Eine neue Mixin-Klasse muss hier eingetragen werden,
  sonst wird sie nie geladen.
- `src/main/resources/fabric.mod.json` — das Mod selbst, Name, Version,
  welche Minecraft-Version und welcher Fabric-Loader vorausgesetzt werden.
- `src/main/resources/assets/` — die Texturen selbst (Knöpfe, Panel,
  Tooltip), erzeugt von `scripts/build_menu_mod_assets.py` im Launcher-
  Repo, nicht von Hand gepflegt. Neu erzeugen nach einer Änderung dort.
