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
import { Confirm, EmptyState } from '../components/ui'
import {
  IconChevronRight,
  IconDownload,
  IconExternal,
  IconPackage,
  IconRefresh,
  IconSearch,
  IconSparkle
} from '../components/Icons'
import { tr } from '@shared/i18n'

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
  // A Set, not a single id. With one shared value, starting a second row's
  // update overwrote the first: the first row's spinner vanished and its
  // button went live again while its request was still running.
  const [updating, setUpdating] = useState<ReadonlySet<string>>(() => new Set())
  // Same question the instance page asks: a stray click here quietly replaced
  // a version someone may have picked on purpose.
  const [confirmRow, setConfirmRow] = useState<Row | null>(null)

  const runRowUpdate = async (row: Row): Promise<void> => {
    // Guards against a double click landing twice before the first render.
    if (updating.has(row.item.id)) return
    setUpdating((current) => new Set(current).add(row.item.id))
    try {
      await window.gabi.content.update(row.instance.id, row.item.id)
      toast('success', tr(`${row.item.name} aktualisiert`, `${row.item.name} updated`))
      await refreshInstances()
      await load()
    } catch (err) {
      toastError(err, tr('Update fehlgeschlagen', 'Update failed'))
    } finally {
      setUpdating((current) => {
        const next = new Set(current)
        next.delete(row.item.id)
        return next
      })
    }
  }
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
      if (request === requestId.current) toastError(err, tr('Mods konnten nicht geladen werden', 'Mods could not be loaded'))
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
          tr(
            `${failed.length} ${pluralise(failed.length, 'Instanz', 'Instanzen')} nicht prüfbar`,
            `${failed.length} ${pluralise(failed.length, 'instance', 'instances')} could not be checked`
          ),
          tr(
            `${total} ${pluralise(total, 'Update', 'Updates')} in den übrigen gefunden. ` +
              `Fehlgeschlagen: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' und weitere' : ''}`,
            `${total} ${pluralise(total, 'update', 'updates')} found in the others. ` +
              `Failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' and more' : ''}`
          ),
          8000
        )
      } else {
        toast(
          total > 0 ? 'info' : 'success',
          total > 0
            ? tr(`${total} ${pluralise(total, 'Update', 'Updates')} gefunden`, `${total} ${pluralise(total, 'update', 'updates')} found`)
            : tr('Alles aktuell', 'Everything is up to date'),
          total > 0
            ? tr('Du kannst sie einzeln oder pro Instanz installieren.', 'You can install them one by one or per instance.')
            : undefined
        )
      }
      await refreshInstances()
      await load()
    } catch (err) {
      toastError(err, tr('Update-Prüfung fehlgeschlagen', 'Update check failed'))
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
          tr(`${total} ${pluralise(total, 'Mod', 'Mods')} aktualisiert`, `${total} ${pluralise(total, 'mod', 'mods')} updated`),
          tr(`Übersprungen, weil gerade in Benutzung: ${skipped.join(', ')}`, `Skipped because in use right now: ${skipped.join(', ')}`),
          8000
        )
      } else if (failed.length > 0) {
        toast(
          'warning',
          tr(
            `${total} ${pluralise(total, 'Mod', 'Mods')} aktualisiert, ${failed.length} fehlgeschlagen`,
            `${total} ${pluralise(total, 'mod', 'mods')} updated, ${failed.length} failed`
          ),
          tr(
            `Nicht aktualisiert: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' und weitere' : ''}. ` +
              `Grund: ${reasons[0] ?? 'unbekannt'}`,
            `Not updated: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' and more' : ''}. ` +
              `Reason: ${reasons[0] ?? 'unknown'}`
          ),
          9000
        )
      } else {
        toast('success', tr(`${total} ${pluralise(total, 'Mod', 'Mods')} aktualisiert`, `${total} ${pluralise(total, 'mod', 'mods')} updated`))
      }
      await refreshInstances()
      await load()
    } catch (err) {
      toastError(err, tr('Update fehlgeschlagen', 'Update failed'))
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
          <h1 className="page-title">{tr('Mods', 'Mods')}</h1>
          <p className="page-sub">
            {tr(
              `Alle Inhalte über sämtliche Instanzen hinweg, ${rows.length} ${pluralise(rows.length, 'Eintrag', 'Einträge')}` +
                (totalUpdates > 0 ? `, ${totalUpdates} ${pluralise(totalUpdates, 'Update', 'Updates')} verfügbar` : '') +
                '.',
              `All content across every instance, ${rows.length} ${pluralise(rows.length, 'entry', 'entries')}` +
                (totalUpdates > 0 ? `, ${totalUpdates} ${pluralise(totalUpdates, 'update', 'updates')} available` : '') +
                '.'
            )}
          </p>
        </div>

        <div className="row gap-8">
          <button className="btn" onClick={checkAll} disabled={checking || instances.length === 0}>
            {checking ? <span className="spinner" /> : <IconRefresh size={16} />}
            {tr('Auf Updates prüfen', 'Check for updates')}
          </button>
          {totalUpdates > 0 && (
            <button
              className="btn primary"
              onClick={updateEverything}
              disabled={checking || updatableInstances.length === 0}
              title={
                updatableInstances.length === 0
                  ? tr('Alle betroffenen Instanzen laufen gerade oder werden bearbeitet.', 'All affected instances are running or being worked on right now.')
                  : undefined
              }
            >
              <IconSparkle size={16} />
              {tr(
                `${totalUpdates} ${pluralise(totalUpdates, 'Update', 'Updates')} installieren`,
                `Install ${totalUpdates} ${pluralise(totalUpdates, 'update', 'updates')}`
              )}
            </button>
          )}
        </div>
      </header>

      {instances.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title={tr('Keine Instanzen', 'No instances')}
          message={tr('Sobald du eine Instanz mit Mods hast, siehst du hier alles auf einen Blick.', 'As soon as you have an instance with mods, you see everything here at a glance.')}
          action={
            <button className="btn primary" onClick={() => navigate('/instances')}>
              {tr('Zu den Instanzen', 'Go to instances')}
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
                placeholder={tr('Mods durchsuchen…', 'Search mods…')}
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
              <option value="all">{tr('Alle Instanzen', 'All instances')}</option>
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
              {tr('Nur mit Update', 'Only with update')}
            </button>
          </div>

          {/* Skeletons only for the first load. Each single update reloads the
              list, and swapping it for skeletons lost the scroll position. */}
          {loading && rows.length === 0 ? (
            <div className="col gap-8">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 68 }} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<IconPackage size={26} />}
              title={tr('Noch keine Mods installiert', 'No mods installed yet')}
              message={tr(
                'Hier sammeln sich alle Mods, Resourcepacks und Shader aus deinen Instanzen. Such dir unter „Entdecken“ etwas aus, Launch Gabi installiert Abhängigkeiten automatisch mit.',
                'All mods, resource packs and shaders from your instances gather here. Pick something under "Discover", Launch Gabi automatically installs dependencies as well.'
              )}
              action={
                <button className="btn primary" onClick={() => navigate('/discover')}>
                  <IconSearch size={16} />
                  {tr('Mods entdecken', 'Discover mods')}
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<IconPackage size={26} />}
              title={onlyUpdates ? tr('Alles aktuell', 'Everything is up to date') : tr('Nichts gefunden', 'Nothing found')}
              message={
                onlyUpdates
                  ? tr('Für keine deiner Instanzen liegen Updates vor.', 'There are no updates for any of your instances.')
                  : tr('Keine Inhalte passen zu diesem Filter.', 'No content matches this filter.')
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
                            : tr('LOKAL', 'LOCAL')}
                      </span>
                      {row.item.update && <span className="badge warn">Update</span>}
                      {!row.item.enabled && <span className="badge">{tr('Deaktiviert', 'Disabled')}</span>}
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
                        disabled={updating.has(row.item.id) || blockedReason(row.instance) !== null}
                        title={blockedReason(row.instance) ?? undefined}
                        onClick={() => setConfirmRow(row)}
                      >
                        {updating.has(row.item.id) ? <span className="spinner" /> : <IconDownload size={13} />}
                        {tr('Update', 'Update')}
                      </button>
                    )}
                    {row.item.pageUrl && (
                      <button
                        className="btn ghost icon sm"
                        onClick={() => void window.gabi.app.openExternal(row.item.pageUrl as string)}
                        aria-label={tr('Projektseite', 'Project page')}
                      >
                        <IconExternal size={14} />
                      </button>
                    )}
                    <button
                      className="btn ghost icon sm"
                      onClick={() => navigate(`/instances/${row.instance.id}?tab=content`)}
                      aria-label={tr('In der Instanz öffnen', 'Open in instance')}
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

      <Confirm
        open={confirmRow !== null}
        title={tr('Mod aktualisieren', 'Update mod')}
        message={
          confirmRow &&
          tr(
            `Nur „${confirmRow.item.name}“ in ${confirmRow.instance.name} auf ${confirmRow.item.update?.versionNumber} aktualisieren? Die bisherige Datei wird dabei entfernt.`,
            `Update only "${confirmRow.item.name}" in ${confirmRow.instance.name} to ${confirmRow.item.update?.versionNumber}? The previous file will be removed.`
          )
        }
        confirmLabel={tr('Ja, aktualisieren', 'Yes, update')}
        cancelLabel={tr('Nein', 'No')}
        onConfirm={async () => {
          const row = confirmRow
          setConfirmRow(null)
          if (row) await runRowUpdate(row)
        }}
        onCancel={() => setConfirmRow(null)}
      />
    </div>
  )
}
