import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { ContentItem, InstanceSummary } from '@shared/types'
import { getState, navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { LOADER_LABELS, formatBytes, formatRelative, loaderColor, pluralise } from '../lib/format'
import { EmptyState } from '../components/ui'
import {
  IconChevronRight,
  IconDownload,
  IconExternal,
  IconPackage,
  IconRefresh,
  IconSearch,
  IconSparkle
} from '../components/Icons'

interface Row {
  instance: InstanceSummary
  item: ContentItem
}

/**
 * Cross-instance mod overview: one place to see everything installed and to
 * apply every pending update without walking through each instance.
 */
export function ModsView(): JSX.Element {
  const { instances } = useStore()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyUpdates, setOnlyUpdates] = useState(false)
  const [instanceFilter, setInstanceFilter] = useState('all')
  const requestId = useRef(0)

  // Keyed by the instance ids rather than the array itself: the list object is
  // replaced on every refresh, which would otherwise reload on each render.
  const instanceKey = instances.map((i) => i.id).join(',')

  const load = useCallback(async (): Promise<void> => {
    // One fetch per instance, so this runs long enough for an added or deleted
    // instance to restart it mid-loop. Without the guard a slower earlier pass
    // could finish last and put rows for a since-deleted instance back.
    const request = ++requestId.current
    setLoading(true)
    try {
      const collected: Row[] = []
      for (const instance of getState().instances) {
        const detail = await window.gabi.instances.get(instance.id)
        for (const item of detail.content) {
          collected.push({ instance, item })
        }
      }
      if (request === requestId.current) setRows(collected)
    } catch (err) {
      if (request === requestId.current) toastError(err, 'Mods konnten nicht geladen werden')
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [instanceKey])

  useEffect(() => {
    void load()
  }, [load])

  const checkAll = async (): Promise<void> => {
    setChecking(true)
    try {
      let total = 0
      for (const instance of instances) {
        const updated = await window.gabi.content.checkUpdates(instance.id)
        total += updated.content.filter((c) => c.update).length
      }
      toast(
        total > 0 ? 'info' : 'success',
        total > 0 ? `${total} Updates gefunden` : 'Alles aktuell',
        total > 0 ? 'Du kannst sie einzeln oder pro Instanz installieren.' : undefined
      )
      await refreshInstances()
      await load()
    } catch (err) {
      toastError(err, 'Update-Prüfung fehlgeschlagen')
    } finally {
      setChecking(false)
    }
  }

  const updateEverything = async (): Promise<void> => {
    setChecking(true)
    try {
      let total = 0
      for (const instance of instances) {
        if (instance.updateCount === 0) continue
        total += await window.gabi.content.updateAll(instance.id)
      }
      toast('success', `${total} Mods aktualisiert`)
      await refreshInstances()
      await load()
    } catch (err) {
      toastError(err, 'Update fehlgeschlagen')
    } finally {
      setChecking(false)
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows
      .filter((row) => {
        if (onlyUpdates && !row.item.update) return false
        if (instanceFilter !== 'all' && row.instance.id !== instanceFilter) return false
        if (!term) return true
        return (
          row.item.name.toLowerCase().includes(term) ||
          row.item.fileName.toLowerCase().includes(term) ||
          row.instance.name.toLowerCase().includes(term)
        )
      })
      .sort((a, b) => {
        if (Boolean(a.item.update) !== Boolean(b.item.update)) return a.item.update ? -1 : 1
        return a.item.name.localeCompare(b.item.name, 'de')
      })
  }, [rows, search, onlyUpdates, instanceFilter])

  const totalUpdates = rows.filter((r) => r.item.update).length

  return (
    <div className="col gap-24">
      <header className="row-between wrap">
        <div>
          <h1 className="page-title">Mods</h1>
          <p className="page-sub">
            Alle Inhalte über sämtliche Instanzen hinweg — {rows.length}{' '}
            {pluralise(rows.length, 'Eintrag', 'Einträge')}
            {totalUpdates > 0 ? `, ${totalUpdates} Updates verfügbar` : ''}.
          </p>
        </div>

        <div className="row gap-8">
          <button className="btn" onClick={checkAll} disabled={checking || instances.length === 0}>
            {checking ? <span className="spinner" /> : <IconRefresh size={16} />}
            Auf Updates prüfen
          </button>
          {totalUpdates > 0 && (
            <button className="btn primary" onClick={updateEverything} disabled={checking}>
              <IconSparkle size={16} />
              {totalUpdates} Updates installieren
            </button>
          )}
        </div>
      </header>

      {instances.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title="Keine Instanzen"
          message="Sobald du eine Instanz mit Mods hast, siehst du hier alles auf einen Blick."
          action={
            <button className="btn primary" onClick={() => navigate('/instances')}>
              Zu den Instanzen
            </button>
          }
        />
      ) : (
        <>
          <div className="row gap-12 wrap">
            <div className="search" style={{ maxWidth: 320 }}>
              <IconSearch size={16} />
              <input
                className="input"
                placeholder="Mods durchsuchen…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <select
              className="select"
              style={{ width: 220 }}
              value={instanceFilter}
              onChange={(event) => setInstanceFilter(event.target.value)}
            >
              <option value="all">Alle Instanzen</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>

            <button
              className={`btn ${onlyUpdates ? 'primary' : ''}`}
              onClick={() => setOnlyUpdates((value) => !value)}
            >
              Nur mit Update
            </button>
          </div>

          {loading ? (
            <div className="col gap-8">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 68 }} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<IconPackage size={26} />}
              title="Noch keine Mods installiert"
              message="Hier sammeln sich alle Mods, Resourcepacks und Shader aus deinen Instanzen. Such dir unter „Entdecken“ etwas aus — Launch Gabi installiert Abhängigkeiten automatisch mit."
              action={
                <button className="btn primary" onClick={() => navigate('/discover')}>
                  <IconSearch size={16} />
                  Mods entdecken
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<IconPackage size={26} />}
              title={onlyUpdates ? 'Alles aktuell' : 'Nichts gefunden'}
              message={
                onlyUpdates
                  ? 'Für keine deiner Instanzen liegen Updates vor.'
                  : 'Keine Inhalte passen zu diesem Filter.'
              }
            />
          ) : (
            <div className="col gap-8">
              {filtered.map((row) => (
                <div key={`${row.instance.id}-${row.item.id}`} className={`content-row ${row.item.enabled ? '' : 'disabled'}`}>
                  {row.item.iconUrl ? (
                    <img className="content-icon" src={row.item.iconUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="content-icon">
                      <IconPackage size={19} />
                    </div>
                  )}

                  <div className="grow" style={{ overflow: 'hidden' }}>
                    <div className="row gap-8">
                      <span className="content-name truncate">{row.item.name}</span>
                      <span className={`provider-tag ${row.item.provider}`}>
                        {row.item.provider === 'modrinth'
                          ? 'MR'
                          : row.item.provider === 'curseforge'
                            ? 'CF'
                            : 'LOKAL'}
                      </span>
                      {row.item.update && <span className="badge warn">Update</span>}
                      {!row.item.enabled && <span className="badge">Deaktiviert</span>}
                    </div>

                    <div className="content-meta">
                      <button
                        className="link"
                        onClick={() => navigate(`/instances/${row.instance.id}`)}
                        style={{ background: 'none', padding: 0 }}
                      >
                        {row.instance.name}
                      </button>
                      <span
                        className="loader-chip"
                        style={{ ['--loader-color' as string]: loaderColor(row.instance.loader) }}
                      >
                        {LOADER_LABELS[row.instance.loader]} {row.instance.mcVersion}
                      </span>
                      {row.item.version && <span>{row.item.version}</span>}
                      {row.item.update && (
                        <span style={{ color: 'var(--warn)' }}>→ {row.item.update.versionNumber}</span>
                      )}
                      {row.item.size ? <span>{formatBytes(row.item.size)}</span> : null}
                      <span>{formatRelative(row.item.installedAt)}</span>
                    </div>
                  </div>

                  <div className="content-actions">
                    {row.item.update && (
                      <button
                        className="btn sm primary"
                        disabled={updating === row.item.id}
                        onClick={async () => {
                          setUpdating(row.item.id)
                          try {
                            await window.gabi.content.update(row.instance.id, row.item.id)
                            toast('success', `${row.item.name} aktualisiert`)
                            await refreshInstances()
                            await load()
                          } catch (err) {
                            toastError(err, 'Update fehlgeschlagen')
                          } finally {
                            setUpdating(null)
                          }
                        }}
                      >
                        {updating === row.item.id ? <span className="spinner" /> : <IconDownload size={13} />}
                        Update
                      </button>
                    )}
                    {row.item.pageUrl && (
                      <button
                        className="btn ghost icon sm"
                        onClick={() => void window.gabi.app.openExternal(row.item.pageUrl as string)}
                        aria-label="Projektseite"
                      >
                        <IconExternal size={14} />
                      </button>
                    )}
                    <button
                      className="btn ghost icon sm"
                      onClick={() => navigate(`/instances/${row.instance.id}?tab=content`)}
                      aria-label="In der Instanz öffnen"
                    >
                      <IconChevronRight size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
