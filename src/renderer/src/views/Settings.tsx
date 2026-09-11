import { useEffect, useState, type JSX } from 'react'
import type {
  JavaRuntime,
  LanguageId,
  LaunchBehaviour,
  RecordingQuality,
  ThemeId,
  UpdateStatus
} from '@shared/types'
import type { AppInfo, ErrorReport } from '@shared/api'
import { ACCENT_CHOICES } from '@shared/defaults'
import { changelogLocalized, changeKindLabel } from '@shared/changelogEn'
import { refreshInstances, refreshSettings, saveSettings, toast, toastError, useStore } from '../lib/store'
import { useDebouncedSetting } from '../lib/hooks'
import { SUPPORTED_LANGUAGES, t } from '../lib/i18n'
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
  | 'backups'
  | 'updates'
  | 'changelog'
  | 'reports'
  | 'advanced'
  | 'about'

// Labels are looked up through `sectionLabel()` at render time rather than
// baked in here, since this array is a module-level constant evaluated once:
// resolving t() at that point would freeze every nav label in whichever
// language was active on first load, and the switch on the appearance
// section would never change them again.
const SECTIONS: { id: Section; key: string }[] = [
  { id: 'general', key: 'nav.general' },
  { id: 'appearance', key: 'nav.appearance' },
  { id: 'java', key: 'nav.java' },
  { id: 'content', key: 'nav.content' },
  { id: 'accounts', key: 'nav.accounts' },
  { id: 'recording', key: 'nav.recording' },
  { id: 'backups', key: 'nav.backups' },
  { id: 'updates', key: 'nav.updates' },
  { id: 'changelog', key: 'nav.changelog' },
  { id: 'reports', key: 'nav.reports' },
  { id: 'advanced', key: 'nav.advanced' },
  { id: 'about', key: 'nav.about' }
]

