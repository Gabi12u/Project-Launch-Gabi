import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type {
  InstanceSettings,
  LoaderId,
  LoaderVersion,
  MinecraftVersion,
  VersionChangeItem,
  VersionChangePlan
} from '@shared/types'
import { LOADERS } from '@shared/defaults'
import { refreshInstances, toast, toastError, useStore } from '../lib/store'
import { formatDate, LOADER_LABELS, pluralise, releaseTypeLabel } from '../lib/format'
import { Modal } from './ui'
import { IconCheck, IconCube, IconRefresh, IconSearch, IconWarning } from './Icons'
import { tr } from '@shared/i18n'

type Step = 0 | 1 | 2

interface Props {
  open: boolean
  instance: { id: string; name: string; mcVersion: string; loader: LoaderId; loaderVersion: string }
  onClose: () => void
  /** Called once the change has ended, including the dependencies installed after it. */
  onDone?: () => void
}

function targetLabel(mcVersion: string, loader: LoaderId, loaderVersion = ''): string {
  if (loader === 'vanilla') return `Minecraft ${mcVersion}`
  return `Minecraft ${mcVersion} · ${LOADER_LABELS[loader]}${loaderVersion ? ` ${loaderVersion}` : ''}`
}

/**
 * Moves an instance to another Minecraft version or mod loader.
 *
 * The same three steps as creating an instance, so nothing here is new to
 * learn, plus an overview of what happens to every mod before anything is
 * changed. The change itself runs as a task in the background.
 */
