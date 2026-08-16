# Launch Gabi

Ein moderner Minecraft-Launcher, Mod-Manager und Instance-Manager für Windows, macOS und Linux.

> „Launcher öffnen → Instanz wählen → Play drücken → fertig."

Launch Gabi verwaltet beliebig viele voneinander getrennte Minecraft-Installationen. Java, Mod
Loader und Abhängigkeiten laufen im Hintergrund, ohne dass sich jemand damit beschäftigen muss.

---

## Was der Launcher kann

**Instanzen** — Beliebig viele getrennte Installationen, jede mit eigener Minecraft-Version, eigenem
Mod Loader, eigenen Mods, Welten, Resourcepacks, Shadern, Java-Version und RAM-Einstellung. Assets
und Bibliotheken werden geteilt, damit nicht jede Instanz Gigabytes doppelt belegt.

**Mod Loader** — Fabric, NeoForge, Forge und Quilt werden vollständig automatisch installiert. Bei
Forge und NeoForge führt Launch Gabi die Installer-Prozessoren selbst aus (Binary-Patching des
Client-Jars), es wird kein externer Installer benötigt.

**Java-Verwaltung** — Vorhandene JDKs werden auf dem System gefunden (Registry-Pfade, JAVA_HOME,
PATH, andere Launcher). Fehlt die passende Version, lädt Launch Gabi ein Temurin-Runtime von
Adoptium und verwaltet es selbst. Pro Instanz überschreibbar.

**Modrinth & CurseForge** — Eine Suche über beide Plattformen: Mods, Modpacks, Resourcepacks,
Shader und Data Packs. Installieren, entfernen, aktivieren, deaktivieren, Version wählen.
Abhängigkeiten werden automatisch mitinstalliert.

**Kompatibilitätsprüfung** — Vor dem Start prüft Launch Gabi Loader-Konflikte, Versions-Mismatches,
fehlende Abhängigkeiten, doppelte Mods und Shader ohne Shader-Loader. Für jedes lösbare Problem gibt
es einen Knopf, der es automatisch behebt.

**Updates** — Update-Prüfung pro Instanz oder für alle auf einmal, einzeln oder gesammelt
installierbar, optional automatisch beim Start.

**Backups** — Sicherungen von Welten, Konfiguration, Mods und mehr. Wiederherstellen legt vorher
automatisch eine Sicherheitskopie an. Vor Mod-Updates wird optional automatisch gesichert.

**Repair Instance** — Prüft Ordnerstruktur, Mod Loader, Client-Jar, Bibliotheken, Assets, Natives,
Mod-Dateien (per SHA1) und Java-Konfiguration und repariert, was defekt ist.

**Modpacks** — Import von `.mrpack` (Modrinth) und CurseForge-Zips, Export einer Instanz als
`.mrpack`. Modpacks lassen sich auch direkt aus der Suche installieren.

**Desktop-Verknüpfungen & Deep Links** — Jede Instanz kann eine eigene Verknüpfung bekommen. Ein
Doppelklick startet den Launcher und die Instanz direkt. Zusätzlich gibt es das Protokoll
`launchgabi://`.

**Accounts** — Microsoft-Login über den Geräte-Code-Ablauf (Xbox Live → XSTS → Minecraft) sowie
Offline-Profile zum Testen. Tokens liegen verschlüsselt im Benutzerprofil.

**Launcher-Updates** — Der Launcher aktualisiert sich selbst. Beim Start und danach alle sechs
Stunden prüft er auf neue Versionen, lädt sie im Hintergrund und installiert sie beim Beenden.
Läuft gerade Minecraft, wird der Neustart verschoben. Steuerbar unter *Einstellungen → Updates*.

---

## Entwicklung

```bash
npm install      # Dependencies (lädt beim ersten Mal die Electron-Binary, ca. 250 MB)
npm run dev      # Launcher im Entwicklungsmodus starten
npm run build    # Bundles nach out/ bauen
npm run typecheck
npm run dist     # Windows-Installer nach dist/ bauen
```

### Voraussetzungen

- Node.js 20 oder neuer
- Etwa 1 GB freier Speicher für `node_modules` inklusive Electron
- Mehrere GB freier Speicher für die Minecraft-Daten selbst (eine 1.21-Instanz belegt je nach
  Modpack 0,5-3 GB, dazu kommt eine Java-Runtime mit ca. 200 MB)

### Wenn der Start fehlschlägt

Meldet Electron beim `npm run dev` einen Fehler wie *„Cannot read properties of undefined (reading
'isPackaged')"* oder *„Cannot find module 'electron'"*, ist im Terminal die Umgebungsvariable
`ELECTRON_RUN_AS_NODE` gesetzt. Dann startet die Electron-Binary als reines Node und stellt die
Electron-Module nicht bereit. Das passiert vor allem in integrierten Terminals von Editoren, die
selbst auf Electron basieren (z. B. VS Code).

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

```bash
unset ELECTRON_RUN_AS_NODE && npm run dev
```

---

## Architektur

