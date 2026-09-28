import { useEffect, useRef, useState, type JSX } from 'react'
import type { JavaRuntime, LaunchBehaviour } from '@shared/types'
import type { InstanceDetail } from '@shared/api'
import { ACCENT_CHOICES, ICON_CHOICES } from '@shared/defaults'
import { refreshInstances, toast, toastError } from '../lib/store'
import { useMemorySliderMax } from '../lib/hooks'
import { formatMemory } from '../lib/format'
import { SettingToggle } from '../components/ui'
import { IconImage, IconRefresh, IconTrash } from '../components/Icons'
import { tr } from '@shared/i18n'

interface Props {
  instance: InstanceDetail
  onChanged: () => Promise<void>
  /** Reports whether there are unsaved edits, so the parent can guard tab switches. */
  onDirtyChange?: (dirty: boolean) => void
}

export function InstanceSettingsPanel({ instance, onChanged, onDirtyChange }: Props): JSX.Element {
  const memoryMax = useMemorySliderMax()
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
  const [detectingJava, setDetectingJava] = useState(false)

  useEffect(() => {
    void window.gabi.java.list().then(setRuntimes).catch(() => undefined)
  }, [])

  // Snapshot of the fields as of the last save (or the initial load), used to
  // compute `dirty` instead of just flipping it to true on any change. A ref,
  // not state, so a save() can update it without an extra render. Order must
  // match the values built below and in save().
  const baseline = useRef(
    JSON.stringify([
      instance.name,
      instance.description,
      instance.group,
      instance.appearance.icon,
      instance.appearance.accent,
      instance.settings.memoryMb,
      instance.settings.jvmArgs,
      instance.settings.envVars,
      instance.settings.preLaunchCommand,
      instance.settings.wrapperCommand,
      instance.settings.javaPath,
      instance.settings.fullscreen,
      instance.settings.windowWidth,
      instance.settings.windowHeight,
      instance.settings.launchBehaviour,
      instance.settings.backupBeforeUpdates
    ])
  )

  const fieldsSnapshot = (): string =>
    JSON.stringify([
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

  // Dirty is a comparison against the baseline, not a flag any edit flips on.
  // That is what lets save() below update the baseline together with a
  // corrected value (trimmed name, clamped size) without the bar flashing on
  // for a frame: once both move together, the comparison stays negative. The
  // first run is the mount effect, which must not count as an edit.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const next = fieldsSnapshot() !== baseline.current
    setDirty(next)
    onDirtyChange?.(next)
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
    onDirtyChange?.(false)
    // Only the instance switching, not onDirtyChange identity, should reset this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id])

  // Leaving the tab unmounts this panel; the parent's copy of `dirty` must not
  // survive that, or a later remount would start out blocked on a stale flag.
  useEffect(() => {
    return () => onDirtyChange?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      const savedGroup = group.trim()

      await window.gabi.instances.update(instance.id, {
        name: savedName,
        description,
        group: savedGroup,
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

      // Move the baseline to what was actually stored before touching the
      // fields it was corrected from. refreshInstances()/onChanged() below are
      // awaited, which gives the dirty effect a chance to run on the
      // corrected values before setDirty(false) further down is reached; with
      // the baseline already matching them, that effect finds no difference
      // instead of flashing the bar on for a frame.
      baseline.current = JSON.stringify([
        savedName,
        description,
        savedGroup,
        icon,
        accent,
        memory,
        jvmArgs,
        envVars,
        preLaunch,
        wrapper,
        javaPath,
        fullscreen,
        safeWidth,
        safeHeight,
        behaviour,
        backupBeforeUpdates
      ])

      // Reflect whatever was actually stored, so the form never shows a value
      // the backend rejected.
      setName(savedName)
      setGroup(savedGroup)
      setWidth(safeWidth)
      setHeight(safeHeight)

      await refreshInstances()
      await onChanged()
      setDirty(false)
      onDirtyChange?.(false)
      toast('success', tr('Gespeichert', 'Saved'), tr(`${savedName} wurde aktualisiert.`, `${savedName} was updated.`))
    } catch (err) {
      toastError(err, tr('Speichern fehlgeschlagen', 'Saving failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="col gap-32">
      {/* --- Appearance --------------------------------------------- */}
      <section className="setting-group">
        <h3>{tr('Darstellung', 'Appearance')}</h3>
        <p className="hint">{tr('Name, Icon und Farbe dieser Instanz.', 'Name, icon and color of this instance.')}</p>

        <div className="col gap-16">
          <div className="row gap-16 wrap">
            <div className="field grow">
              <label className="label" htmlFor="is-name">Name</label>
              <input id="is-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field grow">
              <label className="label" htmlFor="is-gruppe">{tr('Gruppe', 'Group')}</label>
              <input id="is-gruppe"
                className="input"
                placeholder={tr('z. B. Modded', 'e.g. Modded')}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="is-beschreibung">{tr('Beschreibung', 'Description')}</label>
            <input id="is-beschreibung"
              className="input"
              placeholder={tr('Worum geht es in dieser Instanz?', 'What is this instance about?')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label" id="is-icon">Icon</label>
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
                    // The IPC call already wrote the new icon to disk and returns
                    // only a resolved preview path, not the `img:` reference this
                    // form tracks locally. Without re-reading it, the local
                    // `icon` state stays on its old value and save() /
                    // "Hintergrund entfernen" below would overwrite the fresh
                    // icon with that stale one.
                    const fresh = await window.gabi.instances.get(instance.id)
                    // Icon is index 3 in both fieldsSnapshot() and baseline
                    // above. Folding it into the baseline too means the dirty
                    // effect below finds no difference from this pick alone,
                    // since it was already saved to disk.
                    const fields = JSON.parse(baseline.current)
                    fields[3] = fresh.appearance.icon
                    baseline.current = JSON.stringify(fields)
                    setIcon(fresh.appearance.icon)
                    await onChanged()
                    toast('success', tr('Icon gesetzt', 'Icon set'))
                  }
                }}
              >
                <IconImage size={14} /> {tr('Eigenes Bild', 'Custom image')}
              </button>
              <button
                className="btn sm"
                onClick={async () => {
                  const result = await window.gabi.instances.setBackground(instance.id)
                  if (result) {
                    await onChanged()
                    toast('success', tr('Hintergrund gesetzt', 'Background set'))
                  }
                }}
              >
                <IconImage size={14} /> {tr('Hintergrundbild', 'Background image')}
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
                  <IconTrash size={14} /> {tr('Hintergrund entfernen', 'Remove background')}
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label className="label" id="is-akzentfarbe">{tr('Akzentfarbe', 'Accent color')}</label>
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
        <h3>{tr('Leistung', 'Performance')}</h3>
        <p className="hint">{tr('Arbeitsspeicher und Java-Einstellungen für diese Instanz.', 'Memory and Java settings for this instance.')}</p>

        <div className="col gap-16">
          <div className="field">
            <label className="label" htmlFor="is-arbeitsspeicher">
              {tr('Arbeitsspeicher', 'Memory')}: {formatMemory(Math.min(memory, memoryMax))}
            </label>
            <input id="is-arbeitsspeicher"
              className="range"
              type="range"
              min={1024}
              max={memoryMax}
              step={512}
              value={Math.min(memory, memoryMax)}
              onChange={(e) => setMemory(Number(e.target.value))}
            />
            <span className="hint">
              {tr(
                'Mehr ist nicht automatisch besser. Über 8 GB bringt bei den meisten Modpacks nichts mehr und kann die Garbage Collection sogar verlangsamen.',
                'More is not automatically better. Above 8 GB most modpacks gain nothing, and it can even slow down garbage collection.'
              )}
            </span>
          </div>

          <div className="field">
            <label className="label" id="is-java-version">{tr('Java-Version', 'Java version')}</label>
            <div role="group" aria-labelledby="is-java-version" className="row gap-8">
              <select className="select" value={javaPath} onChange={(e) => setJavaPath(e.target.value)}>
                <option value="">{tr('Automatisch verwalten (empfohlen)', 'Manage automatically (recommended)')}</option>
                {/* Covers a path from a runtime that was since removed or never
                    detected; without this the select would silently jump to
                    "Automatisch verwalten" while the instance kept using it. */}
                {javaPath && !runtimes.some((runtime) => runtime.path === javaPath) && (
                  <option value={javaPath}>{javaPath} {tr('(nicht gefunden)', '(not found)')}</option>
                )}
                {runtimes.map((runtime) => (
                  <option key={runtime.path} value={runtime.path}>
                    Java {runtime.major} · {runtime.version} {runtime.managed ? tr('(verwaltet)', '(managed)') : ''}
                  </option>
                ))}
              </select>
              <button
                className="btn icon"
                disabled={detectingJava}
                onClick={async () => {
                  setDetectingJava(true)
                  try {
                    setRuntimes(await window.gabi.java.detect())
                    toast('info', tr('Java-Suche abgeschlossen', 'Java search finished'))
                  } catch (err) {
                    toastError(err, tr('Java-Suche fehlgeschlagen', 'Java search failed'))
                  } finally {
                    setDetectingJava(false)
                  }
                }}
                aria-label={tr('Neu suchen', 'Search again')}
              >
                {detectingJava ? <span className="spinner" /> : <IconRefresh size={15} />}
              </button>
            </div>
            <span className="hint">
              {tr(
                `Automatisch bedeutet: Launch Gabi wählt die von Mojang für ${instance.mcVersion} vorgegebene Java-Version und lädt sie bei Bedarf selbst herunter.`,
                `Automatic means: Launch Gabi picks the Java version Mojang specifies for ${instance.mcVersion} and downloads it by itself when needed.`
              )}
            </span>
          </div>

          <div className="field">
            <label className="label" htmlFor="is-jvm-argumente">{tr('JVM-Argumente', 'JVM arguments')}</label>
            <textarea id="is-jvm-argumente" className="textarea" value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} />
            <span className="hint">
              {tr(
                'Die Voreinstellung enthält bewährte G1GC-Flags für modded Minecraft. Nur ändern, wenn du weißt, was du tust.',
                'The default contains proven G1GC flags for modded Minecraft. Only change it if you know what you are doing.'
              )}
            </span>
          </div>
        </div>
      </section>

      {/* --- Window ---------------------------------------------------- */}
      <section className="setting-group">
        <h3>{tr('Fenster & Start', 'Window & launch')}</h3>

        <SettingToggle
          label={tr('Vollbild starten', 'Start in fullscreen')}
          hint={tr('Minecraft startet direkt im Vollbildmodus.', 'Minecraft starts directly in fullscreen mode.')}
          checked={fullscreen}
          onChange={setFullscreen}
        />

        {!fullscreen && (
          <div className="row gap-16 mt-12">
            <div className="field grow">
              <label className="label" htmlFor="is-fensterbreite">{tr('Fensterbreite', 'Window width')}</label>
              <input id="is-fensterbreite"
                className="input"
                type="number"
                value={width}
                min={640}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </div>
            <div className="field grow">
              <label className="label" htmlFor="is-fensterhohe">{tr('Fensterhöhe', 'Window height')}</label>
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
          <label className="label" htmlFor="is-launcher-verhalten-beim-star">{tr('Launcher-Verhalten beim Start', 'Launcher behavior on launch')}</label>
          <select id="is-launcher-verhalten-beim-star"
            className="select"
            value={behaviour}
            onChange={(e) => setBehaviour(e.target.value as LaunchBehaviour)}
          >
            <option value="keep">{tr('Launcher offen lassen', 'Keep the launcher open')}</option>
            <option value="hide">{tr('Launcher ausblenden', 'Hide the launcher')}</option>
            <option value="close">{tr('Launcher minimieren', 'Minimize the launcher')}</option>
          </select>
        </div>

        <div className="mt-16">
          <SettingToggle
            label={tr('Vor Mod-Updates sichern', 'Back up before mod updates')}
            hint={tr('Legt automatisch eine Sicherung der Welten an, bevor Mods aktualisiert werden.', 'Automatically backs up your worlds before mods are updated.')}
            checked={backupBeforeUpdates}
            onChange={setBackupBeforeUpdates}
          />
        </div>
      </section>

      {/* --- Advanced -------------------------------------------------- */}
      <section className="setting-group">
        <h3>{tr('Erweitert', 'Advanced')}</h3>
        <p className="hint">{tr('Nur nötig für Spezialfälle wie Aufnahme-Tools oder eigene Startskripte.', 'Only needed for special cases such as recording tools or custom start scripts.')}</p>

        <div className="col gap-16">
          <div className="field">
            <label className="label" htmlFor="is-umgebungsvariablen">{tr('Umgebungsvariablen', 'Environment variables')}</label>
            <textarea id="is-umgebungsvariablen"
              className="textarea"
              placeholder="KEY=VALUE&#10;MESA_GL_VERSION_OVERRIDE=4.5"
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              style={{ minHeight: 68 }}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="is-befehl-vor-dem-start">{tr('Befehl vor dem Start', 'Command before launch')}</label>
            <input id="is-befehl-vor-dem-start"
              className="input"
              placeholder={tr('z. B. ein Skript, das etwas vorbereitet', 'e.g. a script that prepares something')}
              value={preLaunch}
              onChange={(e) => setPreLaunch(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="is-wrapper-befehl">{tr('Wrapper-Befehl', 'Wrapper command')}</label>
            <input id="is-wrapper-befehl"
              className="input"
              placeholder={tr('z. B. gamemoderun', 'e.g. gamemoderun')}
              value={wrapper}
              onChange={(e) => setWrapper(e.target.value)}
            />
            <span className="hint">
              {tr(
                'Wird dem Java-Aufruf vorangestellt. Der Befehl muss Java selbst übernehmen, also per exec ersetzen, und darf es nicht im Hintergrund starten. Sonst hält der Launcher das Spiel für beendet, sobald der Wrapper fertig ist, und Mod-Änderungen sind dann nicht mehr gesperrt.',
                'Is put in front of the Java call. The command has to take over Java itself, replacing itself via exec, and must not start it in the background. Otherwise the launcher considers the game closed as soon as the wrapper finishes, and mod changes are no longer locked.'
              )}
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
            {tr('Es gibt ungespeicherte Änderungen.', 'You have unsaved changes.')}
          </span>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving && <span className="spinner" />}
            {tr('Speichern', 'Save')}
          </button>
        </div>
      )}
    </div>
  )
}
