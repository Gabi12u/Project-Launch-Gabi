import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent} from 'react'
import type {
  CompatibilityReport,
  ContentItem,
  ContentType,
  LaunchPreflight,
  LogLine
} from '@shared/types'
import type { InstanceDetail, RecordingInfo, ScreenshotInfo, WorldInfo } from '@shared/api'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { createShortcut, repairInstanceWithOverlay, startInstance, stopInstance } from '../lib/actions'
import { clickable } from '../lib/a11y'
import { t } from '../lib/i18n'
import {
  LOADER_LABELS,
  formatBytes,
  formatDateTime,
  formatDuration,
  contentBlockedReason,
  formatMemory,
  formatPlayTime,
  formatRelative,
  formatTime,
  loaderColor,
  pluralise
} from '../lib/format'
import { Confirm, EmptyState, ProgressBar } from '../components/ui'
import { CompatibilityPanel } from '../components/CompatibilityPanel'
import { ContentBrowser } from '../components/ContentBrowser'
import { InstanceSettingsPanel } from './InstanceSettings'
import {
  IconChevronLeft,
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

type Tab = 'overview' | 'content' | 'browse' | 'worlds' | 'recordings' | 'logs' | 'settings'

// `label` holds an instanceDetail translation key, not display text, so the
// lookup happens at render time and stays reactive to a language switch.
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'tabs.overview' },
  { id: 'content', label: 'tabs.content' },
  { id: 'browse', label: 'tabs.browse' },
  { id: 'worlds', label: 'tabs.worlds' },
  { id: 'recordings', label: 'tabs.recordings' },
  { id: 'logs', label: 'tabs.logs' },
  { id: 'settings', label: 'tabs.settings' }
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [repairing, setRepairing] = useState(false)

  const status = launchStatus[instanceId]
  const running = summary?.running ?? false
  // What the mod controls actually have to obey. `running` alone missed the
  // whole preparation phase after Play, which can last minutes, and missed an
  // update already in flight — the backend refuses in both cases, so the
  // buttons have to know about them too.
  const contentBlocked = summary ? contentBlockedReason(summary) : null
  const busy = starting.includes(instanceId)

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

  const load = useCallback(async (): Promise<void> => {
    try {
      const detail = await window.gabi.instances.get(instanceId)
      if (mounted.current) setInstance(detail)
    } catch (err) {
      if (!mounted.current) return
      toastError(err, t('instanceDetail', 'errors.loadFailed'))
      navigate('/instances')
    }
  }, [instanceId])

  const runChecks = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      const [flight, compat] = await Promise.all([
        window.gabi.launch.preflight(instanceId),
        window.gabi.content.compatibility(instanceId)
      ])
      setPreflight(flight)
      setReport(compat)
    } catch (err) {
      toastError(err, t('instanceDetail', 'errors.checkFailed'))
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
    const instanceName = instance?.name ?? summary?.name ?? instanceId
    try {
      // The overlay this drives lives in the global store, not here, so it
      // stays open even if the user navigates away from this page mid-repair.
      await repairInstanceWithOverlay(instanceId, instanceName)
      await load()
      await runChecks()
    } finally {
      setRepairing(false)
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await window.gabi.instances.remove(instanceId)
      toast('info', t('instanceDetail', 'errors.instanceDeletedTitle'), instance?.name)
      await refreshInstances()
      navigate('/instances')
    } catch (err) {
      toastError(err, t('instanceDetail', 'errors.deleteFailed'))
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
        {t('instanceDetail', 'header.allInstances')}
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
                <span className="badge">{t('instanceDetail', 'header.modsBadge', { count: modCount })}</span>
              )}
              <span className="badge">
                {t('instanceDetail', 'header.ramBadge', { value: formatMemory(instance.settings.memoryMb) })}
              </span>
              {updateCount > 0 && (
                <span className="badge warn">{t('instanceDetail', 'header.updatesBadge', { count: updateCount })}</span>
              )}
              {instance.installing && (
                <span className="badge accent">
                  <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  {t('instanceDetail', 'header.installingBadge')}
                </span>
              )}
            </div>
          </div>

          <div className="col gap-10" style={{ alignItems: 'flex-end' }}>
            {running ? (
              <button className="btn-play stop" onClick={() => void stopInstance(instanceId)}>
                <IconStop size={18} /> {t('instanceDetail', 'header.stopButton')}
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
                {busy ? t('instanceDetail', 'header.startingLabel') : t('instanceDetail', 'header.playLabel')}
              </button>
            )}

            {status && status.phase !== 'idle' && (
              <div className="col gap-6" style={{ width: 260, alignItems: 'flex-end' }}>
                <span className="hint" style={{ textAlign: 'right' }}>
                  {status.detail}
                </span>
                {status.progress !== null && status.phase !== 'running' && (
                  <div style={{ width: '100%' }}>
                    <ProgressBar value={status.progress} />
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
          <IconFolder size={14} /> {t('instanceDetail', 'actions.folder')}
        </button>
        <button className="btn sm" onClick={() => void createShortcut(instanceId)}>
          <IconLink size={14} /> {t('instanceDetail', 'actions.desktopShortcut')}
        </button>
        <button className="btn sm" onClick={repair} disabled={repairing || running}>
          {repairing ? <span className="spinner" /> : <IconWrench size={14} />}
          {t('instanceDetail', 'actions.repair')}
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            try {
              await window.gabi.modpacks.export(instanceId)
            } catch (err) {
              toastError(err, t('instanceDetail', 'actions.exportFailed'))
            }
          }}
        >
          <IconUpload size={14} /> {t('instanceDetail', 'actions.exportModpack')}
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            try {
              await window.gabi.backups.create(instanceId, { includes: ['saves', 'config'] })
              toast(
                'success',
                t('instanceDetail', 'actions.backupCreatedTitle'),
                t('instanceDetail', 'actions.backupCreatedMessage')
              )
            } catch (err) {
              toastError(err, t('instanceDetail', 'actions.backupFailed'))
            }
          }}
        >
          <IconSave size={14} /> {t('instanceDetail', 'actions.backupButton')}
        </button>
        <div className="grow" />
        <button className="btn sm danger" onClick={() => setConfirmDelete(true)} disabled={running}>
          <IconTrash size={14} /> {t('common', 'delete')}
        </button>
      </div>

      {/* --- Tabs ---------------------------------------------------- */}
      <div className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={`tab ${tab === entry.id ? 'active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {t('instanceDetail', entry.label)}
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
        <InstanceSettingsPanel instance={instance} onChanged={load} />
      )}

      <Confirm
        open={confirmDelete}
        title={t('instanceDetail', 'dialog.deleteInstanceTitle')}
        danger
        confirmLabel={t('instanceDetail', 'dialog.deleteInstanceConfirm')}
        message={
          <>
            <strong>{instance.name}</strong> {t('instanceDetail', 'dialog.deleteInstanceMessage')}
          </>
        }
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
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
  onReport,
  onRefresh
}: {
  instance: InstanceDetail
  preflight: LaunchPreflight | null
  report: CompatibilityReport | null
  checking: boolean
  onReport: (report: CompatibilityReport) => void
  onRefresh: () => void
}): JSX.Element {
  const lastSession = instance.sessions[0]

  return (
    <div className="col gap-24">
      <section className="col gap-12">
        <div className="row-between">
          <h2 className="section-title">{t('instanceDetail', 'overview.preflightTitle')}</h2>
          <button className="btn ghost sm" onClick={onRefresh} disabled={checking}>
            {checking ? <span className="spinner" /> : <IconRefresh size={14} />}
            {t('instanceDetail', 'overview.recheckButton')}
          </button>
        </div>

        <div className="preflight-grid">
          <Cell label="Minecraft" value={instance.mcVersion} />
          <Cell
            label={t('instanceDetail', 'overview.loaderLabel')}
            value={`${LOADER_LABELS[instance.loader]}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`}
          />
          <Cell
            label="Java"
            value={preflight?.java ? `Java ${preflight.java.major}` : t('instanceDetail', 'overview.javaLoadingValue')}
            hint={
              preflight?.java
                ? preflight.java.managed
                  ? t('instanceDetail', 'overview.javaManagedHint')
                  : t('instanceDetail', 'overview.javaSystemHint')
                : t('instanceDetail', 'overview.javaOnDemandHint')
            }
          />
          <Cell
            label={t('instanceDetail', 'overview.ramLabel')}
            value={formatMemory(instance.settings.memoryMb)}
            hint={
              preflight
                ? t('instanceDetail', 'overview.ramOfHint', { total: formatMemory(preflight.systemMemoryMb) })
                : undefined
            }
          />
          <Cell
            label={t('instanceDetail', 'overview.modsLabel')}
            value={String(preflight?.enabledModCount ?? 0)}
            hint={t('instanceDetail', 'overview.modsInstalledHint', { count: preflight?.modCount ?? 0 })}
          />
          <Cell label={t('instanceDetail', 'overview.resourcepacksLabel')} value={String(preflight?.resourcePackCount ?? 0)} />
          <Cell label={t('instanceDetail', 'overview.shaderLabel')} value={String(preflight?.shaderCount ?? 0)} />
          {preflight && preflight.downloadSizeMb > 0 && (
            <Cell label={t('instanceDetail', 'overview.downloadSizeLabel')} value={`${preflight.downloadSizeMb} MB`} />
          )}
        </div>
      </section>

      <section className="col gap-12">
        <h2 className="section-title">{t('instanceDetail', 'overview.compatibilityTitle')}</h2>
        <CompatibilityPanel
          report={report}
          instanceId={instance.id}
          loading={checking}
          onChanged={onReport}
        />
      </section>

      <section className="col gap-12">
        <h2 className="section-title">{t('instanceDetail', 'overview.statsTitle')}</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">{t('instanceDetail', 'overview.totalPlaytimeLabel')}</div>
            <div className="stat-value">{formatPlayTime(instance.totalPlayMs)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t('instanceDetail', 'overview.sessionsLabel')}</div>
            <div className="stat-value">{instance.sessions.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t('instanceDetail', 'overview.lastPlayedLabel')}</div>
            <div className="stat-value" style={{ fontSize: 16 }}>
              {formatRelative(instance.lastPlayed)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">{t('instanceDetail', 'overview.lastSessionLabel')}</div>
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
                        {t('instanceDetail', 'overview.crashBadge', {
                          code: session.exitCode ?? t('common', 'unknown')
                        })}
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

// `label` holds an instanceDetail translation key, not display text, so the
// lookup happens at render time and stays reactive to a language switch.
const CONTENT_TABS: { id: ContentType; label: string }[] = [
  { id: 'mod', label: 'contentTabs.mod' },
  { id: 'resourcepack', label: 'contentTabs.resourcepack' },
  { id: 'shaderpack', label: 'contentTabs.shaderpack' },
  { id: 'datapack', label: 'contentTabs.datapack' }
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

  const items = useMemo(() => {
    const term = search.trim().toLowerCase()
    return instance.content
      .filter((c) => c.type === type)
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.fileName.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }, [instance.content, type, search])

  const updates = instance.content.filter((c) => c.update).length

  const checkUpdates = async (): Promise<void> => {
    setChecking(true)
    try {
      const updated = await window.gabi.content.checkUpdates(instance.id)
      const count = updated.content.filter((c) => c.update).length
      toast(
        count > 0 ? 'info' : 'success',
        count > 0
          ? t('instanceDetail', 'content.updatesAvailableTitle', {
              count,
              word: pluralise(
                count,
                t('instanceDetail', 'content.updateWord.one'),
                t('instanceDetail', 'content.updateWord.many')
              )
            })
          : t('instanceDetail', 'content.upToDateTitle'),
        count > 0 ? t('instanceDetail', 'content.updatesAvailableMessage') : undefined
      )
      await onChanged()
    } catch (err) {
      toastError(err, t('instanceDetail', 'content.checkUpdatesFailed'))
    } finally {
      setChecking(false)
    }
  }

  const updateAll = async (): Promise<void> => {
    setChecking(true)
    try {
      const count = await window.gabi.content.updateAll(instance.id)
      toast(
        'success',
        t('instanceDetail', 'content.modsUpdatedTitle', {
          count,
          word: pluralise(count, t('instanceDetail', 'content.modWord.one'), t('instanceDetail', 'content.modWord.many'))
        })
      )
      await onChanged()
    } catch (err) {
      toastError(err, t('instanceDetail', 'content.updateFailed'))
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
      toast('success', t('instanceDetail', 'content.itemUpdatedTitle', { name: item.name }))
      await onChanged()
    } catch (err) {
      toastError(err, t('instanceDetail', 'content.updateFailed'))
    } finally {
      setUpdating(null)
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
                {t('instanceDetail', entry.label)}
                {count > 0 && <span className="tab-count">{count}</span>}
              </button>
            )
          })}
        </div>

        <div className="search" style={{ maxWidth: 260 }}>
          <IconPackage size={15} />
          <input
            className="input"
            placeholder={t('instanceDetail', 'content.filterPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="grow" />

        <button className="btn sm" onClick={checkUpdates} disabled={checking}>
          {checking ? <span className="spinner" /> : <IconRefresh size={14} />}
          {t('instanceDetail', 'content.checkUpdatesButton')}
        </button>

        {updates > 0 && (
          <button
            className="btn sm primary"
            onClick={updateAll}
            disabled={checking || blockedReason !== null}
            title={blockedReason ?? undefined}
          >
            <IconDownload size={14} />
            {t('instanceDetail', 'content.installUpdatesButton', {
              count: updates,
              word: pluralise(
                updates,
                t('instanceDetail', 'content.updateWord.one'),
                t('instanceDetail', 'content.updateWord.many')
              )
            })}
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
                  t('instanceDetail', 'content.filesAddedTitle', {
                    count: added.length,
                    word: pluralise(
                      added.length,
                      t('instanceDetail', 'content.fileWord.one'),
                      t('instanceDetail', 'content.fileWord.many')
                    )
                  })
                )
                await onChanged()
              }
            } catch (err) {
              toastError(err, t('instanceDetail', 'content.importFailed'))
            }
          }}
        >
          <IconUpload size={14} /> {t('instanceDetail', 'content.addFileButton')}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title={t('instanceDetail', 'content.emptyTitle')}
          message={t('instanceDetail', 'content.emptyMessage', {
            type: t('instanceDetail', CONTENT_TABS.find((entry) => entry.id === type)?.label ?? '')
          })}
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
              onToggle={async (enabled) => {
                await window.gabi.content.toggle(instance.id, item.id, enabled)
                await onChanged()
              }}
              onRemove={async () => {
                await window.gabi.content.remove(instance.id, item.id)
                toast('info', t('instanceDetail', 'content.itemRemovedTitle', { name: item.name }))
                await onChanged()
              }}
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
                toastError(
                  err,
                  enabled
                    ? t('instanceDetail', 'content.activateFailed')
                    : t('instanceDetail', 'content.deactivateFailed')
                )
              }
            },
            onUpdate: (item) => setConfirmUpdate(item),
            onPickVersion: (item) => setVersionFor(item),
            onOpenPage: (item) => void window.gabi.app.openExternal(item.pageUrl as string),
            onRemove: async (item) => {
              try {
                await window.gabi.content.remove(instance.id, item.id)
                toast('info', t('instanceDetail', 'content.itemRemovedTitle', { name: item.name }))
                await onChanged()
              } catch (err) {
                toastError(err, t('instanceDetail', 'content.removeFailed'))
              }
            }
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
        title={t('instanceDetail', 'content.confirmUpdateTitle')}
        message={
          confirmUpdate &&
          t('instanceDetail', 'content.confirmUpdateMessage', {
            name: confirmUpdate.name,
            version: confirmUpdate.update?.versionNumber ?? ''
          })
        }
        confirmLabel={t('instanceDetail', 'content.confirmUpdateYes')}
        cancelLabel={t('common', 'no')}
        onConfirm={async () => {
          const item = confirmUpdate
          setConfirmUpdate(null)
          if (item) await runUpdate(item)
        }}
        onCancel={() => setConfirmUpdate(null)}
      />
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
      label: item.enabled ? t('instanceDetail', 'content.deactivate') : t('instanceDetail', 'content.activate'),
      icon: item.enabled ? <IconX size={14} /> : <IconCheck size={14} />,
      disabled: blocked,
      disabledReason: reason,
      onSelect: () => handlers.onToggle(item, !item.enabled)
    },
    {
      label: item.update
        ? t('instanceDetail', 'content.menuUpdateToLabel', { version: item.update.versionNumber })
        : t('instanceDetail', 'content.menuNoUpdateLabel'),
      icon: <IconDownload size={14} />,
      disabled: blocked || !item.update,
      disabledReason: blocked ? reason : t('instanceDetail', 'content.menuAlreadyUpToDateReason'),
      onSelect: () => handlers.onUpdate(item)
    },
    {
      label: t('instanceDetail', 'content.menuChooseVersionLabel'),
      icon: <IconLayers size={14} />,
      disabled: blocked || local,
      disabledReason: blocked
        ? reason
        : t('instanceDetail', 'content.menuNoVersionListReason'),
      onSelect: () => handlers.onPickVersion(item)
    },
    {
      label: t('instanceDetail', 'content.menuOpenPageLabel'),
      icon: <IconExternal size={14} />,
      disabled: !item.pageUrl,
      disabledReason: t('instanceDetail', 'content.menuNoPageReason'),
      separated: true,
      onSelect: () => handlers.onOpenPage(item)
    },
    {
      label: t('common', 'remove'),
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
  onContextMenu
}: {
  item: ContentItem
  instanceId: string
  updating: boolean
  blockedReason: string | null
  onUpdate: () => void
  onToggle: (enabled: boolean) => void
  onRemove: () => void
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void
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
            {item.provider === 'modrinth'
              ? 'MR'
              : item.provider === 'curseforge'
                ? 'CF'
                : t('instanceDetail', 'content.providerLocal')}
          </span>
          {item.update && <span className="badge warn">{t('instanceDetail', 'content.updateWord')}</span>}
        </div>

        <div className="content-meta">
          {item.version && <span>{item.version}</span>}
          {item.update && (
            <span style={{ color: 'var(--warn)' }}>→ {item.update.versionNumber}</span>
          )}
          {item.size ? <span>{formatBytes(item.size)}</span> : null}
          <span className="truncate mono" style={{ opacity: 0.6 }}>
            {item.fileName}
          </span>
        </div>
      </div>

      <div className="content-actions">
        {item.update && (
          <button
            className="btn sm primary"
            onClick={onUpdate}
            disabled={updating || blocked}
            title={blocked ? reason : undefined}
          >
            {updating ? <span className="spinner" /> : <IconDownload size={13} />}
            {t('instanceDetail', 'content.updateWord')}
          </button>
        )}
        {item.pageUrl && (
          <button
            className="btn ghost icon sm"
            onClick={() => void window.gabi.app.openExternal(item.pageUrl as string)}
            aria-label={t('instanceDetail', 'content.projectPageAria')}
          >
            <IconExternal size={14} />
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => onToggle(!item.enabled)}
          disabled={blocked}
          title={
            blocked
              ? reason
              : item.enabled
                ? t('instanceDetail', 'content.deactivate')
                : t('instanceDetail', 'content.activate')
          }
        >
          {item.enabled ? t('instanceDetail', 'content.onLabel') : t('instanceDetail', 'content.offLabel')}
        </button>
        <button
          className="btn ghost icon sm"
          onClick={onRemove}
          disabled={blocked}
          title={blocked ? reason : undefined}
          aria-label={t('common', 'remove')}
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
        title={t('instanceDetail', 'worlds.emptyTitle')}
        message={t('instanceDetail', 'worlds.emptyMessage')}
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
              <span>{t('instanceDetail', 'worlds.lastPlayedLabel', { time: formatRelative(world.lastPlayed) })}</span>
            </div>
          </div>
          <div className="content-actions">
            <button className="btn sm" onClick={() => void window.gabi.app.openPath(world.folder)}>
              <IconFolder size={13} /> {t('common', 'open')}
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
    let wasActive = false
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
      toast('success', t('instanceDetail', 'recordings.deletedTitle'))
      await load()
    } catch (err) {
      toastError(err, t('instanceDetail', 'recordings.deleteFailed'))
    } finally {
      setConfirmDelete(null)
    }
  }

  if (moments.length === 0) {
    return (
      <EmptyState
        icon={<IconFilm size={26} />}
        title={t('instanceDetail', 'recordings.emptyTitle')}
        message={t('instanceDetail', 'recordings.emptyMessage')}
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
            aria-label={t('instanceDetail', 'recordings.openAria', {
              kind:
                moment.kind === 'clip'
                  ? t('instanceDetail', 'recordings.kindClip')
                  : t('instanceDetail', 'recordings.kindShot'),
              time: formatDateTime(moment.at)
            })}
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
                  {moment.durationMs ? formatDuration(moment.durationMs) : t('instanceDetail', 'recordings.videoFallback')}
                </span>
                <span className="shot-size">{formatBytes(moment.sizeBytes ?? 0)}</span>
                <button
                  className="shot-remove"
                  title={t('instanceDetail', 'recordings.deleteButtonTitle')}
                  aria-label={t('instanceDetail', 'recordings.deleteButtonTitle')}
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
        title={t('instanceDetail', 'recordings.deleteButtonTitle')}
        message={t('instanceDetail', 'recordings.confirmDeleteMessage', { fileName: confirmDelete?.fileName ?? '' })}
        confirmLabel={t('common', 'delete')}
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
        setLines((streamed) => {
          const seen = new Set(history.map((line) => `${line.time}|${line.text}`))
          const fresh = streamed.filter((line) => !seen.has(`${line.time}|${line.text}`))
          return [...history, ...fresh].slice(-1200)
        })
      })
      .catch(() => undefined)

    const off = window.gabi.events.onLogLine((line) => {
      if (line.instanceId !== instanceId) return
      setLines((current) => [...current, line].slice(-1200))
    })

    return () => {
      cancelled = true
      off()
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
            {t('instanceDetail', 'logs.filterAll')}
          </button>
          <button className={filter === 'warn' ? 'active' : ''} onClick={() => setFilter('warn')}>
            {t('instanceDetail', 'logs.filterWarnings')}
          </button>
          <button className={filter === 'error' ? 'active' : ''} onClick={() => setFilter('error')}>
            {t('instanceDetail', 'logs.filterErrors')}
          </button>
        </div>

        <button
          className={`btn sm ${autoScroll ? 'primary' : ''}`}
          onClick={() => setAutoScroll((value) => !value)}
        >
          {t('instanceDetail', 'logs.autoScrollButton')}
        </button>

        <div className="grow" />

        <button
          className="btn sm"
          onClick={() => void navigator.clipboard.writeText(lines.map((l) => l.text).join('\n'))}
        >
          {t('instanceDetail', 'logs.copyButton')}
        </button>
        <button className="btn sm" onClick={() => setLines([])}>
          {t('instanceDetail', 'logs.clearButton')}
        </button>
      </div>

      <div className="log-view" ref={boxRef}>
        {shown.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            {t('instanceDetail', 'logs.emptyMessage')}
          </div>
        ) : (
          shown.map((line, index) => (
            <div key={index} className={`log-line ${line.stream === 'launcher' ? 'launcher' : line.level}`}>
              <span className="log-time">{formatTime(line.time)}</span>
              <span>{line.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="row gap-8">
        <IconTerminal size={14} style={{ color: 'var(--text-4)' }} />
        <span className="hint">{t('instanceDetail', 'logs.bufferHint', { count: lines.length })}</span>
      </div>
    </div>
  )
}