```
src/
├─ main/                    Node-Seite: alles mit Datei-, Netz- und Prozesszugriff
│  ├─ index.ts              App-Start, Fenster, Single-Instance, Deep Links
│  ├─ ipc.ts                Alle IPC-Kanäle an einer Stelle
│  ├─ paths.ts              Verzeichnislayout
│  ├─ store.ts              Einstellungen und Accounts (atomare Schreibvorgänge)
│  ├─ tasks.ts              Fortschritts- und Abbruchsystem
│  ├─ core/
│  │  ├─ net.ts             Downloader mit SHA1-Prüfung, Retries, Parallelität
│  │  ├─ mojang.ts          Versions-Manifest, Bibliotheken, Regeln, Assets
│  │  ├─ java.ts            JDK-Erkennung und Adoptium-Download
│  │  ├─ launch.ts          Classpath, Argumente, Prozess, Log-Streaming
│  │  ├─ instances.ts       CRUD, Content-Abgleich mit der Festplatte
│  │  ├─ content.ts         Installieren, Updates, Abhängigkeiten
│  │  ├─ compat.ts          Kompatibilitätsprüfung
│  │  ├─ backups.ts         Sicherungen
│  │  ├─ repair.ts          Reparatur
│  │  ├─ modpack.ts         mrpack/CurseForge Import und Export
│  │  ├─ shortcuts.ts       Verknüpfungen, Deep Links
│  │  └─ archive.ts         ZIP/TAR-Helfer
│  ├─ loaders/              Fabric, Quilt, Forge, NeoForge
│  ├─ providers/            Modrinth, CurseForge, vereinte Suche
│  └─ auth/                 Microsoft-Anmeldung, Offline-Profile
├─ preload/                 Bridge zwischen Main und Renderer
├─ shared/                  Typen, Konstanten, API-Vertrag
└─ renderer/                React-UI
   └─ src/
      ├─ styles/            Design-Tokens und Komponenten-CSS
      ├─ lib/               Store, Formatierung, Aktionen
      ├─ components/        Wiederverwendbare Bausteine
      └─ views/             Home, Instanzen, Mods, Entdecken, Backups, Einstellungen
```

Der Renderer hat keinen direkten Zugriff auf Node — `contextIsolation` ist aktiv, alles läuft über
den typisierten Vertrag in `src/shared/api.ts`.

### Datenverzeichnis

```
<Datenverzeichnis>/
├─ launcher.json           Einstellungen
├─ accounts.json           Accounts (Tokens verschlüsselt)
├─ meta/                   Zwischengespeicherte Manifeste
├─ assets/                 Geteilte Spiel-Assets
├─ libraries/              Geteilte Bibliotheken
├─ versions/               Version-JSONs, Client-Jars, Natives
├─ java/                   Verwaltete Java-Runtimes
├─ backups/<instanz>/      Sicherungen
└─ instances/<instanz>/
   ├─ instance.json
   ├─ media/               Eigenes Icon und Hintergrundbild
   └─ minecraft/           Das eigentliche Spielverzeichnis
```

---

## Konfiguration

**CurseForge** benötigt einen kostenlosen API-Schlüssel von
[console.curseforge.com](https://console.curseforge.com/), einzutragen unter *Einstellungen →
Inhalte*. Modrinth funktioniert ohne Anmeldung.

**Microsoft-Login** verwendet standardmäßig die Anwendungs-ID des offiziellen Minecraft-Launchers.
Für eine eigene Veröffentlichung sollte unter *Einstellungen → Accounts* eine eigene Azure-Client-ID
hinterlegt werden (Anwendungstyp „Öffentlicher Client", Berechtigung `XboxLive.signin`).

**Updates** benötigen einmalig die Release-Quelle in `electron-builder.yml`:

```yaml
publish:
  - provider: github
    owner: dein-github-name
    repo: dein-repository
```

Dieser Wert wird beim Bauen fest in die installierte App geschrieben — er muss also **vor**
`npm run dist` stimmen, sonst sucht der fertige Installer an der falschen Stelle.

### Eine neue Version veröffentlichen

1. `version` in `package.json` erhöhen (z. B. `1.0.1`). Der Updater vergleicht genau dieses Feld.
2. `npm run dist` — erzeugt in `dist/`:
   - `launch-gabi-<version>-setup.exe` — der Installer
   - `latest.yml` — der Update-Feed, den installierte Launcher abfragen
   - `*.blockmap` — ermöglicht Delta-Updates, es wird nur das Geänderte geladen
3. Ein GitHub-Release mit dem Tag `v<version>` anlegen und **alle drei Dateien** anhängen.
   Fehlt `latest.yml`, findet kein Client das Update.

Bestehende Installationen holen sich das Update dann von selbst. Zum Testen genügt es, eine ältere
Version zu installieren und den Launcher zu starten.

> Ohne Code-Signatur zeigt Windows SmartScreen beim ersten Start eine Warnung. Das betrifft die
> Installation, nicht den Update-Vorgang — der läuft danach still durch.

---

## Hinweis

Launch Gabi ist kein offizielles Produkt von Mojang oder Microsoft. Minecraft ist eine Marke von
Mojang AB. Mod-Inhalte stammen von Modrinth und CurseForge und unterliegen den Lizenzen der
jeweiligen Autoren.

## Lizenz

Copyright © 2026 Gabi. Alle Rechte vorbehalten.

Der Quellcode ist einsehbar, aber **nicht** quelloffen: Kopieren, Verändern, Weiterverbreiten und
kommerzielle Nutzung sind ohne schriftliche Erlaubnis nicht gestattet. Die vollständigen Bedingungen
stehen in [LICENSE](LICENSE). Verwendete Fremdbibliotheken behalten ihre eigenen Lizenzen.
