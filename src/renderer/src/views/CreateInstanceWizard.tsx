import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { LoaderId, LoaderVersion, MinecraftVersion } from '@shared/types'
import { ACCENT_CHOICES, ICON_CHOICES, LOADERS } from '@shared/defaults'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { formatDate, formatMemory, pluralise } from '../lib/format'
import { Modal } from '../components/ui'
import { IconCheck, IconSearch, IconSparkle } from '../components/Icons'

type Step = 0 | 1 | 2

interface Props {
  open: boolean
  onClose: () => void
}

export function CreateInstanceWizard({ open, onClose }: Props): JSX.Element {
  const { settings } = useStore()

  const [step, setStep] = useState<Step>(0)
  const [busy, setBusy] = useState(false)

  const [versions, setVersions] = useState<MinecraftVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [versionSearch, setVersionSearch] = useState('')
  const [showSnapshots, setShowSnapshots] = useState(false)

  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<LoaderId>('vanilla')
  const [loaderVersions, setLoaderVersions] = useState<Record<string, LoaderVersion[]>>({})
  const [loaderVersion, setLoaderVersion] = useState('')
  const [checkingLoaders, setCheckingLoaders] = useState(false)
  const loaderRequestId = useRef(0)

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🟩')
  const [accent, setAccent] = useState(settings.accentColor)
  const [memory, setMemory] = useState(settings.defaultMemoryMb)
  const [group, setGroup] = useState('')

  /* --- Reset whenever the wizard is opened ------------------------ */
  useEffect(() => {
    if (!open) return
    setStep(0)
    setVersionSearch('')
    setLoader('vanilla')
    setLoaderVersion('')
    setName('')
    setIcon(ICON_CHOICES[Math.floor(Math.random() * 10)])
    setAccent(settings.accentColor)
    setMemory(settings.defaultMemoryMb)
    setGroup('')
  }, [open, settings.accentColor, settings.defaultMemoryMb])

  /* --- Minecraft versions ----------------------------------------- */
  useEffect(() => {
    if (!open) return
    // Guarded like the loader-versions effect below. Toggling "Snapshots"
    // twice in quick succession let the slower first answer land after the
    // second, leaving the list showing the opposite of what the button said.
    let current = true
    setLoadingVersions(true)
    void window.gabi.versions
      .minecraft(showSnapshots)
      .then((list) => {
        if (!current) return
        setVersions(list)
        setMcVersion((chosen) => chosen || list.find((v) => v.type === 'release')?.id || list[0]?.id || '')
      })
      .catch((err) => {
        if (current) toastError(err, 'Versionsliste konnte nicht geladen werden')
      })
      .finally(() => {
        if (current) setLoadingVersions(false)
      })
    return () => {
      current = false
    }
  }, [open, showSnapshots])

  /* --- Which loaders exist for the chosen version? ----------------- */
  useEffect(() => {
    if (!open || !mcVersion || step !== 1) return

    // Stepping back and picking another Minecraft version restarts this, and a
    // slower earlier response would otherwise overwrite the newer one — leaving
    // a loader build selected that does not belong to the chosen version, which
    // is then what `create()` submits.
    const request = ++loaderRequestId.current

    setCheckingLoaders(true)
    setLoaderVersions({})

    const ids: LoaderId[] = ['fabric', 'neoforge', 'forge', 'quilt']
    void Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await window.gabi.versions.loader(id, mcVersion)] as const
        } catch {
          return [id, [] as LoaderVersion[]] as const
        }
      })
    )
      .then((entries) => {
        if (request !== loaderRequestId.current) return
        setLoaderVersions(Object.fromEntries(entries))
      })
      .finally(() => {
        if (request === loaderRequestId.current) setCheckingLoaders(false)
      })
  }, [open, mcVersion, step])

  /* --- Default the loader build when the loader changes ------------ */
  useEffect(() => {
    const list = loaderVersions[loader] ?? []
    const best = list.find((v) => v.recommended) ?? list.find((v) => v.stable) ?? list[0]
    setLoaderVersion(best?.version ?? '')
  }, [loader, loaderVersions])

  const filteredVersions = useMemo(() => {
    const term = versionSearch.trim().toLowerCase()
    if (!term) return versions.slice(0, 200)
    return versions.filter((v) => v.id.toLowerCase().includes(term)).slice(0, 200)
  }, [versions, versionSearch])

  const suggestedName = useMemo(() => {
    if (!mcVersion) return ''
    const loaderName = LOADERS.find((l) => l.id === loader)?.name ?? ''
    return loader === 'vanilla' ? `Vanilla ${mcVersion}` : `${loaderName} ${mcVersion}`
  }, [mcVersion, loader])

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const instance = await window.gabi.instances.create({
        name: name.trim() || suggestedName,
        mcVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? '' : loaderVersion,
        icon,
        accent,
        group: group.trim(),
        memoryMb: memory
      })

      toast(
        'success',
        'Instanz erstellt',
        `${instance.name} wird im Hintergrund eingerichtet.`
      )
      await refreshInstances()
      onClose()
      navigate(`/instances/${instance.id}`)
    } catch (err) {
      toastError(err, 'Instanz konnte nicht erstellt werden')
    } finally {
      setBusy(false)
    }
  }

  const steps = ['Version', 'Mod Loader', 'Details']

  return (
    <Modal
      open={open}
      title="Neue Instanz"
      subtitle="In drei Schritten zur eigenen Minecraft-Installation."
      onClose={onClose}
      busy={busy}
      width="wide"
      footer={
        <>
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep((s) => (s - 1) as Step)} disabled={busy}>
              Zurück
            </button>
          )}
          <div className="grow" />
          {step < 2 ? (
            <button
              className="btn primary"
              disabled={step === 0 ? !mcVersion : false}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              Weiter
            </button>
          ) : (
            <button className="btn primary" onClick={create} disabled={busy || !mcVersion}>
              {busy ? <span className="spinner" /> : <IconSparkle size={15} />}
              INSTANZ ERSTELLEN
            </button>
          )}
        </>
      }
    >
      <div className="wizard-steps">
        {steps.map((label, index) => (
          <div key={label} style={{ display: 'contents' }}>
            <div className={`wizard-step ${step === index ? 'active' : ''} ${step > index ? 'done' : ''}`}>
              <span className="wizard-dot">{step > index ? <IconCheck size={12} /> : index + 1}</span>
              {label}
            </div>
            {index < steps.length - 1 && <div className="wizard-line" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="col gap-16">
          <div className="row gap-12">
            <div className="search">
              <IconSearch size={16} />
              <input
                className="input"
                placeholder="Version suchen, z. B. 1.21.11"
                value={versionSearch}
                onChange={(event) => setVersionSearch(event.target.value)}
                autoFocus
              />
            </div>
            <button
              className={`btn ${showSnapshots ? 'primary' : ''}`}
              onClick={() => setShowSnapshots((value) => !value)}
            >
              Snapshots
            </button>
          </div>

          {loadingVersions ? (
            <div className="col gap-8">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 41 }} />
              ))}
            </div>
          ) : (
            <div className="version-list">
              {filteredVersions.map((version) => (
                <button
                  key={version.id}
                  className={`version-item ${mcVersion === version.id ? 'selected' : ''}`}
                  onClick={() => setMcVersion(version.id)}
                  onDoubleClick={() => setStep(1)}
                >
                  <span className="row gap-8">
                    <span style={{ fontWeight: 650, fontSize: 13.5 }}>{version.id}</span>
                    {version.type !== 'release' && <span className="badge">{version.type}</span>}
                  </span>
                  <span className="hint">{formatDate(version.releaseTime)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="col gap-16">
          <p className="hint">
            Der Mod Loader entscheidet, welche Mods du installieren kannst. Ohne Loader läuft Minecraft
            unverändert. Ausgegraute Loader gibt es für {mcVersion} noch nicht.
          </p>

          <div className="option-grid">
            {LOADERS.map((entry) => {
              const available =
                entry.id === 'vanilla' || (loaderVersions[entry.id]?.length ?? 0) > 0
              const unknown = entry.id !== 'vanilla' && checkingLoaders

              return (
                <button
                  key={entry.id}
                  className={`option ${loader === entry.id ? 'selected' : ''}`}
                  disabled={!available && !unknown}
                  onClick={() => setLoader(entry.id)}
                >
                  <div className="option-name">
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 3,
                        background: entry.accent,
                        boxShadow: `0 0 10px ${entry.accent}`
                      }}
                    />
                    {entry.name}
                  </div>
                  <div className="option-desc">{entry.blurb}</div>
                  {unknown && (
                    <div className="hint mt-8">
                      <span className="spinner" style={{ width: 11, height: 11, display: 'inline-block' }} />{' '}
                      wird geprüft…
                    </div>
                  )}
                  {/*
                    * Vanilla gets a line too, even though it has no loader
                    * versions to count: the grid stretches every card to the
                    * tallest one, so leaving it out left a visible gap under
                    * Vanilla while every neighbour was filled to the bottom.
                    */}
                  {!unknown && (
                    <div className="hint mt-8">
                      {entry.id === 'vanilla'
                        ? 'Immer verfügbar'
                        : available
                          ? `${loaderVersions[entry.id].length} ${pluralise(loaderVersions[entry.id].length, 'Version', 'Versionen')}`
                          : `Nicht für ${mcVersion}`}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {loader !== 'vanilla' && (loaderVersions[loader]?.length ?? 0) > 0 && (
            <div className="field">
              <label className="label">Loader-Version</label>
              <select
                className="select"
                value={loaderVersion}
                onChange={(event) => setLoaderVersion(event.target.value)}
              >
                {loaderVersions[loader].map((version) => (
                  <option key={version.version} value={version.version}>
                    {version.version}
                    {version.recommended ? ' · empfohlen' : version.stable ? ' · stabil' : ' · beta'}
                  </option>
                ))}
              </select>
              <span className="hint">
                Im Zweifel die empfohlene Version nehmen, sie ist am besten getestet.
              </span>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="col gap-20">
          <div className="field">
            <label className="label">Name</label>
            <input
              className="input"
              placeholder={suggestedName}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>

          <div className="row gap-16" style={{ alignItems: 'flex-start' }}>
            <div className="field grow">
              <label className="label">Gruppe (optional)</label>
              <input
                className="input"
                placeholder="z. B. Modded"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              />
            </div>
            <div className="field grow">
              <label className="label">Arbeitsspeicher: {formatMemory(memory)}</label>
              <input
                className="range"
                type="range"
                min={1024}
                max={16384}
                step={512}
                value={memory}
                onChange={(event) => setMemory(Number(event.target.value))}
              />
              <span className="hint">
                Für Vanilla reichen 2-4 GB, für große Modpacks eher 6-8 GB.
              </span>
            </div>
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

          <div
            className="card pad-sm"
            style={{ ['--card-accent' as string]: accent, borderColor: `${accent}55` }}
          >
            <div className="row gap-12">
              <div
                className="quick-icon"
                style={{ ['--card-accent' as string]: accent }}
              >
                {icon}
              </div>
              <div className="col">
                <span style={{ fontWeight: 650 }}>{name.trim() || suggestedName}</span>
                <span className="hint">
                  Minecraft {mcVersion} · {LOADERS.find((l) => l.id === loader)?.name}
                  {loaderVersion ? ` ${loaderVersion}` : ''} · {formatMemory(memory)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
