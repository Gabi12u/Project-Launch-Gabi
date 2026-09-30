import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  ContentItem,
  ContentType,
  LoaderId,
  ProjectDetails,
  ProjectVersion,
  SearchQuery,
  SearchResponse,
  SearchResultItem
} from '@shared/types'
import { refreshInstances, toast, toastError, useStore } from '../lib/store'
import { formatNumber, formatRelative, plainText } from '../lib/format'
import { clickable } from '../lib/a11y'
import { EmptyState, Modal, Segmented } from '../components/ui'
import { WorldPickerModal } from './WorldPickerModal'
import {
  IconCheck,
  IconDownload,
  IconExternal,
  IconPackage,
  IconSearch,
  IconWarning
} from './Icons'
import { tr } from '@shared/i18n'

const TYPE_LABELS: Record<ContentType | 'modpack', string> = {
  mod: tr('Mods', 'Mods'),
  resourcepack: tr('Resourcepacks', 'Resource packs'),
  shaderpack: tr('Shader', 'Shaders'),
  datapack: tr('Data Packs', 'Data packs'),
  modpack: tr('Modpacks', 'Modpacks')
}

/** Undated entries sort last rather than jumping to the top as NaN would. */
function time(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Mirrors the cross-provider comparator `searchAll` applies to a single page.
 * That sort only ever sees one page at a time, so once "Mehr laden" appends
 * another page from each provider, the accumulated list has to be re-sorted
 * here the same way, or a project from the second page could sit above one
 * from the first just because it belongs to a different platform.
 */
function sortMerged(items: SearchResultItem[], sort: SearchQuery['sort']): SearchResultItem[] {
  const sorted = [...items]
  switch (sort) {
    case 'downloads':
      sorted.sort((a, b) => b.downloads - a.downloads)
      break
    case 'follows':
      sorted.sort((a, b) => (b.follows ?? 0) - (a.follows ?? 0))
      break
    case 'updated':
    case 'newest':
      sorted.sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
      break
    default:
      break
  }
  return sorted
}

/**
 * Names the dependencies an install pulled in, e.g. "Fabric API" or
 * "Fabric API und Cloth Config". Beyond three, only the first two are named
 * and the rest are just counted, so the toast does not grow without bound.
 */
function describeDependencies(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} ${tr('und', 'and')} ${names[names.length - 1]}`
  return tr(`${names[0]}, ${names[1]} und ${names.length - 2} weitere`, `${names[0]}, ${names[1]} and ${names.length - 2} more`)
}

interface Props {
  /** When set, results can be installed straight into this instance. */
  instanceId?: string
  /**
   * Why installing is impossible right now, or null when it is fine.
   *
   * This component had no notion that a game could be running at all: its
   * install button stayed bright and clickable while the backend refused
   * every single click.
   */
  blockedReason?: string | null
  mcVersion?: string
  loader?: LoaderId
  /** Content types the user may switch between. */
  types?: (ContentType | 'modpack')[]
  initialType?: ContentType | 'modpack'
  /** Project ids already installed, so the button can show "Installiert". */
  installedProjectIds?: string[]
  onInstalled?: () => void
  /** Opens this project's modal on mount, e.g. from a `launchgabi://install/...` deep link. */
  openProjectProvider?: 'modrinth' | 'curseforge'
  openProjectId?: string
}

/** Identifies one project across providers for the busy state of its button. */
function installKey(item: { provider: string; projectId: string }): string {
  return `${item.provider}:${item.projectId}`
}

