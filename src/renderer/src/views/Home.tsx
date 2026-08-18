import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { InstanceSummary, LauncherStats, NewsItem } from '@shared/types'
import { navigate, setState, useStore } from '../lib/store'
import { importModpack, startInstance, stopInstance } from '../lib/actions'
import { useCountUp, useInstanceIcon, useParallax, useSpotlight } from '../lib/hooks'
import { clickable } from '../lib/a11y'
import {
  LOADER_LABELS,
  formatMemory,
  formatPlayTime,
  formatRelative,
  greeting,
  loaderColor,
  pluralise
} from '../lib/format'
import { EmptyState, PlayButton } from '../components/ui'
import {
  IconChevronRight,
  IconClock,
  IconCube,
  IconDownload,
  IconExternal,
  IconGrid,
  IconPackage,
  IconPlay,
  IconPlus,
  IconSave,
  IconStop
} from '../components/Icons'

export function HomeView(): JSX.Element {
  const { instances, accounts, starting } = useStore()
  const [news, setNews] = useState<NewsItem[]>([])
  const [stats, setStats] = useState<LauncherStats | null>(null)
  const [heroBg, setHeroBg] = useState<string | null>(null)

  const activeAccount = accounts.find((a) => a.active)

  // Favourites first, then most recently played.
  const featured = instances[0] ?? null
  const recent = instances.slice(0, 6)

  // The aggregate tiles (total play time, disk usage, mod count) come from the
  // main process, not from the instance list. Keying them on `instances.length`
  // alone meant a play session started and ended on this very view changed
  // nothing observable, so the numbers stayed frozen at whatever they were on
  // mount until the user navigated away and back.
  const statsKey = instances.map((i) => `${i.id}:${i.lastPlayed ?? 0}:${i.modCount}`).join(',')

  useEffect(() => {
    void window.gabi.news.list(8).then(setNews).catch(() => undefined)
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
          setHeroBg(`file://${detail.resolvedBackground.replace(/\\/g, '/')}`)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [featured?.id, featured?.appearance.background])

  return (
    <div className="col gap-32">
      <header className="row-between wrap">
        <div>
          <h1 className="greeting">
            {greeting()}, <span>{activeAccount?.username ?? 'Gabi'}</span> 👋
          </h1>
          <p className="page-sub">
            {instances.length === 0
              ? 'Lege deine erste Instanz an und leg los.'
              : `${instances.length} ${pluralise(instances.length, 'Instanz', 'Instanzen')} bereit${
                  stats && stats.totalPlayMs > 0 ? ` · ${formatPlayTime(stats.totalPlayMs)} gespielt` : ''
                }`}
          </p>
        </div>

        <div className="row gap-8">
          <button className="btn" onClick={() => void importModpack()}>
            <IconDownload size={16} />
            Modpack importieren
          </button>
          <button className="btn primary" onClick={() => setState({ createOpen: true })}>
            <IconPlus size={16} />
            Neue Instanz
          </button>
        </div>
      </header>

      {featured ? (
        <FeaturedInstance
          instance={featured}
          background={heroBg}
          starting={starting.includes(featured.id)}
        />
      ) : (
        <div className="card pad-lg">
          <EmptyState
            icon={<IconCube size={28} />}
            title="Noch keine Instanz"
            message="Eine Instanz ist eine eigenständige Minecraft-Installation mit eigener Version, eigenen Mods und eigenen Welten. Erstelle deine erste, oder importiere ein fertiges Modpack."
            action={
              <div className="row gap-8">
                <button className="btn primary" onClick={() => setState({ createOpen: true })}>
                  <IconPlus size={16} />
                  Instanz erstellen
                </button>
                <button className="btn" onClick={() => void importModpack()}>
                  <IconDownload size={16} />
                  Modpack importieren
                </button>
              </div>
            }
          />
        </div>
      )}

      {recent.length > 1 && (
        <section className="col gap-16">
          <div className="row-between">
            <h2 className="section-title">Zuletzt gespielt</h2>
            <button className="btn ghost sm" onClick={() => navigate('/instances')}>
              Alle Instanzen
              <IconChevronRight size={14} />
            </button>
          </div>

          <div className="quick-grid stagger">
            {recent.map((instance) => (
              <QuickCard key={instance.id} instance={instance} busy={starting.includes(instance.id)} />
            ))}
          </div>
        </section>
      )}

      {stats && stats.totalInstances > 0 && (
        <section className="col gap-16">
          <h2 className="section-title">Überblick</h2>
          <div className="stat-grid stagger">
            <Stat icon={<IconGrid size={13} />} label="Instanzen" value={stats.totalInstances} />
            <Stat
              icon={<IconClock size={13} />}
              label="Spielzeit"
              value={stats.totalPlayMs}
              format={formatPlayTime}
            />
            <Stat icon={<IconPackage size={13} />} label="Mods insgesamt" value={stats.totalMods} />
            <Stat
              icon={<IconSave size={13} />}
              label="Speicherplatz"
              value={stats.diskUsageBytes / 1024 / 1024 / 1024}
              format={(v) => v.toFixed(1)}
              suffix="GB"
            />
          </div>
        </section>
      )}

      {news.length > 0 && (
        <section className="col gap-16">
          <div className="row-between">
            <h2 className="section-title">Minecraft News</h2>
          </div>
          <div className="discover-grid stagger">
            {news.slice(0, 6).map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function FeaturedInstance({
  instance,
  background,
  starting
}: {
  instance: InstanceSummary
  background: string | null
  starting: boolean
}): JSX.Element {
  const { launchStatus } = useStore()
  const status = launchStatus[instance.id]
  const heroIcon = useInstanceIcon(instance)
  const heroRef = useRef<HTMLElement | null>(null)

  useParallax(heroRef, 18)

  const busy = starting || instance.installing
  const phase = status?.phase
  const working = Boolean(status && phase && phase !== 'idle' && phase !== 'stopped')

  return (
    <section
      ref={heroRef}
      className="hero"
      style={{ ['--hero-accent' as string]: instance.appearance.accent }}
    >
      {background && <img className="hero-bg" src={background} alt="" />}
      <div className="hero-scrim" />

      <div className="hero-content">
        <div className="col gap-12" style={{ minWidth: 260 }}>
          <div className="row gap-16">
            <div className="hero-icon">
              {heroIcon ? <img src={heroIcon} alt="" /> : instance.appearance.icon}
            </div>
            <div className="col gap-4">
              <span className="badge accent" style={{ alignSelf: 'flex-start' }}>
                {instance.favorite ? 'Favorit' : 'Zuletzt gespielt'}
              </span>
              <h2 className="hero-title">{instance.name}</h2>
            </div>
          </div>

          <div className="hero-meta">
            <span className="badge">
              <IconCube size={12} />
              Minecraft {instance.mcVersion}
            </span>
            <span
              className="badge"
              style={{
                color: loaderColor(instance.loader),
                borderColor: 'transparent',
                background: 'rgba(255,255,255,0.06)'
              }}
            >
              {LOADER_LABELS[instance.loader]}
              {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}
            </span>
            {instance.modCount > 0 && (
              <span className="badge">
                {instance.modCount} {pluralise(instance.modCount, 'Mod', 'Mods')}
              </span>
            )}
            <span className="badge">RAM: {formatMemory(instance.memoryMb)}</span>
            {instance.updateCount > 0 && (
              <span className="badge warn">{instance.updateCount} {pluralise(instance.updateCount, 'Update', 'Updates')} verfügbar</span>
            )}
          </div>

          <div className="hint">
            Zuletzt gespielt: {formatRelative(instance.lastPlayed)}
            {instance.totalPlayMs > 0 && ` · ${formatPlayTime(instance.totalPlayMs)} insgesamt`}
          </div>
        </div>

        <div className="col gap-12" style={{ alignItems: 'flex-end' }}>
          <div className="hero-launch">
            {/* The aura only breathes while the button is idle and ready. */}
            {!busy && !instance.running && <div className="hero-launch-aura" />}

            {instance.running ? (
              <PlayButton stop onClick={() => void stopInstance(instance.id)}>
                <IconStop size={18} />
                MINECRAFT BEENDEN
              </PlayButton>
            ) : (
              <PlayButton
                disabled={busy}
                onClick={() => void startInstance(instance.id, instance.name)}
              >
                {busy ? <span className="spinner" /> : <IconPlay size={18} />}
                {busy ? 'WIRD VORBEREITET…' : 'PLAY'}
              </PlayButton>
            )}
          </div>

          {working && (
            <span className="hint" style={{ textAlign: 'right' }}>
              {status?.detail}
            </span>
          )}

          <button className="btn ghost sm" onClick={() => navigate(`/instances/${instance.id}`)}>
            Instanz verwalten
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>
    </section>
  )
}

function QuickCard({ instance, busy }: { instance: InstanceSummary; busy: boolean }): JSX.Element {
  const spotlight = useSpotlight<HTMLButtonElement>()
  const quickIcon = useInstanceIcon(instance)

  return (
    <button
      className="quick-card"
      style={{ ['--card-accent' as string]: instance.appearance.accent }}
      onClick={() => navigate(`/instances/${instance.id}`)}
      {...spotlight}
    >
      <div className="quick-icon">
        {quickIcon ? <img src={quickIcon} alt="" /> : instance.appearance.icon}
      </div>

      <div className="col grow" style={{ position: 'relative', zIndex: 1, overflow: 'hidden' }}>
        <span className="truncate" style={{ fontSize: 14, fontWeight: 650 }}>
          {instance.name}
        </span>
        <span className="truncate" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
          {instance.mcVersion} · {LOADER_LABELS[instance.loader]}
          {instance.modCount > 0
            ? ` · ${instance.modCount} ${pluralise(instance.modCount, 'Mod', 'Mods')}`
            : ''}
        </span>
      </div>

      <span
        className="quick-play-btn"
        onClick={(event) => {
          event.stopPropagation()
          if (instance.running) void stopInstance(instance.id)
          else void startInstance(instance.id, instance.name)
        }}
      >
        {busy ? (
          <span className="spinner" style={{ width: 13, height: 13 }} />
        ) : instance.running ? (
          <IconStop size={13} />
        ) : (
          <IconPlay size={13} />
        )}
      </span>
    </button>
  )
}

/** A stat tile whose number counts up once, so the page reads as measured. */
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

function NewsCard({ item }: { item: NewsItem }): JSX.Element {
  const spotlight = useSpotlight<HTMLElement>()

  return (
    <article
      className="project-card"
      aria-label={item.title}
      {...clickable(() => void window.gabi.app.openExternal(item.url))}
      {...spotlight}
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
