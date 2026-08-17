import { useEffect, useState, type JSX } from 'react'
import type { JavaRuntime, LaunchBehaviour, ThemeId, UpdateStatus } from '@shared/types'
import type { AppInfo } from '@shared/api'
import { ACCENT_CHOICES } from '@shared/defaults'
import { refreshInstances, refreshSettings, saveSettings, toast, toastError, useStore } from '../lib/store'
import { formatMemory } from '../lib/format'
import { Confirm, SettingToggle } from '../components/ui'
import { LogoLockup } from '../components/Logo'
import {
  IconDownload,
  IconExternal,
  IconFolder,
  IconRefresh,
  IconShield,
  IconTrash
} from '../components/Icons'

type Section =
  | 'general'
  | 'java'
  | 'content'
  | 'accounts'
  | 'appearance'
  | 'updates'
  | 'advanced'
  | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'Allgemein' },
  { id: 'appearance', label: 'Darstellung' },
  { id: 'java', label: 'Java & Leistung' },
  { id: 'content', label: 'Inhalte' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'updates', label: 'Updates' },
  { id: 'advanced', label: 'Erweitert' },
  { id: 'about', label: 'Über' }
]

/** Human readable state line for the launcher's own updater. */
function updateHeadline(status: UpdateStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Suche nach Updates…'
    case 'available':
      return `Version ${status.version} verfügbar`
    case 'downloading':
      return `Wird geladen… ${Math.round(status.percent ?? 0)}%`
    case 'ready':
      return `Version ${status.version} ist bereit`
    case 'installing':
      return `Version ${status.version} wird installiert, der Launcher startet gleich neu…`
    case 'up-to-date':
      return 'Launch Gabi ist aktuell'
    case 'error':
      return 'Update-Prüfung fehlgeschlagen'
    case 'disabled':
      return 'Updates nur in der installierten Version'
    default:
      return `Version ${status.currentVersion}`
  }
}

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

export function SettingsView(): JSX.Element {
  const { settings } = useStore()
  const [section, setSection] = useState<Section>('general')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([])
  const [detecting, setDetecting] = useState(false)
  const [installingJava, setInstallingJava] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [apiKey, setApiKey] = useState(settings.curseForgeApiKey)
  const [clientId, setClientId] = useState(settings.microsoftClientId)

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
                  <label className="label">Verhalten beim Spielstart</label>
                  <select
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
                      await saveSettings({ dataDirectory: dir })
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
                  hint="Schaltet Übergänge und Effekte ab — hilfreich auf schwächerer Hardware."
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
                  <label className="label">
                    Arbeitsspeicher: {formatMemory(settings.defaultMemoryMb)}
                  </label>
                  <input
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
                  <label className="label">JVM-Argumente</label>
                  <textarea
                    className="textarea"
                    value={settings.defaultJvmArgs}
                    onChange={(event) => void saveSettings({ defaultJvmArgs: event.target.value })}
                  />
                </div>
              </section>

              <section className="setting-group">
                <h3>Downloads</h3>
                <div className="field">
                  <label className="label">
                    Gleichzeitige Downloads: {settings.concurrentDownloads}
                  </label>
                  <input
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
                  <label className="label">
                    Anzahl aufbewahrter automatischer Sicherungen: {settings.automaticBackupKeep}
                  </label>
                  <input
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
                Launch Gabi meldet sich über den Geräte-Code-Ablauf an — dein Passwort wird nie im Launcher
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

          {section === 'updates' && <UpdatePanel />}

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