export function ChangeVersionDialog({ open, instance, onClose, onDone }: Props): JSX.Element {
  const { settings } = useStore()
  const [step, setStep] = useState<Step>(0)

  const [versions, setVersions] = useState<MinecraftVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [versionSearch, setVersionSearch] = useState('')
  const [showSnapshots, setShowSnapshots] = useState(() => settings.showSnapshots === true)
  const [versionAttempt, setVersionAttempt] = useState(0)

  const [mcVersion, setMcVersion] = useState(instance.mcVersion)
  const [loader, setLoader] = useState<LoaderId>(instance.loader)
  const [loaderVersions, setLoaderVersions] = useState<Record<string, LoaderVersion[] | 'error'>>({})
  const [loaderVersion, setLoaderVersion] = useState('')
  const [checkingLoaders, setCheckingLoaders] = useState(false)
  const [loaderAttempt, setLoaderAttempt] = useState(0)
  const loaderRequestId = useRef(0)

  const [plan, setPlan] = useState<VersionChangePlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planAttempt, setPlanAttempt] = useState(0)
  const planRequestId = useRef(0)
  const [instanceSettings, setInstanceSettings] = useState<InstanceSettings | null>(null)

  /* --- Reset whenever the dialog is opened ------------------------ */
  useEffect(() => {
    if (!open) return
    setStep(0)
    setVersionSearch('')
    setMcVersion(instance.mcVersion)
    setLoader(instance.loader)
    setLoaderVersion('')
    setPlan(null)
    setPlanError(null)
    setInstanceSettings(null)
    // Only for the hints in the overview; the dialog works without them.
    void window.gabi.instances
      .get(instance.id)
      .then((detail) => setInstanceSettings(detail.settings))
      .catch(() => undefined)
    // Only on opening, the same as the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* --- Minecraft versions ----------------------------------------- */
  useEffect(() => {
    if (!open) return
    let current = true
    setLoadingVersions(true)
    void window.gabi.versions
      .minecraft(showSnapshots)
      .then((list) => {
        if (current) setVersions(list)
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
        // The current loader stays picked when it exists for the new version,
        // which is what most people want: same mods, newer game.
        // Only an answer that there is no build moves the choice to Vanilla.
        // A failed lookup keeps it, "Weiter" stays locked and the banner
        // offers a retry, instead of silently planning a move to Vanilla.
        setLoader((current) => {
          if (current === 'vanilla') return current
          const list = found[current]
          return list === 'error' || (Array.isArray(list) && list.length > 0) ? current : 'vanilla'
        })
      })
      .finally(() => {
        if (request === loaderRequestId.current) setCheckingLoaders(false)
      })
  }, [open, mcVersion, step, loaderAttempt])

  /* --- Default the loader build when the loader changes ------------ */
  const previousLoader = useRef(loader)
  useEffect(() => {
    const list = loaderVersions[loader]
    if (list === undefined && loader !== 'vanilla') return
    const builds = Array.isArray(list) ? list : []
    const loaderChanged = previousLoader.current !== loader
    previousLoader.current = loader
    if (!loaderChanged && builds.some((v) => v.version === loaderVersion)) return
    // Staying on the same game version and loader keeps the build that is
    // installed, so only what was actually changed changes.
    const keep = mcVersion === instance.mcVersion && loader === instance.loader
      ? builds.find((v) => v.version === instance.loaderVersion)
      : undefined
    const best = keep ?? builds.find((v) => v.recommended) ?? builds.find((v) => v.stable) ?? builds[0]
    setLoaderVersion(best?.version ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, loaderVersions])

  const selectedLoaderVersions = useMemo(() => {
    const list = loaderVersions[loader]
    return Array.isArray(list) ? list : []
  }, [loaderVersions, loader])

  const loaderReady = loader === 'vanilla' || (selectedLoaderVersions.length > 0 && Boolean(loaderVersion))
  const unchanged =
    mcVersion === instance.mcVersion &&
    loader === instance.loader &&
    (loader === 'vanilla' || loaderVersion === instance.loaderVersion)

  const filteredVersions = useMemo(() => {
    const term = versionSearch.trim().toLowerCase()
    if (!term) return versions.slice(0, 200)
    return versions.filter((v) => v.id.toLowerCase().includes(term)).slice(0, 200)
  }, [versions, versionSearch])

  // Known only when both versions are in the list, a hidden snapshot is not.
  const downgrade = useMemo(() => {
    const from = versions.find((v) => v.id === instance.mcVersion)
    const to = versions.find((v) => v.id === mcVersion)
    if (!from || !to) return false
    return new Date(to.releaseTime).getTime() < new Date(from.releaseTime).getTime()
  }, [versions, mcVersion, instance.mcVersion])

  /* --- What happens to every mod ------------------------------------ */
  useEffect(() => {
    if (!open || step !== 2) return
    const request = ++planRequestId.current
    setPlan(null)
    setPlanError(null)
    void window.gabi.instances
      .planVersionChange(instance.id, { mcVersion, loader, loaderVersion: loader === 'vanilla' ? '' : loaderVersion })
      .then((result) => {
        if (request === planRequestId.current) setPlan(result)
      })
      .catch((err) => {
        if (request === planRequestId.current) setPlanError(err instanceof Error ? err.message : String(err))
      })
  }, [open, step, instance.id, mcVersion, loader, loaderVersion, planAttempt])

  const groups = useMemo(() => {
    const items = plan?.items ?? []
    const of = (...outcomes: VersionChangeItem['outcome'][]): VersionChangeItem[] =>
      items.filter((item) => outcomes.includes(item.outcome))
    return {
      update: of('update'),
      keep: of('keep').filter((item) => !item.reenable),
      back: items.filter((item) => item.reenable),
      off: of('disable'),
      unchecked: of('unchecked'),
      local: of('local')
    }
  }, [plan])

  const start = (): void => {
    const target = { mcVersion, loader, loaderVersion: loader === 'vanilla' ? '' : loaderVersion }
    const label = targetLabel(mcVersion, loader, target.loaderVersion)
    onClose()
    toast(
      'info',
      tr('Versionswechsel gestartet', 'Version change started'),
      tr(
        `${instance.name} wechselt auf ${label}. Den Fortschritt siehst du bei den Aufgaben.`,
        `${instance.name} is moving to ${label}. You can follow the progress in the tasks.`
      )
    )
    void window.gabi.instances
      .changeVersion(instance.id, target)
      .then(async () => {
        toast('success', tr('Version geändert', 'Version changed'), tr(`${instance.name} ist jetzt auf ${label}.`, `${instance.name} is now on ${label}.`))
        await refreshInstances()
        onDone?.()
      })
      .catch(async (err) => {
        toastError(err, tr('Version konnte nicht geändert werden', 'Version could not be changed'))
        await refreshInstances()
        onDone?.()
      })
  }

  const steps = [tr('Version', 'Version'), tr('Mod-Loader', 'Mod loader'), tr('Überblick', 'Overview')]
  const javaPinned = Boolean(instanceSettings?.javaPath || instanceSettings?.javaMajorOverride)

  return (
    <Modal
      open={open}
      title={tr('Version ändern', 'Change version')}
      subtitle={tr(
        `${instance.name} ist auf ${targetLabel(instance.mcVersion, instance.loader, instance.loaderVersion)}.`,
        `${instance.name} is on ${targetLabel(instance.mcVersion, instance.loader, instance.loaderVersion)}.`
      )}
      onClose={onClose}
      width="wide"
      footer={
        <>
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep((s) => (s - 1) as Step)}>
              {tr('Zurück', 'Back')}
            </button>
          )}
          <div className="grow" />
          {step < 2 ? (
            <button
              className="btn primary"
              disabled={step === 0 ? !mcVersion : checkingLoaders || !loaderReady || unchanged}
              title={step === 1 && unchanged ? tr('Das ist die Version, die die Instanz schon hat.', 'That is the version the instance already has.') : undefined}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              {tr('Weiter', 'Next')}
            </button>
          ) : (
            <button className="btn primary" onClick={start} disabled={!plan}>
              <IconCube size={15} />
              {tr('VERSION ÄNDERN', 'CHANGE VERSION')}
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

          {loadingVersions ? (
            <div className="col gap-8">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 41 }} />
              ))}
            </div>
          ) : versions.length === 0 ? (
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
                    {version.id === instance.mcVersion && <span className="badge accent">{tr('Aktuell', 'Current')}</span>}
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
              `Wähle den Mod-Loader für ${mcVersion}. Mit einem anderen Loader sucht der Launcher für jeden Mod die Fassung für diesen Loader. Ausgegraute Loader gibt es für ${mcVersion} noch nicht.`,
              `Choose the mod loader for ${mcVersion}. With a different loader the launcher looks for each mod's build for that loader. Grayed-out loaders are not available for ${mcVersion} yet.`
            )}
          </p>

          {!checkingLoaders && Object.values(loaderVersions).some((v) => v === 'error') && (
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
              const list = loaderVersions[entry.id]
              const failed = entry.id !== 'vanilla' && list === 'error'
              const available = entry.id === 'vanilla' || (Array.isArray(list) && list.length > 0)
              const unknown = entry.id !== 'vanilla' && checkingLoaders
              return (
                <button
                  key={entry.id}
                  className={`option ${loader === entry.id ? 'selected' : ''}`}
                  aria-pressed={loader === entry.id}
                  disabled={!available || unknown}
                  onClick={() => setLoader(entry.id)}
                >
                  <div className="option-name">
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: entry.accent, boxShadow: `0 0 10px ${entry.accent}` }} />
                    {entry.name}
                    {entry.id === instance.loader && <span className="badge accent">{tr('Aktuell', 'Current')}</span>}
                  </div>
                  <div className="option-desc">{entry.blurb}</div>
                  {unknown && (
                    <div className="hint mt-8">
                      <span className="spinner" style={{ width: 11, height: 11, display: 'inline-block' }} /> {tr('wird geprüft…', 'checking…')}
                    </div>
                  )}
                  {!unknown && failed && (
                    <div className="hint mt-8" style={{ color: 'var(--danger)' }}>
                      {tr('Abfrage fehlgeschlagen', 'Lookup failed')}
                    </div>
                  )}
                  {!unknown && !failed && (
                    <div className="hint mt-8">
                      {entry.id === 'vanilla'
                        ? tr('Immer verfügbar', 'Always available')
                        : available && Array.isArray(list)
                          ? tr(`${list.length} ${pluralise(list.length, 'Version', 'Versionen')}`, `${list.length} ${pluralise(list.length, 'version', 'versions')}`)
                          : tr(`Nicht für ${mcVersion}`, `Not for ${mcVersion}`)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {loader !== 'vanilla' && selectedLoaderVersions.length > 0 && (
            <div className="field">
              <label className="label" htmlFor="cv-loader-version">{tr('Loader-Version', 'Loader version')}</label>
              <select id="cv-loader-version" className="select" value={loaderVersion} onChange={(event) => setLoaderVersion(event.target.value)}>
                {selectedLoaderVersions.map((version) => (
                  <option key={version.version} value={version.version}>
                    {version.version}
                    {version.recommended ? tr(' · empfohlen', ' · recommended') : version.stable ? tr(' · stabil', ' · stable') : tr(' · Beta', ' · beta')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {unchanged && !checkingLoaders && (
            <span className="hint">{tr('Das ist die Version, die die Instanz schon hat.', 'That is the version the instance already has.')}</span>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="col gap-16">
          <div className="card pad-sm">
            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              <span className="hint">{targetLabel(instance.mcVersion, instance.loader, instance.loaderVersion)}</span>
              <span className="hint">→</span>
              <span style={{ fontWeight: 650 }}>{targetLabel(mcVersion, loader, loader === 'vanilla' ? '' : loaderVersion)}</span>
            </div>
          </div>

          {downgrade && (
            <Note>
              {tr(
                `${mcVersion} ist älter als ${instance.mcVersion}. Welten, die schon in ${instance.mcVersion} gespielt wurden, können in einer älteren Version kaputtgehen.`,
                `${mcVersion} is older than ${instance.mcVersion}. Worlds already played in ${instance.mcVersion} can break in an older version.`
              )}
            </Note>
          )}
          {javaPinned && (
            <Note>
              {tr(
                'Für diese Instanz ist ein festes Java eingestellt. Prüfe danach in den Einstellungen der Instanz, ob es zur neuen Version passt.',
                'This instance has a fixed Java set. Check afterwards in the instance settings whether it fits the new version.'
              )}
            </Note>
          )}

          {planError ? (
            <div className="col gap-12" style={{ padding: '18px 0', textAlign: 'center' }}>
              <p className="hint">{planError}</p>
              <div>
                <button className="btn" onClick={() => setPlanAttempt((n) => n + 1)}>
                  <IconRefresh size={14} /> {tr('Erneut versuchen', 'Try again')}
                </button>
              </div>
            </div>
          ) : !plan ? (
            <div className="col gap-8">
              <span className="hint">
                <span className="spinner" style={{ width: 11, height: 11, display: 'inline-block' }} />{' '}
                {tr('Für jeden Mod wird die passende Version gesucht…', 'Looking for the matching version of every mod…')}
              </span>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 38 }} />
              ))}
            </div>
          ) : plan.items.length === 0 ? (
            <p className="hint">
              {tr('Diese Instanz hat keine Mods oder Pakete. Nur Minecraft und der Mod-Loader werden umgestellt.', 'This instance has no mods or packs. Only Minecraft and the mod loader are changed.')}
            </p>
          ) : (
            <div className="col gap-12">
              {groups.update.length > 0 && (
                <PlanGroup
                  tone="ok"
                  title={tr(
                    `${groups.update.length} ${groups.update.length === 1 ? 'Eintrag bekommt' : 'Einträge bekommen'} die passende Version`,
                    `${groups.update.length} ${groups.update.length === 1 ? 'item gets' : 'items get'} the matching version`
                  )}
                  items={groups.update}
                  detail={(item) => `${item.fromVersion} → ${item.toVersion ?? ''}`}
                />
              )}
              {groups.keep.length > 0 && (
                <PlanGroup
                  tone="neutral"
                  title={tr(
                    `${groups.keep.length} ${groups.keep.length === 1 ? 'Eintrag passt' : 'Einträge passen'} schon und ${groups.keep.length === 1 ? 'bleibt' : 'bleiben'}`,
                    `${groups.keep.length} ${groups.keep.length === 1 ? 'item already fits and stays' : 'items already fit and stay'}`
                  )}
                  items={groups.keep}
                />
              )}
              {groups.back.length > 0 && (
                <PlanGroup
                  tone="ok"
                  title={tr(
                    `${groups.back.length} ${groups.back.length === 1 ? 'Eintrag wird' : 'Einträge werden'} wieder eingeschaltet`,
                    `${groups.back.length} ${groups.back.length === 1 ? 'item is' : 'items are'} switched back on`
                  )}
                  note={tr(
                    'Ein früherer Versionswechsel hat sie ausgeschaltet, zur neuen Version passen sie wieder.',
                    'An earlier version change switched them off, they fit the new version again.'
                  )}
                  items={groups.back}
                  detail={(item) => (item.toVersion ? `${item.fromVersion} → ${item.toVersion}` : item.fromVersion)}
                />
              )}
              {groups.off.length > 0 && (
                <PlanGroup
                  tone="warn"
                  title={tr(
                    `${groups.off.length} ${groups.off.length === 1 ? 'Eintrag wird' : 'Einträge werden'} ausgeschaltet`,
                    `${groups.off.length} ${groups.off.length === 1 ? 'item is' : 'items are'} switched off`
                  )}
                  note={tr(
                    'Sie bleiben in der Instanz und gehen von selbst wieder an, wenn du auf eine Version wechselst, zu der sie passen. Einschalten lassen sie sich auch jederzeit von Hand.',
                    'They stay in the instance and come back on by themselves when you change to a version they fit. You can also switch them on by hand at any time.'
                  )}
                  items={groups.off}
                  detail={(item) => item.reason ?? ''}
                />
              )}
              {groups.unchecked.length > 0 && (
                <PlanGroup
                  tone="warn"
                  title={tr(
                    `${groups.unchecked.length} ${groups.unchecked.length === 1 ? 'Eintrag konnte' : 'Einträge konnten'} nicht geprüft werden und ${groups.unchecked.length === 1 ? 'bleibt' : 'bleiben'} unverändert`,
                    `${groups.unchecked.length} ${groups.unchecked.length === 1 ? 'item could not be checked and stays' : 'items could not be checked and stay'} unchanged`
                  )}
                  note={tr(
                    'Der Launcher fasst sie nicht an. Prüfe nach dem Wechsel selbst, ob sie zur neuen Version passen.',
                    'The launcher leaves them alone. Check after the change whether they fit the new version.'
                  )}
                  items={groups.unchecked}
                  detail={(item) => item.reason ?? ''}
                />
              )}
              {groups.local.length > 0 && (
                <PlanGroup
                  tone="neutral"
                  title={tr(
                    `${groups.local.length} von Hand ${groups.local.length === 1 ? 'hinzugefügte Datei bleibt' : 'hinzugefügte Dateien bleiben'} unverändert`,
                    `${groups.local.length} ${groups.local.length === 1 ? 'file added by hand stays' : 'files added by hand stay'} unchanged`
                  )}
                  note={
                    groups.local.length === 1
                      ? tr(
                          'Für sie kennt der Launcher keine Quelle. Prüfe selbst, ob sie zur neuen Version passt.',
                          'The launcher knows no source for it. Check yourself whether it fits the new version.'
                        )
                      : tr(
                          'Für sie kennt der Launcher keine Quelle. Prüfe selbst, ob sie zur neuen Version passen.',
                          'The launcher knows no source for them. Check yourself whether they fit the new version.'
                        )
                  }
                  items={groups.local}
                />
              )}
            </div>
          )}

          <span className="hint">
            {tr(
              'Vor dem Wechsel sichert der Launcher deine Welten. Die Sicherung findest du danach unter Backups.',
              'Before the change the launcher backs up your worlds. You will find the backup under Backups afterwards.'
            )}
          </span>
        </div>
      )}
    </Modal>
  )
}

function Note({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="row gap-8" style={{ padding: '10px 12px', background: 'var(--warn-soft)', borderRadius: 10, alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }}>
        <IconWarning size={14} />
      </span>
      <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

function PlanGroup({
  tone,
  title,
  note,
  items,
  detail
}: {
  tone: 'ok' | 'warn' | 'neutral'
  title: string
  note?: string
  items: VersionChangeItem[]
  detail?: (item: VersionChangeItem) => string
}): JSX.Element {
  const [open, setOpen] = useState(tone !== 'neutral' && items.length <= 8)
  return (
    <div className="card pad-sm col gap-8">
      <button className="row-between" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="row gap-8">
          <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{items.length}</span>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
        </span>
        <span className="hint">{open ? tr('Weniger', 'Less') : tr('Anzeigen', 'Show')}</span>
      </button>
      {note && <span className="hint">{note}</span>}
      {open && (
        <div className="col" style={{ maxHeight: 180, overflowY: 'auto' }}>
          {items.map((item) => (
            <div key={item.contentId} className="row-between" style={{ padding: '5px 0', gap: 12, borderTop: '1px solid var(--line)' }}>
              <span className="truncate" style={{ fontSize: 13 }}>{item.name}</span>
              {detail && <span className="hint truncate" style={{ maxWidth: '55%', textAlign: 'right' }}>{detail(item)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
