import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  CompatibilityReport,
  ContentItem,
  ContentType,
  LaunchPreflight,
  LogLine
} from '@shared/types'
import type { InstanceDetail, ScreenshotInfo, WorldInfo } from '@shared/api'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { createShortcut, startInstance, stopInstance } from '../lib/actions'
import { clickable } from '../lib/a11y'
import {
  LOADER_LABELS,
  formatBytes,
  formatDateTime,
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
  IconImage,
  IconLink,
  IconPackage,
  IconPlay,
  IconRefresh,
  IconSave,
  IconStop,
  IconTerminal,
  IconTrash,
  IconUpload,
  IconWrench
} from '../components/Icons'

type Tab = 'overview' | 'content' | 'browse' | 'worlds' | 'screenshots' | 'logs' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'content', label: 'Installiert' },
  { id: 'browse', label: 'Inhalte finden' },
  { id: 'worlds', label: 'Welten' },
  { id: 'screenshots', label: 'Screenshots' },
  { id: 'logs', label: 'Log' },
  { id: 'settings', label: 'Einstellungen' }
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
      toastError(err, 'Instanz konnte nicht geladen werden')
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
      toastError(err, 'Prüfung fehlgeschlagen')
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
        'Reparatur abgeschlossen',
        `${result.checkedFiles} ${pluralise(result.checkedFiles, 'Datei', 'Dateien')} geprüft, ` +
          `${result.repairedFiles} erneuert, ${repaired} ${pluralise(repaired, 'Bereich', 'Bereiche')} korrigiert` +
          (failed > 0 ? `, ${failed} ${pluralise(failed, 'Schritt', 'Schritte')} fehlgeschlagen` : '') +
          '.',
        9000
      )
      await load()
      await runChecks()
    } catch (err) {
      toastError(err, 'Reparatur fehlgeschlagen')
    } finally {
      setRepairing(false)
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await window.gabi.instances.remove(instanceId)
      toast('info', 'Instanz gelöscht', instance?.name)
      await refreshInstances()
      navigate('/instances')
    } catch (err) {
      toastError(err, 'Instanz konnte nicht gelöscht werden')
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
        Alle Instanzen
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
              {modCount > 0 && <span className="badge">{modCount} Mods</span>}
              <span className="badge">RAM: {formatMemory(instance.settings.memoryMb)}</span>
              {updateCount > 0 && <span className="badge warn">{updateCount} Updates</span>}
              {instance.installing && (
                <span className="badge accent">
                  <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  Wird eingerichtet
                </span>
              )}
            </div>
          </div>

          <div className="col gap-10" style={{ alignItems: 'flex-end' }}>
            {running ? (
              <button className="btn-play stop" onClick={() => void stopInstance(instanceId)}>
                <IconStop size={18} /> BEENDEN
              </button>
            ) : (
              <button
                className="btn-play"
                disabled={busy || instance.installing}
                onClick={() => void startInstance(instanceId, instance.name)}
              >
                {busy ? <span className="spinner" /> : <IconPlay size={18} />}
                {busy ? 'STARTET…' : 'PLAY'}
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
          <IconFolder size={14} /> Ordner
        </button>
        <button className="btn sm" onClick={() => void createShortcut(instanceId)}>
          <IconLink size={14} /> Desktop-Verknüpfung
        </button>
        <button className="btn sm" onClick={repair} disabled={repairing || running}>
          {repairing ? <span className="spinner" /> : <IconWrench size={14} />}
          Reparieren
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            try {
              await window.gabi.modpacks.export(instanceId)
            } catch (err) {
              toastError(err, 'Export fehlgeschlagen')
            }
          }}
        >
          <IconUpload size={14} /> Als Modpack exportieren
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            try {
              await window.gabi.backups.create(instanceId, { includes: ['saves', 'config'] })
              toast('success', 'Sicherung erstellt', 'Welten und Konfiguration wurden gesichert.')
            } catch (err) {
              toastError(err, 'Sicherung fehlgeschlagen')
            }
          }}
        >
          <IconSave size={14} /> Sichern
        </button>
        <div className="grow" />
        <button className="btn sm danger" onClick={() => setConfirmDelete(true)} disabled={running}>
          <IconTrash size={14} /> Löschen
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
          onReport={setReport}
          onRefresh={runChecks}
        />
      )}

      {tab === 'content' && (
        <ContentTab instance={instance} onChanged={async () => { await load(); await runChecks() }} />
      )}

      {tab === 'browse' && (
        <ContentBrowser
          instanceId={instanceId}
          mcVersion={instance.mcVersion}
          loader={instance.loader}
          installedProjectIds={instance.content.map((c) => c.projectId ?? '').filter(Boolean)}
          onInstalled={async () => {
            await load()
            await runChecks()
          }}
        />
      )}

      {tab === 'worlds' && <WorldsTab instanceId={instanceId} />}
      {tab === 'screenshots' && <ScreenshotsTab instanceId={instanceId} />}
      {tab === 'logs' && <LogsTab instanceId={instanceId} />}
      {tab === 'settings' && (
        <InstanceSettingsPanel instance={instance} onChanged={load} />
      )}

      <Confirm
        open={confirmDelete}
        title="Instanz löschen?"
        danger
        confirmLabel="Endgültig löschen"
        message={
          <>
            <strong>{instance.name}</strong> wird mit allen Mods, Welten, Screenshots und Sicherungen
            unwiderruflich gelöscht. Das lässt sich nicht rückgängig machen.
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
          <h2 className="section-title">Vor dem Start</h2>
          <button className="btn ghost sm" onClick={onRefresh} disabled={checking}>
            {checking ? <span className="spinner" /> : <IconRefresh size={14} />}
            Neu prüfen
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
            value={preflight?.java ? `Java ${preflight.java.major}` : 'Wird geladen'}
            hint={preflight?.java ? (preflight.java.managed ? 'verwaltet' : 'System') : 'bei Bedarf'}
          />
          <Cell
            label="RAM"
            value={formatMemory(instance.settings.memoryMb)}
            hint={preflight ? `von ${formatMemory(preflight.systemMemoryMb)}` : undefined}
          />
          <Cell label="Mods" value={String(preflight?.enabledModCount ?? 0)} hint={`${preflight?.modCount ?? 0} installiert`} />
          <Cell label="Resourcepacks" value={String(preflight?.resourcePackCount ?? 0)} />
          <Cell label="Shader" value={String(preflight?.shaderCount ?? 0)} />
          {preflight && preflight.downloadSizeMb > 0 && (
            <Cell label="Noch zu laden" value={`${preflight.downloadSizeMb} MB`} />
          )}
        </div>
      </section>

      <section className="col gap-12">
        <h2 className="section-title">Mod-Kompatibilität</h2>
        <CompatibilityPanel
          report={report}
          instanceId={instance.id}
          loading={checking}
          onChanged={onReport}
        />
      </section>

      <section className="col gap-12">
        <h2 className="section-title">Statistik</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Gesamte Spielzeit</div>
            <div className="stat-value">{formatPlayTime(instance.totalPlayMs)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Sitzungen</div>
            <div className="stat-value">{instance.sessions.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Zuletzt gespielt</div>
            <div className="stat-value" style={{ fontSize: 16 }}>
              {formatRelative(instance.lastPlayed)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Letzte Sitzung</div>
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
                    {session.crashed && <span className="badge danger">Absturz (Code {session.exitCode})</span>}
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
  { id: 'mod', label: 'Mods' },
  { id: 'resourcepack', label: 'Resourcepacks' },
  { id: 'shaderpack', label: 'Shader' },
  { id: 'datapack', label: 'Data Packs' }
]

function ContentTab({
  instance,
  onChanged
}: {
  instance: InstanceDetail
  onChanged: () => Promise<void>
}): JSX.Element {
  const [type, setType] = useState<ContentType>('mod')
  const [search, setSearch] = useState('')
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)

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
        count > 0 ? `${count} ${pluralise(count, 'Update', 'Updates')} verfügbar` : 'Alles aktuell',
        count > 0 ? 'Du kannst einzeln oder alle auf einmal aktualisieren.' : undefined
      )
      await onChanged()
    } catch (err) {
      toastError(err, 'Update-Prüfung fehlgeschlagen')
    } finally {
      setChecking(false)
    }
  }

  const updateAll = async (): Promise<void> => {
    setChecking(true)
    try {
      const count = await window.gabi.content.updateAll(instance.id)
      toast('success', `${count} ${pluralise(count, 'Mod', 'Mods')} aktualisiert`)
      await onChanged()
    } catch (err) {
      toastError(err, 'Update fehlgeschlagen')
    } finally {
      setChecking(false)
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
            placeholder="Filtern…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="grow" />

        <button className="btn sm" onClick={checkUpdates} disabled={checking}>
          {checking ? <span className="spinner" /> : <IconRefresh size={14} />}
          Auf Updates prüfen
        </button>

        {updates > 0 && (
          <button className="btn sm primary" onClick={updateAll} disabled={checking}>
            <IconDownload size={14} />
            {updates} {pluralise(updates, 'Update', 'Updates')} installieren
          </button>
        )}

        <button
          className="btn sm"
          onClick={async () => {
            try {
              const added = await window.gabi.content.importFile(instance.id, type)
              if (added.length > 0) {
                toast('success', `${added.length} ${pluralise(added.length, 'Datei', 'Dateien')} hinzugefügt`)
                await onChanged()
              }
            } catch (err) {
              toastError(err, 'Import fehlgeschlagen')
            }
          }}
        >
          <IconUpload size={14} /> Datei hinzufügen
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title="Nichts installiert"
          message={`Hier landen alle ${CONTENT_TABS.find((t) => t.id === type)?.label} dieser Instanz. Nutze den Tab „Inhalte finden", um welche zu installieren.`}
        />
      ) : (
        <div className="col gap-8">
          {items.map((item) => (
            <ContentRow
              key={item.id}
              item={item}
              instanceId={instance.id}
              updating={updating === item.id}
              onUpdate={async () => {
                setUpdating(item.id)
                try {
                  await window.gabi.content.update(instance.id, item.id)
                  toast('success', `${item.name} aktualisiert`)
                  await onChanged()
                } catch (err) {
                  toastError(err, 'Update fehlgeschlagen')
                } finally {
                  setUpdating(null)
                }
              }}
              onToggle={async (enabled) => {
                await window.gabi.content.toggle(instance.id, item.id, enabled)
                await onChanged()
              }}
              onRemove={async () => {
                await window.gabi.content.remove(instance.id, item.id)
                toast('info', `${item.name} entfernt`)
                await onChanged()
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ContentRow({
  item,
  updating,
  onUpdate,
  onToggle,
  onRemove
}: {
  item: ContentItem
  instanceId: string
  updating: boolean
  onUpdate: () => void
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div className={`content-row ${item.enabled ? '' : 'disabled'}`}>
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
            {item.provider === 'modrinth' ? 'MR' : item.provider === 'curseforge' ? 'CF' : 'LOKAL'}
          </span>
          {item.update && <span className="badge warn">Update</span>}
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
          <button className="btn sm primary" onClick={onUpdate} disabled={updating}>
            {updating ? <span className="spinner" /> : <IconDownload size={13} />}
            Update
          </button>
        )}
        {item.pageUrl && (
          <button
            className="btn ghost icon sm"
            onClick={() => void window.gabi.app.openExternal(item.pageUrl as string)}
            aria-label="Projektseite"
          >
            <IconExternal size={14} />
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => onToggle(!item.enabled)}
          title={item.enabled ? 'Deaktivieren' : 'Aktivieren'}
        >
          {item.enabled ? 'An' : 'Aus'}
        </button>
        <button className="btn ghost icon sm" onClick={onRemove} aria-label="Entfernen">
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
        title="Noch keine Welten"
        message="Sobald du in dieser Instanz eine Welt erstellst, erscheint sie hier, inklusive Größe und letztem Spielstand."
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
              <span>Zuletzt: {formatRelative(world.lastPlayed)}</span>
            </div>
          </div>
          <div className="content-actions">
            <button className="btn sm" onClick={() => void window.gabi.app.openPath(world.folder)}>
              <IconFolder size={13} /> Öffnen
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Screenshots
 * ------------------------------------------------------------------ */

function ScreenshotsTab({ instanceId }: { instanceId: string }): JSX.Element {
  const [shots, setShots] = useState<ScreenshotInfo[] | null>(null)

  useEffect(() => {
    void window.gabi.instances.screenshots(instanceId).then(setShots).catch(() => setShots([]))
  }, [instanceId])

  if (!shots) return <div className="skeleton" style={{ height: 200 }} />

  if (shots.length === 0) {
    return (
      <EmptyState
        icon={<IconImage size={26} />}
        title="Keine Screenshots"
        message="Drücke im Spiel F2, um einen Screenshot aufzunehmen. Er taucht dann automatisch hier auf."
      />
    )
  }

  return (
    <div className="shot-grid">
      {shots.map((shot) => (
        <div
          key={shot.file}
          className="shot"
          // The image itself is decorative (alt=""), so without a label here a
          // screen reader would announce this tile as an unnamed button.
          aria-label={`Screenshot ${formatDateTime(shot.takenAt)} öffnen`}
          {...clickable(() => void window.gabi.app.openPath(shot.file))}
        >
          {shot.dataUrl && <img src={shot.dataUrl} alt="" loading="lazy" />}
        </div>
      ))}
    </div>
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
            Alles
          </button>
          <button className={filter === 'warn' ? 'active' : ''} onClick={() => setFilter('warn')}>
            Warnungen
          </button>
          <button className={filter === 'error' ? 'active' : ''} onClick={() => setFilter('error')}>
            Fehler
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
          onClick={() => void navigator.clipboard.writeText(lines.map((l) => l.text).join('\n'))}
        >
          Log kopieren
        </button>
        <button className="btn sm" onClick={() => setLines([])}>
          Leeren
        </button>
      </div>

      <div className="log-view" ref={boxRef}>
        {shown.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            Noch keine Ausgabe. Starte die Instanz, um das Live-Log zu sehen.
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
        <span className="hint">
          {lines.length} Zeilen im Puffer. Das vollständige Log liegt im Instanzordner unter logs/latest.log.
        </span>
      </div>
    </div>
  )
}
