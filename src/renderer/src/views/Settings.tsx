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
import { changeKindLabel, changelogLocalized } from '@shared/changelogEn'
import { navigate, refreshInstances, refreshSettings, saveSettings, toast, toastError, useStore } from '../lib/store'
import { memorySliderMax, useDebouncedSetting } from '../lib/hooks'
import { formatBytes, formatDate, formatDateTime, formatMemory } from '../lib/format'
import { Confirm, SettingToggle } from '../components/ui'
import { SUPPORTED_LANGUAGES, getLanguage, tr } from '@shared/i18n'
import { LogoLockup } from '../components/Logo'
import {
  IconDownload,
  IconExternal,
  IconFolder,
  IconRefresh,
  IconRecord,
  IconShield,
  IconTrash,
  IconWarning
} from '../components/Icons'

type Section =
  | 'general'
  | 'java'
  | 'content'
  | 'accounts'
  | 'appearance'
  | 'recording'
  | 'updates'
  | 'changelog'
  | 'reports'
  | 'advanced'
  | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: tr('Allgemein', 'General') },
  { id: 'appearance', label: tr('Darstellung', 'Appearance') },
  { id: 'java', label: tr('Java & Leistung', 'Java & performance') },
  { id: 'content', label: tr('Inhalte', 'Content') },
  { id: 'accounts', label: 'Accounts' },
  { id: 'recording', label: tr('Aufnahmen', 'Recordings') },
  { id: 'updates', label: 'Updates' },
  { id: 'changelog', label: tr('Neuerungen', 'What\'s new') },
  { id: 'reports', label: tr('Fehlerberichte', 'Error reports') },
  { id: 'advanced', label: tr('Erweitert', 'Advanced') },
  { id: 'about', label: tr('Über', 'About') }
]

/** Human readable state line for the launcher's own updater. */
function updateHeadline(status: UpdateStatus): string {
  switch (status.state) {
    case 'checking':
      return tr('Suche nach Updates…', 'Checking for updates…')
    case 'available':
      return tr(`Version ${status.version} verfügbar`, `Version ${status.version} available`)
    case 'downloading':
      return tr(`Wird geladen… ${Math.round(status.percent ?? 0)}%`, `Downloading… ${Math.round(status.percent ?? 0)}%`)
    case 'ready':
      return tr(`Version ${status.version} ist bereit`, `Version ${status.version} is ready`)
    case 'installing':
      return tr(
        `Version ${status.version} wird installiert, der Launcher startet gleich neu…`,
        `Installing version ${status.version}, the launcher restarts shortly…`
      )
    case 'up-to-date':
      return tr('Launch Gabi ist aktuell', 'Launch Gabi is up to date')
    case 'error':
      return tr('Update-Prüfung fehlgeschlagen', 'Update check failed')
    case 'disabled':
      return tr('Updates nur in der installierten Version', 'Updates only work in the installed version')
    default:
      return `Version ${status.currentVersion}`
  }
}

