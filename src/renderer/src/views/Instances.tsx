import { useEffect, useMemo, useState, type JSX } from 'react'
import type { InstanceSummary, LoaderId } from '@shared/types'
import type { AppInfo } from '@shared/api'
import { navigate, refreshInstances, setState, toast, toastError, useStore } from '../lib/store'
import { importInstanceFolder, importModpack } from '../lib/actions'
import { LOADER_LABELS, formatMemory, pluralise } from '../lib/format'
import { InstanceRow } from '../components/InstanceEntry'
import { Confirm, EmptyState, Segmented } from '../components/ui'
import {
  IconCube,
  IconDownload,
  IconFolder,
  IconPlus,
  IconSearch
} from '../components/Icons'

type SortKey = 'recent' | 'name' | 'created' | 'played'

export function InstancesView(): JSX.Element {
  const { instances } = useStore()
  const [search, setSearch] = useState('')
  const [loader, setLoader] = useState<LoaderId | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [confirmDelete, setConfirmDelete] = useState<InstanceSummary | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.gabi.app.info().then(setInfo).catch(() => undefined)
  }, [])

  const loaders = useMemo(() => [...new Set(instances.map((i) => i.loader))].sort(), [instances])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()

    const result = instances.filter((instance) => {
      if (loader !== 'all' && instance.loader !== loader) return false
      if (!term) return true
      return (
        instance.name.toLowerCase().includes(term) ||
        instance.mcVersion.includes(term) ||
        instance.description.toLowerCase().includes(term) ||
        instance.group.toLowerCase().includes(term)
      )
    })

    switch (sort) {
      case 'name':
        return [...result].sort((a, b) => a.name.localeCompare(b.name, 'de'))
      case 'played':
        return [...result].sort((a, b) => b.totalPlayMs - a.totalPlayMs)
      case 'created':
        return [...result].sort((a, b) => b.id.localeCompare(a.id))
      default:
        return result
    }
  }, [instances, search, loader, sort])

  // Grouping keeps large libraries navigable.
  const groups = useMemo(() => {
    const map = new Map<string, InstanceSummary[]>()
    for (const instance of filtered) {
      const key = instance.group || ''
      const list = map.get(key) ?? []
      list.push(instance)
      map.set(key, list)
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b, 'de')
    })
  }, [filtered])

  // Same instance the home screen features and the pack pages bind to:
  // favourites first, then most recently played.
  const active = instances[0] ?? null
  const systemMb = info?.systemMemoryMb ?? 0

  const remove = async (): Promise<void> => {
    if (!confirmDelete) return
    try {
      await window.gabi.instances.remove(confirmDelete.id)
      toast('info', `${confirmDelete.name} gelöscht`)
      await refreshInstances()
    } catch (err) {
      toastError(err, 'Löschen fehlgeschlagen')
    } finally {
      setConfirmDelete(null)
    }
  }

  return (
    <div className="col gap-20">
      <header className="row-between wrap gap-12">
        <div>
          <h1 className="page-title">Deine Instanzen</h1>
          <p className="page-sub">Verwalte und starte deine Minecraft Instanzen</p>
        </div>

        <div className="row gap-8">
          <div className="search" style={{ maxWidth: 240 }}>
            <IconSearch size={15} />
            <input
              className="input"
              placeholder="Instanz suchen…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className="btn" onClick={() => void importModpack()} title="Ein .mrpack oder ein CurseForge-Zip einlesen">
            <IconDownload size={15} />
            Modpack
          </button>
          <button
            className="btn"
            onClick={() => void importInstanceFolder()}
            title="Eine vorhandene Instanz aus Prism, MultiMC oder einen .minecraft-Ordner übernehmen"
          >
            <IconFolder size={15} />
            Ordner
          </button>
          <button className="btn primary" onClick={() => setState({ createOpen: true })}>
            <IconPlus size={15} />
            Neue Instanz
          </button>
        </div>
      </header>

      {instances.length > 1 && (
        <div className="row gap-12 wrap">
          {loaders.length > 1 && (
            <div className="segmented">
              <button className={loader === 'all' ? 'active' : ''} onClick={() => setLoader('all')}>
                Alle
              </button>
              {loaders.map((id) => (
                <button key={id} className={loader === id ? 'active' : ''} onClick={() => setLoader(id)}>
                  {LOADER_LABELS[id]}
                </button>
              ))}
            </div>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <Segmented<SortKey>
              value={sort}
              onChange={setSort}
              options={[
                { value: 'recent', label: 'Zuletzt' },
                { value: 'name', label: 'Name' },
                { value: 'played', label: 'Spielzeit' }
              ]}
            />
          </div>
        </div>
      )}

      {instances.length === 0 ? (
        <div className="card pad-lg">
          <EmptyState
            icon={<IconCube size={28} />}
            title="Noch keine Instanzen"
            message="Erstelle eine Instanz mit der Minecraft-Version und dem Mod Loader deiner Wahl. Launch Gabi richtet alles Weitere automatisch ein."
            action={
              <button className="btn primary" onClick={() => setState({ createOpen: true })}>
                <IconPlus size={16} />
                Erste Instanz erstellen
              </button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={26} />}
          title="Nichts gefunden"
          message={`Für „${search}" gibt es keine passende Instanz.`}
          action={
            <button
              className="btn"
              onClick={() => {
                setSearch('')
                setLoader('all')
              }}
            >
              Filter zurücksetzen
            </button>
          }
        />
      ) : (
        <div className="col gap-20">
          {groups.map(([group, items]) => (
            <section key={group || 'ungrouped'} className="col gap-10">
              {group && (
                <h2 className="section-title">
                  {group} <span style={{ opacity: 0.5 }}>· {items.length}</span>
                </h2>
              )}
              {items.map((instance) => (
                <InstanceRow key={instance.id} instance={instance} onDelete={setConfirmDelete} />
              ))}
            </section>
          ))}

          <div className="inst-row create" {...{ onClick: () => setState({ createOpen: true }), role: 'button', tabIndex: 0 }}>
            <IconPlus size={18} />
            <div className="col" style={{ gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>
                Neue Instanz erstellen
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
                Erstelle eine neue Minecraft Instanz
              </span>
            </div>
          </div>
        </div>
      )}

      {active && (
        <div className="panel-pair">
          <div className="panel">
            <span className="panel-label">AKTUELLE INSTANZ</span>
            <div className="row-between gap-12">
              <div className="row gap-10" style={{ minWidth: 0 }}>
                <span className={`badge ${active.running ? 'ok dot live' : ''}`}>
                  {active.running ? 'Läuft' : 'Bereit'}
                </span>
                <div className="col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="inst-row-name truncate">{active.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
                    {active.mcVersion} · {LOADER_LABELS[active.loader]} · {active.modCount}{' '}
                    {pluralise(active.modCount, 'Mod', 'Mods')}
                  </span>
                </div>
              </div>
              <button
                className="btn sm"
                onClick={() => void window.gabi.instances.openFolder(active.id)}
              >
                <IconFolder size={14} />
                Instanz Ordner öffnen
              </button>
            </div>
          </div>

          <div className="panel">
            <span className="panel-label">SPEICHER</span>
            <div className="row-between gap-12">
              <span style={{ fontSize: 18, fontWeight: 680, color: 'var(--text)' }}>
                {formatMemory(active.memoryMb)}
                {systemMb > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-4)', fontWeight: 500 }}>
                    {' '}
                    / {formatMemory(systemMb)}
                  </span>
                )}
              </span>
              <button
                className="btn sm"
                onClick={() => navigate(`/instances/${active.id}?tab=settings`)}
              >
                RAM ändern
              </button>
            </div>
            <div className="ram-bar">
              <div
                className="ram-fill"
                style={{
                  width: systemMb > 0 ? `${Math.min(100, (active.memoryMb / systemMb) * 100)}%` : '0%'
                }}
              />
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
              Für {active.name} zugewiesen
              {systemMb > 0 ? `, insgesamt ${formatMemory(systemMb)} im System` : ''}
            </span>
          </div>
        </div>
      )}

      <Confirm
        open={confirmDelete !== null}
        title="Instanz löschen"
        danger
        message={
          confirmDelete
            ? `„${confirmDelete.name}" wird mit allen Welten, Mods und Einstellungen gelöscht. Das lässt sich nicht rückgängig machen.`
            : ''
        }
        confirmLabel="Endgültig löschen"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
