import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { LoaderId, LoaderVersion, MinecraftVersion } from '@shared/types'
import { ACCENT_CHOICES, ICON_CHOICES, LOADERS } from '@shared/defaults'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { useMemorySliderMax } from '../lib/hooks'
import { formatDate, formatMemory, pluralise, releaseTypeLabel } from '../lib/format'
import { accentName } from '../lib/accents'
import { Modal } from '../components/ui'
import { IconCheck, IconSearch, IconSparkle,
  IconRefresh} from '../components/Icons'
import { tr } from '@shared/i18n'

type Step = 0 | 1 | 2

interface Props {
  open: boolean
  onClose: () => void
}

export function CreateInstanceWizard({ open, onClose }: Props): JSX.Element {
  const { settings } = useStore()
  // Read when the wizard opens, without making a settings change reset it.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const memoryMax = useMemorySliderMax()
  // useMemorySliderMax answers instantly with a generous fallback ceiling
  // while the real installed RAM is still being fetched. Clamping against
  // that fallback before it resolves could cut a legitimate high value down
  // to the fallback for no reason, so the clamp is only applied once the
  // real number is confirmed to have arrived.
  const [memoryKnown, setMemoryKnown] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.gabi.app
      .info()
      .then((info) => {
        if (!cancelled && info.systemMemoryMb) setMemoryKnown(true)
      })
      // Without the real RAM size the slider keeps its fallback ceiling.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const [step, setStep] = useState<Step>(0)
  const [busy, setBusy] = useState(false)

  const [versions, setVersions] = useState<MinecraftVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [versionSearch, setVersionSearch] = useState('')
  // From the setting of the same name, which otherwise did nothing.
  const [showSnapshots, setShowSnapshots] = useState(() => settings.showSnapshots === true)

  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<LoaderId>('vanilla')
  // 'error' marks a loader whose lookup itself failed (network drop, metadata
  // service unreachable), kept apart from a genuinely empty array. Without
  // the distinction, a failed lookup and "no build exists for this version"
  // looked identical, and a lost connection made every loader show as
  // permanently unavailable with no hint that trying again could help.
  const [loaderVersions, setLoaderVersions] = useState<Record<string, LoaderVersion[] | 'error'>>({})
  const [loaderVersion, setLoaderVersion] = useState('')
  const [checkingLoaders, setCheckingLoaders] = useState(false)
  // Bumped by the retry button to run the version lookup again.
  const [versionAttempt, setVersionAttempt] = useState(0)
  const [loaderAttempt, setLoaderAttempt] = useState(0)
  const loaderRequestId = useRef(0)

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🟩')
  const [accent, setAccent] = useState(settings.accentColor)
  const [memory, setMemory] = useState(settings.defaultMemoryMb)
  const [group, setGroup] = useState('')

  // The value that is actually shown and saved: never above what the machine
  // really has. Submitting the raw slider value used to save more memory
  // than exists on machines with less RAM than the default.
  const effectiveMemory = memoryKnown ? Math.min(memory, memoryMax) : memory

  /* --- Reset whenever the wizard is opened ------------------------ */
  useEffect(() => {
    if (!open) return
    setStep(0)
    setVersionSearch('')
    setLoader('vanilla')
    setLoaderVersion('')
    setName('')
    setIcon(ICON_CHOICES[Math.floor(Math.random() * 10)])
    setAccent(settingsRef.current.accentColor)
    setMemory(settingsRef.current.defaultMemoryMb)
    setGroup('')
    // Only on opening. A settings save landing while the wizard was open
    // (a debounced slider) threw it back to the first step, name cleared.
  }, [open])

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
        setMcVersion((chosen) => {
          // A snapshot chosen while "Snapshots" was on has to be dropped once
          // the toggle turns off: this list no longer contains it, and an id
          // that resolves to nothing would stay selected invisibly.
          if (chosen && list.some((v) => v.id === chosen)) return chosen
          return list.find((v) => v.type === 'release')?.id || list[0]?.id || ''
        })
      })
      .catch((err) => {
        if (current) toastError(err, tr('Versionsliste konnte nicht geladen werden', 'Version list could not be loaded'))
      })
      .finally(() => {
        if (current) setLoadingVersions(false)
      })
    return () => {
      current = false
    }
  }, [open, showSnapshots, versionAttempt])

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
          return [id, 'error' as const] as const
        }
      })
    )
      .then((entries) => {
        if (request !== loaderRequestId.current) return
        const found = Object.fromEntries(entries)
        setLoaderVersions(found)

        // Falls back to vanilla when the loader that was selected turns out
        // not to exist for this Minecraft version. Without this the card kept
        // its highlight while reading "Nicht für x", and the instance was
        // still created with that loader — the failure only surfaced later,
        // in the background install, after the user had already been sent to
        // the new and unusable instance. A failed lookup counts the same as
        // unavailable here, since there is no build to fall back on either way.
        setLoader((current) => {
          if (current === 'vanilla') return current
          const versions = found[current]
          return Array.isArray(versions) && versions.length > 0 ? current : 'vanilla'
        })
      })
      .finally(() => {
        if (request === loaderRequestId.current) setCheckingLoaders(false)
      })
  }, [open, mcVersion, step, loaderAttempt])

  /* --- Default the loader build when the loader changes ------------ */
  // Tracks the loader a default was last picked for, so a re-fetch of
  // loaderVersions with a new array identity (e.g. from "Erneut versuchen")
  // does not by itself overwrite a build the user already picked by hand.
  const previousLoader = useRef(loader)
  useEffect(() => {
    const versions = loaderVersions[loader]
    // While a lookup is still running the map is blank for a moment; that
    // is not an answer yet and must not clear a build picked by hand.
    if (versions === undefined && loader !== 'vanilla') return
    const list = Array.isArray(versions) ? versions : []
    const loaderChanged = previousLoader.current !== loader
    previousLoader.current = loader
    // Only reset when the loader itself changed, or the current pick no
    // longer exists in the freshly fetched list for it.
    if (!loaderChanged && list.some((v) => v.version === loaderVersion)) return
    const best = list.find((v) => v.recommended) ?? list.find((v) => v.stable) ?? list[0]
    setLoaderVersion(best?.version ?? '')
    // loaderVersion is only read here, not a trigger: adding it would re-run
    // this effect every time it sets it, even when loader and loaderVersions
    // themselves stayed the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, loaderVersions])

  const selectedLoaderVersions = useMemo(() => {
    const versions = loaderVersions[loader]
    return Array.isArray(versions) ? versions : []
  }, [loaderVersions, loader])

  // Vanilla always exists; any other loader needs at least one selectable
  // build for the chosen Minecraft version. Without this check, "Weiter" and
  // "Instanz erstellen" accepted a loader/version pairing that the install
  // step then had no build for at all.
  const loaderReady = loader === 'vanilla' || (selectedLoaderVersions.length > 0 && Boolean(loaderVersion))

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
        memoryMb: effectiveMemory
      })

      toast(
        'success',
        tr('Instanz erstellt', 'Instance created'),
        tr(`${instance.name} wird im Hintergrund eingerichtet.`, `${instance.name} is being set up in the background.`)
      )
      await refreshInstances()
      onClose()
      navigate(`/instances/${instance.id}`)
    } catch (err) {
      toastError(err, tr('Instanz konnte nicht erstellt werden', 'Instance could not be created'))
    } finally {
      setBusy(false)
    }
  }

  const steps = [tr('Version', 'Version'), tr('Mod-Loader', 'Mod loader'), tr('Details', 'Details')]

  return (
    <Modal
      open={open}
      title={tr('Neue Instanz', 'New instance')}
      subtitle={tr('In drei Schritten zur eigenen Minecraft-Installation.', 'Your own Minecraft installation in three steps.')}
      onClose={onClose}
      busy={busy}
      width="wide"
      footer={
        <>
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep((s) => (s - 1) as Step)} disabled={busy}>
              {tr('Zurück', 'Back')}
            </button>
          )}
          <div className="grow" />
          {step < 2 ? (
            <button
              className="btn primary"
              disabled={step === 0 ? !mcVersion : checkingLoaders || !loaderReady}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              {tr('Weiter', 'Next')}
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={create}
              disabled={busy || !mcVersion || checkingLoaders || !loaderReady}
            >
              {busy ? <span className="spinner" /> : <IconSparkle size={15} />}
              {tr('INSTANZ ERSTELLEN', 'CREATE INSTANCE')}
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
                placeholder={tr('Version suchen, z. B. 1.21.11', 'Search version, e.g. 1.21.11')}
                value={versionSearch}
                onChange={(event) => setVersionSearch(event.target.value)}
                autoFocus
              />
            </div>
            <button
              className={`btn ${showSnapshots ? 'primary' : ''}`}
              onClick={() => setShowSnapshots((value) => !value)}
              title={tr('Testversionen von Mojang anzeigen', 'Show test versions from Mojang')}
            >
              {tr('Snapshots', 'Snapshots')}
            </button>
          </div>

          {showSnapshots && (
            <span className="hint">
              {tr('Snapshots sind Testversionen von Mojang und oft noch fehlerhaft.', 'Snapshots are test versions from Mojang and often still buggy.')}
            </span>
          )}

          {loadingVersions ? (
            <div className="col gap-8">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 41 }} />
              ))}
            </div>
          ) : versions.length === 0 ? (
            /*
             * The list stayed simply empty when this first lookup failed, with
             * nothing but a toast that had long since gone. "Weiter" is
             * disabled without a chosen version, so the only ways out were
             * toggling the snapshot switch or closing the whole wizard, and
             * neither is anywhere suggested.
             */
            <div className="col gap-12" style={{ padding: '28px 0', textAlign: 'center' }}>
              <p className="hint">
                {tr('Die Versionsliste konnte nicht geladen werden. Meist liegt das an der Internetverbindung.', 'The version list could not be loaded. This is usually caused by the internet connection.')}
              </p>
              <div>
                <button className="btn" onClick={() => setVersionAttempt((n) => n + 1)}>
                  <IconRefresh size={14} /> {tr('Erneut versuchen', 'Try again')}
                </button>
              </div>
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
                    {version.type !== 'release' && <span className="badge">{releaseTypeLabel(version.type)}</span>}
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
            {tr(
              `Der Mod-Loader entscheidet, welche Mods du installieren kannst. Ohne Loader läuft Minecraft unverändert. Ausgegraute Loader gibt es für ${mcVersion} noch nicht.`,
              `The mod loader decides which mods you can install. Without a loader Minecraft runs unchanged. Grayed-out loaders are not available for ${mcVersion} yet.`
            )}
          </p>

          {!checkingLoaders &&
            Object.values(loaderVersions).some((v) => v === 'error') && (
              // A failed lookup used to look exactly like "no build for this
              // version," for every loader at once if the whole check failed
              // together, with no way to tell the difference or try again.
              <div className="row-between" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <span className="hint">
                  {tr(
                    'Die Abfrage ist bei mindestens einem Loader fehlgeschlagen, vermutlich wegen der Internetverbindung. Das bedeutet nicht, dass es keinen Loader gibt.',
                    'The lookup failed for at least one loader, probably because of the internet connection. That does not mean the loader does not exist.'
                  )}
                </span>
                <button className="btn ghost sm" onClick={() => setLoaderAttempt((n) => n + 1)}>
                  <IconRefresh size={12} /> {tr('Erneut versuchen', 'Try again')}
                </button>
              </div>
            )}

          <div className="option-grid">
            {LOADERS.map((entry) => {
              const versions = loaderVersions[entry.id]
              const failed = entry.id !== 'vanilla' && versions === 'error'
              const available =
                entry.id === 'vanilla' || (Array.isArray(versions) && versions.length > 0)
              const unknown = entry.id !== 'vanilla' && checkingLoaders

              return (
                <button
                  key={entry.id}
                  className={`option ${loader === entry.id ? 'selected' : ''}`}
                  aria-pressed={loader === entry.id}
                  // Locked while the check is still running, too. It used to
                  // stay clickable during that window, so a loader could be
                  // picked before anyone knew whether a build for this
                  // Minecraft version exists at all.
                  disabled={!available || unknown}
                  title={unknown ? tr('Verfügbarkeit wird noch geprüft…', 'Still checking availability…') : undefined}
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
                      {tr('wird geprüft…', 'checking…')}
                    </div>
                  )}
                  {/*
                    * Vanilla gets a line too, even though it has no loader
                    * versions to count: the grid stretches every card to the
                    * tallest one, so leaving it out left a visible gap under
                    * Vanilla while every neighbour was filled to the bottom.
                    */}
                  {!unknown && failed && (
                    <div className="hint mt-8" style={{ color: 'var(--danger)' }}>
                      {tr('Abfrage fehlgeschlagen', 'Lookup failed')}
                    </div>
                  )}
                  {!unknown && !failed && (
                    <div className="hint mt-8">
                      {entry.id === 'vanilla'
                        ? tr('Immer verfügbar', 'Always available')
                        : available && Array.isArray(versions)
                          ? tr(
                              `${versions.length} ${pluralise(versions.length, 'Version', 'Versionen')}`,
                              `${versions.length} ${pluralise(versions.length, 'version', 'versions')}`
                            )
                          : tr(`Nicht für ${mcVersion}`, `Not for ${mcVersion}`)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {loader !== 'vanilla' && selectedLoaderVersions.length > 0 && (
            <div className="field">
              <label className="label" htmlFor="ci-loader-version">{tr('Loader-Version', 'Loader version')}</label>
              <select id="ci-loader-version"
                className="select"
                value={loaderVersion}
                onChange={(event) => setLoaderVersion(event.target.value)}
              >
                {selectedLoaderVersions.map((version) => (
                  <option key={version.version} value={version.version}>
                    {version.version}
                    {version.recommended ? tr(' · empfohlen', ' · recommended') : version.stable ? tr(' · stabil', ' · stable') : tr(' · Beta', ' · beta')}
                  </option>
                ))}
              </select>
              <span className="hint">
                {tr('Im Zweifel die empfohlene Version nehmen, sie ist am besten getestet.', 'If in doubt, pick the recommended version. It is the best tested.')}
              </span>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="col gap-20">
          <div className="field">
            <label className="label" htmlFor="ci-name">{tr('Name', 'Name')}</label>
            <input id="ci-name"
              className="input"
              placeholder={suggestedName}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>

          <div className="row gap-16" style={{ alignItems: 'flex-start' }}>
            <div className="field grow">
              <label className="label" htmlFor="ci-gruppe-optional">{tr('Gruppe (optional)', 'Group (optional)')}</label>
              <input id="ci-gruppe-optional"
                className="input"
                placeholder={tr('z. B. Modded', 'e.g. Modded')}
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              />
            </div>
            <div className="field grow">
              <label className="label" htmlFor="ci-arbeitsspeicher">
                {tr('Arbeitsspeicher', 'Memory')}: {formatMemory(effectiveMemory)}
              </label>
              <input id="ci-arbeitsspeicher"
                className="range"
                type="range"
                min={1024}
                max={memoryMax}
                step={512}
                value={effectiveMemory}
                onChange={(event) => setMemory(Number(event.target.value))}
              />
              <span className="hint">
                {tr('Für Vanilla reichen 2-4 GB, für große Modpacks eher 6-8 GB.', '2-4 GB is enough for vanilla; large modpacks usually need 6-8 GB.')}
              </span>
            </div>
          </div>

          <div className="field">
            <label className="label" id="ci-icon">{tr('Icon', 'Icon')}</label>
            <div role="group" aria-labelledby="ci-icon" className="icon-picker">
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
            <label className="label" id="ci-akzentfarbe">{tr('Akzentfarbe', 'Accent color')}</label>
            <div role="group" aria-labelledby="ci-akzentfarbe" className="swatches">
              {ACCENT_CHOICES.map((choice) => (
                <button
                  key={choice}
                  className={`swatch ${accent === choice ? 'selected' : ''}`}
                  style={{ background: choice, color: choice }}
                  onClick={() => setAccent(choice)}
                  aria-label={accentName(choice)}
                  aria-pressed={accent === choice}
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
                  {loaderVersion ? ` ${loaderVersion}` : ''} · {formatMemory(effectiveMemory)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
