import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ContentItem, ContentType } from '@shared/types'
import type { InstanceDetail } from '@shared/api'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { formatBytes, formatRelative, loaderColor, LOADER_LABELS } from '../lib/format'
import { t } from '../lib/i18n'
import { EmptyState, Switch } from '../components/ui'
import { IconChevronRight, IconExternal, IconImage, IconSparkle, IconTrash } from '../components/Icons'

interface Props {
  type: Extract<ContentType, 'resourcepack' | 'shaderpack'>
}

// title/subtitle/empty hold instanceSettings translation keys, not display
// text, so the lookup happens at render time and stays reactive to a
// language switch.
const COPY = {
  resourcepack: {
    title: 'content.resourcepackTitle',
    subtitle: 'content.resourcepackSubtitle',
    empty: 'content.resourcepackEmpty',
    icon: <IconImage size={26} />
  },
  shaderpack: {
    title: 'content.shaderpackTitle',
    subtitle: 'content.shaderpackSubtitle',
    empty: 'content.shaderpackEmpty',
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
    ? t('instanceSettings', 'content.blockedRunning')
    : active?.contentBusy
      ? t('instanceSettings', 'content.blockedBusy')
      : null

  return (
    <div className="col gap-24">
      <header className="row-between wrap gap-12">
        <div>
          <h1 className="page-title">{t('instanceSettings', copy.title)}</h1>
          <p className="page-sub">{t('instanceSettings', copy.subtitle)}</p>
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
          title={t('instanceSettings', 'content.noInstanceTitle')}
          message={t('instanceSettings', 'content.noInstanceMessage')}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={copy.icon}
          title={t('instanceSettings', 'content.emptyTitle')}
          message={t('instanceSettings', 'content.emptyMessage', { empty: t('instanceSettings', copy.empty) })}
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
                  {!item.enabled && <span className="badge">{t('instanceSettings', 'content.disabledBadge')}</span>}
                  {item.update && <span className="badge warn">{t('instanceSettings', 'content.updateBadge')}</span>}
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
                      toastError(
                        err,
                        value
                          ? t('instanceSettings', 'content.activateFailedToast')
                          : t('instanceSettings', 'content.deactivateFailedToast')
                      )
                    } finally {
                      setBusy(null)
                    }
                  }}
                />
                {item.pageUrl && (
                  <button
                    className="btn ghost icon sm"
                    onClick={() => void window.gabi.app.openExternal(item.pageUrl as string)}
                    aria-label={t('instanceSettings', 'content.projectPageAria')}
                  >
                    <IconExternal size={14} />
                  </button>
                )}
                <button
                  className="btn ghost icon sm"
                  disabled={blocked !== null || busy === item.id}
                  title={blocked ?? undefined}
                  aria-label={t('common', 'remove')}
                  onClick={async () => {
                    setBusy(item.id)
                    try {
                      await window.gabi.content.remove(active.id, item.id)
                      toast('info', t('instanceSettings', 'content.itemRemovedToast', { name: item.name }))
                      await load()
                      await refreshInstances()
                    } catch (err) {
                      toastError(err, t('instanceSettings', 'content.removeFailedToast'))
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
