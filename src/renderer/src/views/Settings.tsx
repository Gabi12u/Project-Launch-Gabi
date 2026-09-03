import { useEffect, useState, type JSX } from 'react'
import type {
  JavaRuntime,
  LaunchBehaviour,
  RecordingQuality,
  ThemeId,
  UpdateStatus
} from '@shared/types'
import type { AppInfo, ErrorReport } from '@shared/api'
import { ACCENT_CHOICES } from '@shared/defaults'
import { CHANGELOG, CHANGE_KIND_LABEL } from '@shared/changelog'
import { refreshInstances, refreshSettings, saveSettings, toast, toastError, useStore } from '../lib/store'
import { formatBytes, formatDate, formatDateTime, formatMemory, updateHeadline } from '../lib/format'
import { Confirm, SettingToggle } from '../components/ui'
import { LogoLockup } from '../components/Logo'
import { BackupsView } from './Backups'
import {
  IconDownload,
  IconExternal,
  IconFolder,
  IconRefresh,
  IconRecord,
  IconShield,
  IconTrash
} from '../components/Icons'

type Section =
  | 'general'
  | 'java'
  | 'content'
  | 'accounts'
  | 'appearance'
  | 'recording'
  | 'backups'
  | 'updates'
  | 'changelog'
  | 'reports'
  | 'advanced'
  | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'Allgemein' },
  { id: 'appearance', label: 'Darstellung' },
  { id: 'java', label: 'Java & Leistung' },
  { id: 'content', label: 'Inhalte' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'recording', label: 'Aufnahmen' },
  { id: 'backups', label: 'Sicherungen' },
  { id: 'updates', label: 'Updates' },
  { id: 'changelog', label: 'Neuerungen' },
  { id: 'reports', label: 'Fehlerberichte' },
  { id: 'advanced', label: 'Erweitert' },
  { id: 'about', label: 'Über' }
]


function UpdatePanel(): JSX.Element {
  const { settings } = useStore()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.gabi.updates.status().then(setStatus).catch(() => undefined)
    // The main process pushes every state change, so the panel stays live
    // while a download runs in the background.
    return window.gabi.events.onUpdateStatus(setStatus)
  }, [])

  const run = (action: () => Promise<unknown>): void => {
    setBusy(true)
    void action()
      .catch(toastError)
      .finally(() => setBusy(false))
  }

  const state = status?.state ?? 'idle'

  return (
    <>
      <section className="setting-group">
        <h3>Launcher-Updates</h3>
        <p className="hint">{status ? updateHeadline(status) : 'Status wird geladen…'}</p>

        {state === 'downloading' && (
          <div className="progress mt-8">
            <div className="progress-fill" style={{ width: `${Math.round(status?.percent ?? 0)}%` }} />
          </div>
        )}

        {status?.error && <p className="hint mt-8">{status.error}</p>}

        {status?.notes && state !== 'up-to-date' && (
          <p className="hint mt-8" style={{ whiteSpace: 'pre-wrap' }}>
            {status.notes.slice(0, 600)}
          </p>
        )}

        <div className="row gap-8 mt-16">
          <button
            className="btn"
            disabled={busy || state === 'checking' || state === 'downloading' || state === 'installing'}
            onClick={() => run(() => window.gabi.updates.check())}
          >
            <IconRefresh />
            Jetzt suchen
          </button>

          {state === 'available' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => window.gabi.updates.download())}
            >
              <IconDownload />
              Herunterladen
            </button>
          )}

          {state === 'ready' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => window.gabi.updates.install())}
            >
              Neu starten & installieren
            </button>
          )}
        </div>
      </section>

      <section className="setting-group">
        <h3>Verhalten</h3>
        <SettingToggle
          label="Updates automatisch herunterladen"
          hint="Neue Versionen werden still im Hintergrund geladen, während du den Launcher benutzt."
          checked={settings.autoUpdate}
          onChange={(value) => void saveSettings({ autoUpdate: value })}
        />
        <SettingToggle
          label="Beim Start automatisch installieren"
          hint="Ist ein Update fertig geladen, wird es beim nächsten Öffnen eingespielt und der Launcher startet neu. Es wird dabei nichts heruntergeladen, der Start bleibt schnell."
          checked={settings.autoInstallUpdates}
          onChange={(value) => void saveSettings({ autoInstallUpdates: value })}
        />
      </section>
    </>
  )
}