function LanguageSetting(): JSX.Element {
  const { settings } = useStore()
  const [askRestart, setAskRestart] = useState(false)
  const pending = settings.language !== getLanguage()

  return (
    <section className="setting-group">
      <h3>{tr('Sprache', 'Language')}</h3>
      <p className="hint">
        {tr(
          'Gilt für den ganzen Launcher. Zum Wechseln startet der Launcher neu.',
          'Applies to the whole launcher. Switching restarts the launcher.'
        )}
      </p>
      <div className="option-grid">
        {SUPPORTED_LANGUAGES.map((language) => (
          <button
            key={language.id}
            className={`option ${settings.language === language.id ? 'selected' : ''}`}
            onClick={async () => {
              if (settings.language === language.id) return
              const ok = await saveSettings({ language: language.id })
              if (ok && language.id !== getLanguage()) setAskRestart(true)
            }}
          >
            <div className="option-name">{language.label}</div>
          </button>
        ))}
      </div>
      {pending && !askRestart && (
        <p className="hint">
          {tr('Die neue Sprache gilt ab dem nächsten Start.', 'The new language applies from the next start.')}{' '}
          <button className="link" onClick={() => setAskRestart(true)}>
            {tr('Jetzt neu starten', 'Restart now')}
          </button>
        </p>
      )}
      <Confirm
        open={askRestart}
        title={tr('Launcher neu starten?', 'Restart the launcher?')}
        confirmLabel={tr('Neu starten', 'Restart')}
        message={tr(
          'Die Sprache wechselt nach einem Neustart. Laufende Downloads müssen vorher fertig sein.',
          'The language changes after a restart. Running downloads need to finish first.'
        )}
        onConfirm={async () => {
          setAskRestart(false)
          try {
            await window.gabi.app.relaunch()
          } catch (err) {
            toastError(err, tr('Neustart nicht möglich', 'Restart not possible'))
          }
        }}
        onCancel={() => setAskRestart(false)}
      />
    </section>
  )
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
        <h3>{tr('Launcher-Updates', 'Launcher updates')}</h3>
        <p className="hint">{status ? updateHeadline(status) : tr('Status wird geladen…', 'Loading status…')}</p>

        {state === 'downloading' && (
          <div className="progress mt-8">
            <div className="progress-fill" style={{ width: `${Math.round(status?.percent ?? 0)}%` }} />
          </div>
        )}

        {/* The raw error (often English network text) stays in the log. */}
        {status?.error && (
          <p className="hint mt-8">
            {tr(
              'Der Update-Server war nicht erreichbar. Prüfe deine Internetverbindung und versuche es später erneut.',
              'The update server could not be reached. Check your internet connection and try again later.'
            )}
          </p>
        )}

        {status?.notes && state !== 'up-to-date' && (
          // The raw release notes are markdown from GitHub, not plain text, so
          // showing them as-is left stray "#" and "-" characters on screen.
          // The changelog tab already renders the same information properly.
          <p className="hint mt-8">
            {tr('Was neu ist, steht unter', 'Details are under')}{' '}
            <button
              className="link"
              style={{ background: 'none', padding: 0 }}
              onClick={() => navigate('/settings?section=changelog')}
            >
              {tr('Neuerungen', 'What\'s new')}
            </button>
            .
          </p>
        )}

        <div className="row gap-8 mt-16">
          <button
            className="btn"
            disabled={busy || state === 'checking' || state === 'downloading' || state === 'installing'}
            onClick={() => run(() => window.gabi.updates.check())}
          >
            <IconRefresh />
            {tr('Jetzt suchen', 'Check now')}
          </button>

          {state === 'available' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => window.gabi.updates.download())}
            >
              <IconDownload />
              {tr('Herunterladen', 'Download')}
            </button>
          )}

          {state === 'ready' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => window.gabi.updates.install())}
            >
              {tr('Neu starten & installieren', 'Restart & install')}
            </button>
          )}
        </div>
      </section>

      <section className="setting-group">
        <h3>{tr('Verhalten', 'Behavior')}</h3>
        <SettingToggle
          label={tr('Updates automatisch herunterladen', 'Download updates automatically')}
          hint={tr('Neue Versionen werden still im Hintergrund geladen, während du den Launcher benutzt.', 'New versions download quietly in the background while you use the launcher.')}
          checked={settings.autoUpdate}
          onChange={(value) => void saveSettings({ autoUpdate: value })}
        />
        <SettingToggle
          label={tr('Beim Start automatisch installieren', 'Install automatically on start')}
          hint={tr(
            'Ist ein Update fertig geladen, wird es beim nächsten Öffnen eingespielt und der Launcher startet neu. Es wird dabei nichts heruntergeladen, der Start bleibt schnell.',
            'When an update has finished downloading, it is installed the next time you open the launcher, which then restarts. Nothing is downloaded at that point, so starting stays fast.'
          )}
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
  const { settings, accounts } = useStore()
  const wanted = query?.get('section')
  const [section, setSection] = useState<Section>(
    wanted && SECTION_IDS.has(wanted) ? (wanted as Section) : 'general'
  )
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([])
  const [detecting, setDetecting] = useState(false)
  const [installingJava, setInstallingJava] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDataDir, setConfirmDataDir] = useState(false)
  const [apiKey, setApiKey] = useState(settings.curseForgeApiKey)
  // Only claims to be unread once the version is actually known: before the
  // app info arrives both sides are empty strings and the dot would flicker.
  const changelogUnread = Boolean(info?.version) && settings.lastSeenVersion !== info?.version
  const memoryMax = memorySliderMax(info?.systemMemoryMb)
  const [clientId, setClientId] = useState(settings.microsoftClientId)
  // Debounced: these five write straight to a settings file on disk, and
  // without this every step of a drag or every keystroke was its own
  // synchronous rewrite.
  const [defaultMemoryMb, setDefaultMemoryMb] = useDebouncedSetting(settings.defaultMemoryMb, (value) =>
    saveSettings({ defaultMemoryMb: value })
  )
  const [defaultJvmArgs, setDefaultJvmArgs] = useDebouncedSetting(settings.defaultJvmArgs, (value) =>
    saveSettings({ defaultJvmArgs: value })
  )
  const [concurrentDownloads, setConcurrentDownloads] = useDebouncedSetting(
    settings.concurrentDownloads,
    (value) => saveSettings({ concurrentDownloads: value })
  )
  const [automaticBackupKeep, setAutomaticBackupKeep] = useDebouncedSetting(
    settings.automaticBackupKeep,
    (value) => saveSettings({ automaticBackupKeep: value })
  )

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

  /** Runs after the confirm dialog, once the user actually wants to switch. */
  const changeDataDirectory = async (): Promise<void> => {
    setConfirmDataDir(false)
    let dir: string | null
    try {
      dir = await window.gabi.app.pickDirectory(tr('Datenverzeichnis wählen', 'Choose data folder'))
    } catch (err) {
      toastError(err, tr('Ordnerauswahl fehlgeschlagen', 'Choosing a folder failed'))
      return
    }
    if (!dir) return
    // Only report a move once the save actually took. A rejected path
    // (unwritable, invalid) left the directory untouched, yet this still told
    // the user it had changed and to go move their data across.
    if (!(await saveSettings({ dataDirectory: dir }))) return
    // The main process just dropped its instance cache, so the list on screen
    // still shows the old directory's instances until it is read again.
    await refreshInstances()
    toast('success', tr('Datenordner geändert', 'Data folder changed'))
  }

  return (
    <div className="col gap-24">
      <header>
        <h1 className="page-title">{tr('Einstellungen', 'Settings')}</h1>
        <p className="page-sub">{tr('Alles, was für alle Instanzen gilt.', 'Everything that applies to all instances.')}</p>
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
                <h3>{tr('Start', 'Startup')}</h3>
                <SettingToggle
                  label={tr('Minimiert starten', 'Start minimized')}
                  hint={tr('Launch Gabi startet im Hintergrund, ohne Fenster.', 'Launch Gabi starts in the background, without a window.')}
                  checked={settings.startMinimized}
                  onChange={(value) => void saveSettings({ startMinimized: value })}
                />
                <div className="field mt-16">
                  <label className="label" htmlFor="st-verhalten-beim-spielstart">{tr('Verhalten beim Spielstart', 'When a game starts')}</label>
                  <select id="st-verhalten-beim-spielstart"
                    className="select"
                    value={settings.launchBehaviour}
                    onChange={(event) =>
                      void saveSettings({ launchBehaviour: event.target.value as LaunchBehaviour })
                    }
                  >
                    <option value="keep">{tr('Launcher offen lassen', 'Keep the launcher open')}</option>
                    <option value="hide">{tr('Launcher ausblenden, nur das Log zeigen', 'Hide the launcher, show only the log')}</option>
                    <option value="close">{tr('Launcher minimieren', 'Minimize the launcher')}</option>
                  </select>
                  <span className="hint">
                    {tr('Gilt als Voreinstellung; jede Instanz kann davon abweichen. Wird das Log-Fenster geschlossen, kommt der Launcher wieder hervor.', 'This is the default; each instance can override it. Closing the log window brings the launcher back.')}
                  </span>
                </div>
              </section>

              <section className="setting-group">
                <h3>{tr('Benachrichtigungen', 'Notifications')}</h3>
                <SettingToggle
                  label={tr('Beim Start auf Mod-Updates prüfen', 'Check for mod updates on start')}
                  hint={tr('Prüft im Hintergrund alle Instanzen, sobald der Launcher startet.', 'Checks all instances in the background as soon as the launcher starts.')}
                  checked={settings.checkContentUpdatesOnStart}
                  onChange={(value) => void saveSettings({ checkContentUpdatesOnStart: value })}
                />
                <SettingToggle
                  label={tr('Über verfügbare Updates informieren', 'Notify about available updates')}
                  hint={tr('Zeigt eine Meldung, wenn die Prüfung oben neue Mod-Updates gefunden hat.', 'Shows a message when the check above found new mod updates.')}
                  checked={settings.notifyOnUpdates}
                  onChange={(value) => void saveSettings({ notifyOnUpdates: value })}
                />
                <SettingToggle
                  label={tr('Melden, wenn Minecraft beendet wird', 'Notify when Minecraft closes')}
                  hint={tr('Zeigt nach jeder Sitzung eine kurze Zusammenfassung.', 'Shows a short summary after every session.')}
                  checked={settings.notifyOnGameExit}
                  onChange={(value) => void saveSettings({ notifyOnGameExit: value })}
                />
              </section>

              <section className="setting-group">
                <h3>{tr('Speicherort', 'Storage location')}</h3>
                <p className="hint">
                  {tr('Hier liegen Instanzen, Versionen, Bibliotheken und Java-Laufzeiten.', 'Instances, versions, libraries and Java runtimes are stored here.')}
                </p>
                <div className="row gap-8">
                  <input className="input" value={settings.dataDirectory} readOnly />
                  <button className="btn" onClick={() => setConfirmDataDir(true)}>
                    {tr('Ändern', 'Change')}
                  </button>
                  <button
                    className="btn icon"
                    onClick={() => void window.gabi.app.openPath(settings.dataDirectory)}
                    aria-label={tr('Ordner öffnen', 'Open folder')}
                  >
                    <IconFolder size={15} />
                  </button>
                </div>
              </section>
            </>
          )}

          {section === 'appearance' && (
            <>
              <LanguageSetting />

              <section className="setting-group">
                <h3>{tr('Theme', 'Theme')}</h3>
                <p className="hint">{tr('Bestimmt die Hintergrundstimmung des Launchers.', 'Sets the background mood of the launcher.')}</p>
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
                <h3>{tr('Akzentfarbe', 'Accent color')}</h3>
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
                <h3>{tr('Bewegung', 'Motion')}</h3>
                <SettingToggle
                  label={tr('Animationen reduzieren', 'Reduce animations')}
                  hint={tr('Schaltet Übergänge und Effekte ab, hilfreich auf schwächerer Hardware.', 'Turns off transitions and effects, helpful on weaker hardware.')}
                  checked={settings.reduceMotion}
                  onChange={(value) => void saveSettings({ reduceMotion: value })}
                />
              </section>

              <section className="setting-group">
                <h3>{tr('Eigene Startseite (Beta)', 'Custom title screen (beta)')}</h3>
                <p className="hint">
                  {tr(
                    'Tauscht Hintergrund und die normalen Knöpfe im Minecraft-Hauptmenü gegen einen eigenen Stil von Launch Gabi, per Ressourcenpaket, ohne das Spiel selbst zu verändern. Wirkt ab dem nächsten Start einer Instanz, auf Minecraft 1.20.2 und neuer. Ein Mod-Knopf, der den normalen Minecraft-Knopf verwendet, sieht automatisch genauso aus, einer mit eigener Zeichnung nicht. Noch in Arbeit: kein eigenes Menü mit eigenen Animationen, das bleibt ein größeres, eigenes Vorhaben.',
                    'Replaces the background and the regular buttons in the Minecraft main menu with a Launch Gabi style, using a resource pack, without changing the game itself. Takes effect from the next start of an instance, on Minecraft 1.20.2 and newer. A mod button that uses the regular Minecraft button automatically looks the same, one with its own artwork does not. Still in progress: no custom menu with its own animations yet, that remains a bigger project of its own.'
                  )}
                </p>
                <SettingToggle
                  label={tr('Eigene Startseite verwenden', 'Use custom title screen')}
                  hint={tr('Gilt für alle Instanzen und jede Minecraft-Version.', 'Applies to all instances and every Minecraft version.')}
                  checked={settings.customStartScreen === 'on'}
                  onChange={(value) => void saveSettings({ customStartScreen: value ? 'on' : 'off' })}
                />
              </section>
            </>
          )}

          {section === 'java' && (
            <>
              <section className="setting-group">
                <h3>{tr('Java-Verwaltung', 'Java management')}</h3>
                <SettingToggle
                  label={tr('Java automatisch verwalten', 'Manage Java automatically')}
                  hint={tr(
                    'Launch Gabi lädt die passende Java-Version selbst herunter. Ohne diese Option musst du Java manuell installieren.',
                    'Launch Gabi downloads the right Java version by itself. Without this option you have to install Java manually.'
                  )}
                  checked={settings.javaAutoManage}
                  onChange={(value) => void saveSettings({ javaAutoManage: value })}
                />

                <div className="row-between mt-20">
                  <h4 style={{ fontSize: 14 }}>{tr('Gefundene Installationen', 'Installations found')}</h4>
                  <button
                    className="btn sm"
                    disabled={detecting}
                    onClick={async () => {
                      setDetecting(true)
                      try {
                        setRuntimes(await window.gabi.java.detect())
                        toast('success', tr('Suche abgeschlossen', 'Search finished'))
                      } catch (err) {
                        // Was missing entirely, unlike the install buttons
                        // below: a rejection ended as an unhandled promise and
                        // the spinner simply stopped with no explanation.
                        toastError(err, tr('Java-Suche fehlgeschlagen', 'Java search failed'))
                      } finally {
                        setDetecting(false)
                      }
                    }}
                  >
                    {detecting ? <span className="spinner" /> : <IconRefresh size={14} />}
                    {tr('Neu suchen', 'Search again')}
                  </button>
                </div>

                <div className="col gap-8 mt-12">
                  {runtimes.length === 0 ? (
                    <div className="hint">{tr('Noch keine Java-Installation gefunden.', 'No Java installation found yet.')}</div>
                  ) : (
                    runtimes.map((runtime) => (
                      <div key={runtime.path} className="content-row">
                        <div className="content-icon">☕</div>
                        <div className="grow" style={{ overflow: 'hidden' }}>
                          <div className="content-name">
                            Java {runtime.major}
                            {runtime.managed && <span className="badge accent" style={{ marginLeft: 8 }}>{tr('verwaltet', 'managed')}</span>}
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
                          toast('success', tr(`Java ${major} installiert`, `Java ${major} installed`), runtime.version)
                          setRuntimes(await window.gabi.java.list(true))
                        } catch (err) {
                          toastError(err, tr(`Java ${major} konnte nicht installiert werden`, `Java ${major} could not be installed`))
                        } finally {
                          setInstallingJava(null)
                        }
                      }}
                    >
                      {installingJava === major ? <span className="spinner" /> : <IconDownload size={14} />}
                      {tr(`Java ${major} laden`, `Get Java ${major}`)}
                    </button>
                  ))}
                </div>
              </section>

              <section className="setting-group">
                <h3>{tr('Standardwerte für neue Instanzen', 'Defaults for new instances')}</h3>
                <div className="field">
                  <label className="label" htmlFor="st-standard-arbeitsspeicher">
                    {tr('Arbeitsspeicher', 'Memory')}: {formatMemory(Math.min(defaultMemoryMb, memoryMax))}
                  </label>
                  <input
                    id="st-standard-arbeitsspeicher"
                    className="range"
                    type="range"
                    min={1024}
                    max={memoryMax}
                    step={512}
                    value={Math.min(defaultMemoryMb, memoryMax)}
                    onChange={(event) => setDefaultMemoryMb(Number(event.target.value))}
                  />
                  {info && (
                    <span className="hint">
                      {tr(
                        `Dein System hat ${formatMemory(info.systemMemoryMb)} RAM. Lass mindestens 2-4 GB für Windows übrig.`,
                        `Your system has ${formatMemory(info.systemMemoryMb)} of RAM. Leave at least 2-4 GB for Windows.`
                      )}
                    </span>
                  )}
                </div>

                <div className="field mt-16">
                  <label className="label" htmlFor="st-jvm-argumente">{tr('JVM-Argumente', 'JVM arguments')}</label>
                  <textarea id="st-jvm-argumente"
                    className="textarea"
                    value={defaultJvmArgs}
                    onChange={(event) => setDefaultJvmArgs(event.target.value)}
                  />
                </div>
              </section>

              <section className="setting-group">
                <h3>Downloads</h3>
                <div className="field">
                  <label className="label" htmlFor="st-gleichzeitige-downloads">
                    {tr('Gleichzeitige Downloads', 'Parallel downloads')}: {concurrentDownloads}
                  </label>
                  <input
                    id="st-gleichzeitige-downloads"
                    className="range"
                    type="range"
                    min={1}
                    max={24}
                    value={concurrentDownloads}
                    onChange={(event) => setConcurrentDownloads(Number(event.target.value))}
                  />
                  <span className="hint">
                    {tr('Mehr ist schneller, belastet aber Verbindung und Festplatte stärker.', 'More is faster, but puts more load on your connection and disk.')}
                  </span>
                </div>
              </section>
            </>
          )}

          {section === 'content' && (
            <>
              <section className="setting-group">
                <h3>{tr('Mod-Verwaltung', 'Mod management')}</h3>
                <SettingToggle
                  label={tr('Abhängigkeiten automatisch installieren', 'Install dependencies automatically')}
                  hint={tr('Fehlende Bibliotheken wie Fabric API werden ohne Nachfrage mitinstalliert.', 'Missing libraries such as Fabric API are installed along without asking.')}
                  checked={settings.autoInstallDependencies}
                  onChange={(value) => void saveSettings({ autoInstallDependencies: value })}
                />
                <SettingToggle
                  label={tr('Snapshots in der Versionsliste zeigen', 'Show snapshots in the version list')}
                  checked={settings.showSnapshots}
                  onChange={(value) => void saveSettings({ showSnapshots: value })}
                />
              </section>

              <section className="setting-group">
                <h3>CurseForge</h3>
                <p className="hint">
                  {tr(
                    'Modrinth funktioniert ohne Anmeldung. Für CurseForge verlangt die Plattform einen eigenen API-Schlüssel, den du kostenlos erstellen kannst.',
                    'Modrinth works without signing in. CurseForge requires its own API key, which you can create for free.'
                  )}
                </p>
                <div className="row gap-8">
                  <input
                    className="input"
                    type="password"
                    placeholder={tr('API-Schlüssel einfügen', 'Paste API key')}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button className="btn primary" onClick={() => void saveSettings({ curseForgeApiKey: apiKey })}>
                    {tr('Speichern', 'Save')}
                  </button>
                </div>
                <button
                  className="btn ghost sm mt-8"
                  onClick={() => void window.gabi.app.openExternal('https://console.curseforge.com/')}
                >
                  <IconExternal size={14} />
                  {tr('Schlüssel erstellen', 'Create key')}
                </button>
              </section>

              <section className="setting-group">
                <h3>{tr('Automatische Sicherungen', 'Automatic backups')}</h3>
                <SettingToggle
                  label={tr('Automatisch sichern', 'Back up automatically')}
                  hint={tr('Legt regelmäßig Sicherungen der Welten an.', 'Regularly creates backups of your worlds.')}
                  checked={settings.automaticBackups}
                  onChange={(value) => void saveSettings({ automaticBackups: value })}
                />
                <div className="field mt-16">
                  <label className="label" htmlFor="st-aufbewahrte-sicherungen">
                    {tr('Anzahl aufbewahrter automatischer Sicherungen', 'Automatic backups to keep')}: {automaticBackupKeep}
                  </label>
                  <input
                    id="st-aufbewahrte-sicherungen"
                    className="range"
                    type="range"
                    min={1}
                    max={20}
                    value={automaticBackupKeep}
                    onChange={(event) => setAutomaticBackupKeep(Number(event.target.value))}
                  />
                </div>
              </section>
            </>
          )}

          {section === 'accounts' && (
            <section className="setting-group">
              <h3>{tr('Microsoft-Anmeldung', 'Microsoft sign-in')}</h3>
              <p className="hint">
                {tr(
                  'Launch Gabi meldet sich über den Geräte-Code-Ablauf an, dein Passwort wird nie im Launcher eingegeben. Voreingestellt ist die Anwendungs-ID des offiziellen Minecraft-Launchers, die über',
                  'Launch Gabi signs in with the device code flow, your password is never entered in the launcher. The default is the application ID of the official Minecraft Launcher, which runs through'
                )}{' '}
                <span className="mono">login.live.com</span>
                {tr(' läuft.', '.')}{' '}
                {tr(
                  'Trägst du hier stattdessen eine eigene Azure-Anwendungs-ID im GUID-Format ein, wechselt Launch Gabi automatisch auf den Azure-AD-Ablauf.',
                  'If you enter your own Azure application ID in GUID format here instead, Launch Gabi switches to the Azure AD flow automatically.'
                )}
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
                  {tr('Speichern', 'Save')}
                </button>
              </div>
              <div className="issue info mt-16">
                <div className="issue-icon">
                  <IconShield size={16} />
                </div>
                <div>
                  <div className="issue-title">{tr('Wo werden Tokens gespeichert?', 'Where are tokens stored?')}</div>
                  <div className="issue-detail">
                    {tr(
                      'Zugriffs- und Aktualisierungstoken liegen verschlüsselt in deinem Benutzerprofil und werden über die Verschlüsselung des Betriebssystems geschützt. Sie verlassen deinen Rechner nur Richtung Microsoft und Mojang.',
                      'Access and refresh tokens are stored encrypted in your user profile, protected by your operating system\'s encryption. They only ever leave your computer toward Microsoft and Mojang.'
                    )}
                  </div>
                </div>
              </div>
              {accounts.some((account) => account.secure === false) && (
                <div className="issue warning mt-8">
                  <div className="issue-icon">
                    <IconWarning size={16} />
                  </div>
                  <div>
                    <div className="issue-title">{tr('Ungeschützt gespeichert', 'Stored unprotected')}</div>
                    <div className="issue-detail">
                      {tr(
                        'Bei mindestens einem gespeicherten Account konnte das Betriebssystem keine Verschlüsselung anbieten, der Token liegt dort ungeschützt auf der Festplatte.',
                        'For at least one saved account the operating system could not offer encryption, so its token is stored unprotected on disk.'
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {section === 'recording' && <RecordingPanel />}

          {section === 'updates' && <UpdatePanel />}

          {section === 'changelog' && <ChangelogPanel currentVersion={info?.version ?? ''} />}

          {section === 'reports' && <ReportsPanel />}

          {section === 'advanced' && (
            <>
              <section className="setting-group">
                <h3>{tr('Protokolle', 'Logs')}</h3>
                <p className="hint">
                  {tr('Bei Problemen findest du hier die Launcher-Logs. Sie enthalten keine Zugangsdaten.', 'If something goes wrong, you can find the launcher logs here. They contain no credentials.')}
                </p>
                <button
                  className="btn"
                  onClick={() => info && void window.gabi.app.openPath(info.logDirectory)}
                >
                  <IconFolder size={15} />
                  {tr('Log-Ordner öffnen', 'Open log folder')}
                </button>
              </section>

              <section className="setting-group">
                <h3>{tr('Zurücksetzen', 'Reset')}</h3>
                <p className="hint">
                  {tr(
                    'Setzt alle Launcher-Einstellungen auf die Voreinstellung zurück. Der Datenordner und deine Instanzen, Welten und Accounts bleiben dabei unverändert.',
                    'Resets all launcher settings to their defaults. The data folder and your instances, worlds and accounts stay as they are.'
                  )}
                </p>
                <button className="btn danger" onClick={() => setConfirmReset(true)}>
                  <IconTrash size={15} />
                  {tr('Einstellungen zurücksetzen', 'Reset settings')}
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
                  <div className="preflight-label">{tr('Plattform', 'Platform')}</div>
                  <div className="preflight-value">
                    {info.platform} {info.arch}
                  </div>
                </div>
                <div className="preflight-cell">
                  <div className="preflight-label">{tr('Arbeitsspeicher', 'Memory')}</div>
                  <div className="preflight-value">{formatMemory(info.systemMemoryMb)}</div>
                </div>
              </div>

              <p className="hint mt-20">
                {tr(
                  'Launch Gabi ist kein offizielles Produkt von Mojang oder Microsoft. Minecraft ist eine Marke von Mojang AB. Mod-Inhalte stammen von Modrinth und CurseForge und unterliegen den Lizenzen der jeweiligen Autoren.',
                  'Launch Gabi is not an official product of Mojang or Microsoft. Minecraft is a trademark of Mojang AB. Mod content comes from Modrinth and CurseForge and is subject to the licenses of its authors.'
                )}
              </p>
            </section>
          )}
        </div>
      </div>

      <Confirm
        open={confirmReset}
        title={tr('Einstellungen zurücksetzen?', 'Reset settings?')}
        danger
        confirmLabel={tr('Zurücksetzen', 'Reset')}
        message={tr(
          'Alle Launcher-Einstellungen kehren zur Voreinstellung zurück. Deine Instanzen, Welten und Accounts bleiben unangetastet.',
          'All launcher settings return to their defaults. Your instances, worlds and accounts stay untouched.'
        )}
        onConfirm={async () => {
          try {
            await window.gabi.settings.reset()
            await refreshSettings()
            setConfirmReset(false)
            toast('success', tr('Zurückgesetzt', 'Reset done'))
          } catch (err) {
            setConfirmReset(false)
            toastError(err, tr('Zurücksetzen fehlgeschlagen', 'Reset failed'))
          }
        }}
        onCancel={() => setConfirmReset(false)}
      />

      <Confirm
        open={confirmDataDir}
        title={tr('Datenordner ändern?', 'Change data folder?')}
        confirmLabel={tr('Ordner auswählen', 'Choose folder')}
        message={tr(
          'Deine vorhandenen Instanzen werden nicht verschoben. Im neuen Ordner startest du leer. Den alten Ordner kannst du jederzeit wieder auswählen.',
          'Your existing instances are not moved. You start empty in the new folder. You can pick the old folder again at any time.'
        )}
        onConfirm={changeDataDirectory}
        onCancel={() => setConfirmDataDir(false)}
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
  {
    id: 'low',
    label: tr('Sparsam', 'Light'),
    hint: tr('30 Bilder, kleine Dateien. Schont den Rechner am meisten.', '30 frames, small files. Easiest on your computer.')
  },
  {
    id: 'medium',
    label: tr('Ausgewogen', 'Balanced'),
    hint: tr('30 Bilder in guter Qualität. Kostet wenig Leistung.', '30 frames in good quality. Costs little performance.')
  },
  {
    id: 'high',
    label: tr('Scharf', 'Sharp'),
    hint: tr('60 Bilder. Nur wenn dein Rechner Luft hat, sonst ruckelt die Aufnahme.', '60 frames. Only if your computer has headroom, otherwise the recording stutters.')
  }
]

function RecordingPanel(): JSX.Element {
  const { settings, recording } = useStore()
  const [recordingMaxMinutes, setRecordingMaxMinutes] = useDebouncedSetting(
    settings.recordingMaxMinutes,
    (value) => saveSettings({ recordingMaxMinutes: value })
  )

  return (
    <>
      <section className="setting-group">
        <h3>{tr('Aufnehmen im Spiel', 'Recording in game')}</h3>
        <p className="hint">
          {tr(
            'Eine Taste startet die Aufnahme, dieselbe Taste beendet sie wieder. Die fertigen Videos findest du bei der Instanz im Reiter Aufnahmen, zusammen mit deinen Screenshots.',
            'One key starts the recording, the same key stops it again. You can find the finished videos in the instance under the Recordings tab, together with your screenshots.'
          )}
        </p>

        <SettingToggle
          label={tr('Aufnahmen erlauben', 'Allow recordings')}
          hint={tr(
            'Ist das aus, wird die Taste gar nicht erst belegt und steht anderen Programmen zur Verfügung.',
            'When this is off, the key is not taken at all and stays free for other programs.'
          )}
          checked={settings.recordingEnabled}
          onChange={(value) => void saveSettings({ recordingEnabled: value })}
        />

        <div className="field mt-16">
          <label className="label" htmlFor="st-aufnahmetaste">
            {tr('Aufnahmetaste', 'Recording key')}
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
            {tr(
              'Die Taste gilt systemweit, aber nur solange eine Instanz läuft. Danach ist sie wieder frei für andere Programme.',
              'The key works system wide, but only while an instance is running. Afterwards it is free for other programs again.'
            )}
          </span>
        </div>
      </section>

      <section className="setting-group">
        <h3>{tr('Qualität', 'Quality')}</h3>
        <div className="field">
          <label className="label" htmlFor="st-aufnahmequalitaet">
            {tr('Bildqualität', 'Video quality')}
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
          label={tr('Ton mit aufnehmen', 'Record sound')}
          hint={tr(
            'Nimmt auf, was aus den Lautsprechern kommt. Klappt nicht auf jedem System, dann läuft die Aufnahme ohne Ton weiter.',
            'Records what comes out of your speakers. This does not work on every system, then the recording continues without sound.'
          )}
          checked={settings.recordingAudio}
          onChange={(value) => void saveSettings({ recordingAudio: value })}
        />

        <div className="field mt-16">
          <label className="label" htmlFor="st-aufnahmedauer">
            {tr(`Höchstdauer: ${recordingMaxMinutes} Minuten`, `Maximum length: ${recordingMaxMinutes} minutes`)}
          </label>
          <input
            id="st-aufnahmedauer"
            className="range"
            type="range"
            min={1}
            max={120}
            step={1}
            value={recordingMaxMinutes}
            disabled={!settings.recordingEnabled}
            onChange={(event) => setRecordingMaxMinutes(Number(event.target.value))}
          />
          <span className="hint">
            {tr(
              'Danach hört die Aufnahme von selbst auf. Die Bremse für den Fall, dass du das Beenden vergisst.',
              'After that the recording stops by itself. A safety net in case you forget to stop it.'
            )}
          </span>
        </div>
      </section>

      {recording.active && (
        <section className="setting-group">
          <h3>{tr('Läuft gerade', 'Recording now')}</h3>
          <p className="hint">
            {tr(
              `Es wird aufgenommen, bereits ${formatBytes(recording.bytes)} geschrieben.`,
              `Recording, ${formatBytes(recording.bytes)} written so far.`
            )}
          </p>
          <button className="btn danger mt-8" onClick={() => void window.gabi.recording.toggle()}>
            <IconRecord size={13} />
            {tr('Aufnahme beenden', 'Stop recording')}
          </button>
        </section>
      )}

      <section className="setting-group">
        <h3>{tr('Gut zu wissen', 'Good to know')}</h3>
        <ul className="hint bullet-list">
          <li>
            {tr(
              'Das Launcher-Fenster muss offen bleiben. Steht bei der Instanz das Verhalten auf Schließen, kann nicht aufgenommen werden.',
              'The launcher window has to stay open. If the instance is set to close the launcher, recording is not possible.'
            )}
          </li>
          <li>
            {tr(
              'Im echten Vollbild liefert Minecraft manchmal kein Bild. Der randlose Fenstermodus funktioniert immer.',
              'In exclusive fullscreen Minecraft sometimes delivers no picture. Borderless window mode always works.'
            )}
          </li>
          <li>
            {tr(
              'Videos brauchen viel Platz. Die Höchstdauer oben hält das im Rahmen.',
              'Videos take up a lot of space. The maximum length above keeps that in check.'
            )}
          </li>
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
      <h3>{tr('Was sich geändert hat', 'What has changed')}</h3>
      <p className="hint">
        {tr(
          'Nach jedem Update steht hier, was dazugekommen ist und was repariert wurde. Ältere Einträge bleiben stehen.',
          'After every update this shows what was added and what was fixed. Older entries stay.'
        )}
      </p>

      <div className="changelog">
        {changelogLocalized(getLanguage()).map((release) => (
          <article key={release.version} className="changelog-entry">
            <header className="changelog-head">
              <span className="changelog-version">{release.version}</span>
              {release.version === currentVersion && (
                <span className="badge ok dot">{tr('Deine Version', 'Your version')}</span>
              )}
              <span className="changelog-date">{formatDate(release.date)}</span>
            </header>

            <p className="changelog-headline">{release.headline}</p>

            <ul className="changelog-list">
              {release.changes.map((change, index) => (
                <li key={index}>
                  <span className={`changelog-kind ${change.kind}`}>
                    {changeKindLabel(getLanguage(), change.kind)}
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
        <h3>{tr('Fehler melden', 'Report errors')}</h3>
        <p className="hint">
          {tr(
            'Geht im Launcher etwas schief, wird der Fehler hier festgehalten. Auf Wunsch geht er zusätzlich an die Entwicklung, damit Fehler auffallen, von denen sonst niemand erfährt.',
            'When something goes wrong in the launcher, the error is recorded here. If you want, it is also sent to the developer, so errors get noticed that nobody would otherwise hear about.'
          )}
        </p>

        <SettingToggle
          label={tr('Fehler automatisch senden', 'Send errors automatically')}
          hint={
            configured
              ? tr(
                  'Ohne deinen Namen, deine UUID und deine Zugangsdaten. Deine IP-Adresse wird nicht gespeichert.',
                  'Without your name, your UUID and your credentials. Your IP address is not stored.'
                )
              : tr(
                  'In dieser Version ist kein Empfänger hinterlegt, es wird nichts gesendet. Berichte werden nur bei dir gespeichert.',
                  'This version has no recipient set up, so nothing is sent. Reports are only stored on your computer.'
                )
          }
          checked={settings.crashReports === 'on'}
          onChange={(value) => void saveSettings({ crashReports: value ? 'on' : 'off' })}
        />
      </section>

      <section className="setting-group">
        <h3>{tr('Was bei dir liegt', 'What is stored on your computer')}</h3>
        <p className="hint">
          {tr(
            'Jeder Bericht wird auch lokal abgelegt, unabhängig davon, ob gesendet wird. So kannst du jederzeit nachlesen, was ein Bericht enthält, und ihn selbst weitergeben.',
            'Every report is also stored locally, whether it is sent or not. That way you can always read what a report contains and pass it on yourself.'
          )}
        </p>

        {reports === null ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : reports.length === 0 ? (
          <p className="hint">
            {tr('Bisher wurde nichts festgehalten. Das ist die gute Nachricht.', 'Nothing has been recorded so far. That is the good news.')}
          </p>
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
                    <span>{tr('Version', 'Version')} {report.version}</span>
                    <span className="truncate">{report.platform}</span>
                  </div>
                  {open === report.id && (
                    <pre className="report-detail">{report.detail || tr('Keine weiteren Angaben.', 'No further details.')}</pre>
                  )}
                </div>
                <div className="content-actions">
                  <button
                    className="btn sm ghost"
                    onClick={() => setOpen(open === report.id ? null : report.id)}
                  >
                    {open === report.id ? tr('Zuklappen', 'Collapse') : tr('Ansehen', 'View')}
                  </button>
                  <button
                    className="btn sm ghost"
                    title={tr('Als Text kopieren, zum Weitergeben', 'Copy as text to pass on')}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(
                          `${report.area} | ${report.version} | ${report.platform}\n` +
                            `${report.message}\n\n${report.detail}`
                        )
                        .then(() => toast('success', tr('Bericht kopiert', 'Report copied')))
                        .catch(() => toastError(new Error(tr('Zwischenablage nicht verfügbar', 'Clipboard not available'))))
                    }}
                  >
                    {tr('Kopieren', 'Copy')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="row gap-8 mt-16">
          <button className="btn ghost" onClick={() => void window.gabi.reports.openFolder()}>
            <IconFolder size={14} />
            {tr('Ordner öffnen', 'Open folder')}
          </button>
          <button
            className="btn ghost danger"
            disabled={!reports || reports.length === 0}
            onClick={() => {
              void window.gabi.reports
                .clear()
                .then(load)
                .then(() => toast('success', tr('Fehlerberichte gelöscht', 'Error reports deleted')))
                .catch((err: unknown) => toastError(err, tr('Löschen fehlgeschlagen', 'Deleting failed')))
            }}
          >
            <IconTrash size={14} />
            {tr('Alle löschen', 'Delete all')}
          </button>
        </div>
      </section>
    </>
  )
}
