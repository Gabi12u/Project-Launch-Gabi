import { useEffect, useRef, useState, type JSX } from 'react'
import type { JavaRuntime, LaunchBehaviour } from '@shared/types'
import type { InstanceDetail } from '@shared/api'
import { ACCENT_CHOICES, ICON_CHOICES } from '@shared/defaults'
import { refreshInstances, toast, toastError } from '../lib/store'
import { formatMemory } from '../lib/format'
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
      await window.gabi.instances.update(instance.id, {
        name: name.trim() || instance.name,
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
          windowWidth: width,
          windowHeight: height,
          launchBehaviour: behaviour,
          backupBeforeUpdates
        }
      })
      await refreshInstances()
      await onChanged()
      setDirty(false)
      toast('success', 'Gespeichert', `${name} wurde aktualisiert.`)
    } catch (err) {
      toastError(err, 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="col gap-32">
      {/* --- Appearance --------------------------------------------- */}
      <section className="setting-group">
        <h3>Darstellung</h3>
        <p className="hint">Name, Icon und Farbe dieser Instanz.</p>

        <div className="col gap-16">
          <div className="row gap-16 wrap">
            <div className="field grow">
              <label className="label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field grow">
              <label className="label">Gruppe</label>
              <input
                className="input"
                placeholder="z. B. Modded"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="label">Beschreibung</label>
            <input
              className="input"
              placeholder="Worum geht es in dieser Instanz?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label">Icon</label>
            <div className="icon-picker">
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
                    toast('success', 'Icon gesetzt')
                  }
                }}
              >
                <IconImage size={14} /> Eigenes Bild
              </button>
              <button
                className="btn sm"
                onClick={async () => {
                  const result = await window.gabi.instances.setBackground(instance.id)
                  if (result) {
                    await onChanged()
                    toast('success', 'Hintergrund gesetzt')
                  }
                }}
              >
                <IconImage size={14} /> Hintergrundbild
              </button>
              {instance.appearance.background && (
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    await window.gabi.instances.update(instance.id, {
                      appearance: { ...instance.appearance, background: null }
                    })
                    await onChanged()
                  }}
                >
                  <IconTrash size={14} /> Hintergrund entfernen
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label className="label">Akzentfarbe</label>
            <div className="swatches">
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
        <h3>Leistung</h3>
        <p className="hint">Arbeitsspeicher und Java-Einstellungen für diese Instanz.</p>

        <div className="col gap-16">
          <div className="field">
            <label className="label">Arbeitsspeicher: {formatMemory(memory)}</label>
            <input
              className="range"
              type="range"
              min={1024}
              max={32768}
              step={512}
              value={memory}
              onChange={(e) => setMemory(Number(e.target.value))}
            />
            <span className="hint">
              Mehr ist nicht automatisch besser — über 8 GB bringt bei den meisten Modpacks nichts mehr und
              kann die Garbage Collection sogar verlangsamen.
            </span>
          </div>

          <div className="field">
            <label className="label">Java-Version</label>
            <div className="row gap-8">
              <select className="select" value={javaPath} onChange={(e) => setJavaPath(e.target.value)}>
                <option value="">Automatisch verwalten (empfohlen)</option>
                {runtimes.map((runtime) => (
                  <option key={runtime.path} value={runtime.path}>
                    Java {runtime.major} · {runtime.version} {runtime.managed ? '(verwaltet)' : ''}
                  </option>
                ))}
              </select>
              <button
                className="btn icon"
                onClick={async () => {
                  setRuntimes(await window.gabi.java.detect())
                  toast('info', 'Java-Suche abgeschlossen')
                }}
                aria-label="Neu suchen"
              >
                <IconRefresh size={15} />
              </button>
            </div>
            <span className="hint">
              Automatisch bedeutet: Launch Gabi wählt die von Mojang für {instance.mcVersion} vorgegebene
              Java-Version und lädt sie bei Bedarf selbst herunter.
            </span>
          </div>

          <div className="field">
            <label className="label">JVM-Argumente</label>
            <textarea className="textarea" value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} />
            <span className="hint">
              Die Voreinstellung enthält bewährte G1GC-Flags für modded Minecraft. Nur ändern, wenn du weißt,
              was du tust.
            </span>
          </div>
        </div>
      </section>

      {/* --- Window ---------------------------------------------------- */}
      <section className="setting-group">
        <h3>Fenster & Start</h3>

        <SettingToggle
          label="Vollbild starten"
          hint="Minecraft startet direkt im Vollbildmodus."
          checked={fullscreen}
          onChange={setFullscreen}
        />

        {!fullscreen && (
          <div className="row gap-16 mt-12">
            <div className="field grow">
              <label className="label">Fensterbreite</label>
              <input
                className="input"
                type="number"
                value={width}
                min={640}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </div>
            <div className="field grow">
              <label className="label">Fensterhöhe</label>
              <input
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
          <label className="label">Launcher-Verhalten beim Start</label>
          <select
            className="select"
            value={behaviour}
            onChange={(e) => setBehaviour(e.target.value as LaunchBehaviour)}
          >
            <option value="keep">Launcher offen lassen</option>
            <option value="hide">Launcher ausblenden</option>
            <option value="close">Launcher minimieren</option>
          </select>
        </div>

        <div className="mt-16">
          <SettingToggle
            label="Vor Mod-Updates sichern"
            hint="Legt automatisch eine Sicherung der Welten an, bevor Mods aktualisiert werden."
            checked={backupBeforeUpdates}
            onChange={setBackupBeforeUpdates}
          />
        </div>
      </section>

      {/* --- Advanced -------------------------------------------------- */}
      <section className="setting-group">
        <h3>Erweitert</h3>
        <p className="hint">Nur nötig für Spezialfälle wie Aufnahme-Tools oder eigene Startskripte.</p>

        <div className="col gap-16">
          <div className="field">
            <label className="label">Umgebungsvariablen</label>
            <textarea
              className="textarea"
              placeholder="KEY=VALUE&#10;MESA_GL_VERSION_OVERRIDE=4.5"
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              style={{ minHeight: 68 }}
            />
          </div>

          <div className="field">
            <label className="label">Befehl vor dem Start</label>
            <input
              className="input"
              placeholder="z. B. ein Skript, das etwas vorbereitet"
              value={preLaunch}
              onChange={(e) => setPreLaunch(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label">Wrapper-Befehl</label>
            <input
              className="input"
              placeholder="z. B. gamemoderun"
              value={wrapper}
              onChange={(e) => setWrapper(e.target.value)}
            />
            <span className="hint">Wird dem Java-Aufruf vorangestellt.</span>
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
            Es gibt ungespeicherte Änderungen.
          </span>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving && <span className="spinner" />}
            Speichern
          </button>
        </div>
      )}
    </div>
  )
}
