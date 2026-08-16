import { useMemo, useState, type JSX } from 'react'
import type { LoaderId } from '@shared/types'
import { setState, useStore } from '../lib/store'
import { importModpack } from '../lib/actions'
import { LOADER_LABELS } from '../lib/format'
import { InstanceCard } from '../components/InstanceCard'
import { EmptyState, Segmented } from '../components/ui'
import { IconCube, IconDownload, IconPlus, IconSearch } from '../components/Icons'

type SortKey = 'recent' | 'name' | 'created' | 'played'

export function InstancesView(): JSX.Element {
  const { instances } = useStore()
  const [search, setSearch] = useState('')
  const [loader, setLoader] = useState<LoaderId | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('recent')

  const loaders = useMemo(
    () => [...new Set(instances.map((i) => i.loader))].sort(),
    [instances]
  )

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
    const map = new Map<string, typeof filtered>()
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

  return (
    <div className="col gap-24">
      <header className="row-between wrap">
        <div>
          <h1 className="page-title">Instanzen</h1>
          <p className="page-sub">
            Jede Instanz ist vollständig getrennt: eigene Version, Mods, Welten und Einstellungen.
          </p>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => void importModpack()}>
            <IconDownload size={16} />
            Importieren
          </button>
          <button className="btn primary" onClick={() => setState({ createOpen: true })}>
            <IconPlus size={16} />
            Neue Instanz
          </button>
        </div>
      </header>

      {instances.length > 0 && (
        <div className="row gap-12 wrap">
          <div className="search" style={{ maxWidth: 340 }}>
            <IconSearch size={16} />
            <input
              className="input"
              placeholder="Instanzen durchsuchen…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

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
          message={`Für „${search}“ gibt es keine passende Instanz.`}
          action={
            <button className="btn" onClick={() => { setSearch(''); setLoader('all') }}>
              Filter zurücksetzen
            </button>
          }
        />
      ) : (
        <div className="col gap-32">
          {groups.map(([group, items]) => (
            <section key={group || 'ungrouped'} className="col gap-16">
              {group && (
                <h2 className="section-title">
                  {group} <span style={{ opacity: 0.5 }}>· {items.length}</span>
                </h2>
              )}
              <div className="instance-grid stagger">
                {items.map((instance) => (
                  <InstanceCard key={instance.id} instance={instance} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
