import { useMemo, useState, type JSX } from 'react'
import type { LoaderId } from '@shared/types'
import { setState, useStore } from '../lib/store'
import { importInstanceFolder, importModpack } from '../lib/actions'
import { LOADER_LABELS } from '../lib/format'
import { InstanceCard } from '../components/InstanceCard'
import { EmptyState, Segmented } from '../components/ui'
import { IconCube, IconDownload, IconFolder, IconPlus, IconSearch } from '../components/Icons'
import { locale, tr } from '@shared/i18n'

type SortKey = 'recent' | 'name' | 'played'

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
        return [...result].sort((a, b) => a.name.localeCompare(b.name, locale()))
      case 'played':
        return [...result].sort((a, b) => b.totalPlayMs - a.totalPlayMs)
      default:
        return result
    }
  }, [instances, search, loader, sort])

  // Grouping keeps large libraries navigable. Grouped by a normalized key so
  // "Modded" and "modded" land in one group instead of two; the label shown
  // is whichever spelling was seen first.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: typeof filtered }>()
    for (const instance of filtered) {
      const raw = instance.group || ''
      const key = raw.trim().toLocaleLowerCase(locale())
      const entry = map.get(key)
      if (entry) {
        entry.items.push(instance)
      } else {
        map.set(key, { label: raw.trim(), items: [instance] })
      }
    }
    return [...map.entries()]
      .map(([key, { label, items }]) => [key, label, items] as const)
      .sort(([keyA], [keyB]) => {
        if (keyA === '') return -1
        if (keyB === '') return 1
        return keyA.localeCompare(keyB, locale())
      })
  }, [filtered])

  return (
    <div className="col gap-24">
      <header className="row-between wrap">
        <div>
          <h1 className="page-title">{tr('Instanzen', 'Instances')}</h1>
          <p className="page-sub">
            {tr('Jede Instanz ist vollständig getrennt: eigene Version, Mods, Welten und Einstellungen.', 'Every instance is fully separate: its own version, mods, worlds and settings.')}
          </p>
        </div>
        <div className="row gap-8">
          <button
            className="btn"
            onClick={() => void importModpack()}
            title={tr('Ein .mrpack oder ein CurseForge-Zip einlesen', 'Read a .mrpack or a CurseForge zip')}
          >
            <IconDownload size={16} />
            {tr('Modpack', 'Modpack')}
          </button>
          <button
            className="btn"
            onClick={() => void importInstanceFolder()}
            title={tr('Eine vorhandene Instanz aus Prism, MultiMC oder einen .minecraft-Ordner übernehmen', 'Import an existing instance from Prism, MultiMC or a .minecraft folder')}
          >
            <IconFolder size={16} />
            {tr('Ordner', 'Folder')}
          </button>
          <button className="btn primary" onClick={() => setState({ createOpen: true })}>
            <IconPlus size={16} />
            {tr('Neue Instanz', 'New instance')}
          </button>
        </div>
      </header>

      {instances.length > 0 && (
        <div className="row gap-12 wrap">
          <div className="search" style={{ maxWidth: 340 }}>
            <IconSearch size={16} />
            <input
              className="input"
              placeholder={tr('Instanzen durchsuchen…', 'Search instances…')}
              aria-label={tr('Instanzen durchsuchen', 'Search instances')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {loaders.length > 1 && (
            <div className="segmented">
              <button className={loader === 'all' ? 'active' : ''} onClick={() => setLoader('all')}>
                {tr('Alle', 'All')}
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
                { value: 'recent', label: tr('Zuletzt', 'Recent') },
                { value: 'name', label: 'Name' },
                { value: 'played', label: tr('Spielzeit', 'Play time') }
              ]}
            />
          </div>
        </div>
      )}

      {instances.length === 0 ? (
        <div className="card pad-lg">
          <EmptyState
            icon={<IconCube size={28} />}
            title={tr('Noch keine Instanzen', 'No instances yet')}
            message={tr(
              'Erstelle eine Instanz mit der Minecraft-Version und dem Mod Loader deiner Wahl. Launch Gabi richtet alles Weitere automatisch ein.',
              'Create an instance with the Minecraft version and mod loader of your choice. Launch Gabi sets up everything else automatically.'
            )}
            action={
              <button className="btn primary" onClick={() => setState({ createOpen: true })}>
                <IconPlus size={16} />
                {tr('Erste Instanz erstellen', 'Create first instance')}
              </button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={26} />}
          title={tr('Nichts gefunden', 'Nothing found')}
          message={
            search.trim()
              ? tr(`Für „${search}“ gibt es keine passende Instanz.`, `There is no matching instance for "${search}".`)
              : tr('Für diesen Filter gibt es keine Instanz.', 'No instance matches this filter.')
          }
          action={
            <button className="btn" onClick={() => { setSearch(''); setLoader('all') }}>
              {tr('Filter zurücksetzen', 'Reset filter')}
            </button>
          }
        />
      ) : (
        <div className="col gap-32">
          {groups.map(([key, label, items]) => (
            <section key={key || 'ungrouped'} className="col gap-16">
              {label && (
                <h2 className="section-title">
                  {label} <span style={{ opacity: 0.5 }}>· {items.length}</span>
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
