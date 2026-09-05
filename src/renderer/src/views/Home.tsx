import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { InstanceSummary, LauncherStats, NewsItem } from '@shared/types'
import type { AppInfo } from '@shared/api'
import { navigate, setState, useStore } from '../lib/store'
import { importModpack, startInstance } from '../lib/actions'
import { useCountUp } from '../lib/hooks'
import { clickable } from '../lib/a11y'
import { formatDate, formatPlayTime } from '../lib/format'
import { t } from '../lib/i18n'
import { InstanceTile } from '../components/InstanceEntry'
import { Confirm, EmptyState } from '../components/ui'
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconCube,
  IconDownload,
  IconExternal,
  IconGrid,
  IconPackage,
  IconPlay,
  IconPlus,
  IconSave
} from '../components/Icons'

export function HomeView(): JSX.Element {
  const { instances, accounts, starting, updateStatus } = useStore()
  const [news, setNews] = useState<NewsItem[]>([])
  const [stats, setStats] = useState<LauncherStats | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [heroBg, setHeroBg] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<InstanceSummary | null>(null)

  const activeAccount = accounts.find((a) => a.active)

  // Favourites first, then most recently played.
  const featured = instances[0] ?? null
  const shown = instances.slice(0, 5)

  // The aggregate tiles come from the main process, not from the instance
  // list. Keying them on the ids alone meant a session started and ended on
  // this very view changed nothing observable.
  const statsKey = instances.map((i) => `${i.id}:${i.lastPlayed ?? 0}:${i.modCount}`).join(',')

  useEffect(() => {
    void window.gabi.news.list(8).then(setNews).catch(() => undefined)
    void window.gabi.app.info().then(setInfo).catch(() => undefined)
  }, [])

  useEffect(() => {
    void window.gabi.app.stats().then(setStats).catch(() => undefined)
  }, [statsKey])

  useEffect(() => {
    if (!featured?.appearance.background) {
      setHeroBg(null)
      return
    }
    let cancelled = false
    void window.gabi.instances
      .get(featured.id)
      .then((detail) => {
        if (!cancelled && detail.resolvedBackground) {
          setHeroBg('file://' + detail.resolvedBackground.replace(/\\/g, '/'))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [featured?.id, featured?.appearance.background])

  const busy = featured ? starting.includes(featured.id) : false

  return (
    <div className="col gap-24">
      <section className="home-hero">
        {heroBg && <img className="home-hero-bg" src={heroBg} alt="" />}
        <div className="home-hero-scrim" />

        <div className="col gap-14" style={{ minWidth: 0 }}>
          <div>
            <h1 className="home-hero-title">
              {activeAccount
                ? t('shell', 'hero.welcomeBack', { name: activeAccount.username })
                : t('shell', 'hero.welcomeBackGeneric')}
            </h1>
            <p className="home-hero-sub">
              {featured ? t('shell', 'hero.subReady') : t('shell', 'hero.subEmpty')}
            </p>
          </div>

          {featured ? (
            <div className="row gap-10 wrap">
              <button
                className="btn primary lg"
                disabled={busy || featured.installing || featured.running}
                onClick={() => void startInstance(featured.id, featured.name)}
              >
                {busy ? <span className="spinner" /> : <IconPlay size={15} />}
                {featured.running
                  ? t('shell', 'status.running')
                  : busy
                    ? t('shell', 'hero.playStarting')
                    : t('shell', 'hero.playStart')}
              </button>
              <button className="btn" onClick={() => navigate('/instances/' + featured.id)}>
                {featured.name}
                <IconChevronRight size={14} />
              </button>
            </div>
          ) : (
            <div className="row gap-8">
              <button className="btn primary" onClick={() => setState({ createOpen: true })}>
                <IconPlus size={15} />
                {t('shell', 'hero.createInstance')}
              </button>
              <button className="btn" onClick={() => void importModpack()}>
                <IconDownload size={15} />
                {t('shell', 'hero.importModpack')}
              </button>
            </div>
          )}
        </div>
      </section>

      {instances.length === 0 ? (
        <div className="card pad-lg">
          <EmptyState
            icon={<IconCube size={28} />}
            title={t('shell', 'empty.title')}
            message={t('shell', 'empty.message')}
          />
        </div>
      ) : (
        <section className="col gap-12">
          <div className="row-between">
            <h2 className="section-title">{t('shell', 'instances.title')}</h2>
            <button className="btn ghost sm" onClick={() => navigate('/instances')}>
              {t('shell', 'instances.viewAll')}
              <IconChevronRight size={14} />
            </button>
          </div>

          <div className="tile-row">
            {shown.map((instance) => (
              <InstanceTile key={instance.id} instance={instance} onDelete={setConfirmDelete} />
            ))}
            <div
              className="inst-tile create"
              {...clickable(() => setState({ createOpen: true }))}
              aria-label={t('shell', 'instances.newInstance')}
            >
              <IconPlus size={18} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t('shell', 'instances.newInstance')}
              </span>
            </div>
          </div>
        </section>
      )}

      <div className="panel-pair">
        <div className="panel">
          <span className="panel-label">{t('shell', 'news.title')}</span>
          {news.length === 0 ? (
            <span className="hint">{t('shell', 'news.empty')}</span>
          ) : (
            <div className="col gap-8">
              {news.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  className="row-between gap-12"
                  style={{ background: 'none', textAlign: 'left', width: '100%' }}
                  onClick={() => void window.gabi.app.openExternal(item.url)}
                >
                  <div className="col" style={{ gap: 2, minWidth: 0 }}>
                    <div className="row gap-8">
                      <span className="truncate" style={{ fontSize: 13, fontWeight: 620 }}>
                        {item.title}
                      </span>
                      <span className="badge accent">{item.tag}</span>
                    </div>
                    <span className="truncate hint">{item.summary}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
                    {formatDate(item.date)}
                  </span>
                </button>
              ))}
              <button
                className="btn ghost sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => navigate('/news')}
              >
                {t('shell', 'news.viewAll')}
                <IconChevronRight size={13} />
              </button>
            </div>
          )}
        </div>

        <div className="panel">
          <span className="panel-label">{t('shell', 'status.title')}</span>
          <div className="col gap-8">
            <div className="status-line">
              <span>Minecraft</span>
              <b>{featured ? featured.mcVersion : t('shell', 'status.noInstance')}</b>
            </div>
            <div className="status-line">
              <span>{t('shell', 'status.launcherLabel')}</span>
              <b>{info ? 'v' + info.version : '…'}</b>
            </div>
            <div className="status-line">
              <span>{t('shell', 'status.label')}</span>
              <span
                className="row gap-6"
                style={{
                  color:
                    updateStatus?.state === 'ready' || updateStatus?.state === 'downloading'
                      ? 'var(--warn)'
                      : 'var(--ok)',
                  fontWeight: 600
                }}
              >
                {updateStatus?.state === 'ready'
                  ? t('shell', 'status.updateReady')
                  : updateStatus?.state === 'downloading'
                    ? t('shell', 'status.updateDownloading')
                    : updateStatus?.state === 'disabled'
                      ? t('shell', 'status.devMode')
                      : t('shell', 'status.upToDate')}
                {(!updateStatus ||
                  updateStatus.state === 'up-to-date' ||
                  updateStatus.state === 'idle') && <IconCheck size={13} />}
              </span>
            </div>
          </div>
        </div>
      </div>

      {stats && stats.totalInstances > 0 && (
        <section className="col gap-12">
          <h2 className="section-title">{t('shell', 'overview.title')}</h2>
          <div className="stat-grid stagger">
            <Stat
              icon={<IconGrid size={13} />}
              label={t('shell', 'overview.instances')}
              value={stats.totalInstances}
            />
            <Stat
              icon={<IconClock size={13} />}
              label={t('shell', 'overview.playtime')}
              value={stats.totalPlayMs}
              format={formatPlayTime}
            />
            <Stat
              icon={<IconPackage size={13} />}
              label={t('shell', 'overview.totalMods')}
              value={stats.totalMods}
            />
            <Stat
              icon={<IconSave size={13} />}
              label={t('shell', 'overview.diskUsage')}
              value={stats.diskUsageBytes / 1024 / 1024 / 1024}
              format={(v) => v.toFixed(1)}
              suffix="GB"
            />
          </div>
        </section>
      )}

      <Confirm
        open={confirmDelete !== null}
        title={t('shell', 'deleteInstance.title')}
        danger
        message={confirmDelete ? t('shell', 'deleteInstance.message') : ''}
        confirmLabel={t('shell', 'deleteInstance.confirm')}
        onConfirm={async () => {
          if (!confirmDelete) return
          await window.gabi.instances.remove(confirmDelete.id)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Stat({
  icon,
  label,
  value,
  suffix,
  format
}: {
  icon: ReactNode
  label: string
  value: number
  suffix?: string
  format?: (value: number) => string
}): JSX.Element {
  const animated = useCountUp(value)
  const text = format ? format(animated) : Math.round(animated).toLocaleString('de-DE')

  return (
    <div className="stat">
      <div className="stat-head">
        {icon}
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">
        {text}
        {suffix && <small>{suffix}</small>}
      </div>
    </div>
  )
}

export function NewsCard({ item }: { item: NewsItem }): JSX.Element {
  return (
    <article
      className="project-card"
      aria-label={item.title}
      {...clickable(() => void window.gabi.app.openExternal(item.url))}
    >
      {item.imageUrl ? (
        <img className="project-icon" src={item.imageUrl} alt="" loading="lazy" />
      ) : (
        <div className="project-icon" style={{ display: 'grid', placeItems: 'center' }}>
          <IconGrid size={20} />
        </div>
      )}
      <div className="col grow gap-4" style={{ overflow: 'hidden' }}>
        <div className="row gap-8">
          <span className="badge accent">{item.tag}</span>
        </div>
        <span className="clamp-2" style={{ fontSize: 13.5, fontWeight: 650, lineHeight: 1.35 }}>
          {item.title}
        </span>
        <span className="clamp-2 hint">{item.summary}</span>
      </div>
      <IconExternal size={14} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
    </article>
  )
}
