import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
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
import {
  IconCheck,
  IconDownload,
  IconExternal,
  IconPackage,
  IconSearch,
  IconWarning
} from './Icons'

const TYPE_LABELS: Record<ContentType | 'modpack', string> = {
  mod: 'Mods',
  resourcepack: 'Resourcepacks',
  shaderpack: 'Shader',
  datapack: 'Data Packs',
  modpack: 'Modpacks'
}

interface Props {
  /** When set, results can be installed straight into this instance. */
  instanceId?: string
  mcVersion?: string
  loader?: LoaderId
  /** Content types the user may switch between. */
  types?: (ContentType | 'modpack')[]
  initialType?: ContentType | 'modpack'
  /** Project ids already installed, so the button can show "Installiert". */
  installedProjectIds?: string[]
  onInstalled?: () => void
}

export function ContentBrowser({
  instanceId,
  mcVersion,
  loader,
  types = ['mod', 'resourcepack', 'shaderpack', 'datapack'],
  initialType,
  installedProjectIds = [],
  onInstalled
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
  // A Set, not a single id. With one shared value, starting a second install
  // overwrote the first: the first card's spinner vanished and its button went
  // live again while its request was still running, so a second click fired a
  // genuinely duplicate install. Whichever call finished first also cleared
  // the indicator for the one still in flight.
  const [installing, setInstalling] = useState<ReadonlySet<string>>(() => new Set())
  const [detail, setDetail] = useState<SearchResultItem | null>(null)

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

        setResponse((current) =>
          append && current
            ? { ...result, items: [...current.items, ...result.items] }
            : result
        )
      } catch (err) {
        if (id === requestId.current) {
          // Cleared on a fresh search, so the list cannot keep showing the
          // previous type's results under a heading that already changed.
          // An appended page is left alone: losing what is already on screen
          // because page four failed would be worse.
          if (!append) setResponse(null)
          toastError(err, 'Suche fehlgeschlagen')
        }
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [debounced, type, useVersionFilter, mcVersion, loader, providers, sort]
  )

  useEffect(() => {
    setOffset(0)
    void search(0, false)
  }, [search])

  const install = async (item: SearchResultItem, versionId?: string): Promise<void> => {
    if (!instanceId) return
    // Guards against a double click landing twice before the first render.
    if (installing.has(item.projectId)) return
    setInstalling((current) => new Set(current).add(item.projectId))

    try {
      if (item.type === 'modpack') {
        await window.gabi.modpacks.installFromProvider(item.provider, item.projectId, versionId)
        toast('success', 'Modpack wird installiert', item.name)
      } else {
        const installed = await window.gabi.content.install({
          instanceId,
          provider: item.provider,
          projectId: item.projectId,
          versionId,
          type: item.type
        })
        toast(
          'success',
          `${item.name} installiert`,
          installed.length > 1 ? `Inklusive ${installed.length - 1} Abhängigkeiten.` : undefined
        )
      }
      onInstalled?.()
      await refreshInstances()
    } catch (err) {
      toastError(err, `${item.name} konnte nicht installiert werden`)
    } finally {
      setInstalling((current) => {
        const next = new Set(current)
        next.delete(item.projectId)
        return next
      })
    }
  }

  const missingKey = useMemo(
    () => response?.errors.some((e) => e.provider === 'curseforge' && e.message.includes('API')),
    [response]
  )

  return (
    <div className="col gap-16">
      <div className="row gap-12 wrap">
        <div className="search" style={{ minWidth: 260 }}>
          <IconSearch size={16} />
          <input
            className="input"
            placeholder={`${TYPE_LABELS[type]} durchsuchen…`}
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
            { value: 'relevance', label: 'Relevanz' },
            { value: 'downloads', label: 'Downloads' },
            { value: 'updated', label: 'Aktualisiert' }
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
            Nur passend für {mcVersion}
            {loader && loader !== 'vanilla' ? ` · ${loader}` : ''}
          </button>
        )}

        <button
          className={`badge ${providers.includes('modrinth') ? 'accent' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() =>
            setProviders((current) =>
              current.includes('modrinth')
                ? current.filter((p) => p !== 'modrinth')
                : [...current, 'modrinth']
            )
          }
        >
          Modrinth
        </button>

        <button
          className={`badge ${providers.includes('curseforge') ? 'accent' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() =>
            setProviders((current) =>
              current.includes('curseforge')
                ? current.filter((p) => p !== 'curseforge')
                : [...current, 'curseforge']
            )
          }
        >
          CurseForge
        </button>

        {response && (
          <span className="muted" style={{ marginLeft: 'auto' }}>
            {formatNumber(response.total)} Treffer
          </span>
        )}
      </div>

      {missingKey && !settings.curseForgeApiKey && (
        <div className="issue warning">
          <div className="issue-icon">
            <IconWarning size={16} />
          </div>
          <div className="grow">
            <div className="issue-title">CurseForge ist nicht verbunden</div>
            <div className="issue-detail">
              Für die CurseForge-Suche wird ein kostenloser API-Schlüssel benötigt. Du kannst ihn in den
              Einstellungen unter „Inhalte“ eintragen. Modrinth funktioniert auch ohne.
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
          title="Nichts gefunden"
          message={
            useVersionFilter && mcVersion
              ? `Für Minecraft ${mcVersion} gibt es dazu nichts. Schalte den Versionsfilter aus, um breiter zu suchen.`
              : 'Versuche einen anderen Suchbegriff.'
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
                installing={installing.has(item.projectId)}
                canInstall={Boolean(instanceId)}
                onInstall={() => void install(item)}
                onOpen={() => setDetail(item)}
              />
            ))}
          </div>

          {response && response.items.length < response.total && (
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
              Mehr laden
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
          onInstall={(versionId) => void install(detail, versionId)}
          installing={installing.has(detail.projectId)}
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
          {item.author && <span className="truncate">von {item.author}</span>}
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
          {installed ? 'Installiert' : installing ? '' : 'Installieren'}
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
        if (current) toastError(err, 'Projekt konnte nicht geladen werden')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [item.provider, item.projectId])

  const shown = useMemo(() => {
    if (!onlyCompatible || !mcVersion) return versions

    // Deliberately the same rules the rest of the app applies, not stricter.
    // Demanding an exact game-version match hid a mod published only for
    // "1.21" from a 1.21.1 instance, even though installing it without
    // picking a version works and the compatibility check afterwards raises
    // no objection. The Quilt exception was missing for the same reason.
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
  }, [versions, onlyCompatible, mcVersion, loader])

  return (
    <Modal
      open
      title={item.name}
      subtitle={item.author ? `von ${item.author}` : undefined}
      onClose={onClose}
      width="wide"
      footer={
        <>
          <button className="btn ghost" onClick={() => void window.gabi.app.openExternal(item.pageUrl)}>
            <IconExternal size={14} />
            Auf {item.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'} öffnen
          </button>
          <div className="grow" />
          {instanceId && (
            <button className="btn primary" onClick={() => onInstall(selected || undefined)} disabled={installing}>
              {installing ? <span className="spinner" /> : <IconDownload size={15} />}
              {selected ? 'Diese Version installieren' : 'Neueste installieren'}
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
              <h3 className="section-title">Versionen</h3>
              {mcVersion && (
                <button
                  className={`badge ${onlyCompatible ? 'accent' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOnlyCompatible((value) => !value)}
                >
                  Nur kompatible
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              <div className="issue warning">
                <div className="issue-icon">
                  <IconWarning size={16} />
                </div>
                <div>
                  <div className="issue-title">Keine passende Version</div>
                  <div className="issue-detail">
                    Für Minecraft {mcVersion} {loader && loader !== 'vanilla' ? `(${loader})` : ''} gibt es
                    keine Veröffentlichung. Schalte den Filter aus, um alle Versionen zu sehen.
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