// `colors` is only the swatch in the picker; the real values live in
// tokens.css, so the two lists have to be kept in step.
const THEMES: { id: ThemeId; label: string; colors: [string, string] }[] = [
  { id: 'midnight', label: 'Midnight', colors: ['#6b4cff', '#2b6fff'] },
  { id: 'nebula', label: 'Nebula', colors: ['#a24bff', '#ff4fa3'] },
  { id: 'abyss', label: 'Abyss', colors: ['#1e6fff', '#00c2c7'] },
  { id: 'aurora', label: 'Aurora', colors: ['#24d1a0', '#4f7bff'] },
  { id: 'cobalt', label: 'Cobalt', colors: ['#3d6fff', '#1b3bd6'] },
  { id: 'indigo', label: 'Indigo', colors: ['#5b4bff', '#2a1d8f'] },
  { id: 'violet', label: 'Violet', colors: ['#6b5cff', '#a24bff'] },
  { id: 'prism', label: 'Prism', colors: ['#3d8cff', '#ff4fd8'] },
  { id: 'orchid', label: 'Orchid', colors: ['#25c2b0', '#e0559f'] },
  { id: 'dusk', label: 'Dusk', colors: ['#8a5cff', '#ff8a4d'] },
  { id: 'sunset', label: 'Sunset', colors: ['#ff9b3d', '#ff4d7a'] },
  { id: 'ember', label: 'Ember', colors: ['#ff4d3d', '#a01020'] },
  { id: 'rust', label: 'Rust', colors: ['#c96a45', '#7a2f22'] },
  { id: 'moss', label: 'Moss', colors: ['#a8a24d', '#5c5327'] },
  { id: 'fern', label: 'Fern', colors: ['#6f9e6a', '#37543a'] },
  { id: 'pine', label: 'Pine', colors: ['#2fae86', '#1a5e57'] },
  { id: 'lagoon', label: 'Lagoon', colors: ['#2f8fff', '#2fd6a8'] },
  { id: 'slate', label: 'Slate', colors: ['#7d93c8', '#3f4d6b'] }
]

/** Every id that may arrive through `?section=`, so a stray one is ignored. */
const SECTION_IDS = new Set<string>(SECTIONS.map((entry) => entry.id))

