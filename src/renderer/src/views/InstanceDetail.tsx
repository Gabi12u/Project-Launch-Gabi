import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent} from 'react'
import { LogRow, createLineBatcher, logLineKey } from '../components/LogRow'
import type {
  CompatibilityReport,
  ContentItem,
  ContentType,
  LaunchPreflight,
  LogLine
} from '@shared/types'
import type { InstanceDetail, RecordingInfo, ScreenshotInfo, WorldInfo } from '@shared/api'
import {
  navigate,
  proceedPendingNavigation,
  refreshInstances,
  setNavigationGuard,
  toast,
  toastError,
  useStore, getState } from '../lib/store'
import { createShortcut, startInstance, stopInstance } from '../lib/actions'
import { clickable } from '../lib/a11y'
import {
  LOADER_LABELS,
  formatBytes,
  formatDateTime,
  formatDuration,
  contentBlockedReason,
  formatMemory,
  formatPlayTime,
  formatRelative,
  loaderColor,
  pluralise
} from '../lib/format'
import { Confirm, EmptyState, ProgressBar, Segmented } from '../components/ui'
import { CompatibilityPanel } from '../components/CompatibilityPanel'
import { ContentBrowser } from '../components/ContentBrowser'
import { WorldPickerModal } from '../components/WorldPickerModal'
import { InstanceSettingsPanel } from './InstanceSettings'
import {
  IconChevronLeft,
  IconCopy,
  IconCube,
  IconDownload,
  IconExternal,
  IconFolder,
  IconLink,
  IconPackage,
  IconPlay,
  IconRefresh,
  IconSave,
  IconStop,
  IconTerminal,
  IconTrash,
  IconUpload,
  IconWrench,
  IconLayers,
  IconCheck,
  IconFilm,
  IconX} from '../components/Icons'
import { ContextMenu, useContextMenu, type MenuItem } from '../components/ContextMenu'
import { VersionPicker } from '../components/VersionPicker'
import { tr } from '@shared/i18n'

type Tab = 'overview' | 'content' | 'browse' | 'worlds' | 'recordings' | 'logs' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: tr('Übersicht', 'Overview') },
  { id: 'content', label: tr('Installiert', 'Installed') },
  { id: 'browse', label: tr('Inhalte finden', 'Find content') },
  { id: 'worlds', label: tr('Welten', 'Worlds') },
  { id: 'recordings', label: tr('Aufnahmen', 'Recordings') },
  { id: 'logs', label: tr('Log', 'Log') },
  { id: 'settings', label: tr('Einstellungen', 'Settings') }
]

/**
 * Every tab body renders conditionally, so an id that matches none of them
 * leaves the panel blank with nothing selected. Routes are built from strings
 * elsewhere — notification payloads carry a free-form `route` — so an unknown
 * value falls back to the overview instead of rendering nothing.
 */
function toTab(raw: string | null): Tab {
  return TABS.some((t) => t.id === raw) ? (raw as Tab) : 'overview'
}

