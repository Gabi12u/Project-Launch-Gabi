import { type JSX } from 'react'
import type { InstanceSummary } from '@shared/types'
import { navigate, useStore } from '../lib/store'
import { startInstance, stopInstance, toggleFavorite } from '../lib/actions'
import { useInstanceIcon, useTilt } from '../lib/hooks'
import { LOADER_LABELS, formatRelative, loaderColor, pluralise } from '../lib/format'
import { IconPlay, IconStar, IconStarFilled, IconStop } from './Icons'

export function InstanceCard({ instance }: { instance: InstanceSummary }): JSX.Element {
  const { starting } = useStore()
  const iconSrc = useInstanceIcon(instance)
  const isStarting = starting.includes(instance.id)
  const tilt = useTilt<HTMLElement>(5)

  const accent = instance.appearance.accent

  return (
    <article
      className="instance-card"
      style={{ ['--card-accent' as string]: accent }}
      onClick={() => navigate(`/instances/${instance.id}`)}
      {...tilt}
    >
      <div className="instance-cover">
        <div className="instance-icon">
          {iconSrc ? <img src={iconSrc} alt="" /> : instance.appearance.icon}
        </div>

        <div className="instance-corner">
          <button
            className={`icon-pill ${instance.favorite ? 'on' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              void toggleFavorite(instance.id, !instance.favorite)
            }}
            aria-label={instance.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          >
            {instance.favorite ? <IconStarFilled size={14} /> : <IconStar size={14} />}
          </button>
        </div>
      </div>

      <div className="instance-body">
        <div className="row-between" style={{ gap: 8 }}>
          <span className="instance-name truncate">{instance.name}</span>
          {instance.running && <span className="badge ok dot live">Läuft</span>}
          {instance.installing && !instance.running && (
            <span className="badge accent">
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
              Setup
            </span>
          )}
        </div>

        <div className="instance-tags">
          <span>{instance.mcVersion}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span
            className="loader-chip"
            style={{ ['--loader-color' as string]: loaderColor(instance.loader) }}
          >
            {LOADER_LABELS[instance.loader]}
          </span>
          {instance.modCount > 0 && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>
                {instance.modCount} {pluralise(instance.modCount, 'Mod', 'Mods')}
              </span>
            </>
          )}
          {instance.updateCount > 0 && (
            <span className="badge accent">{instance.updateCount} Updates</span>
          )}
        </div>

        <div className="instance-tags" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
          Zuletzt gespielt: {formatRelative(instance.lastPlayed)}
        </div>

        <div className="instance-actions">
          {instance.running ? (
            <button
              className="btn sm danger grow"
              onClick={(event) => {
                event.stopPropagation()
                void stopInstance(instance.id)
              }}
            >
              <IconStop size={13} />
              Beenden
            </button>
          ) : (
            <button
              className="btn sm primary grow"
              disabled={isStarting || instance.installing}
              onClick={(event) => {
                event.stopPropagation()
                void startInstance(instance.id, instance.name)
              }}
            >
              {isStarting ? <span className="spinner" /> : <IconPlay size={13} />}
              {isStarting ? 'Startet…' : 'Spielen'}
            </button>
          )}
          <button
            className="btn sm"
            onClick={(event) => {
              event.stopPropagation()
              navigate(`/instances/${instance.id}`)
            }}
          >
            Öffnen
          </button>
        </div>
      </div>
    </article>
  )
}