export function SettingsView({ query }: { query?: URLSearchParams }): JSX.Element {
  const { settings } = useStore()
  const wanted = query?.get('section')
  const [section, setSection] = useState<Section>(
    wanted && SECTION_IDS.has(wanted) ? (wanted as Section) : 'general'
  )
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([])
  const [detecting, setDetecting] = useState(false)
  const [installingJava, setInstallingJava] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [apiKey, setApiKey] = useState(settings.curseForgeApiKey)
  // Only claims to be unread once the version is actually known: before the
  // app info arrives both sides are empty strings and the dot would flicker.
  const changelogUnread = Boolean(info?.version) && settings.lastSeenVersion !== info?.version
  const [clientId, setClientId] = useState(settings.microsoftClientId)

  // A notification that points here can arrive while this view is already
  // open, and then the initial state above has long since been decided. Both
  // routes matter: the toast after an update lands on the changelog, and the
  // one about a taken hotkey lands on the recording settings.
  useEffect(() => {
    if (wanted && SECTION_IDS.has(wanted)) setSection(wanted as Section)
  }, [wanted])

  useEffect(() => {
    void window.gabi.app.info().then(setInfo).catch(() => undefined)
    void window.gabi.java.list().then(setRuntimes).catch(() => undefined)
  }, [])

  useEffect(() => {
    setApiKey(settings.curseForgeApiKey)
    setClientId(settings.microsoftClientId)
  }, [settings.curseForgeApiKey, settings.microsoftClientId])

  return (
    <div className="col gap-24">
      <header>
        <h1 className="page-title">Einstellungen</h1>
        <p className="page-sub">Alles, was für alle Instanzen gilt.</p>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              className={section === entry.id ? 'active' : ''}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
              {/* A dot on the changelog until this version's entry has been
                  read, so an update does not pass by unnoticed. */}
              {entry.id === 'changelog' && changelogUnread && <span className="nav-new" />}
            </button>
          ))}
        </nav>

        <div className="col">
          {section === 'general' && (
            <>
              <section className="setting-group">
                <h3>Start</h3>
                <SettingToggle
                  label="Minimiert starten"
                  hint="Launch Gabi startet im Hintergrund, ohne Fenster."
                  checked={settings.startMinimized}
                  onChange={(value) => void saveSettings({ startMinimized: value })}
                />
                <div className="field mt-16">
                  <label className="label" htmlFor="st-verhalten-beim-spielstart">Verhalten beim Spielstart</label>
                  <select id="st-verhalten-beim-spielstart"
                    className="select"
                    value={settings.launchBehaviour}
                    onChange={(event) =>
                      void saveSettings({ launchBehaviour: event.target.value as LaunchBehaviour })
                    }
                  >
                    <option value="keep">Launcher offen lassen</option>
                    <option value="hide">Launcher ausblenden</option>
                    <option value="close">Launcher minimieren</option>
                  </select>
                  <span className="hint">
                    Gilt als Voreinstellung; jede Instanz kann davon abweichen.
                  </span>
                </div>
              </section>

              <section className="setting-group">
                <h3>Benachrichtigungen</h3>
                <SettingToggle
                  label="Beim Start auf Mod-Updates prüfen"
                  hint="Prüft im Hintergrund alle Instanzen, sobald der Launcher startet."
                  checked={settings.checkContentUpdatesOnStart}
                  onChange={(value) => void saveSettings({ checkContentUpdatesOnStart: value })}
                />
                <SettingToggle
                  label="Über verfügbare Updates informieren"
                  checked={settings.notifyOnUpdates}
                  onChange={(value) => void saveSettings({ notifyOnUpdates: value })}
                />
                <SettingToggle
                  label="Melden, wenn Minecraft beendet wird"
                  hint="Zeigt nach jeder Sitzung eine kurze Zusammenfassung."
                  checked={settings.notifyOnGameExit}
                  onChange={(value) => void saveSettings({ notifyOnGameExit: value })}
                />
              </section>

              <section className="setting-group">
                <h3>Speicherort</h3>
                <p className="hint">
                  Hier liegen Instanzen, Versionen, Bibliotheken und Java-Laufzeiten.
                </p>
                <div className="row gap-8">
                  <input className="input" value={settings.dataDirectory} readOnly />
                  <button
                    className="btn"
                    onClick={async () => {
                      const dir = await window.gabi.app.pickDirectory('Datenverzeichnis wählen')
                      if (!dir) return
                      // Only report a move once the save actually took. A
                      // rejected path (unwritable, invalid) left the directory
                      // untouched, yet this still told the user it had changed
                      // and to go move their data across.
                      if (!(await saveSettings({ dataDirectory: dir }))) return
                      // The main process just dropped its instance cache, so the
                      // list on screen still shows the old directory's instances
                      // until it is read again.
                      await refreshInstances()
                      toast(
                        'warning',
                        'Verzeichnis geändert',
                        'Vorhandene Daten wurden nicht verschoben. Kopiere sie bei Bedarf selbst.',
                        10000
                      )
                    }}
                  >
                    Ändern
                  </button>
                  <button
                    className="btn icon"
                    onClick={() => void window.gabi.app.openPath(settings.dataDirectory)}
                    aria-label="Ordner öffnen"
                  >
                    <IconFolder size={15} />
                  </button>
                </div>
              </section>
            </>
          )}

          {section === 'appearance' && (
            <>
              <section className="setting-group">
                <h3>Navigation</h3>
                <p className="hint">
                  Ob die Navigation als Leiste über dem Fenster liegt oder als Spalte an der Seite.
                  Beide zeigen dieselben Einträge.
                </p>
                <div className="segmented" style={{ alignSelf: 'flex-start', marginTop: 10 }}>
                  <button
                    className={settings.navPosition !== 'side' ? 'active' : ''}
                    onClick={() => void saveSettings({ navPosition: 'top' })}
                  >
                    Oben
                  </button>
                  <button
                    className={settings.navPosition === 'side' ? 'active' : ''}
                    onClick={() => void saveSettings({ navPosition: 'side' })}
                  >
                    Seitlich
                  </button>
                </div>
              </section>

              <section className="setting-group">
                <h3>Theme</h3>
                <p className="hint">Bestimmt die Hintergrundstimmung des Launchers.</p>
                <div className="option-grid">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      className={`option ${settings.theme === theme.id ? 'selected' : ''}`}
                      onClick={() => void saveSettings({ theme: theme.id })}
                    >
                      <div
                        style={{
                          height: 42,
                          borderRadius: 'var(--r-xs)',
                          marginBottom: 10,
                          background: `linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]})`
                        }}
                      />
                      <div className="option-name">{theme.label}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="setting-group">
                <h3>Akzentfarbe</h3>
                <div className="swatches">
                  {ACCENT_CHOICES.map((color) => (
                    <button
                      key={color}
                      className={`swatch ${settings.accentColor === color ? 'selected' : ''}`}
                      style={{ background: color, color }}
                      onClick={() => void saveSettings({ accentColor: color })}
                      aria-label={color}
                    />
                  ))}
                </div>
              </section>

              <section className="setting-group">
                <h3>Bewegung</h3>
                <SettingToggle
                  label="Animationen reduzieren"
                  hint="Schaltet Übergänge und Effekte ab, hilfreich auf schwächerer Hardware."
                  checked={settings.reduceMotion}
                  onChange={(value) => void saveSettings({ reduceMotion: value })}
                />
              </section>

            </>
          )}

          {section === 'java' && (
            <>
              <section className="setting-group">
                <h3>Java-Verwaltung</h3>
                <SettingToggle
                  label="Java automatisch verwalten"
                  hint="Launch Gabi lädt die passende Java-Version selbst herunter. Ohne diese Option musst du Java manuell installieren."
                  checked={settings.javaAutoManage}
                  onChange={(value) => void saveSettings({ javaAutoManage: value })}
                />

                <div className="row-between mt-20">
                  <h4 style={{ fontSize: 14 }}>Gefundene Installationen</h4>
                  <button
                    className="btn sm"
                    disabled={detecting}
                    onClick={async () => {
                      setDetecting(true)
                      try {
                        setRuntimes(await window.gabi.java.detect())
                        toast('success', 'Suche abgeschlossen')
                      } catch (err) {
                        // Was missing entirely, unlike the install buttons
                        // below: a rejection ended as an unhandled promise and
                        // the spinner simply stopped with no explanation.
                        toastError(err, 'Java-Suche fehlgeschlagen')
                      } finally {
                        setDetecting(false)
                      }
                    }}
                  >
                    {detecting ? <span className="spinner" /> : <IconRefresh size={14} />}
                    Neu suchen
                  </button>
                </div>

                <div className="col gap-8 mt-12">
                  {runtimes.length === 0 ? (
                    <div className="hint">Noch keine Java-Installation gefunden.</div>
                  ) : (
                    runtimes.map((runtime) => (
                      <div key={runtime.path} className="content-row">
                        <div className="content-icon">☕</div>
                        <div className="grow" style={{ overflow: 'hidden' }}>
                          <div className="content-name">
                            Java {runtime.major}
                            {runtime.managed && <span className="badge accent" style={{ marginLeft: 8 }}>verwaltet</span>}
                          </div>
                          <div className="content-meta">
                            <span>{runtime.version}</span>
                            <span>{runtime.vendor}</span>
                            <span className="truncate mono" style={{ opacity: 0.6 }}>
                              {runtime.path}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="row gap-8 mt-16 wrap">
                  {[8, 17, 21].map((major) => (
                    <button
                      key={major}
                      className="btn sm"
                      disabled={installingJava !== null}
                      onClick={async () => {
                        setInstallingJava(major)
                        try {
                          const runtime = await window.gabi.java.install(major)
                          toast('success', `Java ${major} installiert`, runtime.version)
                          setRuntimes(await window.gabi.java.list(true))
                        } catch (err) {
                          toastError(err, `Java ${major} konnte nicht installiert werden`)
                        } finally {
                          setInstallingJava(null)
                        }
                      }}
                    >
                      {installingJava === major ? <span className="spinner" /> : <IconDownload size={14} />}
                      Java {major} laden
                    </button>
                  ))}
                </div>
              </section>

              <section className="setting-group">
                <h3>Standardwerte für neue Instanzen</h3>
                <div className="field">
                  <label className="label" htmlFor="st-standard-arbeitsspeicher">
                    Arbeitsspeicher: {formatMemory(settings.defaultMemoryMb)}
                  </label>
                  <input
                    id="st-standard-arbeitsspeicher"
                    className="range"
                    type="range"
                    min={1024}
                    max={16384}
                    step={512}
                    value={settings.defaultMemoryMb}
                    onChange={(event) =>
                      void saveSettings({ defaultMemoryMb: Number(event.target.value) })
                    }
                  />
                  {info && (
                    <span className="hint">
                      Dein System hat {formatMemory(info.systemMemoryMb)} RAM. Lass mindestens 2-4 GB für
                      Windows übrig.
                    </span>
                  )}
                </div>

                <div className="field mt-16">
                  <label className="label" htmlFor="st-jvm-argumente">JVM-Argumente</label>
                  <textarea id="st-jvm-argumente"
                    className="textarea"
                    value={settings.defaultJvmArgs}
                    onChange={(event) => void saveSettings({ defaultJvmArgs: event.target.value })}
                  />
                </div>
              </section>

              <section className="setting-group">
                <h3>Downloads</h3>
                <div className="field">
                  <label className="label" htmlFor="st-gleichzeitige-downloads">
                    Gleichzeitige Downloads: {settings.concurrentDownloads}
                  </label>
                  <input
                    id="st-gleichzeitige-downloads"
                    className="range"
                    type="range"
                    min={1}
                    max={24}
                    value={settings.concurrentDownloads}
                    onChange={(event) =>
                      void saveSettings({ concurrentDownloads: Number(event.target.value) })
                    }
                  />
                  <span className="hint">
                    Mehr ist schneller, belastet aber Verbindung und Festplatte stärker.
                  </span>
                </div>
              </section>
            </>
          )}

          {section === 'content' && (
            <>
              <section className="setting-group">
                <h3>Mod-Verwaltung</h3>
                <SettingToggle
                  label="Abhängigkeiten automatisch installieren"
                  hint="Fehlende Bibliotheken wie Fabric API werden ohne Nachfrage mitinstalliert."
                  checked={settings.autoInstallDependencies}
                  onChange={(value) => void saveSettings({ autoInstallDependencies: value })}
                />
                <SettingToggle
                  label="Snapshots in der Versionsliste zeigen"
                  checked={settings.showSnapshots}
                  onChange={(value) => void saveSettings({ showSnapshots: value })}
                />
              </section>

              <section className="setting-group">
                <h3>CurseForge</h3>
                <p className="hint">
                  Modrinth funktioniert ohne Anmeldung. Für CurseForge verlangt die Plattform einen eigenen
                  API-Schlüssel, den du kostenlos erstellen kannst.
                </p>
                <div className="row gap-8">
                  <input
                    className="input"
                    type="password"
                    placeholder="API-Schlüssel einfügen"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button className="btn primary" onClick={() => void saveSettings({ curseForgeApiKey: apiKey })}>
                    Speichern
                  </button>
                </div>
                <button
                  className="btn ghost sm mt-8"
                  onClick={() => void window.gabi.app.openExternal('https://console.curseforge.com/')}
                >
                  <IconExternal size={14} />
                  Schlüssel erstellen
                </button>
              </section>

              <section className="setting-group">
                <h3>Automatische Sicherungen</h3>
                <SettingToggle
                  label="Automatisch sichern"
                  hint="Legt regelmäßig Sicherungen der Welten an."
                  checked={settings.automaticBackups}
                  onChange={(value) => void saveSettings({ automaticBackups: value })}
                />
                <div className="field mt-16">
                  <label className="label" htmlFor="st-aufbewahrte-sicherungen">
                    Anzahl aufbewahrter automatischer Sicherungen: {settings.automaticBackupKeep}
                  </label>
                  <input
                    id="st-aufbewahrte-sicherungen"
                    className="range"
                    type="range"
                    min={1}
                    max={20}
                    value={settings.automaticBackupKeep}
                    onChange={(event) =>
                      void saveSettings({ automaticBackupKeep: Number(event.target.value) })
                    }
                  />
                </div>
              </section>
            </>
          )}

          {section === 'accounts' && (
            <section className="setting-group">
              <h3>Microsoft-Anmeldung</h3>
              <p className="hint">
                Launch Gabi meldet sich über den Geräte-Code-Ablauf an, dein Passwort wird nie im Launcher
                eingegeben. Voreingestellt ist die Anwendungs-ID des offiziellen Minecraft-Launchers, die
                über <span className="mono">login.live.com</span> läuft. Trägst du hier stattdessen eine
                eigene Azure-Anwendungs-ID im GUID-Format ein, wechselt Launch Gabi automatisch auf den
                Azure-AD-Ablauf.
              </p>
              <div className="row gap-8 mt-12">
                <input
                  className="input"
                  placeholder="Azure Client-ID"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                />
                <button
                  className="btn primary"
                  onClick={() => void saveSettings({ microsoftClientId: clientId })}
                >
                  Speichern
                </button>
              </div>
              <div className="issue info mt-16">
                <div className="issue-icon">
                  <IconShield size={16} />
                </div>
                <div>
                  <div className="issue-title">Wo werden Tokens gespeichert?</div>
                  <div className="issue-detail">
                    Zugriffs- und Aktualisierungstoken liegen verschlüsselt in deinem Benutzerprofil und
                    werden über die Verschlüsselung des Betriebssystems geschützt. Sie verlassen deinen
                    Rechner nur Richtung Microsoft und Mojang.
                  </div>
                </div>
              </div>
            </section>
          )}

          {section === 'recording' && <RecordingPanel />}

          {/* Its own page before the remodel; the same view, just reached
              from here now that the navigation no longer lists it. */}
          {section === 'backups' && <BackupsView />}

          {section === 'updates' && <UpdatePanel />}

          {section === 'changelog' && <ChangelogPanel currentVersion={info?.version ?? ''} />}

          {section === 'reports' && <ReportsPanel />}

          {section === 'advanced' && (
            <>
              <section className="setting-group">
                <h3>Protokolle</h3>
                <p className="hint">
                  Bei Problemen findest du hier die Launcher-Logs. Sie enthalten keine Zugangsdaten.
                </p>
                <button
                  className="btn"
                  onClick={() => info && void window.gabi.app.openPath(info.logDirectory)}
                >
                  <IconFolder size={15} />
                  Log-Ordner öffnen
                </button>
              </section>

              <section className="setting-group">
                <h3>Zurücksetzen</h3>
                <p className="hint">
                  Setzt alle Launcher-Einstellungen auf die Voreinstellung zurück. Instanzen, Welten und
                  Accounts bleiben erhalten.
                </p>
                <button className="btn danger" onClick={() => setConfirmReset(true)}>
                  <IconTrash size={15} />
                  Einstellungen zurücksetzen
                </button>
              </section>
            </>
          )}

          {section === 'about' && info && (
            <section className="setting-group">
              <div style={{ marginBottom: 24 }}>
                <LogoLockup />
              </div>

              <div className="preflight-grid">
                <div className="preflight-cell">
                  <div className="preflight-label">Version</div>
                  <div className="preflight-value">{info.version}</div>
                </div>
                <div className="preflight-cell">
                  <div className="preflight-label">Electron</div>
                  <div className="preflight-value">{info.electron}</div>
                </div>
                <div className="preflight-cell">
                  <div className="preflight-label">Node</div>
                  <div className="preflight-value">{info.node}</div>
                </div>
                <div className="preflight-cell">
                  <div className="preflight-label">Plattform</div>
                  <div className="preflight-value">
                    {info.platform} {info.arch}
                  </div>
                </div>
                <div className="preflight-cell">
                  <div className="preflight-label">Arbeitsspeicher</div>
                  <div className="preflight-value">{formatMemory(info.systemMemoryMb)}</div>
                </div>
              </div>

              <p className="hint mt-20">
                Launch Gabi ist kein offizielles Produkt von Mojang oder Microsoft. Minecraft ist eine Marke
                von Mojang AB. Mod-Inhalte stammen von Modrinth und CurseForge und unterliegen den Lizenzen
                der jeweiligen Autoren.
              </p>
            </section>
          )}
        </div>
      </div>

      <Confirm
        open={confirmReset}
        title="Einstellungen zurücksetzen?"
        danger
        confirmLabel="Zurücksetzen"
        message="Alle Launcher-Einstellungen kehren zur Voreinstellung zurück. Deine Instanzen, Welten und Accounts bleiben unangetastet."
        onConfirm={async () => {
          await window.gabi.settings.reset()
          await refreshSettings()
          setConfirmReset(false)
          toast('success', 'Zurückgesetzt')
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

/** Keys offered for the recording hotkey, in Electron's accelerator notation. */
const HOTKEYS = ['F6', 'F7', 'F8', 'F9', 'F10', 'Ctrl+Shift+R', 'Alt+R', 'Ctrl+Alt+R']

const QUALITIES: { id: RecordingQuality; label: string; hint: string }[] = [
  { id: 'low', label: 'Sparsam', hint: '30 Bilder, kleine Dateien. Schont den Rechner am meisten.' },
  { id: 'medium', label: 'Ausgewogen', hint: '30 Bilder in guter Qualität. Kostet wenig Leistung.' },
  {
    id: 'high',
    label: 'Scharf',
    hint: '60 Bilder. Nur wenn dein Rechner Luft hat, sonst ruckelt die Aufnahme.'
  }
]

function RecordingPanel(): JSX.Element {
  const { settings, recording } = useStore()

  return (
    <>
      <section className="setting-group">
        <h3>Aufnehmen im Spiel</h3>
        <p className="hint">
          Eine Taste startet die Aufnahme, dieselbe Taste beendet sie wieder. Die fertigen Videos
          findest du bei der Instanz im Reiter Aufnahmen, zusammen mit deinen Screenshots.
        </p>

        <SettingToggle
          label="Aufnahmen erlauben"
          hint="Ist das aus, wird die Taste gar nicht erst belegt und steht anderen Programmen zur Verfügung."
          checked={settings.recordingEnabled}
          onChange={(value) => void saveSettings({ recordingEnabled: value })}
        />

        <div className="field mt-16">
          <label className="label" htmlFor="st-aufnahmetaste">
            Aufnahmetaste
          </label>
          <select
            id="st-aufnahmetaste"
            className="select"
            value={settings.recordingHotkey}
            disabled={!settings.recordingEnabled}
            onChange={(event) => void saveSettings({ recordingHotkey: event.target.value })}
          >
            {/* A hand-edited settings file can hold something not in this list,
                and without this the select would silently jump to the first
                entry while the launcher kept using the stored one. */}
            {!HOTKEYS.includes(settings.recordingHotkey) && (
              <option value={settings.recordingHotkey}>{settings.recordingHotkey}</option>
            )}
            {HOTKEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <span className="hint">
            Die Taste gilt systemweit, aber nur solange eine Instanz läuft. Danach ist sie wieder
            frei für andere Programme.
          </span>
        </div>
      </section>

      <section className="setting-group">
        <h3>Qualität</h3>
        <div className="field">
          <label className="label" htmlFor="st-aufnahmequalitaet">
            Bildqualität
          </label>
          <select
            id="st-aufnahmequalitaet"
            className="select"
            value={settings.recordingQuality}
            disabled={!settings.recordingEnabled}
            onChange={(event) =>
              void saveSettings({ recordingQuality: event.target.value as RecordingQuality })
            }
          >
            {QUALITIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <span className="hint">
            {QUALITIES.find((entry) => entry.id === settings.recordingQuality)?.hint}
          </span>
        </div>

        <SettingToggle
          label="Ton mit aufnehmen"
          hint="Nimmt auf, was aus den Lautsprechern kommt. Klappt nicht auf jedem System, dann läuft die Aufnahme ohne Ton weiter."
          checked={settings.recordingAudio}
          onChange={(value) => void saveSettings({ recordingAudio: value })}
        />

        <div className="field mt-16">
          <label className="label" htmlFor="st-aufnahmedauer">
            Höchstdauer: {settings.recordingMaxMinutes} Minuten
          </label>
          <input
            id="st-aufnahmedauer"
            className="range"
            type="range"
            min={1}
            max={120}
            step={1}
            value={settings.recordingMaxMinutes}
            disabled={!settings.recordingEnabled}
            onChange={(event) =>
              void saveSettings({ recordingMaxMinutes: Number(event.target.value) })
            }
          />
          <span className="hint">
            Danach hört die Aufnahme von selbst auf. Die Bremse für den Fall, dass du das Beenden
            vergisst.
          </span>
        </div>
      </section>

      {recording.active && (
        <section className="setting-group">
          <h3>Läuft gerade</h3>
          <p className="hint">
            Es wird aufgenommen, bereits {formatBytes(recording.bytes)} geschrieben.
          </p>
          <button className="btn danger mt-8" onClick={() => void window.gabi.recording.toggle()}>
            <IconRecord size={13} />
            Aufnahme beenden
          </button>
        </section>
      )}

      <section className="setting-group">
        <h3>Gut zu wissen</h3>
        <ul className="hint bullet-list">
          <li>
            Das Launcher-Fenster muss offen bleiben. Steht bei der Instanz das Verhalten auf
            Schließen, kann nicht aufgenommen werden.
          </li>
          <li>
            Im echten Vollbild liefert Minecraft manchmal kein Bild. Der randlose Fenstermodus
            funktioniert immer.
          </li>
          <li>Videos brauchen viel Platz. Die Höchstdauer oben hält das im Rahmen.</li>
        </ul>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Changelog
 *
 * The public record of what each version changed, kept inside the app rather
 * than only on a release page nobody opens. Old entries stay.
 * ------------------------------------------------------------------ */

function ChangelogPanel({ currentVersion }: { currentVersion: string }): JSX.Element {
  const { settings } = useStore()

  // Marks this version as read, which is what clears the marker on the nav
  // entry. Written once per version rather than on every visit.
  useEffect(() => {
    if (!currentVersion || settings.lastSeenVersion === currentVersion) return
    void saveSettings({ lastSeenVersion: currentVersion })
  }, [currentVersion, settings.lastSeenVersion])

  return (
    <section className="setting-group">
      <h3>Was sich geändert hat</h3>
      <p className="hint">
        Nach jedem Update steht hier, was dazugekommen ist und was repariert wurde. Ältere Einträge
        bleiben stehen.
      </p>

      <div className="changelog">
        {CHANGELOG.map((release) => (
          <article key={release.version} className="changelog-entry">
            <header className="changelog-head">
              <span className="changelog-version">{release.version}</span>
              {release.version === currentVersion && (
                <span className="badge ok dot">Deine Version</span>
              )}
              <span className="changelog-date">{formatDate(release.date)}</span>
            </header>

            <p className="changelog-headline">{release.headline}</p>

            <ul className="changelog-list">
              {release.changes.map((change, index) => (
                <li key={index}>
                  <span className={`changelog-kind ${change.kind}`}>
                    {CHANGE_KIND_LABEL[change.kind]}
                  </span>
                  <span>{change.text}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Error reports
 * ------------------------------------------------------------------ */

function ReportsPanel(): JSX.Element {
  const { settings } = useStore()
  const [reports, setReports] = useState<ErrorReport[] | null>(null)
  const [configured, setConfigured] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    const [list, status] = await Promise.all([
      window.gabi.reports.list().catch(() => [] as ErrorReport[]),
      window.gabi.reports.status().catch(() => ({ configured: false }))
    ])
    setReports(list)
    setConfigured(status.configured)
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <>
      <section className="setting-group">
        <h3>Fehler melden</h3>
        <p className="hint">
          Geht im Launcher etwas schief, wird der Fehler hier festgehalten. Auf Wunsch geht er
          zusätzlich an die Entwicklung, damit Fehler auffallen, von denen sonst niemand erfährt.
        </p>

        <SettingToggle
          label="Fehler automatisch senden"
          hint={
            configured
              ? 'Ohne deinen Namen, deine UUID und deine Zugangsdaten. Deine IP-Adresse wird nicht gespeichert.'
              : 'In dieser Version ist kein Empfänger hinterlegt, es wird nichts gesendet. Berichte werden nur bei dir gespeichert.'
          }
          checked={settings.crashReports === 'on'}
          onChange={(value) => void saveSettings({ crashReports: value ? 'on' : 'off' })}
        />
      </section>

      <section className="setting-group">
        <h3>Was bei dir liegt</h3>
        <p className="hint">
          Jeder Bericht wird auch lokal abgelegt, unabhängig davon, ob gesendet wird. So kannst du
          jederzeit nachlesen, was ein Bericht enthält, und ihn selbst weitergeben.
        </p>

        {reports === null ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : reports.length === 0 ? (
          <p className="hint">Bisher wurde nichts festgehalten. Das ist die gute Nachricht.</p>
        ) : (
          <div className="col gap-8 mt-8">
            {reports.map((report) => (
              <div key={report.id} className="content-row">
                <div className="grow" style={{ overflow: 'hidden' }}>
                  <div className="row gap-8">
                    <span className="badge">{report.area}</span>
                    <span className="content-name truncate">{report.message}</span>
                  </div>
                  <div className="content-meta">
                    <span>{formatDateTime(report.at)}</span>
                    <span>Version {report.version}</span>
                    <span className="truncate">{report.platform}</span>
                  </div>
                  {open === report.id && (
                    <pre className="report-detail">{report.detail || 'Keine weiteren Angaben.'}</pre>
                  )}
                </div>
                <div className="content-actions">
                  <button
                    className="btn sm ghost"
                    onClick={() => setOpen(open === report.id ? null : report.id)}
                  >
                    {open === report.id ? 'Zuklappen' : 'Ansehen'}
                  </button>
                  <button
                    className="btn sm ghost"
                    title="Als Text kopieren, zum Weitergeben"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(
                          `${report.area} | ${report.version} | ${report.platform}\n` +
                            `${report.message}\n\n${report.detail}`
                        )
                        .then(() => toast('success', 'Bericht kopiert'))
                        .catch(() => toastError(new Error('Zwischenablage nicht verfügbar')))
                    }}
                  >
                    Kopieren
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="row gap-8 mt-16">
          <button className="btn ghost" onClick={() => void window.gabi.reports.openFolder()}>
            <IconFolder size={14} />
            Ordner öffnen
          </button>
          <button
            className="btn ghost danger"
            disabled={!reports || reports.length === 0}
            onClick={() => {
              void window.gabi.reports
                .clear()
                .then(load)
                .then(() => toast('success', 'Fehlerberichte gelöscht'))
                .catch((err: unknown) => toastError(err, 'Löschen fehlgeschlagen'))
            }}
          >
            <IconTrash size={14} />
            Alle löschen
          </button>
        </div>
      </section>
    </>
  )
}