export function InstanceDetailView({
  instanceId,
  query
}: {
  instanceId: string
  query: URLSearchParams
}): JSX.Element {
  const { instances, launchStatus, starting } = useStore()
  const summary = instances.find((i) => i.id === instanceId)

  const [instance, setInstance] = useState<InstanceDetail | null>(null)
  const [tab, setTab] = useState<Tab>(() => toTab(query.get('tab')))

  // The view is keyed by instance id only, so navigating to the *same*
  // instance with a different ?tab= re-renders instead of remounting and the
  // initializer above never runs again. Without this, "In der Instanz oeffnen"
  // on a mod row did nothing at all when that instance was already open.
  const requestedTab = query.get('tab')
  useEffect(() => {
    if (requestedTab) setTab(toTab(requestedTab))
  }, [requestedTab])
  const [preflight, setPreflight] = useState<LaunchPreflight | null>(null)
  const [report, setReport] = useState<CompatibilityReport | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkFailed, setCheckFailed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRepair, setConfirmRepair] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  // Whether the settings panel has unsaved edits, so a tab switch that would
  // unmount it can ask first instead of silently discarding them.
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [pendingTab, setPendingTab] = useState<Tab | null>(null)
  // Set by the navigation guard below whenever something outside this view,
  // the "Alle Instanzen" button, the sidebar, the command palette or a route
  // pushed from the main process, tries to leave while settings are dirty.
  // It reuses the very same discard confirm that switching tabs internally
  // already showed, so every way out of the settings tab behaves the same.
  const [navBlocked, setNavBlocked] = useState(false)

  useEffect(() => {
    if (!settingsDirty) return
    setNavigationGuard(() => {
      setNavBlocked(true)
      return false
    })
    return () => setNavigationGuard(null)
  }, [settingsDirty])

  const status = launchStatus[instanceId]
  const running = summary?.running ?? false
  // What the mod controls actually have to obey. `running` alone missed the
  // whole preparation phase after Play, which can last minutes, and missed an
  // update already in flight — the backend refuses in both cases, so the
  // buttons have to know about them too.
  const contentBlocked = summary ? contentBlockedReason(summary) : null
  const busy = starting.includes(instanceId)
  // Everything the main process refuses delete and repair for, so the buttons
  // are greyed out up front instead of failing after the confirmation.
  const instanceBusy = running || busy || Boolean(instance?.installing) || Boolean(summary?.contentBusy)

  // Set on unmount, so a request still in flight cannot act on a view the
  // user has already left. Without it a rejected lookup navigated to
  // /instances from wherever they had since gone.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadedOnce = useRef(false)
  const load = useCallback(async (): Promise<void> => {
    try {
      const detail = await window.gabi.instances.get(instanceId)
      if (mounted.current) {
        loadedOnce.current = true
        setInstance(detail)
      }
    } catch (err) {
      if (!mounted.current) return
      toastError(err, tr('Instanz konnte nicht geladen werden', 'Instance could not be loaded'))
      // A failed refresh of a page already showing the instance keeps it, and
      // any unsaved settings with it; only a first load that fails leaves.
      if (loadedOnce.current) return
      setNavigationGuard(null)
      navigate('/instances')
    }
  }, [instanceId])

  const runChecks = useCallback(async (): Promise<void> => {
    setChecking(true)
    setCheckFailed(false)
    try {
      // Settled one by one: with Promise.all a single failure threw away the
      // other result too, and the panel then sat on "Loading" for good once
      // the toast was gone.
      const [flight, compat] = await Promise.allSettled([
        window.gabi.launch.preflight(instanceId),
        window.gabi.content.compatibility(instanceId)
      ])
      if (flight.status === 'fulfilled') setPreflight(flight.value)
      if (compat.status === 'fulfilled') setReport(compat.value)
      const failure = [flight, compat].find((result) => result.status === 'rejected')
      if (failure && failure.status === 'rejected') {
        setCheckFailed(true)
        toastError(failure.reason, tr('Prüfung fehlgeschlagen', 'Check failed'))
      }
    } finally {
      setChecking(false)
    }
  }, [instanceId])

  useEffect(() => {
    void load()
    void runChecks()
  }, [load, runChecks])

  const repair = async (): Promise<void> => {
    setRepairing(true)
    try {
      const result = await window.gabi.instances.repair(instanceId)
      const repaired = result.steps.filter((s) => s.status === 'repaired').length
      const failed = result.steps.filter((s) => s.status === 'failed').length

      toast(
        failed > 0 ? 'warning' : 'success',
        tr('Reparatur abgeschlossen', 'Repair finished'),
        tr(
          `${result.checkedFiles} ${pluralise(result.checkedFiles, 'Datei', 'Dateien')} geprüft, ` +
            `${result.repairedFiles} erneuert, ${repaired} ${pluralise(repaired, 'Bereich', 'Bereiche')} korrigiert` +
            (failed > 0 ? `, ${failed} ${pluralise(failed, 'Schritt', 'Schritte')} fehlgeschlagen` : '') +
            '.',
          `${result.checkedFiles} ${pluralise(result.checkedFiles, 'file', 'files')} checked, ` +
            `${result.repairedFiles} replaced, ${repaired} ${pluralise(repaired, 'area', 'areas')} fixed` +
            (failed > 0 ? `, ${failed} ${pluralise(failed, 'step', 'steps')} failed` : '') +
            '.'
        ),
        9000
      )
      await load()
      await runChecks()
    } catch (err) {
      toastError(err, tr('Reparatur fehlgeschlagen', 'Repair failed'))
    } finally {
      setRepairing(false)
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await window.gabi.instances.remove(instanceId)
      toast('info', tr('Instanz gelöscht', 'Instance deleted'), instance?.name)
      await refreshInstances()
      // Unsaved settings of an instance that no longer exists are nothing to ask about.
      setNavigationGuard(null)
      navigate('/instances')
    } catch (err) {
      // Closed here too: on success the navigation away closes it, on a
      // failure it otherwise stayed open over the error.
      setConfirmDelete(false)
      toastError(err, tr('Instanz konnte nicht gelöscht werden', 'Instance could not be deleted'))
    }
  }

  const duplicate = async (): Promise<void> => {
    setDuplicating(true)
    try {
      const created = await window.gabi.instances.duplicate(instanceId)
      toast('success', tr('Instanz dupliziert', 'Instance duplicated'), created.name)
      await refreshInstances()
      navigate(`/instances/${created.id}`)
    } catch (err) {
      toastError(err, tr('Instanz konnte nicht dupliziert werden', 'Instance could not be duplicated'))
    } finally {
      setDuplicating(false)
    }
  }

  if (!instance) {
    return (
      <div className="col gap-16">
        <div className="skeleton" style={{ height: 160 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    )
  }

  const accent = instance.appearance.accent
  const modCount = instance.content.filter((c) => c.type === 'mod').length
  const updateCount = instance.content.filter((c) => c.update).length

  return (
    <div className="col gap-24">
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/instances')}>
        <IconChevronLeft size={14} />
        {tr('Alle Instanzen', 'All instances')}
      </button>

      {/* --- Header ------------------------------------------------- */}
      <section className="hero" style={{ ['--hero-accent' as string]: accent, minHeight: 210 }}>
        {instance.resolvedBackground && (
          <img className="hero-bg" src={`file://${instance.resolvedBackground.replace(/\\/g, '/')}`} alt="" />
        )}
        <div className="hero-scrim" />

        <div className="hero-content">
          <div className="col gap-12">
            <div className="row gap-16">
              <div className="hero-icon">
                {instance.resolvedIcon ? (
                  <img src={`file://${instance.resolvedIcon.replace(/\\/g, '/')}`} alt="" />
                ) : (
                  instance.appearance.icon
                )}
              </div>
              <div className="col gap-6">
                <h1 className="hero-title" style={{ fontSize: 34 }}>
                  {instance.name}
                </h1>
                {instance.description && <p className="hint">{instance.description}</p>}
              </div>
            </div>

            <div className="hero-meta">
              <span className="badge">
                <IconCube size={12} /> {instance.mcVersion}
              </span>
              <span
                className="badge"
                style={{ color: loaderColor(instance.loader), background: 'rgba(255,255,255,0.06)' }}
              >
                {LOADER_LABELS[instance.loader]}
                {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}
              </span>
              {modCount > 0 && (
                <span className="badge">{modCount} {pluralise(modCount, 'Mod', 'Mods')}</span>
              )}
              <span className="badge">RAM: {formatMemory(instance.settings.memoryMb)}</span>
              {updateCount > 0 && (
                <span className="badge warn">{updateCount} {pluralise(updateCount, 'Update', 'Updates')}</span>
              )}
              {instance.installing && (
                <span className="badge accent">
                  <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  {tr('Wird eingerichtet', 'Setting up')}
                </span>
              )}
            </div>
          </div>

          <div className="col gap-10" style={{ alignItems: 'flex-end' }}>
            {running ? (
              <button className="btn-play stop" onClick={() => void stopInstance(instanceId)}>
                <IconStop size={18} /> {tr('BEENDEN', 'STOP')}
              </button>
            ) : (
              // Also blocked while a repair runs: it is replacing the very
              // files a launch would load. The main process refuses it too,
              // because this flag is lost as soon as the view is left.
              <button
                className="btn-play"
                disabled={busy || instance.installing || repairing}
                onClick={() => void startInstance(instanceId, instance.name)}
              >
                {busy ? <span className="spinner" /> : <IconPlay size={18} />}
                {busy ? tr('STARTET…', 'STARTING…') : tr('SPIELEN', 'PLAY')}
              </button>
            )}

            {status && status.phase !== 'idle' && (
              <div className="col gap-6" style={{ width: 260, alignItems: 'flex-end' }}>
                <span className="hint" style={{ textAlign: 'right' }}>
                  {status.detail}
                </span>
                {status.progress !== null && status.phase !== 'running' && (
                  <div style={{ width: '100%' }}>
                    <ProgressBar value={status.progress} label={status.detail} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* --- Action bar ---------------------------------------------- */}
      <div className="row gap-8 wrap">
        <button className="btn sm" onClick={() => void window.gabi.instances.openFolder(instanceId)}>
          <IconFolder size={14} /> {tr('Ordner', 'Folder')}
        </button>
        <button className="btn sm" onClick={() => void createShortcut(instanceId)}>
          <IconLink size={14} /> {tr('Desktop-Verknüpfung', 'Desktop shortcut')}
        </button>
        <button
          className="btn sm"
          onClick={() => setConfirmRepair(true)}
          disabled={repairing || instanceBusy}
          title={
            instanceBusy
              ? tr('Die Instanz läuft, startet oder wird gerade bearbeitet.', 'The instance is running, starting or being worked on right now.')
              : tr('Prüft alle Spieldateien, lädt beschädigte neu und entfernt doppelt installierte Mods.', 'Checks all game files, downloads damaged ones again and removes mods installed twice.')
          }
        >
          {repairing ? <span className="spinner" /> : <IconWrench size={14} />}
          {tr('Reparieren', 'Repair')}
        </button>
        <button
          className="btn sm"
          onClick={duplicate}
          disabled={duplicating || running || busy || instance.installing || repairing}
        >
          {duplicating ? <span className="spinner" /> : <IconCopy size={14} />}
          {tr('Duplizieren', 'Duplicate')}
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            try {
              await window.gabi.modpacks.export(instanceId)
            } catch (err) {
              toastError(err, tr('Export fehlgeschlagen', 'Export failed'))
            }
          }}
        >
          <IconUpload size={14} /> {tr('Als Modpack exportieren', 'Export as modpack')}
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            try {
              await window.gabi.backups.create(instanceId, { includes: ['saves', 'config'] })
              toast('success', tr('Sicherung erstellt', 'Backup created'), tr('Welten und Konfiguration wurden gesichert.', 'Worlds and config were backed up.'))
            } catch (err) {
              toastError(err, tr('Sicherung fehlgeschlagen', 'Backup failed'))
            }
          }}
        >
          <IconSave size={14} /> {tr('Sichern', 'Back up')}
        </button>
        <div className="grow" />
        <button
          className="btn sm danger"
          onClick={() => setConfirmDelete(true)}
          disabled={instanceBusy || repairing}
          title={instanceBusy ? tr('Die Instanz läuft, startet oder wird gerade bearbeitet.', 'The instance is running, starting or being worked on right now.') : undefined}
        >
          <IconTrash size={14} /> {tr('Löschen', 'Delete')}
        </button>
      </div>

      {/* --- Tabs ---------------------------------------------------- */}
      <div className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={`tab ${tab === entry.id ? 'active' : ''}`}
            onClick={() => {
              // Leaving the settings tab unmounts the panel below, which would
              // otherwise discard whatever it has not saved yet.
              if (tab === 'settings' && entry.id !== 'settings' && settingsDirty) {
                setPendingTab(entry.id)
              } else {
                setTab(entry.id)
              }
            }}
          >
            {entry.label}
            {entry.id === 'content' && instance.content.length > 0 && (
              <span className="tab-count">{instance.content.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          instance={instance}
          preflight={preflight}
          report={report}
          checking={checking}
          checkFailed={checkFailed}
          onReport={setReport}
          onRefresh={runChecks}
        />
      )}

      {tab === 'content' && (
        <ContentTab
          instance={instance}
          blockedReason={contentBlocked}
          onChanged={async () => { await load(); await runChecks() }}
        />
      )}

      {tab === 'browse' && (
        <ContentBrowser
          instanceId={instanceId}
          blockedReason={contentBlocked}
          mcVersion={instance.mcVersion}
          loader={instance.loader}
          installedProjectIds={instance.content
            .filter((c) => c.projectId)
            .map((c) => `${c.provider}:${c.projectId}`)}
          onInstalled={async () => {
            await load()
            await runChecks()
          }}
        />
      )}

      {tab === 'worlds' && <WorldsTab instanceId={instanceId} />}
      {tab === 'recordings' && <RecordingsTab instanceId={instanceId} />}
      {tab === 'logs' && <LogsTab instanceId={instanceId} />}
      {tab === 'settings' && (
        <InstanceSettingsPanel instance={instance} onChanged={load} onDirtyChange={setSettingsDirty} />
      )}

      <Confirm
        open={confirmDelete}
        title={tr('Instanz löschen?', 'Delete instance?')}
        danger
        confirmLabel={tr('Endgültig löschen', 'Delete permanently')}
        message={
          <>
            <strong>{instance.name}</strong>{' '}
            {tr(
              'wird mit allen Mods, Welten, Screenshots, Aufnahmen und Sicherungen unwiderruflich gelöscht. Das lässt sich nicht rückgängig machen.',
              'will be deleted permanently with all mods, worlds, screenshots, recordings and backups. This cannot be undone.'
            )}
          </>
        }
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />

      <Confirm
        open={confirmRepair}
        title={tr('Instanz reparieren?', 'Repair instance?')}
        confirmLabel={tr('Reparieren', 'Repair')}
        message={
          <>
            {tr(
              'Prüft alle Spieldateien, lädt beschädigte neu und entfernt doppelt installierte Mods. Deine Welten und Einstellungen bleiben erhalten.',
              'Checks all game files, downloads damaged ones again and removes mods installed twice. Your worlds and settings are kept.'
            )}
          </>
        }
        onConfirm={async () => {
          setConfirmRepair(false)
          await repair()
        }}
        onCancel={() => setConfirmRepair(false)}
      />

      <Confirm
        open={pendingTab !== null || navBlocked}
        title={tr('Ungespeicherte Änderungen verwerfen?', 'Discard unsaved changes?')}
        danger
        confirmLabel={tr('Verwerfen', 'Discard')}
        message={tr('Die Einstellungen dieser Instanz wurden noch nicht gespeichert. Beim Wechsel gehen sie verloren.', 'The settings of this instance have not been saved yet. They will be lost if you switch.')}
        onConfirm={() => {
          setSettingsDirty(false)
          if (pendingTab) {
            setTab(pendingTab)
            setPendingTab(null)
          }
          if (navBlocked) {
            setNavBlocked(false)
            proceedPendingNavigation()
          }
        }}
        onCancel={() => {
          setPendingTab(null)
          setNavBlocked(false)
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

function OverviewTab({
  instance,
  preflight,
  report,
  checking,
  checkFailed,
  onReport,
  onRefresh
}: {
  instance: InstanceDetail
  preflight: LaunchPreflight | null
  report: CompatibilityReport | null
  checking: boolean
  checkFailed: boolean
  onReport: (report: CompatibilityReport) => void
  onRefresh: () => void
}): JSX.Element {
  const lastSession = instance.sessions[0]

  return (
    <div className="col gap-24">
      <section className="col gap-12">
        <div className="row-between">
          <h2 className="section-title">{tr('Vor dem Start', 'Before launch')}</h2>
          <button className="btn ghost sm" onClick={onRefresh} disabled={checking}>
            {checking ? <span className="spinner" /> : <IconRefresh size={14} />}
            {tr('Neu prüfen', 'Check again')}
          </button>
        </div>

        <div className="preflight-grid">
          <Cell label="Minecraft" value={instance.mcVersion} />
          <Cell
            label="Loader"
            value={`${LOADER_LABELS[instance.loader]}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`}
          />
          <Cell
            label="Java"
            value={
              preflight?.java
                ? `Java ${preflight.java.major}`
                : checkFailed && !preflight
                  ? tr('Nicht geprüft', 'Not checked')
                  : tr('Wird geladen', 'Loading')
            }
            hint={
              preflight?.java
                ? preflight.java.managed
                  ? tr('verwaltet', 'managed')
                  : tr('System', 'system')
                : checkFailed && !preflight
                  ? tr('Neu prüfen oben rechts', 'Use Check again at the top right')
                  : tr('bei Bedarf', 'when needed')
            }
          />
          <Cell
            label="RAM"
            value={formatMemory(instance.settings.memoryMb)}
            hint={preflight ? tr(`von ${formatMemory(preflight.systemMemoryMb)}`, `of ${formatMemory(preflight.systemMemoryMb)}`) : undefined}
          />
          <Cell label="Mods" value={String(preflight?.enabledModCount ?? 0)} hint={tr(`${preflight?.modCount ?? 0} installiert`, `${preflight?.modCount ?? 0} installed`)} />
          <Cell label={tr('Resourcepacks', 'Resource packs')} value={String(preflight?.resourcePackCount ?? 0)} />
          <Cell label={tr('Shader', 'Shaders')} value={String(preflight?.shaderCount ?? 0)} />
          {preflight && preflight.downloadSizeMb > 0 && (
            <Cell label={tr('Noch zu laden', 'Still to download')} value={`${preflight.downloadSizeMb} MB`} />
          )}
        </div>
      </section>

      <section className="col gap-12">
        <h2 className="section-title">{tr('Mod-Kompatibilität', 'Mod compatibility')}</h2>
        <CompatibilityPanel
          report={report}
          instanceId={instance.id}
          loading={checking}
          failed={checkFailed}
          onRetry={onRefresh}
          onChanged={onReport}
        />
      </section>

      <section className="col gap-12">
        <h2 className="section-title">{tr('Statistik', 'Statistics')}</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">{tr('Gesamte Spielzeit', 'Total play time')}</div>
            <div className="stat-value">{formatPlayTime(instance.totalPlayMs)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{tr('Sitzungen', 'Sessions')}</div>
            <div className="stat-value">{instance.sessions.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{tr('Zuletzt gespielt', 'Last played')}</div>
            <div className="stat-value" style={{ fontSize: 16 }}>
              {formatRelative(instance.lastPlayed)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">{tr('Letzte Sitzung', 'Last session')}</div>
            <div className="stat-value" style={{ fontSize: 16 }}>
              {lastSession ? formatPlayTime(lastSession.durationMs) : '-'}
            </div>
          </div>
        </div>

        {instance.sessions.length > 0 && (
          <div className="col gap-8 mt-8">
            {instance.sessions.slice(0, 5).map((session, index) => (
              <div key={index} className="content-row" style={{ padding: '10px 14px' }}>
                <div className="content-icon" style={{ width: 32, height: 32 }}>
                  {session.crashed ? '💥' : '🎮'}
                </div>
                <div className="grow">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {formatDateTime(session.startedAt)}
                  </div>
                  <div className="content-meta">
                    {formatPlayTime(session.durationMs)}
                    {session.crashed && (
                      <span className="badge danger">
                        {typeof session.exitCode === 'number'
                          ? tr(`Absturz (Code ${session.exitCode})`, `Crash (code ${session.exitCode})`)
                          : tr('Absturz', 'Crash')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="preflight-cell">
      <div className="preflight-label">{label}</div>
      <div className="preflight-value">{value}</div>
      {hint && <div className="hint" style={{ marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Installed content
 * ------------------------------------------------------------------ */

const CONTENT_TABS: { id: ContentType; label: string }[] = [
  { id: 'mod', label: tr('Mods', 'Mods') },
  { id: 'resourcepack', label: tr('Resourcepacks', 'Resource packs') },
  { id: 'shaderpack', label: tr('Shader', 'Shaders') },
  { id: 'datapack', label: tr('Data Packs', 'Data packs') }
]

type ContentSortKey = 'name' | 'added' | 'provider'

const CONTENT_SORT_OPTIONS: { value: ContentSortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'added', label: tr('Zuletzt hinzugefügt', 'Recently added') },
  { value: 'provider', label: tr('Anbieter', 'Provider') }
]

function ContentTab({
  instance,
  onChanged,
  blockedReason
}: {
  instance: InstanceDetail
  onChanged: () => Promise<void>
  /** Why mods cannot be changed right now, or null when they can. */
  blockedReason: string | null
}): JSX.Element {
  const [type, setType] = useState<ContentType>('mod')
  const [search, setSearch] = useState('')
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const menu = useContextMenu<ContentItem>()
  const [versionFor, setVersionFor] = useState<ContentItem | null>(null)
  const [confirmUpdate, setConfirmUpdate] = useState<ContentItem | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<ContentItem | null>(null)
  const [worldsFor, setWorldsFor] = useState<ContentItem | null>(null)
  const [sort, setSort] = useState<ContentSortKey>('name')

  const items = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = instance.content
      .filter((c) => c.type === type)
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.fileName.toLowerCase().includes(term))

    switch (sort) {
      case 'added':
        return [...filtered].sort((a, b) => b.installedAt - a.installedAt)
      case 'provider':
        return [...filtered].sort(
          (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name, 'de')
        )
      default:
        return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'de'))
    }
  }, [instance.content, type, search, sort])

  const updates = instance.content.filter((c) => c.update).length

  const checkUpdates = async (): Promise<void> => {
    setChecking(true)
    try {
      const updated = await window.gabi.content.checkUpdates(instance.id)
      const count = updated.content.filter((c) => c.update).length
      toast(
        count > 0 ? 'info' : 'success',
        count > 0
          ? tr(
              `${count} ${pluralise(count, 'Update', 'Updates')} verfügbar`,
              `${count} ${pluralise(count, 'update', 'updates')} available`
            )
          : tr('Alles aktuell', 'Everything is up to date'),
        count > 0
          ? tr('Du kannst einzeln oder alle auf einmal aktualisieren.', 'You can update them one by one or all at once.')
          : undefined
      )
      await onChanged()
    } catch (err) {
      toastError(err, tr('Update-Prüfung fehlgeschlagen', 'Update check failed'))
    } finally {
      setChecking(false)
    }
  }

  const updateAll = async (): Promise<void> => {
    setChecking(true)
    try {
      const count = await window.gabi.content.updateAll(instance.id)
      toast('success', tr(`${count} ${pluralise(count, 'Mod', 'Mods')} aktualisiert`, `${count} ${pluralise(count, 'mod', 'mods')} updated`))
      await onChanged()
    } catch (err) {
      toastError(err, tr('Update fehlgeschlagen', 'Update failed'))
    } finally {
      setChecking(false)
    }
  }

  // Shared by the inline row button and the context menu entry, both of which
  // only ask `setConfirmUpdate` to show the dialog below rather than updating
  // right away. Updating all at once already asks for confirmation through
  // its own explicit "N Updates installieren" button; one mod clicked by
  // itself did not, and a wrong click there quietly replaced a version the
  // user may have picked on purpose.
  const runUpdate = async (item: ContentItem): Promise<void> => {
    setUpdating(item.id)
    try {
      await window.gabi.content.update(instance.id, item.id)
      toast('success', tr(`${item.name} aktualisiert`, `${item.name} updated`))
      await onChanged()
    } catch (err) {
      toastError(err, tr('Update fehlgeschlagen', 'Update failed'))
    } finally {
      setUpdating(null)
    }
  }

  // Also shared by the row button and the context menu entry. Removing a file
  // deletes it from disk for good, so both paths only ask `setConfirmRemove`
  // to show the dialog below instead of removing right away.
  const runRemove = async (item: ContentItem): Promise<void> => {
    try {
      await window.gabi.content.remove(instance.id, item.id)
      toast('info', tr(`${item.name} entfernt`, `${item.name} removed`))
      await onChanged()
    } catch (err) {
      toastError(err, tr('Entfernen fehlgeschlagen', 'Removing failed'))
    } finally {
      setConfirmRemove(null)
    }
  }

  return (
    <div className="col gap-16">
      <div className="row gap-12 wrap">
        <div className="segmented">
          {CONTENT_TABS.map((entry) => {
            const count = instance.content.filter((c) => c.type === entry.id).length
            return (
              <button
                key={entry.id}
                className={type === entry.id ? 'active' : ''}
                onClick={() => setType(entry.id)}
              >
                {entry.label}
                {count > 0 && <span className="tab-count">{count}</span>}
              </button>
            )
          })}
        </div>

        <div className="search" style={{ maxWidth: 260 }}>
          <IconPackage size={15} />
          <input
            className="input"
            placeholder={tr('Filtern…', 'Filter…')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <Segmented value={sort} onChange={setSort} options={CONTENT_SORT_OPTIONS} />

        <div className="grow" />

        <button className="btn sm" onClick={checkUpdates} disabled={checking}>
          {checking ? <span className="spinner" /> : <IconRefresh size={14} />}
          {tr('Auf Updates prüfen', 'Check for updates')}
        </button>

        {updates > 0 && (
          <button
            className="btn sm primary"
            onClick={updateAll}
            disabled={checking || blockedReason !== null}
            title={blockedReason ?? undefined}
          >
            <IconDownload size={14} />
            {tr(
              `${updates} ${pluralise(updates, 'Update', 'Updates')} installieren`,
              `Install ${updates} ${pluralise(updates, 'update', 'updates')}`
            )}
          </button>
        )}

        <button
          className="btn sm"
          onClick={async () => {
            try {
              const added = await window.gabi.content.importFile(instance.id, type)
              if (added.length > 0) {
                toast(
                  'success',
                  tr(
                    `${added.length} ${pluralise(added.length, 'Datei', 'Dateien')} hinzugefügt`,
                    `${added.length} ${pluralise(added.length, 'file', 'files')} added`
                  )
                )
                await onChanged()
              }
            } catch (err) {
              toastError(err, tr('Import fehlgeschlagen', 'Import failed'))
            }
          }}
        >
          <IconUpload size={14} /> {tr('Datei hinzufügen', 'Add file')}
        </button>
      </div>

      {items.length === 0 && search.trim() ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title={tr('Nichts gefunden', 'Nothing found')}
          message={tr(`Nichts passt zu „${search.trim()}“.`, `Nothing matches "${search.trim()}".`)}
          action={
            <button className="btn" onClick={() => setSearch('')}>
              {tr('Filter zurücksetzen', 'Reset filter')}
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title={tr('Nichts installiert', 'Nothing installed')}
          message={tr(
            `Hier landen alle ${CONTENT_TABS.find((t) => t.id === type)?.label} dieser Instanz. Nutze den Tab „Inhalte finden“, um welche zu installieren.`,
            `Everything under ${CONTENT_TABS.find((t) => t.id === type)?.label} in this instance shows up here. Use the "Find content" tab to install some.`
          )}
        />
      ) : (
        <div className="col gap-8">
          {items.map((item) => (
            <ContentRow
              key={item.id}
              item={item}
              instanceId={instance.id}
              blockedReason={blockedReason}
              updating={updating === item.id}
              onContextMenu={(event) => menu.onContextMenu(event, item)}
              onUpdate={() => setConfirmUpdate(item)}
              onEditWorlds={() => setWorldsFor(item)}
              onToggle={async (enabled) => {
                try {
                  await window.gabi.content.toggle(instance.id, item.id, enabled)
                  await onChanged()
                } catch (err) {
                  toastError(err, enabled ? tr('Aktivieren fehlgeschlagen', 'Enabling failed') : tr('Deaktivieren fehlgeschlagen', 'Disabling failed'))
                }
              }}
              onRemove={() => setConfirmRemove(item)}
            />
          ))}
        </div>
      )}

      {menu.open && (
        <ContextMenu
          x={menu.open.x}
          y={menu.open.y}
          onClose={menu.close}
          items={contentMenuItems(menu.open.target, {
            blockedReason,
            onToggle: async (item, enabled) => {
              try {
                await window.gabi.content.toggle(instance.id, item.id, enabled)
                await onChanged()
              } catch (err) {
                toastError(err, enabled ? tr('Aktivieren fehlgeschlagen', 'Enabling failed') : tr('Deaktivieren fehlgeschlagen', 'Disabling failed'))
              }
            },
            onUpdate: (item) => setConfirmUpdate(item),
            onPickVersion: (item) => setVersionFor(item),
            onOpenPage: (item) => void window.gabi.app.openExternal(item.pageUrl as string),
            onRemove: (item) => setConfirmRemove(item)
          })}
        />
      )}

      {versionFor && (
        <VersionPicker
          item={versionFor}
          instanceId={instance.id}
          mcVersion={instance.mcVersion}
          loader={instance.loader}
          onClose={() => setVersionFor(null)}
          onChanged={onChanged}
        />
      )}

      <Confirm
        open={confirmUpdate !== null}
        title={confirmUpdate ? tr(`„${confirmUpdate.name}“ aktualisieren?`, `Update "${confirmUpdate.name}"?`) : ''}
        message={
          confirmUpdate && (
            <>
              {tr(
                `Nur „${confirmUpdate.name}“ auf ${confirmUpdate.update?.versionNumber} aktualisieren? Die bisherige Datei wird dabei entfernt.`,
                `Update only "${confirmUpdate.name}" to ${confirmUpdate.update?.versionNumber}? The previous file will be removed.`
              )}
            </>
          )
        }
        confirmLabel={tr('Ja, aktualisieren', 'Yes, update')}
        cancelLabel={tr('Nein', 'No')}
        onConfirm={async () => {
          const item = confirmUpdate
          setConfirmUpdate(null)
          if (item) await runUpdate(item)
        }}
        onCancel={() => setConfirmUpdate(null)}
      />

      <Confirm
        open={confirmRemove !== null}
        title={confirmRemove ? tr(`„${confirmRemove.name}“ entfernen?`, `Remove "${confirmRemove.name}"?`) : ''}
        danger
        confirmLabel={tr('Entfernen', 'Remove')}
        message={tr(
          'Die Datei wird dabei endgültig gelöscht. Brauchst du es nur vorübergehend nicht, schalte es stattdessen aus.',
          'The file will be deleted permanently. If you only want it out of the way for now, turn it off instead.'
        )}
        onConfirm={() => (confirmRemove ? runRemove(confirmRemove) : Promise.resolve())}
        onCancel={() => setConfirmRemove(null)}
      />

      {worldsFor && (
        <WorldPickerModal
          instanceId={instance.id}
          title={tr(`Welten für ${worldsFor.name}`, `Worlds for ${worldsFor.name}`)}
          initialSelected={worldsFor.worlds ?? []}
          onClose={() => setWorldsFor(null)}
          onConfirm={async (worlds) => {
            try {
              await window.gabi.content.setDatapackWorlds(instance.id, worldsFor.id, worlds)
              toast('success', tr('Welten aktualisiert', 'Worlds updated'), worldsFor.name)
              setWorldsFor(null)
              await onChanged()
            } catch (err) {
              toastError(err, tr('Welten konnten nicht aktualisiert werden', 'Worlds could not be updated'))
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * Builds the right-click entries for one item.
 *
 * Kept out of the component so the list is easy to read and the "why is this
 * greyed out" reason sits next to the entry it belongs to.
 */
function contentMenuItems(
  item: ContentItem,
  handlers: {
    blockedReason: string | null
    onToggle: (item: ContentItem, enabled: boolean) => void
    onUpdate: (item: ContentItem) => void
    onPickVersion: (item: ContentItem) => void
    onOpenPage: (item: ContentItem) => void
    onRemove: (item: ContentItem) => void
  }
): MenuItem[] {
  const blocked = handlers.blockedReason !== null
  const reason = handlers.blockedReason ?? ''
  const local = item.provider === 'local' || !item.projectId

  return [
    {
      label: item.enabled ? tr('Deaktivieren', 'Disable') : tr('Aktivieren', 'Enable'),
      icon: item.enabled ? <IconX size={14} /> : <IconCheck size={14} />,
      disabled: blocked,
      disabledReason: reason,
      onSelect: () => handlers.onToggle(item, !item.enabled)
    },
    {
      label: item.update
        ? tr(`Auf ${item.update.versionNumber} aktualisieren`, `Update to ${item.update.versionNumber}`)
        : tr('Kein Update verfügbar', 'No update available'),
      icon: <IconDownload size={14} />,
      disabled: blocked || !item.update,
      disabledReason: blocked ? reason : tr('Dieser Eintrag ist bereits aktuell.', 'This item is already up to date.'),
      onSelect: () => handlers.onUpdate(item)
    },
    {
      label: tr('Version wählen…', 'Choose version…'),
      icon: <IconLayers size={14} />,
      disabled: blocked || local,
      disabledReason: blocked
        ? reason
        : tr('Diese Datei wurde von Hand hinzugefügt, es gibt keine Versionsliste.', 'This file was added by hand, there is no version list.'),
      onSelect: () => handlers.onPickVersion(item)
    },
    {
      label: tr('Projektseite öffnen', 'Open project page'),
      icon: <IconExternal size={14} />,
      disabled: !item.pageUrl,
      disabledReason: tr('Für diesen Eintrag ist keine Seite hinterlegt.', 'There is no page for this item.'),
      separated: true,
      onSelect: () => handlers.onOpenPage(item)
    },
    {
      label: tr('Entfernen', 'Remove'),
      icon: <IconTrash size={14} />,
      danger: true,
      disabled: blocked,
      disabledReason: reason,
      onSelect: () => handlers.onRemove(item)
    }
  ]
}

function ContentRow({
  item,
  updating,
  blockedReason,
  onUpdate,
  onToggle,
  onRemove,
  onContextMenu,
  onEditWorlds
}: {
  item: ContentItem
  instanceId: string
  updating: boolean
  blockedReason: string | null
  onUpdate: () => void
  onToggle: (enabled: boolean) => void
  onRemove: () => void
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  onEditWorlds: () => void
}): JSX.Element {
  // Every change is refused by the main process while the game is up, so the
  // buttons say so up front instead of letting the click fail.
  const blocked = blockedReason !== null
  const reason = blockedReason ?? ''

  return (
    <div
      className={`content-row ${item.enabled ? '' : 'disabled'}`}
      onContextMenu={onContextMenu}
    >
      {item.iconUrl ? (
        <img className="content-icon" src={item.iconUrl} alt="" loading="lazy" />
      ) : (
        <div className="content-icon">
          <IconPackage size={19} />
        </div>
      )}

      <div className="grow" style={{ overflow: 'hidden' }}>
        <div className="row gap-8">
          <span className="content-name truncate">{item.name}</span>
          <span className={`provider-tag ${item.provider}`}>
            {item.provider === 'modrinth' ? 'MR' : item.provider === 'curseforge' ? 'CF' : tr('LOKAL', 'LOCAL')}
          </span>
          {item.update && <span className="badge warn">Update</span>}
        </div>

        <div className="content-meta">
          {item.version && <span>{item.version}</span>}
          {item.update && (
            <span style={{ color: 'var(--warn)' }}>→ {item.update.versionNumber}</span>
          )}
          {item.size ? <span>{formatBytes(item.size)}</span> : null}
          {item.type === 'datapack' && (
            <span>
              {item.worlds && item.worlds.length > 0
                ? tr(`Welten: ${item.worlds.join(', ')}`, `Worlds: ${item.worlds.join(', ')}`)
                : tr('Keiner Welt zugeordnet', 'Not assigned to any world')}
            </span>
          )}
          <span className="truncate mono" style={{ opacity: 0.6 }}>
            {item.fileName}
          </span>
        </div>
      </div>

      <div className="content-actions">
        {item.type === 'datapack' && (
          <button
            className="btn sm"
            onClick={onEditWorlds}
            disabled={blocked}
            title={blocked ? reason : undefined}
          >
            <IconCube size={13} /> {tr('Welten wählen', 'Choose worlds')}
          </button>
        )}
        {item.update && (
          <button
            className="btn sm primary"
            onClick={onUpdate}
            disabled={updating || blocked}
            title={blocked ? reason : undefined}
          >
            {updating ? <span className="spinner" /> : <IconDownload size={13} />}
            Update
          </button>
        )}
        {item.pageUrl && (
          <button
            className="btn ghost icon sm"
            onClick={() => void window.gabi.app.openExternal(item.pageUrl as string)}
            aria-label={tr('Projektseite', 'Project page')}
          >
            <IconExternal size={14} />
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => onToggle(!item.enabled)}
          disabled={blocked}
          title={blocked ? reason : item.enabled ? tr('Deaktivieren', 'Disable') : tr('Aktivieren', 'Enable')}
        >
          {item.enabled ? tr('An', 'On') : tr('Aus', 'Off')}
        </button>
        <button
          className="btn ghost icon sm"
          onClick={onRemove}
          disabled={blocked}
          title={blocked ? reason : undefined}
          aria-label={tr('Entfernen', 'Remove')}
        >
          <IconTrash size={14} />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Worlds
 * ------------------------------------------------------------------ */

function WorldsTab({ instanceId }: { instanceId: string }): JSX.Element {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)

  useEffect(() => {
    void window.gabi.instances.worlds(instanceId).then(setWorlds).catch(() => setWorlds([]))
  }, [instanceId])

  if (!worlds) return <div className="skeleton" style={{ height: 200 }} />

  if (worlds.length === 0) {
    return (
      <EmptyState
        icon={<IconCube size={26} />}
        title={tr('Noch keine Welten', 'No worlds yet')}
        message={tr('Sobald du in dieser Instanz eine Welt erstellst, erscheint sie hier, inklusive Größe und letztem Spielstand.', 'As soon as you create a world in this instance, it shows up here, including its size and when it was last played.')}
      />
    )
  }

  return (
    <div className="col gap-8">
      {worlds.map((world) => (
        <div key={world.folder} className="content-row">
          <div className="content-icon">🌍</div>
          <div className="grow">
            <div className="content-name">{world.name}</div>
            <div className="content-meta">
              <span>{formatBytes(world.sizeBytes)}</span>
              <span>{tr('Zuletzt', 'Last played')}: {formatRelative(world.lastPlayed)}</span>
            </div>
          </div>
          <div className="content-actions">
            <button className="btn sm" onClick={() => void window.gabi.app.openPath(world.folder)}>
              <IconFolder size={13} /> {tr('Öffnen', 'Open')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Recordings
 *
 * Screenshots and clips share one tab. They are the same thing to the person
 * looking for them: a moment from a session they want back. Minecraft writes
 * the pictures itself on F2, the launcher writes the videos on the recording
 * hotkey, and both land here sorted by when they happened.
 * ------------------------------------------------------------------ */

interface Moment {
  key: string
  at: number
  kind: 'shot' | 'clip'
  file: string
  preview: string | null
  /** Only clips carry these. */
  durationMs?: number
  sizeBytes?: number
}

function RecordingsTab({ instanceId }: { instanceId: string }): JSX.Element {
  const [shots, setShots] = useState<ScreenshotInfo[] | null>(null)
  const [clips, setClips] = useState<RecordingInfo[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<RecordingInfo | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [nextShots, nextClips] = await Promise.all([
      window.gabi.instances.screenshots(instanceId).catch(() => [] as ScreenshotInfo[]),
      window.gabi.instances.recordings(instanceId).catch(() => [] as RecordingInfo[])
    ])
    setShots(nextShots)
    setClips(nextClips)
  }, [instanceId])

  useEffect(() => {
    void load()
  }, [load])

  // A recording that finishes while this tab is open used to leave no trace
  // until the user navigated away and back. The list refreshes on the edge
  // from recording to not recording, which is exactly when a new file exists.
  useEffect(() => {
    // Seeded from the live state: a recording already running when the tab
    // opened never counted as "was active", so its finished clip never showed.
    let wasActive = getState().recording.active
    return window.gabi.events.onRecordingState((state) => {
      if (wasActive && !state.active) void load()
      wasActive = state.active
    })
  }, [load])

  if (!shots || !clips) return <div className="skeleton" style={{ height: 200 }} />

  const moments: Moment[] = [
    ...clips.map((clip) => ({
      key: clip.file,
      at: clip.recordedAt,
      kind: 'clip' as const,
      file: clip.file,
      preview: clip.posterDataUrl,
      durationMs: clip.durationMs,
      sizeBytes: clip.sizeBytes
    })),
    ...shots.map((shot) => ({
      key: shot.file,
      at: shot.takenAt,
      kind: 'shot' as const,
      file: shot.file,
      preview: shot.dataUrl
    }))
  ].sort((a, b) => b.at - a.at)

  const remove = async (clip: RecordingInfo): Promise<void> => {
    try {
      await window.gabi.instances.deleteRecording(instanceId, clip.file)
      toast('success', tr('Aufnahme gelöscht', 'Recording deleted'))
      await load()
    } catch (err) {
      toastError(err, tr('Aufnahme konnte nicht gelöscht werden', 'Recording could not be deleted'))
    } finally {
      setConfirmDelete(null)
    }
  }

  if (moments.length === 0) {
    return (
      <EmptyState
        icon={<IconFilm size={26} />}
        title={tr('Noch nichts aufgenommen', 'Nothing recorded yet')}
        message={tr('Drücke im Spiel F2 für einen Screenshot oder die Aufnahmetaste für ein Video. Beides taucht dann hier auf.', 'Press F2 in game for a screenshot or the recording key for a video. Both show up here.')}
      />
    )
  }

  return (
    <>
      <div className="shot-grid">
        {moments.map((moment) => (
          <div
            key={moment.key}
            className={`shot${moment.kind === 'clip' ? ' is-clip' : ''}`}
            aria-label={tr(
              `${moment.kind === 'clip' ? 'Aufnahme' : 'Screenshot'} ${formatDateTime(moment.at)} öffnen`,
              `Open ${moment.kind === 'clip' ? 'recording' : 'screenshot'} ${formatDateTime(moment.at)}`
            )}
            {...clickable(() => void window.gabi.app.openPath(moment.file))}
          >
            {moment.preview && <img src={moment.preview} alt="" loading="lazy" />}

            {moment.kind === 'clip' && (
              <>
                {/* A clip with no poster would otherwise be an empty tile. */}
                {!moment.preview && (
                  <div className="shot-fallback">
                    <IconFilm size={26} />
                  </div>
                )}
                <span className="shot-badge">
                  <IconFilm size={11} />
                  {moment.durationMs ? formatDuration(moment.durationMs) : 'Video'}
                </span>
                <span className="shot-size">{formatBytes(moment.sizeBytes ?? 0)}</span>
                <button
                  className="shot-remove"
                  title={tr('Aufnahme löschen', 'Delete recording')}
                  aria-label={tr('Aufnahme löschen', 'Delete recording')}
                  onClick={(event) => {
                    // Without this the tile's own click handler fires too and
                    // opens the very video the user is trying to delete.
                    event.stopPropagation()
                    const clip = clips.find((c) => c.file === moment.file)
                    if (clip) setConfirmDelete(clip)
                  }}
                >
                  <IconTrash size={13} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <Confirm
        open={confirmDelete !== null}
        title={tr('Aufnahme löschen', 'Delete recording')}
        message={tr(
          `${confirmDelete?.fileName ?? ''} wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.`,
          `${confirmDelete?.fileName ?? ''} will be deleted permanently. This cannot be undone.`
        )}
        confirmLabel={tr('Löschen', 'Delete')}
        danger
        onConfirm={() => (confirmDelete ? remove(confirmDelete) : Promise.resolve())}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Logs
 * ------------------------------------------------------------------ */

/**
 * When each instance's log was last cleared, for this session. The tab
 * unmounts on every switch and reloads the full history, so without this
 * "Clear" only lasted until the next tab change.
 */
const logClearedAt = new Map<string, number>()

function LogsTab({ instanceId }: { instanceId: string }): JSX.Element {
  const [lines, setLines] = useState<LogLine[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<'all' | 'warn' | 'error'>('all')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    // Switching instances must not carry the previous one's lines into the
    // merge below.
    setLines([])

    void window.gabi.launch
      .logs(instanceId)
      .then((history) => {
        if (cancelled) return
        // The subscription is already live, so lines can land while this fetch
        // is still in flight. Replacing the array outright would discard them,
        // worst exactly when watching a crash happen — so the history goes in
        // front of what already streamed in, minus what it repeats.
        const cutoff = logClearedAt.get(instanceId) ?? 0
        history = history.filter((line) => line.time > cutoff)
        // Queued lines into the state first, so the merge below sees them.
        batcher.flushNow()
        setLines((streamed) => {
          const seen = new Set(history.map((line) => `${line.time}|${line.text}`))
          const fresh = streamed.filter((line) => !seen.has(`${line.time}|${line.text}`))
          return [...history, ...fresh].slice(-1200)
        })
      })
      .catch(() => undefined)

    // One state update per batch rather than per line (see instanceLog.ts),
    // and at most four a second while the game floods the log.
    const batcher = createLineBatcher((mine) => {
      // Lines still held in the batcher when "Leeren" was clicked would
      // otherwise come back a moment later; the clear time decides, as it
      // already does for the history above.
      const cutoff = logClearedAt.get(instanceId) ?? 0
      const fresh = mine.filter((line) => line.time > cutoff)
      if (fresh.length > 0) setLines((current) => [...current, ...fresh].slice(-1200))
    })
    const off = window.gabi.events.onLogLines((batch) => {
      const mine = batch.filter((line) => line.instanceId === instanceId)
      if (mine.length > 0) batcher.push(mine)
    })

    return () => {
      cancelled = true
      off()
      batcher.dispose()
    }
  }, [instanceId])

  useEffect(() => {
    if (autoScroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const shown = lines.filter((line) => {
    if (filter === 'all') return true
    if (filter === 'warn') return line.level === 'warn' || line.level === 'error'
    return line.level === 'error'
  })

  return (
    <div className="col gap-12">
      <div className="row gap-12 wrap">
        <div className="segmented">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            {tr('Alles', 'All')}
          </button>
          <button className={filter === 'warn' ? 'active' : ''} onClick={() => setFilter('warn')}>
            {tr('Warnungen', 'Warnings')}
          </button>
          <button className={filter === 'error' ? 'active' : ''} onClick={() => setFilter('error')}>
            {tr('Fehler', 'Errors')}
          </button>
        </div>

        <button
          className={`btn sm ${autoScroll ? 'primary' : ''}`}
          onClick={() => setAutoScroll((value) => !value)}
        >
          Auto-Scroll
        </button>

        <div className="grow" />

        <button
          className="btn sm"
          onClick={() =>
            void navigator.clipboard
              .writeText(lines.map((l) => l.text).join('\n'))
              .then(() => toast('success', tr('Log kopiert', 'Log copied'), tr(`${lines.length} Zeilen`, `${lines.length} lines`)))
              .catch((err: unknown) => toastError(err, tr('Kopieren fehlgeschlagen', 'Copying failed')))
          }
        >
          {tr('Log kopieren', 'Copy log')}
        </button>
        <button
          className="btn sm"
          onClick={() => {
            logClearedAt.set(instanceId, Date.now())
            setLines([])
          }}
        >
          {tr('Leeren', 'Clear')}
        </button>
      </div>

      <div className="log-view" ref={boxRef}>
        {shown.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            {tr('Noch keine Ausgabe. Starte die Instanz, um das Live-Log zu sehen.', 'No output yet. Start the instance to see the live log.')}
          </div>
        ) : (
          shown.map((line) => <LogRow key={logLineKey(line)} line={line} />)
        )}
      </div>

      <div className="row gap-8">
        <IconTerminal size={14} style={{ color: 'var(--text-4)' }} />
        <span className="hint">
          {tr(
            `${lines.length} Zeilen im Puffer. Das vollständige Log liegt im Instanzordner unter logs/latest.log.`,
            `${lines.length} lines in the buffer. The full log is in the instance folder under logs/latest.log.`
          )}
        </span>
      </div>
    </div>
  )
}
