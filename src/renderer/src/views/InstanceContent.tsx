import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ContentItem, ContentType } from '@shared/types'
import type { InstanceDetail } from '@shared/api'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { formatBytes, formatRelative, loaderColor, LOADER_LABELS } from '../lib/format'
import { EmptyState, Switch } from '../components/ui'
import { IconChevronRight, IconExternal, IconImage, IconSparkle, IconTrash } from '../components/Icons'

interface Props {
  type: Extract<ContentType, 'resourcepack' | 'shaderpack'>
}

const COPY = {
  resourcepack: {
    title: 'Resource Packs',
    subtitle: 'Texturen und Klänge der aktuellen Instanz',
    empty: 'Noch keine Resource Packs in dieser Instanz.',
    icon: <IconImage size={26} />
  },
  shaderpack: {
    title: 'Shader',
    subtitle: 'Shader der aktuellen Instanz',
    empty: 'Noch keine Shader in dieser Instanz.',
    icon: <IconSparkle size={26} />
  }
} as const

/**
 * Resource packs and shaders for the instance that is currently in focus.
 *
 * Both live inside one instance's folder in Minecraft, never globally, so
 * this page is explicitly bound to a single instance and says which one at
 * the top. The instance shown is the same one the home screen features:
 * favourites first, then most recently played.
 */
export function InstanceContentView({ type }: Props): JSX.Element {
  const { instances } = useStore()
  const copy = COPY[type]

  const active = instances[0] ?? null
  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!active) {
      setDetail(null)
      return
    }
    try {
      setDetail(await window.gabi.instances.get(active.id))
    } catch {
      setDetail(null)
    }
  }, [active?.id])

  useEffect(() => {
    void load()
  }, [load])

  const items: ContentItem[] = (detail?.content ?? []).filter((item) => item.type === type)
  const blocked = active?.running
    ? 'Minecraft läuft gerade.'
    : active?.contentBusy
      ? 'An den Inhalten wird gerade gearbeitet.'
      : null

  return (
    <div className="col gap-24">
      <header className="row-between wrap gap-12">
        <div>
          <h1 className="page-title">{copy.title}</h1>
          <p className="page-sub">{copy.subtitle}</p>
        </div>

        {active && (
          <button className="btn" onClick={() => navigate(`/instances/${active.id}?tab=content`)}>
            {active.name}
            <span
              className="loader-chip"
              style={{ ['--loader-color' as string]: loaderColor(active.loader) }}
            >
              {LOADER_LABELS[active.loader]} {active.mcVersion}
            </span>
            <IconChevronRight size={15} />
          </button>
        )}
      </header>

      {!active ? (
        <EmptyState
          icon={copy.icon}
          title="Keine Instanz"
          message="Lege zuerst eine Instanz an, dann erscheinen hier ihre Inhalte."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={copy.icon}
          title="Nichts installiert"
          message={`${copy.empty} Über „Mods" lassen sich welche finden und installieren.`}
        />
      ) : (
        <div className="col gap-8">
          {items.map((item) => (
            <div key={item.id} className={`content-row ${item.enabled ? '' : 'disabled'}`}>
              {item.iconUrl ? (
                <img className="content-icon" src={item.iconUrl} alt="" loading="lazy" />
              ) : (
                <div className="content-icon">{copy.icon}</div>
              )}

              <div className="grow" style={{ overflow: 'hidden' }}>
                <div className="row gap-8">
                  <span className="content-name truncate">{item.name}</span>
                  {!item.enabled && <span className="badge">Deaktiviert</span>}
                  {item.update && <span className="badge warn">Update</span>}
                </div>
                <div className="content-meta">
                  {item.version && <span>{item.version}</span>}
                  {item.size ? <span>{formatBytes(item.size)}</span> : null}
                  <span>{formatRelative(item.installedAt)}</span>
                </div>
              </div>

              <div className="content-actions">
                <Switch
                  checked={item.enabled}
                  disabled={blocked !== null || busy === item.id}
                  onChange={async (value) => {
                    setBusy(item.id)
                    try {
                      await window.gabi.content.toggle(active.id, item.id, value)
                      await load()
                      await refreshInstances()
                    } catch (err) {
                      toastError(err, value ? 'Aktivieren fehlgeschlagen' : 'Deaktivieren fehlgeschlagen')
                    } finally {
                      setBusy(null)
                    }
                  }}
                />
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
                  className="btn ghost icon sm"
                  disabled={blocked !== null || busy === item.id}
                  title={blocked ?? undefined}
                  aria-label="Entfernen"
                  onClick={async () => {
                    setBusy(item.id)
                    try {
                      await window.gabi.content.remove(active.id, item.id)
                      toast('info', `${item.name} entfernt`)
                      await load()
                      await refreshInstances()
                    } catch (err) {
                      toastError(err, 'Entfernen fehlgeschlagen')
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
