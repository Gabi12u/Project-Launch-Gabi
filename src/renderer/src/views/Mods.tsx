import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { ContentItem, InstanceSummary } from '@shared/types'
import { getState, navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import {
  LOADER_LABELS,
  contentBlockedReason as blockedReason,
  formatBytes,
  formatRelative,
  loaderColor,
  pluralise
} from '../lib/format'
import { EmptyState } from '../components/ui'
import { DiscoverView } from './Discover'
import { t } from '../lib/i18n'
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
 * Mods, both halves of it: what is installed across every instance, and the
 * Modrinth/CurseForge browser that used to be its own "Entdecken" entry in
 * the navigation. One page, two tabs, because looking for a mod and looking
 * at the ones you have are the same errand.
 */
export function ModsView({ query }: { query?: URLSearchParams }): JSX.Element {
  const wanted = query?.get('tab')
  const [tab, setTab] = useState<'installed' | 'discover'>(
    wanted === 'discover' ? 'discover' : 'installed'
  )

  // A link can land here while the page is already open, so the tab follows
  // the query rather than only seeding from it once.
  useEffect(() => {
    if (wanted === 'discover' || wanted === 'installed') setTab(wanted)
  }, [wanted])

  return (
    <div className="col gap-20">
      <header>
        <h1 className="page-title">{t('mods', 'page.title')}</h1>
        <p className="page-sub">{t('mods', 'page.subtitle')}</p>
      </header>

      <div className="segmented" style={{ alignSelf: 'flex-start' }}>
        <button className={tab === 'installed' ? 'active' : ''} onClick={() => setTab('installed')}>
          {t('mods', 'tabs.installed')}
        </button>
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>
          {t('mods', 'tabs.discover')}
        </button>
      </div>

      {tab === 'installed' ? (
        <InstalledMods />
      ) : (
        <DiscoverView query={query ?? new URLSearchParams()} embedded />
      )}
    </div>
  )
}

/**
 * Everything installed across every instance, with every pending update
 * appliable without walking through the instances one by one.
 */
function InstalledMods(): JSX.Element {
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
      if (request === requestId.current) toastError(err, t('mods', 'toast.loadFailed'))
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
      // Each instance is caught on its own. A single failure used to break out
      // of the loop, so every instance after it was silently skipped while the
      // toast gave no hint that the check had been left half done.
      const failed: string[] = []
      for (const instance of instances) {
        try {
          const updated = await window.gabi.content.checkUpdates(instance.id)
          total += updated.content.filter((c) => c.update).length
        } catch {
          failed.push(instance.name)
        }
      }

      if (failed.length > 0) {
        toast(
          'warning',
          t('mods', 'toast.checkFailedTitle', {
            count: failed.length,
            unit: pluralise(failed.length, t('mods', 'unit.instance'), t('mods', 'unit.instances'))
          }),
          t('mods', 'toast.checkFailedBody', {
            count: total,
            unit: pluralise(total, t('mods', 'unit.update'), t('mods', 'unit.updates')),
            names: failed.slice(0, 3).join(', '),
            more: failed.length > 3 ? t('mods', 'toast.andMore') : ''
          }),
          8000
        )
      } else {
        toast(
          total > 0 ? 'info' : 'success',
          total > 0
            ? t('mods', 'toast.updatesFoundTitle', {
                count: total,
                unit: pluralise(total, t('mods', 'unit.update'), t('mods', 'unit.updates'))
              })
            : t('mods', 'toast.upToDateTitle'),
          total > 0 ? t('mods', 'toast.updatesFoundBody') : undefined
        )
      }
      await refreshInstances()
      await load()
    } catch (err) {
      toastError(err, t('mods', 'toast.checkError'))
    } finally {
      setChecking(false)
    }
  }

  // Instances that actually could be updated right now, so the bulk button can
  // grey itself out instead of promising work it will skip.
  const updatableInstances = instances.filter(
    (i) => i.updateCount > 0 && blockedReason(i) === null
  )

  const updateEverything = async (): Promise<void> => {
    setChecking(true)
    try {
      let total = 0
      // Same reasoning as the check above: one broken instance must not stop
      // the others from being updated.
      const failed: string[] = []
      // The reason is kept, not just the name. This used to report only which
      // instances failed, so "läuft gerade" and "Server nicht erreichbar"
      // looked identical and the one thing the user could act on was lost.
      const reasons: string[] = []
      const skipped: string[] = []

      for (const instance of instances) {
        if (instance.updateCount === 0) continue
        // Not even attempted while blocked: the backend would refuse anyway,
        // and asking is how a batch turned into a list of mystery failures.
        const blocked = blockedReason(instance)
        if (blocked) {
          skipped.push(instance.name)
          continue
        }
        try {
          total += await window.gabi.content.updateAll(instance.id)
        } catch (err) {
          failed.push(instance.name)
          const message = err instanceof Error ? err.message : String(err)
          if (!reasons.includes(message)) reasons.push(message)
        }
      }

      if (skipped.length > 0 && failed.length === 0) {
        toast(
          'warning',
          t('mods', 'toast.updatedTitle', {
            count: total,
            unit: pluralise(total, t('mods', 'unit.mod'), t('mods', 'unit.mods'))
          }),
          t('mods', 'toast.skippedBusy', { names: skipped.join(', ') }),
          8000
        )
      } else if (failed.length > 0) {
        toast(
          'warning',
          t('mods', 'toast.updatedWithFailuresTitle', {
            count: total,
            unit: pluralise(total, t('mods', 'unit.mod'), t('mods', 'unit.mods')),
            failedCount: failed.length
          }),
          t('mods', 'toast.updateFailedBody', {
            names: failed.slice(0, 3).join(', '),
            more: failed.length > 3 ? t('mods', 'toast.andMore') : '',
            reason: reasons[0] ?? t('common', 'unknown')
          }),
          9000
        )
      } else {
        toast(
          'success',
          t('mods', 'toast.updatedTitle', {
            count: total,
            unit: pluralise(total, t('mods', 'unit.mod'), t('mods', 'unit.mods'))
          })
        )
      }
      await refreshInstances()
      await load()
    } catch (err) {
      toastError(err, t('mods', 'toast.updateError'))
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
        <p className="page-sub" style={{ marginTop: 0 }}>
          {`${t('mods', 'summary.main', {
            count: rows.length,
            unit: pluralise(rows.length, t('mods', 'unit.entry'), t('mods', 'unit.entries'))
          })}${
            totalUpdates > 0
              ? t('mods', 'summary.withUpdates', {
                  count: totalUpdates,
                  unit: pluralise(totalUpdates, t('mods', 'unit.update'), t('mods', 'unit.updates'))
                })
              : ''
          }.`}
        </p>

        <div className="row gap-8">
          <button className="btn" onClick={checkAll} disabled={checking || instances.length === 0}>
            {checking ? <span className="spinner" /> : <IconRefresh size={16} />}
            {t('mods', 'actions.checkUpdates')}
          </button>
          {totalUpdates > 0 && (
            <button
              className="btn primary"
              onClick={updateEverything}
              disabled={checking || updatableInstances.length === 0}
              title={updatableInstances.length === 0 ? t('mods', 'hints.allBusy') : undefined}
            >
              <IconSparkle size={16} />
              {t('mods', 'actions.installUpdates', {
                count: totalUpdates,
                unit: pluralise(totalUpdates, t('mods', 'unit.update'), t('mods', 'unit.updates'))
              })}
            </button>
          )}
        </div>
      </header>

      {instances.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title={t('mods', 'empty.noInstances.title')}
          message={t('mods', 'empty.noInstances.message')}
          action={
            <button className="btn primary" onClick={() => navigate('/instances')}>
              {t('mods', 'empty.noInstances.action')}
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
                placeholder={t('mods', 'filters.searchPlaceholder')}
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
              <option value="all">{t('mods', 'filters.allInstances')}</option>
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
              {t('mods', 'filters.onlyUpdates')}
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
              title={t('mods', 'empty.noMods.title')}
              message={t('mods', 'empty.noMods.message')}
              action={
                <button className="btn primary" onClick={() => navigate('/discover')}>
                  <IconSearch size={16} />
                  {t('mods', 'empty.noMods.action')}
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<IconPackage size={26} />}
              title={onlyUpdates ? t('mods', 'toast.upToDateTitle') : t('mods', 'empty.nothingFound.title')}
              message={
                onlyUpdates
                  ? t('mods', 'empty.noUpdates.message')
                  : t('mods', 'empty.nothingFound.message')
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
                            : t('mods', 'provider.local')}
                      </span>
                      {row.item.update && <span className="badge warn">{t('mods', 'badge.update')}</span>}
                      {!row.item.enabled && <span className="badge">{t('mods', 'badge.disabled')}</span>}
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
                        disabled={updating === row.item.id || blockedReason(row.instance) !== null}
                        title={blockedReason(row.instance) ?? undefined}
                        onClick={async () => {
                          setUpdating(row.item.id)
                          try {
                            await window.gabi.content.update(row.instance.id, row.item.id)
                            toast('success', t('mods', 'toast.itemUpdated', { name: row.item.name }))
                            await refreshInstances()
                            await load()
                          } catch (err) {
                            toastError(err, t('mods', 'toast.updateError'))
                          } finally {
                            setUpdating(null)
                          }
                        }}
                      >
                        {updating === row.item.id ? <span className="spinner" /> : <IconDownload size={13} />}
                        {t('mods', 'badge.update')}
                      </button>
                    )}
                    {row.item.pageUrl && (
                      <button
                        className="btn ghost icon sm"
                        onClick={() => void window.gabi.app.openExternal(row.item.pageUrl as string)}
                        aria-label={t('mods', 'actions.projectPage')}
                      >
                        <IconExternal size={14} />
                      </button>
                    )}
                    <button
                      className="btn ghost icon sm"
                      onClick={() => navigate(`/instances/${row.instance.id}?tab=content`)}
                      aria-label={t('mods', 'actions.openInInstance')}
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