export function ContentBrowser({
  instanceId,
  blockedReason,
  mcVersion,
  loader,
  types = ['mod', 'resourcepack', 'shaderpack', 'datapack'],
  initialType,
  installedProjectIds = [],
  onInstalled,
  openProjectProvider,
  openProjectId
}: Props): JSX.Element {
  const { settings } = useStore()

  const [type, setType] = useState<ContentType | 'modpack'>(initialType ?? types[0])
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState<SearchQuery['sort']>('relevance')
  const [useVersionFilter, setUseVersionFilter] = useState(true)
  const [providers, setProviders] = useState<('modrinth' | 'curseforge')[]>(['modrinth', 'curseforge'])

  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  // CurseForge's Quilt search merges two independently paginated lists (see
  // curseforge.ts), so `total` there is only an upper bound: a page can come
  // back with results already shown on an earlier page instead of new ones,
  // and would otherwise leave "Mehr laden" visible forever. Set once an
  // appended page adds nothing new, cleared whenever a fresh search starts.
  const [exhausted, setExhausted] = useState(false)
  // A Set, not a single id. With one shared value, starting a second install
  // overwrote the first: the first card's spinner vanished and its button went
  // live again while its request was still running, so a second click fired a
  // genuinely duplicate install. Whichever call finished first also cleared
  // the indicator for the one still in flight.
  const [installing, setInstalling] = useState<ReadonlySet<string>>(() => new Set())
  const [detail, setDetail] = useState<SearchResultItem | null>(null)
  // A datapack asks which world(s) it should go into before it installs, the
  // same thing Prism does. Everything else installs straight away.
  const [worldPickFor, setWorldPickFor] = useState<{ item: SearchResultItem; versionId?: string } | null>(
    null
  )

  const requestId = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 320)
    return () => clearTimeout(timer)
  }, [query])

  // Bumped on unmount so a search still in flight cannot set state on a view
  // the user has already left. `requestId` alone only guards against a newer
  // search superseding an older one.
  useEffect(() => {
    return () => {
      requestId.current++
    }
  }, [])

  // Opens the project a deep link (launchgabi://install/...) pointed at.
  // Keyed so the same link does not reopen the modal again after the user
  // has closed it, and a changed link still opens its own project.
  const openedProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (!openProjectProvider || !openProjectId) return
    const key = `${openProjectProvider}:${openProjectId}`
    if (openedProjectRef.current === key) return
    openedProjectRef.current = key

    let current = true
    void window.gabi.providers
      .project(openProjectProvider, openProjectId)
      .then((details) => {
        if (current) setDetail(details)
      })
      .catch((err) => {
        if (current) toastError(err, tr('Projekt konnte nicht geöffnet werden', 'Project could not be opened'))
      })
    return () => {
      current = false
    }
  }, [openProjectProvider, openProjectId])

  const search = useCallback(
    async (nextOffset: number, append: boolean): Promise<void> => {
      const id = ++requestId.current
      setLoading(true)
      try {
        const result = await window.gabi.providers.search({
          query: debounced,
          type,
          gameVersion: useVersionFilter ? mcVersion : undefined,
          loader: useVersionFilter ? loader : undefined,
          providers,
          sort,
          offset: nextOffset,
          limit: 20
        })

        // Ignore responses from superseded requests.
        if (id !== requestId.current) return

        setResponse((current) => {
          if (!append || !current) return result
          // Keyed the same way the rendered cards are keyed. CurseForge's
          // Quilt search can hand back a project already shown on an earlier
          // page (see curseforge.ts), so without this a mod could appear
          // twice in the grid.
          const seen = new Set(current.items.map((item) => `${item.provider}-${item.projectId}`))
          const additions = result.items.filter((item) => !seen.has(`${item.provider}-${item.projectId}`))
          // Nothing new came back. `total` can overcount in the same Quilt
          // case, so it alone never reliably signals the end; an empty page
          // of new results does.
          if (additions.length === 0) setExhausted(true)
          const combined = [...current.items, ...additions]
          // Each page arrives pre-sorted across providers on its own; once a
          // second page is appended, the whole accumulated list needs the
          // same sort re-applied, or the pages just stack platform by platform.
          const items = providers.length > 1 ? sortMerged(combined, sort) : combined
          return { ...result, items }
        })
      } catch (err) {
        if (id === requestId.current) {
          // Cleared on a fresh search, so the list cannot keep showing the
          // previous type's results under a heading that already changed.
          // An appended page is left alone: losing what is already on screen
          // because page four failed would be worse.
          if (!append) setResponse(null)
          toastError(err, tr('Suche fehlgeschlagen', 'Search failed'))
        }
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [debounced, type, useVersionFilter, mcVersion, loader, providers, sort]
  )

  useEffect(() => {
    setOffset(0)
    setExhausted(false)
    void search(0, false)
  }, [search])

  const install = async (item: SearchResultItem, versionId?: string, worlds?: string[]): Promise<void> => {
    if (!instanceId) return
    // Guards against a double click landing twice before the first render.
    // Keyed with the provider: a Modrinth and a CurseForge project can share
    // an id, and one install then showed the other one as busy too.
    const key = installKey(item)
    if (installing.has(key)) return
    setInstalling((current) => new Set(current).add(key))

    try {
      if (item.type === 'modpack') {
        await window.gabi.modpacks.installFromProvider(item.provider, item.projectId, versionId)
        toast('success', tr('Modpack wird installiert', 'Installing modpack'), item.name)
      } else {
        const installed = await window.gabi.content.install({
          instanceId,
          provider: item.provider,
          projectId: item.projectId,
          versionId,
          type: item.type,
          worlds
        })
        toast(
          'success',
          tr(`${item.name} installiert`, `${item.name} installed`),
          installed.length > 1
            ? tr(
                `Inklusive ${describeDependencies(installed.slice(1).map((dep) => dep.name))}.`,
                `Including ${describeDependencies(installed.slice(1).map((dep) => dep.name))}.`
              )
            : undefined
        )
      }
      onInstalled?.()
      await refreshInstances()
    } catch (err) {
      toastError(err, tr(`${item.name} konnte nicht installiert werden`, `${item.name} could not be installed`))
    } finally {
      setInstalling((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const missingKey = useMemo(
    () => response?.errors.some((e) => e.provider === 'curseforge' && e.message.includes('API')),
    [response]
  )

  // The empty state otherwise just says "nothing found", which reads like a
  // dead end when the real reason is that CurseForge, the only source left
  // active, could not even be queried without a key.
  const emptyDueToMissingKey =
    missingKey && providers.length === 1 && providers[0] === 'curseforge' && !settings.curseForgeApiKey

  return (
    <div className="col gap-16">
      <div className="row gap-12 wrap">
        <div className="search" style={{ minWidth: 260 }}>
          <IconSearch size={16} />
          <input
            className="input"
            placeholder={tr(`${TYPE_LABELS[type]} durchsuchen…`, `Search ${TYPE_LABELS[type].toLowerCase()}…`)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {types.length > 1 && (
          <div className="segmented">
            {types.map((entry) => (
              <button
                key={entry}
                className={type === entry ? 'active' : ''}
                onClick={() => setType(entry)}
              >
                {TYPE_LABELS[entry]}
              </button>
            ))}
          </div>
        )}

        <Segmented<SearchQuery['sort']>
          value={sort}
          onChange={setSort}
          options={[
            { value: 'relevance', label: tr('Relevanz', 'Relevance') },
            { value: 'downloads', label: tr('Downloads', 'Downloads') },
            { value: 'updated', label: tr('Aktualisiert', 'Updated') }
          ]}
        />
      </div>

      <div className="row gap-12 wrap" style={{ fontSize: 12.5 }}>
        {mcVersion && (
          <button
            className={`badge ${useVersionFilter ? 'accent' : ''}`}
            onClick={() => setUseVersionFilter((value) => !value)}
            style={{ cursor: 'pointer' }}
          >
            {useVersionFilter ? <IconCheck size={11} /> : null}
            {tr('Nur passend für', 'Only for')} {mcVersion}
            {loader && loader !== 'vanilla' ? ` · ${loader}` : ''}
          </button>
        )}

        <button
          className={`badge ${providers.includes('modrinth') ? 'accent' : ''}`}
          style={{ cursor: 'pointer' }}
          title={
            providers.length === 1 && providers.includes('modrinth')
              ? tr('Mindestens eine Quelle muss aktiv sein', 'At least one source has to stay active')
              : undefined
          }
          onClick={() =>
            setProviders((current) => {
              // The last active provider cannot be switched off, or the search
              // would have nothing left to query at all.
              if (current.includes('modrinth')) {
                return current.length > 1 ? current.filter((p) => p !== 'modrinth') : current
              }
              return [...current, 'modrinth']
            })
          }
        >
          Modrinth
        </button>

        <button
          className={`badge ${providers.includes('curseforge') ? 'accent' : ''}`}
          style={{ cursor: 'pointer' }}
          title={
            providers.length === 1 && providers.includes('curseforge')
              ? tr('Mindestens eine Quelle muss aktiv sein', 'At least one source has to stay active')
              : undefined
          }
          onClick={() =>
            setProviders((current) => {
              if (current.includes('curseforge')) {
                return current.length > 1 ? current.filter((p) => p !== 'curseforge') : current
              }
              return [...current, 'curseforge']
            })
          }
        >
          CurseForge
        </button>

        {response && (
          <span className="muted" style={{ marginLeft: 'auto' }}>
            {formatNumber(response.total)} {tr('Treffer', 'results')}
          </span>
        )}
      </div>

      {missingKey && !settings.curseForgeApiKey && (
        <div className="issue warning">
          <div className="issue-icon">
            <IconWarning size={16} />
          </div>
          <div className="grow">
            <div className="issue-title">{tr('CurseForge ist nicht verbunden', 'CurseForge is not connected')}</div>
            <div className="issue-detail">
              {tr(
                'Für die CurseForge-Suche wird ein kostenloser API-Schlüssel benötigt. Du kannst ihn in den Einstellungen unter „Inhalte“ eintragen. Modrinth funktioniert auch ohne.',
                'Searching CurseForge needs a free API key. You can enter it in the settings under "Content". Modrinth works without one.'
              )}
            </div>
          </div>
        </div>
      )}

      {loading && !response ? (
        <div className="discover-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 96 }} />
          ))}
        </div>
      ) : response && response.items.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={26} />}
          title={tr('Nichts gefunden', 'Nothing found')}
          message={
            emptyDueToMissingKey
              ? tr(
                  'CurseForge ist als einzige Quelle aktiv, aber ohne API-Schlüssel liefert es keine Ergebnisse. Trage einen Schlüssel in den Einstellungen ein oder schalte Modrinth mit dazu.',
                  'CurseForge is the only active source, but without an API key it returns no results. Enter a key in the settings or turn Modrinth on as well.'
                )
              : useVersionFilter && mcVersion
                ? tr(
                    `Für Minecraft ${mcVersion} gibt es dazu nichts. Schalte den Versionsfilter aus, um breiter zu suchen.`,
                    `There is nothing for Minecraft ${mcVersion}. Turn off the version filter to search more broadly.`
                  )
                : tr('Versuche einen anderen Suchbegriff.', 'Try a different search term.')
          }
        />
      ) : (
        <>
          <div className="discover-grid stagger">
            {response?.items.map((item) => (
              <ProjectCard
                key={`${item.provider}-${item.projectId}`}
                item={item}
                // Keyed by provider plus id, like the React key one line up.
                // Comparing the bare id could mark a CurseForge result as
                // installed because an unrelated Modrinth project happened to
                // carry the same id.
                installed={installedProjectIds.includes(`${item.provider}:${item.projectId}`)}
                installing={installing.has(installKey(item))}
                canInstall={Boolean(instanceId) && !blockedReason}
                onInstall={() =>
                  item.type === 'datapack' ? setWorldPickFor({ item }) : void install(item)
                }
                onOpen={() => setDetail(item)}
              />
            ))}
          </div>

          {response && response.items.length < response.total && !exhausted && (
            <button
              className="btn block"
              disabled={loading}
              onClick={() => {
                const next = offset + 20
                setOffset(next)
                void search(next, true)
              }}
            >
              {loading ? <span className="spinner" /> : null}
              {tr('Mehr laden', 'Load more')}
            </button>
          )}
        </>
      )}

      {detail && (
        <ProjectModal
          item={detail}
          instanceId={instanceId}
          mcVersion={mcVersion}
          loader={loader}
          onClose={() => setDetail(null)}
          onInstall={(versionId) =>
            detail.type === 'datapack'
              ? setWorldPickFor({ item: detail, versionId })
              : void install(detail, versionId)
          }
          installing={installing.has(installKey(detail))}
        />
      )}

      {worldPickFor && instanceId && (
        <WorldPickerModal
          instanceId={instanceId}
          title={tr(`Welten für ${worldPickFor.item.name}`, `Worlds for ${worldPickFor.item.name}`)}
          onClose={() => setWorldPickFor(null)}
          onConfirm={async (worlds) => {
            const target = worldPickFor
            if (!target) return
            await install(target.item, target.versionId, worlds)
            setWorldPickFor(null)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ProjectCard({
  item,
  installed,
  installing,
  canInstall,
  onInstall,
  onOpen
}: {
  item: SearchResultItem
  installed: boolean
  installing: boolean
  canInstall: boolean
  onInstall: () => void
  onOpen: () => void
}): JSX.Element {
  return (
    <article className="project-card" aria-label={item.name} {...clickable(onOpen)}>
      {item.iconUrl ? (
        <img className="project-icon" src={item.iconUrl} alt="" loading="lazy" />
      ) : (
        <div className="project-icon" style={{ display: 'grid', placeItems: 'center' }}>
          <IconPackage size={22} />
        </div>
      )}

      <div className="col grow gap-6" style={{ overflow: 'hidden' }}>
        <div className="row gap-8" style={{ overflow: 'hidden' }}>
          <span className="truncate" style={{ fontSize: 14, fontWeight: 660 }}>
            {item.name}
          </span>
          <span className={`provider-tag ${item.provider}`}>
            {item.provider === 'modrinth' ? 'MR' : 'CF'}
          </span>
        </div>

        <span className="clamp-2 hint">{plainText(item.summary, 120)}</span>

        <div className="row gap-8" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
          <span>
            <IconDownload size={11} style={{ display: 'inline', verticalAlign: '-1px' }}/>{' '}
            {formatNumber(item.downloads)}
          </span>
          {item.author && <span className="truncate">{tr('von', 'by')} {item.author}</span>}
          {item.updatedAt && <span>{formatRelative(new Date(item.updatedAt).getTime())}</span>}
        </div>
      </div>

      {canInstall && (
        <button
          className={`btn sm ${installed ? '' : 'primary'}`}
          style={{ alignSelf: 'center', flexShrink: 0 }}
          disabled={installing || installed}
          onClick={(event) => {
            event.stopPropagation()
            onInstall()
          }}
        >
          {installing ? (
            <span className="spinner" />
          ) : installed ? (
            <IconCheck size={14} />
          ) : (
            <IconDownload size={14} />
          )}
          {installed ? tr('Installiert', 'Installed') : installing ? tr('Wird installiert…', 'Installing…') : tr('Installieren', 'Install')}
        </button>
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ */

function ProjectModal({
  item,
  instanceId,
  mcVersion,
  loader,
  onClose,
  onInstall,
  installing
}: {
  item: SearchResultItem
  instanceId?: string
  mcVersion?: string
  loader?: LoaderId
  onClose: () => void
  onInstall: (versionId?: string) => void
  installing: boolean
}): JSX.Element {
  const [project, setProject] = useState<ProjectDetails | null>(null)
  const [versions, setVersions] = useState<ProjectVersion[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [onlyCompatible, setOnlyCompatible] = useState(true)
  // Looked up separately from `installedProjectIds` (which only carries ids)
  // so the modal can show which version is already in place.
  const [installedItem, setInstalledItem] = useState<ContentItem | null>(null)

  useEffect(() => {
    if (!instanceId) {
      setInstalledItem(null)
      return
    }
    let current = true
    void window.gabi.instances
      .get(instanceId)
      .then((instance) => {
        if (!current) return
        setInstalledItem(
          instance.content.find((c) => c.provider === item.provider && c.projectId === item.projectId) ??
            null
        )
      })
      .catch(() => {
        if (current) setInstalledItem(null)
      })
    return () => {
      current = false
    }
  }, [instanceId, item.provider, item.projectId])

  useEffect(() => {
    // Guarded like the other async lookups in this app: closing the dialog
    // while the request is still running would otherwise set state on a
    // component that is already gone.
    let current = true
    setLoading(true)
    void window.gabi.providers
      .project(item.provider, item.projectId)
      .then((details) => {
        if (!current) return
        setProject(details)
        setVersions(details.versions)
      })
      .catch((err) => {
        if (current) toastError(err, tr('Projekt konnte nicht geladen werden', 'Project could not be loaded'))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [item.provider, item.projectId])

  // Deliberately the same rules the rest of the app applies, not stricter.
  // Demanding an exact game-version match hid a mod published only for
  // "1.21" from a 1.21.1 instance, even though installing it without
  // picking a version works and the compatibility check afterwards raises
  // no objection. The Quilt exception was missing for the same reason.
  const compatibleVersions = useMemo(() => {
    if (!mcVersion) return versions

    const line = mcVersion.split('.').slice(0, 2).join('.')
    const versionFits = (version: (typeof versions)[number]): boolean =>
      version.gameVersions.length === 0 ||
      version.gameVersions.includes(mcVersion) ||
      version.gameVersions.some((v) => v === line || v.startsWith(`${line}.`))

    const loaderFits = (version: (typeof versions)[number]): boolean =>
      !loader ||
      loader === 'vanilla' ||
      version.loaders.length === 0 ||
      version.loaders.includes(loader) ||
      (loader === 'quilt' && version.loaders.includes('fabric'))

    return versions.filter((version) => versionFits(version) && loaderFits(version))
  }, [versions, mcVersion, loader])

  const shown = onlyCompatible && mcVersion ? compatibleVersions : versions
  // With the filter off every version looked alike, so one for another loader
  // or Minecraft version could be installed without a word. Marked the same
  // way the version picker marks them.
  const compatibleIds = useMemo(() => new Set(compatibleVersions.map((version) => version.versionId)), [compatibleVersions])

  // `versions` arrives sorted newest first (see the provider), so the first
  // compatible entry is what "Neueste installieren" would actually fetch.
  const latestVersionId = compatibleVersions[0]?.versionId
  const installedIsLatest = Boolean(
    installedItem?.versionId && latestVersionId && installedItem.versionId === latestVersionId
  )

  return (
    <Modal
      open
      title={item.name}
      subtitle={
        [
          item.author ? tr(`von ${item.author}`, `by ${item.author}`) : null,
          installedItem ? tr(`Bereits installiert: ${installedItem.version}`, `Already installed: ${installedItem.version}`) : null
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      onClose={onClose}
      width="wide"
      footer={
        <>
          <button className="btn ghost" onClick={() => void window.gabi.app.openExternal(item.pageUrl)}>
            <IconExternal size={14} />
            {tr(
              `Auf ${item.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'} öffnen`,
              `Open on ${item.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'}`
            )}
          </button>
          <div className="grow" />
          {instanceId && (
            <button
              className="btn primary"
              onClick={() => onInstall(selected || undefined)}
              disabled={installing || (!selected && installedIsLatest)}
              title={!selected && installedIsLatest ? tr('Diese Version ist schon installiert', 'This version is already installed') : undefined}
            >
              {installing ? <span className="spinner" /> : <IconDownload size={15} />}
              {selected ? tr('Diese Version installieren', 'Install this version') : tr('Neueste installieren', 'Install latest')}
            </button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="col gap-12">
          <div className="skeleton" style={{ height: 80 }} />
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      ) : (
        <div className="col gap-20">
          <div className="row gap-16" style={{ alignItems: 'flex-start' }}>
            {item.iconUrl && <img className="project-icon" style={{ width: 72, height: 72 }} src={item.iconUrl} alt="" />}
            <div className="col gap-8 grow">
              <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                {plainText(project?.summary ?? item.summary, 400)}
              </p>
              <div className="row gap-8 wrap">
                <span className="badge">
                  <IconDownload size={11} /> {formatNumber(item.downloads)}
                </span>
                {item.categories.slice(0, 5).map((category) => (
                  <span key={category} className="badge">
                    {category}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="col gap-12">
            <div className="row-between">
              <h3 className="section-title">{tr('Versionen', 'Versions')}</h3>
              {mcVersion && (
                <button
                  className={`badge ${onlyCompatible ? 'accent' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOnlyCompatible((value) => !value)}
                >
                  {tr('Nur kompatible', 'Compatible only')}
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              <div className="issue warning">
                <div className="issue-icon">
                  <IconWarning size={16} />
                </div>
                <div>
                  <div className="issue-title">{tr('Keine passende Version', 'No matching version')}</div>
                  <div className="issue-detail">
                    {tr(
                      `Für Minecraft ${mcVersion}${loader && loader !== 'vanilla' ? ` (${loader})` : ''} gibt es keine Veröffentlichung. Schalte den Filter aus, um alle Versionen zu sehen.`,
                      `There is no release for Minecraft ${mcVersion}${loader && loader !== 'vanilla' ? ` (${loader})` : ''}. Turn off the filter to see all versions.`
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="version-list" style={{ maxHeight: 320 }}>
                {shown.slice(0, 60).map((version) => (
                  <button
                    key={version.versionId}
                    className={`version-item ${selected === version.versionId ? 'selected' : ''}`}
                    onClick={() => setSelected(selected === version.versionId ? '' : version.versionId)}
                  >
                    <div className="col gap-4" style={{ overflow: 'hidden' }}>
                      <span className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>
                        {version.versionNumber}
                      </span>
                      <span className="hint truncate">
                        {version.gameVersions.slice(0, 4).join(', ')}
                        {version.loaders.length > 0 ? ` · ${version.loaders.join(', ')}` : ''}
                      </span>
                    </div>
                    <div className="row gap-8">
                      {mcVersion && !compatibleIds.has(version.versionId) && (
                        <span className="badge danger">{tr('Passt nicht', 'Does not fit')}</span>
                      )}
                      <span
                        className={`badge ${
                          version.releaseType === 'release'
                            ? 'ok'
                            : version.releaseType === 'beta'
                              ? 'warn'
                              : 'danger'
                        }`}
                      >
                        {version.releaseType}
                      </span>
                      <span className="hint">{formatRelative(new Date(version.releasedAt).getTime())}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
