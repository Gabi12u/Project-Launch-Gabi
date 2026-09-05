import { useEffect, useRef, useState, type JSX } from 'react'
import type { JavaRuntime, LaunchBehaviour } from '@shared/types'
import type { InstanceDetail } from '@shared/api'
import { ACCENT_CHOICES, ICON_CHOICES } from '@shared/defaults'
import { refreshInstances, toast, toastError } from '../lib/store'
import { formatMemory } from '../lib/format'
import { t } from '../lib/i18n'
import { SettingToggle } from '../components/ui'
import { IconImage, IconRefresh, IconTrash } from '../components/Icons'

interface Props {
  instance: InstanceDetail
  onChanged: () => Promise<void>
}

export function InstanceSettingsPanel({ instance, onChanged }: Props): JSX.Element {
  const [name, setName] = useState(instance.name)
  const [description, setDescription] = useState(instance.description)
  const [group, setGroup] = useState(instance.group)
  const [icon, setIcon] = useState(instance.appearance.icon)
  const [accent, setAccent] = useState(instance.appearance.accent)

  const [memory, setMemory] = useState(instance.settings.memoryMb)
  const [jvmArgs, setJvmArgs] = useState(instance.settings.jvmArgs)
  const [envVars, setEnvVars] = useState(instance.settings.envVars)
  const [preLaunch, setPreLaunch] = useState(instance.settings.preLaunchCommand)
  const [wrapper, setWrapper] = useState(instance.settings.wrapperCommand)
  const [javaPath, setJavaPath] = useState(instance.settings.javaPath)
  const [fullscreen, setFullscreen] = useState(instance.settings.fullscreen)
  const [width, setWidth] = useState(instance.settings.windowWidth)
  const [height, setHeight] = useState(instance.settings.windowHeight)
  const [behaviour, setBehaviour] = useState<LaunchBehaviour>(instance.settings.launchBehaviour)
  const [backupBeforeUpdates, setBackupBeforeUpdates] = useState(instance.settings.backupBeforeUpdates)

  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    void window.gabi.java.list().then(setRuntimes).catch(() => undefined)
  }, [])

  // Any edit marks the form dirty so the save bar appears. The first run is
  // the mount effect, which must not count as an edit.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    setDirty(true)
  }, [
    name,
    description,
    group,
    icon,
    accent,
    memory,
    jvmArgs,
    envVars,
    preLaunch,
    wrapper,
    javaPath,
    fullscreen,
    width,
    height,
    behaviour,
    backupBeforeUpdates
  ])

  useEffect(() => {
    setDirty(false)
  }, [instance.id])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      // Clearing a number field yields Number('') === 0, and the launch command
      // builder passes these straight through to the game with no fallback of
      // its own. The `min` attribute on the inputs is only a validity hint, it
      // does not clamp anything.
      const safeWidth = Number.isFinite(width) && width >= 640 ? Math.round(width) : 854
      const safeHeight = Number.isFinite(height) && height >= 480 ? Math.round(height) : 480
      // The stored name is the one the toast should report, not the raw field.
      const savedName = name.trim() || instance.name

      await window.gabi.instances.update(instance.id, {
        name: savedName,
        description,
        group: group.trim(),
        appearance: { ...instance.appearance, icon, accent },
        settings: {
          ...instance.settings,
          memoryMb: memory,
          jvmArgs,
          envVars,
          preLaunchCommand: preLaunch,
          wrapperCommand: wrapper,
          javaPath,
          fullscreen,
          windowWidth: safeWidth,
          windowHeight: safeHeight,
          launchBehaviour: behaviour,
          backupBeforeUpdates
        }
      })

      // Reflect whatever was actually stored, so the form never shows a value
      // the backend rejected.
      setName(savedName)
      setWidth(safeWidth)
      setHeight(safeHeight)

      await refreshInstances()
      await onChanged()
      setDirty(false)
      toast(
        'success',
        t('instanceSettings', 'settings.savedToastTitle'),
        t('instanceSettings', 'settings.savedToastMessage', { name: savedName })
      )
    } catch (err) {
      toastError(err, t('instanceSettings', 'settings.saveFailedToast'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="col gap-32">
      {/* --- Appearance --------------------------------------------- */}
      <section className="setting-group">
        <h3>{t('instanceSettings', 'settings.appearanceTitle')}</h3>
        <p className="hint">{t('instanceSettings', 'settings.appearanceHint')}</p>

        <div className="col gap-16">
          <div className="row gap-16 wrap">
            <div className="field grow">
              <label className="label" htmlFor="is-name">{t('instanceSettings', 'settings.nameLabel')}</label>
              <input id="is-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field grow">
              <label className="label" htmlFor="is-gruppe">{t('instanceSettings', 'settings.groupLabel')}</label>
              <input id="is-gruppe"
                className="input"
                placeholder={t('instanceSettings', 'settings.groupPlaceholder')}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="is-beschreibung">{t('instanceSettings', 'settings.descriptionLabel')}</label>
            <input id="is-beschreibung"
              className="input"
              placeholder={t('instanceSettings', 'settings.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label" id="is-icon">{t('instanceSettings', 'settings.iconLabel')}</label>
            <div role="group" aria-labelledby="is-icon" className="icon-picker">
              {ICON_CHOICES.map((choice) => (
                <button
                  key={choice}
                  className={`icon-choice ${icon === choice ? 'selected' : ''}`}
                  onClick={() => setIcon(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
            <div className="row gap-8 mt-8">
              <button
                className="btn sm"
                onClick={async () => {
                  const result = await window.gabi.instances.setIconImage(instance.id)
                  if (result) {
                    await onChanged()
                    toast('success', t('instanceSettings', 'settings.iconSetToast'))
                  }
                }}
              >
                <IconImage size={14} /> {t('instanceSettings', 'settings.customImageButton')}
              </button>
              <button
                className="btn sm"
                onClick={async () => {
                  const result = await window.gabi.instances.setBackground(instance.id)
                  if (result) {
                    await onChanged()
                    toast('success', t('instanceSettings', 'settings.backgroundSetToast'))
                  }
                }}
              >
                <IconImage size={14} /> {t('instanceSettings', 'settings.backgroundImageButton')}
              </button>
              {instance.appearance.background && (
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    // Spreading `instance.appearance` alone would write back the
                    // icon and accent as they were when the page loaded, quietly
                    // undoing an unsaved pick in the picker above while that pick
                    // still shows as selected on screen.
                    await window.gabi.instances.update(instance.id, {
                      appearance: { ...instance.appearance, icon, accent, background: null }
                    })
                    await onChanged()
                  }}
                >
                  <IconTrash size={14} /> {t('instanceSettings', 'settings.removeBackgroundButton')}
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label className="label" id="is-akzentfarbe">{t('instanceSettings', 'settings.accentColorLabel')}</label>
            <div role="group" aria-labelledby="is-akzentfarbe" className="swatches">
              {ACCENT_CHOICES.map((choice) => (
                <button
                  key={choice}
                  className={`swatch ${accent === choice ? 'selected' : ''}`}
                  style={{ background: choice, color: choice }}
                  onClick={() => setAccent(choice)}
                  aria-label={choice}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* --- Performance --------------------------------------------- */}
      <section className="setting-group">
        <h3>{t('instanceSettings', 'settings.performanceTitle')}</h3>
        <p className="hint">{t('instanceSettings', 'settings.performanceHint')}</p>

        <div className="col gap-16">
          <div className="field">
            <label className="label" htmlFor="is-arbeitsspeicher">
              {t('instanceSettings', 'settings.memoryLabel', { value: formatMemory(memory) })}
            </label>
            <input id="is-arbeitsspeicher"
              className="range"
              type="range"
              min={1024}
              max={32768}
              step={512}
              value={memory}
              onChange={(e) => setMemory(Number(e.target.value))}
            />
            <span className="hint">
              {t('instanceSettings', 'settings.memoryHint')}
            </span>
          </div>

          <div className="field">
            <label className="label" id="is-java-version">{t('instanceSettings', 'settings.javaVersionLabel')}</label>
            <div role="group" aria-labelledby="is-java-version" className="row gap-8">
              <select className="select" value={javaPath} onChange={(e) => setJavaPath(e.target.value)}>
                <option value="">{t('instanceSettings', 'settings.javaAutoOption')}</option>
                {runtimes.map((runtime) => (
                  <option key={runtime.path} value={runtime.path}>
                    {t('instanceSettings', 'settings.javaOptionLabel', {
                      major: runtime.major,
                      version: runtime.version
                    })}{' '}
                    {runtime.managed ? t('instanceSettings', 'settings.javaManagedSuffix') : ''}
                  </option>
                ))}
              </select>
              <button
                className="btn icon"
                onClick={async () => {
                  setRuntimes(await window.gabi.java.detect())
                  toast('info', t('instanceSettings', 'settings.javaSearchDoneToast'))
                }}
                aria-label={t('instanceSettings', 'settings.javaRedetectAria')}
              >
                <IconRefresh size={15} />
              </button>
            </div>
            <span className="hint">
              {t('instanceSettings', 'settings.javaAutoHint', { version: instance.mcVersion })}
            </span>
          </div>

          <div className="field">
            <label className="label" htmlFor="is-jvm-argumente">{t('instanceSettings', 'settings.jvmArgsLabel')}</label>
            <textarea id="is-jvm-argumente" className="textarea" value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} />
            <span className="hint">
              {t('instanceSettings', 'settings.jvmArgsHint')}
            </span>
          </div>
        </div>
      </section>

      {/* --- Window ---------------------------------------------------- */}
      <section className="setting-group">
        <h3>{t('instanceSettings', 'settings.windowTitle')}</h3>

        <SettingToggle
          label={t('instanceSettings', 'settings.fullscreenLabel')}
          hint={t('instanceSettings', 'settings.fullscreenHint')}
          checked={fullscreen}
          onChange={setFullscreen}
        />

        {!fullscreen && (
          <div className="row gap-16 mt-12">
            <div className="field grow">
              <label className="label" htmlFor="is-fensterbreite">{t('instanceSettings', 'settings.windowWidthLabel')}</label>
              <input id="is-fensterbreite"
                className="input"
                type="number"
                value={width}
                min={640}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </div>
            <div className="field grow">
              <label className="label" htmlFor="is-fensterhohe">{t('instanceSettings', 'settings.windowHeightLabel')}</label>
              <input id="is-fensterhohe"
                className="input"
                type="number"
                value={height}
                min={480}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        <div className="field mt-16">
          <label className="label" htmlFor="is-launcher-verhalten-beim-star">{t('instanceSettings', 'settings.launchBehaviourLabel')}</label>
          <select id="is-launcher-verhalten-beim-star"
            className="select"
            value={behaviour}
            onChange={(e) => setBehaviour(e.target.value as LaunchBehaviour)}
          >
            <option value="keep">{t('instanceSettings', 'settings.keepOpenOption')}</option>
            <option value="hide">{t('instanceSettings', 'settings.hideOption')}</option>
            <option value="close">{t('instanceSettings', 'settings.minimizeOption')}</option>
          </select>
        </div>

        <div className="mt-16">
          <SettingToggle
            label={t('instanceSettings', 'settings.backupBeforeUpdatesLabel')}
            hint={t('instanceSettings', 'settings.backupBeforeUpdatesHint')}
            checked={backupBeforeUpdates}
            onChange={setBackupBeforeUpdates}
          />
        </div>
      </section>

      {/* --- Advanced -------------------------------------------------- */}
      <section className="setting-group">
        <h3>{t('instanceSettings', 'settings.advancedTitle')}</h3>
        <p className="hint">{t('instanceSettings', 'settings.advancedHint')}</p>

        <div className="col gap-16">
          <div className="field">
            <label className="label" htmlFor="is-umgebungsvariablen">{t('instanceSettings', 'settings.envVarsLabel')}</label>
            <textarea id="is-umgebungsvariablen"
              className="textarea"
              placeholder={t('instanceSettings', 'settings.envVarsPlaceholder')}
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              style={{ minHeight: 68 }}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="is-befehl-vor-dem-start">{t('instanceSettings', 'settings.preLaunchLabel')}</label>
            <input id="is-befehl-vor-dem-start"
              className="input"
              placeholder={t('instanceSettings', 'settings.preLaunchPlaceholder')}
              value={preLaunch}
              onChange={(e) => setPreLaunch(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="is-wrapper-befehl">{t('instanceSettings', 'settings.wrapperLabel')}</label>
            <input id="is-wrapper-befehl"
              className="input"
              placeholder={t('instanceSettings', 'settings.wrapperPlaceholder')}
              value={wrapper}
              onChange={(e) => setWrapper(e.target.value)}
            />
            <span className="hint">
              {t('instanceSettings', 'settings.wrapperHint')}
            </span>
          </div>
        </div>
      </section>

      {dirty && (
        <div
          style={{
            position: 'sticky',
            bottom: 12,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: 12,
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-solid-2)',
            border: '1px solid var(--line-strong)',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          <span className="hint grow" style={{ alignSelf: 'center' }}>
            {t('instanceSettings', 'settings.unsavedChanges')}
          </span>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving && <span className="spinner" />}
            {t('common', 'save')}
          </button>
        </div>
      )}
    </div>
  )
}