function sectionLabel(id: Section): string {
  const entry = SECTIONS.find((section) => section.id === id)
  return entry ? t('settings', entry.key) : id
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
        <h3>{t('settings', 'updates.title')}</h3>
        <p className="hint">{status ? updateHeadline(status) : t('settings', 'updates.statusLoading')}</p>

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
            {t('settings', 'updates.checkNow')}
          </button>

          {state === 'available' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => window.gabi.updates.download())}
            >
              <IconDownload />
              {t('common', 'download')}
            </button>
          )}

          {state === 'ready' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => window.gabi.updates.install())}
            >
              {t('settings', 'updates.restartAndInstall')}
            </button>
          )}
        </div>
      </section>

      <section className="setting-group">
        <h3>{t('settings', 'updates.behaviour.title')}</h3>
        <SettingToggle
          label={t('settings', 'updates.autoDownload.label')}
          hint={t('settings', 'updates.autoDownload.hint')}
          checked={settings.autoUpdate}
          onChange={(value) => void saveSettings({ autoUpdate: value })}
        />
        <SettingToggle
          label={t('settings', 'updates.autoInstall.label')}
          hint={t('settings', 'updates.autoInstall.hint')}
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
  const [apiKey, setApiKey] = useState(settings.curseForgeApiKey)
  // Only claims to be unread once the version is actually known: before the
  // app info arrives both sides are empty strings and the dot would flicker.
  const changelogUnread = Boolean(info?.version) && settings.lastSeenVersion !== info?.version
  const [clientId, setClientId] = useState(settings.microsoftClientId)
  // Debounced: these five write straight to a settings file on disk, and
  // without this every step of a drag or every keystroke was its own
  // synchronous rewrite.
  const [defaultMemoryMb, setDefaultMemoryMb] = useDebouncedSetting(settings.defaultMemoryMb, (value) =>
    void saveSettings({ defaultMemoryMb: value })
  )
  const [defaultJvmArgs, setDefaultJvmArgs] = useDebouncedSetting(settings.defaultJvmArgs, (value) =>
    void saveSettings({ defaultJvmArgs: value })
  )
  const [concurrentDownloads, setConcurrentDownloads] = useDebouncedSetting(
    settings.concurrentDownloads,
    (value) => void saveSettings({ concurrentDownloads: value })
  )
  const [automaticBackupKeep, setAutomaticBackupKeep] = useDebouncedSetting(
    settings.automaticBackupKeep,
    (value) => void saveSettings({ automaticBackupKeep: value })
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

  return (
    <div className="col gap-24">
      <header>
        <h1 className="page-title">{t('settings', 'page.title')}</h1>
        <p className="page-sub">{t('settings', 'page.subtitle')}</p>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              className={section === entry.id ? 'active' : ''}
              onClick={() => setSection(entry.id)}
            >
              {sectionLabel(entry.id)}
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
                <h3>{t('settings', 'general.start.title')}</h3>
                <SettingToggle
                  label={t('settings', 'general.startMinimized.label')}
                  hint={t('settings', 'general.startMinimized.hint')}
                  checked={settings.startMinimized}
                  onChange={(value) => void saveSettings({ startMinimized: value })}
                />
                <div className="field mt-16">
                  <label className="label" htmlFor="st-verhalten-beim-spielstart">
                    {t('settings', 'general.launchBehaviour.label')}
                  </label>
                  <select id="st-verhalten-beim-spielstart"
                    className="select"
                    value={settings.launchBehaviour}
                    onChange={(event) =>
                      void saveSettings({ launchBehaviour: event.target.value as LaunchBehaviour })
                    }
                  >
                    <option value="keep">{t('settings', 'general.launchBehaviour.keep')}</option>
                    <option value="hide">{t('settings', 'general.launchBehaviour.hide')}</option>
                    <option value="close">{t('settings', 'general.launchBehaviour.close')}</option>
                  </select>
                  <span className="hint">
                    {t('settings', 'general.launchBehaviour.hint')}
                  </span>
                </div>
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'general.notifications.title')}</h3>
                <SettingToggle
                  label={t('settings', 'general.checkContentUpdatesOnStart.label')}
                  hint={t('settings', 'general.checkContentUpdatesOnStart.hint')}
                  checked={settings.checkContentUpdatesOnStart}
                  onChange={(value) => void saveSettings({ checkContentUpdatesOnStart: value })}
                />
                <SettingToggle
                  label={t('settings', 'general.notifyOnUpdates.label')}
                  checked={settings.notifyOnUpdates}
                  onChange={(value) => void saveSettings({ notifyOnUpdates: value })}
                />
                <SettingToggle
                  label={t('settings', 'general.notifyOnGameExit.label')}
                  hint={t('settings', 'general.notifyOnGameExit.hint')}
                  checked={settings.notifyOnGameExit}
                  onChange={(value) => void saveSettings({ notifyOnGameExit: value })}
                />
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'general.dataDirectory.title')}</h3>
                <p className="hint">
                  {t('settings', 'general.dataDirectory.hint')}
                </p>
                <div className="row gap-8">
                  <input className="input" value={settings.dataDirectory} readOnly />
                  <button
                    className="btn"
                    onClick={async () => {
                      const dir = await window.gabi.app.pickDirectory(
                        t('settings', 'general.dataDirectory.pickerTitle')
                      )
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
                        t('settings', 'general.dataDirectory.changedToastTitle'),
                        t('settings', 'general.dataDirectory.changedToastMessage'),
                        10000
                      )
                    }}
                  >
                    {t('settings', 'general.dataDirectory.changeButton')}
                  </button>
                  <button
                    className="btn icon"
                    onClick={() => void window.gabi.app.openPath(settings.dataDirectory)}
                    aria-label={t('settings', 'general.dataDirectory.openFolderAria')}
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
                <h3>{t('settings', 'language.title')}</h3>
                <p className="hint">{t('settings', 'language.hint')}</p>
                <select
                  value={settings.language}
                  onChange={(event) =>
                    void saveSettings({ language: event.target.value as LanguageId })
                  }
                  style={{ alignSelf: 'flex-start', marginTop: 10, maxWidth: 220 }}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'appearance.navigation.title')}</h3>
                <p className="hint">
                  {t('settings', 'appearance.navigation.hint')}
                </p>
                <div className="segmented" style={{ alignSelf: 'flex-start', marginTop: 10 }}>
                  <button
                    className={settings.navPosition !== 'side' ? 'active' : ''}
                    onClick={() => void saveSettings({ navPosition: 'top' })}
                  >
                    {t('settings', 'appearance.navigation.top')}
                  </button>
                  <button
                    className={settings.navPosition === 'side' ? 'active' : ''}
                    onClick={() => void saveSettings({ navPosition: 'side' })}
                  >
                    {t('settings', 'appearance.navigation.side')}
                  </button>
                </div>
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'appearance.theme.title')}</h3>
                <p className="hint">{t('settings', 'appearance.theme.hint')}</p>
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
                <h3>{t('settings', 'appearance.accentColor.title')}</h3>
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
                <h3>{t('settings', 'appearance.motion.title')}</h3>
                <SettingToggle
                  label={t('settings', 'appearance.reduceMotion.label')}
                  hint={t('settings', 'appearance.reduceMotion.hint')}
                  checked={settings.reduceMotion}
                  onChange={(value) => void saveSettings({ reduceMotion: value })}
                />
              </section>

            </>
          )}

          {section === 'java' && (
            <>
              <section className="setting-group">
                <h3>{t('settings', 'java.management.title')}</h3>
                <SettingToggle
                  label={t('settings', 'java.autoManage.label')}
                  hint={t('settings', 'java.autoManage.hint')}
                  checked={settings.javaAutoManage}
                  onChange={(value) => void saveSettings({ javaAutoManage: value })}
                />

                <div className="row-between mt-20">
                  <h4 style={{ fontSize: 14 }}>{t('settings', 'java.installations.title')}</h4>
                  <button
                    className="btn sm"
                    disabled={detecting}
                    onClick={async () => {
                      setDetecting(true)
                      try {
                        setRuntimes(await window.gabi.java.detect())
                        toast('success', t('settings', 'java.installations.scanDoneToast'))
                      } catch (err) {
                        // Was missing entirely, unlike the install buttons
                        // below: a rejection ended as an unhandled promise and
                        // the spinner simply stopped with no explanation.
                        toastError(err, t('settings', 'java.installations.scanFailedToast'))
                      } finally {
                        setDetecting(false)
                      }
                    }}
                  >
                    {detecting ? <span className="spinner" /> : <IconRefresh size={14} />}
                    {t('settings', 'java.installations.rescan')}
                  </button>
                </div>

                <div className="col gap-8 mt-12">
                  {runtimes.length === 0 ? (
                    <div className="hint">{t('settings', 'java.installations.empty')}</div>
                  ) : (
                    runtimes.map((runtime) => (
                      <div key={runtime.path} className="content-row">
                        <div className="content-icon">☕</div>
                        <div className="grow" style={{ overflow: 'hidden' }}>
                          <div className="content-name">
                            {t('settings', 'java.installations.entryTitle', { major: runtime.major })}
                            {runtime.managed && (
                              <span className="badge accent" style={{ marginLeft: 8 }}>
                                {t('settings', 'java.installations.managedBadge')}
                              </span>
                            )}
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
                          toast(
                            'success',
                            t('settings', 'java.installations.installedToast', { major }),
                            runtime.version
                          )
                          setRuntimes(await window.gabi.java.list(true))
                        } catch (err) {
                          toastError(err, t('settings', 'java.installations.installFailedToast', { major }))
                        } finally {
                          setInstallingJava(null)
                        }
                      }}
                    >
                      {installingJava === major ? <span className="spinner" /> : <IconDownload size={14} />}
                      {t('settings', 'java.installations.downloadButton', { major })}
                    </button>
                  ))}
                </div>
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'java.defaults.title')}</h3>
                <div className="field">
                  <label className="label" htmlFor="st-standard-arbeitsspeicher">
                    {t('settings', 'java.defaults.memoryLabel', { value: formatMemory(defaultMemoryMb) })}
                  </label>
                  <input
                    id="st-standard-arbeitsspeicher"
                    className="range"
                    type="range"
                    min={1024}
                    max={16384}
                    step={512}
                    value={defaultMemoryMb}
                    onChange={(event) => setDefaultMemoryMb(Number(event.target.value))}
                  />
                  {info && (
                    <span className="hint">
                      {t('settings', 'java.defaults.memoryHint', { value: formatMemory(info.systemMemoryMb) })}
                    </span>
                  )}
                </div>

                <div className="field mt-16">
                  <label className="label" htmlFor="st-jvm-argumente">
                    {t('settings', 'java.defaults.jvmArgsLabel')}
                  </label>
                  <textarea id="st-jvm-argumente"
                    className="textarea"
                    value={defaultJvmArgs}
                    onChange={(event) => setDefaultJvmArgs(event.target.value)}
                  />
                </div>
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'java.downloads.title')}</h3>
                <div className="field">
                  <label className="label" htmlFor="st-gleichzeitige-downloads">
                    {t('settings', 'java.downloads.concurrentLabel', { value: concurrentDownloads })}
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
                    {t('settings', 'java.downloads.concurrentHint')}
                  </span>
                </div>
              </section>
            </>
          )}

          {section === 'content' && (
            <>
              <section className="setting-group">
                <h3>{t('settings', 'content.modManagement.title')}</h3>
                <SettingToggle
                  label={t('settings', 'content.autoInstallDeps.label')}
                  hint={t('settings', 'content.autoInstallDeps.hint')}
                  checked={settings.autoInstallDependencies}
                  onChange={(value) => void saveSettings({ autoInstallDependencies: value })}
                />
                <SettingToggle
                  label={t('settings', 'content.showSnapshots.label')}
                  checked={settings.showSnapshots}
                  onChange={(value) => void saveSettings({ showSnapshots: value })}
                />
              </section>

              <section className="setting-group">
                <h3>CurseForge</h3>
                <p className="hint">
                  {t('settings', 'content.curseforge.hint')}
                </p>
                <div className="row gap-8">
                  <input
                    className="input"
                    type="password"
                    placeholder={t('settings', 'content.curseforge.apiKeyPlaceholder')}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button className="btn primary" onClick={() => void saveSettings({ curseForgeApiKey: apiKey })}>
                    {t('common', 'save')}
                  </button>
                </div>
                <button
                  className="btn ghost sm mt-8"
                  onClick={() => void window.gabi.app.openExternal('https://console.curseforge.com/')}
                >
                  <IconExternal size={14} />
                  {t('settings', 'content.curseforge.createKey')}
                </button>
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'content.autoBackups.title')}</h3>
                <SettingToggle
                  label={t('settings', 'content.autoBackups.label')}
                  hint={t('settings', 'content.autoBackups.hint')}
                  checked={settings.automaticBackups}
                  onChange={(value) => void saveSettings({ automaticBackups: value })}
                />
                <div className="field mt-16">
                  <label className="label" htmlFor="st-aufbewahrte-sicherungen">
                    {t('settings', 'content.autoBackups.keepLabel', { value: automaticBackupKeep })}
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
              <h3>{t('settings', 'accounts.title')}</h3>
              <p className="hint">
                {t('settings', 'accounts.introBeforeDomain')} <span className="mono">login.live.com</span>
                {t('settings', 'accounts.introAfterDomain')}
              </p>
              <div className="row gap-8 mt-12">
                <input
                  className="input"
                  placeholder={t('settings', 'accounts.clientIdPlaceholder')}
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                />
                <button
                  className="btn primary"
                  onClick={() => void saveSettings({ microsoftClientId: clientId })}
                >
                  {t('common', 'save')}
                </button>
              </div>
              <div className="issue info mt-16">
                <div className="issue-icon">
                  <IconShield size={16} />
                </div>
                <div>
                  <div className="issue-title">{t('settings', 'accounts.tokenStorage.title')}</div>
                  <div className="issue-detail">
                    {t('settings', 'accounts.tokenStorage.detail')}
                  </div>
                </div>
              </div>
              {accounts.some((account) => account.secure === false) && (
                <div className="issue warning mt-8">
                  <div className="issue-icon">
                    <IconWarning size={16} />
                  </div>
                  <div>
                    <div className="issue-title">
                      {t('settings', 'accounts.tokenStorage.insecureTitle')}
                    </div>
                    <div className="issue-detail">
                      {t('settings', 'accounts.tokenStorage.insecureDetail')}
                    </div>
                  </div>
                </div>
              )}
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
                <h3>{t('settings', 'advanced.logs.title')}</h3>
                <p className="hint">
                  {t('settings', 'advanced.logs.hint')}
                </p>
                <button
                  className="btn"
                  onClick={() => info && void window.gabi.app.openPath(info.logDirectory)}
                >
                  <IconFolder size={15} />
                  {t('settings', 'advanced.logs.openButton')}
                </button>
              </section>

              <section className="setting-group">
                <h3>{t('settings', 'advanced.reset.title')}</h3>
                <p className="hint">
                  {t('settings', 'advanced.reset.hint')}
                </p>
                <button className="btn danger" onClick={() => setConfirmReset(true)}>
                  <IconTrash size={15} />
                  {t('settings', 'advanced.reset.button')}
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
                  <div className="preflight-label">{t('settings', 'about.version')}</div>
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
                  <div className="preflight-label">{t('settings', 'about.platform')}</div>
                  <div className="preflight-value">
                    {info.platform} {info.arch}
                  </div>
                </div>
                <div className="preflight-cell">
                  <div className="preflight-label">{t('settings', 'about.memory')}</div>
                  <div className="preflight-value">{formatMemory(info.systemMemoryMb)}</div>
                </div>
              </div>

              <p className="hint mt-20">
                {t('settings', 'about.disclaimer')}
              </p>
            </section>
          )}
        </div>
      </div>

      <Confirm
        open={confirmReset}
        title={t('settings', 'advanced.reset.confirmTitle')}
        danger
        confirmLabel={t('settings', 'advanced.reset.confirmLabel')}
        message={t('settings', 'advanced.reset.confirmMessage')}
        onConfirm={async () => {
          await window.gabi.settings.reset()
          await refreshSettings()
          setConfirmReset(false)
          toast('success', t('settings', 'advanced.reset.doneToast'))
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

// Ids and translation key stems only, resolved through t() at render time in
// RecordingPanel: this is a module-level constant evaluated once, so baking
// resolved strings in here would freeze them in whatever language was active
// on first load.
const QUALITIES: { id: RecordingQuality; labelKey: string; hintKey: string }[] = [
  { id: 'low', labelKey: 'recording.quality.low.label', hintKey: 'recording.quality.low.hint' },
  {
    id: 'medium',
    labelKey: 'recording.quality.medium.label',
    hintKey: 'recording.quality.medium.hint'
  },
  {
    id: 'high',
    labelKey: 'recording.quality.high.label',
    hintKey: 'recording.quality.high.hint'
  }
]

function RecordingPanel(): JSX.Element {
  const { settings, recording } = useStore()
  const [recordingMaxMinutes, setRecordingMaxMinutes] = useDebouncedSetting(
    settings.recordingMaxMinutes,
    (value) => void saveSettings({ recordingMaxMinutes: value })
  )

  return (
    <>
      <section className="setting-group">
        <h3>{t('settings', 'recording.inGame.title')}</h3>
        <p className="hint">
          {t('settings', 'recording.inGame.hint')}
        </p>

        <SettingToggle
          label={t('settings', 'recording.enabled.label')}
          hint={t('settings', 'recording.enabled.hint')}
          checked={settings.recordingEnabled}
          onChange={(value) => void saveSettings({ recordingEnabled: value })}
        />

        <div className="field mt-16">
          <label className="label" htmlFor="st-aufnahmetaste">
            {t('settings', 'recording.hotkey.label')}
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
            {t('settings', 'recording.hotkey.hint')}
          </span>
        </div>
      </section>

      <section className="setting-group">
        <h3>{t('settings', 'recording.quality.title')}</h3>
        <div className="field">
          <label className="label" htmlFor="st-aufnahmequalitaet">
            {t('settings', 'recording.quality.label')}
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
                {t('settings', entry.labelKey)}
              </option>
            ))}
          </select>
          <span className="hint">
            {(() => {
              const entry = QUALITIES.find((entry) => entry.id === settings.recordingQuality)
              return entry ? t('settings', entry.hintKey) : null
            })()}
          </span>
        </div>

        <SettingToggle
          label={t('settings', 'recording.audio.label')}
          hint={t('settings', 'recording.audio.hint')}
          checked={settings.recordingAudio}
          onChange={(value) => void saveSettings({ recordingAudio: value })}
        />

        <div className="field mt-16">
          <label className="label" htmlFor="st-aufnahmedauer">
            {t('settings', 'recording.maxDuration.label', { minutes: recordingMaxMinutes })}
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
            {t('settings', 'recording.maxDuration.hint')}
          </span>
        </div>
      </section>

      {recording.active && (
        <section className="setting-group">
          <h3>{t('settings', 'recording.active.title')}</h3>
          <p className="hint">
            {t('settings', 'recording.active.hint', { bytes: formatBytes(recording.bytes) })}
          </p>
          <button className="btn danger mt-8" onClick={() => void window.gabi.recording.toggle()}>
            <IconRecord size={13} />
            {t('settings', 'recording.active.stopButton')}
          </button>
        </section>
      )}

      <section className="setting-group">
        <h3>{t('settings', 'recording.tips.title')}</h3>
        <ul className="hint bullet-list">
          <li>
            {t('settings', 'recording.tips.windowOpen')}
          </li>
          <li>
            {t('settings', 'recording.tips.fullscreen')}
          </li>
          <li>{t('settings', 'recording.tips.space')}</li>
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
      <h3>{t('settings', 'changelog.title')}</h3>
      <p className="hint">
        {t('settings', 'changelog.hint')}
      </p>

      <div className="changelog">
        {changelogLocalized(settings.language).map((release) => (
          <article key={release.version} className="changelog-entry">
            <header className="changelog-head">
              <span className="changelog-version">{release.version}</span>
              {release.version === currentVersion && (
                <span className="badge ok dot">{t('settings', 'changelog.yourVersion')}</span>
              )}
              <span className="changelog-date">{formatDate(release.date)}</span>
            </header>

            <p className="changelog-headline">{release.headline}</p>

            <ul className="changelog-list">
              {release.changes.map((change, index) => (
                <li key={index}>
                  <span className={`changelog-kind ${change.kind}`}>
                    {changeKindLabel(settings.language, change.kind)}
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
        <h3>{t('settings', 'reports.title')}</h3>
        <p className="hint">
          {t('settings', 'reports.hint')}
        </p>

        <SettingToggle
          label={t('settings', 'reports.autoSend.label')}
          hint={
            configured
              ? t('settings', 'reports.autoSend.hintConfigured')
              : t('settings', 'reports.autoSend.hintNotConfigured')
          }
          checked={settings.crashReports === 'on'}
          onChange={(value) => void saveSettings({ crashReports: value ? 'on' : 'off' })}
        />
      </section>

      <section className="setting-group">
        <h3>{t('settings', 'reports.local.title')}</h3>
        <p className="hint">
          {t('settings', 'reports.local.hint')}
        </p>

        {reports === null ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : reports.length === 0 ? (
          <p className="hint">{t('settings', 'reports.local.empty')}</p>
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
                    <span>{t('settings', 'reports.local.versionLabel', { version: report.version })}</span>
                    <span className="truncate">{report.platform}</span>
                  </div>
                  {open === report.id && (
                    <pre className="report-detail">
                      {report.detail || t('settings', 'reports.local.noDetails')}
                    </pre>
                  )}
                </div>
                <div className="content-actions">
                  <button
                    className="btn sm ghost"
                    onClick={() => setOpen(open === report.id ? null : report.id)}
                  >
                    {open === report.id
                      ? t('settings', 'reports.local.collapse')
                      : t('settings', 'reports.local.view')}
                  </button>
                  <button
                    className="btn sm ghost"
                    title={t('settings', 'reports.local.copyTitle')}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(
                          `${report.area} | ${report.version} | ${report.platform}\n` +
                            `${report.message}\n\n${report.detail}`
                        )
                        .then(() => toast('success', t('settings', 'reports.local.copiedToast')))
                        .catch(() =>
                          toastError(new Error(t('settings', 'reports.local.clipboardUnavailable')))
                        )
                    }}
                  >
                    {t('common', 'copy')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="row gap-8 mt-16">
          <button className="btn ghost" onClick={() => void window.gabi.reports.openFolder()}>
            <IconFolder size={14} />
            {t('settings', 'reports.local.openFolder')}
          </button>
          <button
            className="btn ghost danger"
            disabled={!reports || reports.length === 0}
            onClick={() => {
              void window.gabi.reports
                .clear()
                .then(load)
                .then(() => toast('success', t('settings', 'reports.local.deletedToast')))
                .catch((err: unknown) => toastError(err, t('settings', 'reports.local.deleteFailedToast')))
            }}
          >
            <IconTrash size={14} />
            {t('settings', 'reports.local.deleteAll')}
          </button>
        </div>
      </section>
    </>
  )
}
