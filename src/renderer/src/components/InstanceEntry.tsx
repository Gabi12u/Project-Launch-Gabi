import { useState, type JSX, type MouseEvent } from 'react'
import type { InstanceSummary } from '@shared/types'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { repairInstanceWithOverlay, startInstance, stopInstance, toggleFavorite } from '../lib/actions'
import { useInstanceIcon } from '../lib/hooks'
import { clickable } from '../lib/a11y'
import { LOADER_LABELS, formatRelative, loaderColor, pluralise } from '../lib/format'
import { ContextMenu, type MenuItem } from './ContextMenu'
import {
  IconCopy,
  IconCube,
  IconFolder,
  IconMore,
  IconPackage,
  IconPlay,
  IconStar,
  IconStarFilled,
  IconStop,
  IconTrash,
  IconWrench
} from './Icons'

/**
 * The actions behind the "…" button, shared by the row on the instances
 * page and the tile on the home screen so the two cannot offer different
 * things for the same instance.
 */
function instanceMenu(instance: InstanceSummary, onDeleted: () => void): MenuItem[] {
  const busy = instance.running || instance.installing
  const busyReason = instance.running
    ? 'Die Instanz läuft gerade.'
    : instance.installing
      ? 'Die Instanz wird gerade eingerichtet.'
      : undefined

  return [
    {
      label: 'Bearbeiten',
      icon: <IconPackage size={14} />,
      onSelect: () => navigate(`/instances/${instance.id}?tab=settings`)
    },
    {
      label: 'Ordner öffnen',
      icon: <IconFolder size={14} />,
      onSelect: () => void window.gabi.instances.openFolder(instance.id)
    },
    {
      label: instance.favorite ? 'Favorit entfernen' : 'Als Favorit',
      icon: instance.favorite ? <IconStarFilled size={14} /> : <IconStar size={14} />,
      onSelect: () => void toggleFavorite(instance.id, !instance.favorite)
    },
    {
      label: 'Duplizieren',
      icon: <IconCopy size={14} />,
      separated: true,
      disabled: busy,
      disabledReason: busyReason,
      onSelect: () => {
        void window.gabi.instances
          .duplicate(instance.id)
          .then(async (copy) => {
            toast('success', 'Instanz dupliziert', `${copy.name} wurde angelegt.`)
            await refreshInstances()
          })
          .catch((err: unknown) => toastError(err, 'Duplizieren fehlgeschlagen'))
      }
    },
    {
      label: 'Reparieren',
      icon: <IconWrench size={14} />,
      disabled: busy,
      disabledReason: busyReason,
      onSelect: () => void repairInstanceWithOverlay(instance.id, instance.name)
    },
    {
      label: 'Löschen',
      icon: <IconTrash size={14} />,
      danger: true,
      separated: true,
      disabled: busy,
      disabledReason: busyReason,
      onSelect: onDeleted
    }
  ]
}

function useMenu(): {
  at: { x: number; y: number } | null
  open: (event: MouseEvent) => void
  close: () => void
} {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return {
    at,
    open: (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
      setAt({ x: box.right, y: box.bottom + 4 })
    },
    close: () => setAt(null)
  }
}

function LaunchButton({ instance }: { instance: InstanceSummary }): JSX.Element {
  const { starting } = useStore()
  const isStarting = starting.includes(instance.id)

  if (instance.running) {
    return (
      <button
        className="play-btn stop"
        aria-label="Beenden"
        onClick={(event) => {
          event.stopPropagation()
          void stopInstance(instance.id)
        }}
      >
        <IconStop size={15} />
      </button>
    )
  }

  return (
    <button
      className="play-btn"
      aria-label={`${instance.name} starten`}
      disabled={isStarting || instance.installing}
      onClick={(event) => {
        event.stopPropagation()
        void startInstance(instance.id, instance.name)
      }}
    >
      {isStarting ? <span className="spinner" /> : <IconPlay size={15} />}
    </button>
  )
}

/** One instance as a full-width row, the shape the instances page uses. */
export function InstanceRow({
  instance,
  onDelete
}: {
  instance: InstanceSummary
  onDelete: (instance: InstanceSummary) => void
}): JSX.Element {
  const iconSrc = useInstanceIcon(instance)
  const menu = useMenu()

  return (
    <>
      <div className="inst-row" {...clickable(() => navigate(`/instances/${instance.id}`))}>
        <div className="inst-row-icon">
          {iconSrc ? <img src={iconSrc} alt="" /> : (instance.appearance.icon ?? <IconCube size={19} />)}
        </div>

        <div className="inst-row-main">
          <div className="row gap-8">
            <span className="inst-row-name truncate">{instance.name}</span>
            {instance.running && <span className="badge ok dot live">Läuft</span>}
            {instance.installing && !instance.running && (
              <span className="badge accent">
                <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                Setup
              </span>
            )}
            {instance.favorite && <IconStarFilled size={12} style={{ color: 'var(--warn)' }} />}
          </div>

          <div className="inst-row-chips">
            <span className="chip">
              <IconCube size={11} />
              {instance.mcVersion}
            </span>
            <span
              className="chip loader"
              style={{ ['--loader-color' as string]: loaderColor(instance.loader) }}
            >
              {LOADER_LABELS[instance.loader]}
            </span>
            <span className="chip">
              {instance.modCount} {pluralise(instance.modCount, 'Mod', 'Mods')}
            </span>
            {instance.updateCount > 0 && (
              <span className="chip" style={{ color: 'var(--warn)' }}>
                {instance.updateCount} Updates
              </span>
            )}
          </div>
        </div>

        <span className="inst-row-played">Zuletzt gespielt: {formatRelative(instance.lastPlayed)}</span>

        <LaunchButton instance={instance} />

        <button className="sq-btn" aria-label="Mehr" onClick={menu.open}>
          <IconMore size={16} />
        </button>
      </div>

      {menu.at && (
        <ContextMenu
          x={menu.at.x}
          y={menu.at.y}
          onClose={menu.close}
          items={instanceMenu(instance, () => onDelete(instance))}
        />
      )}
    </>
  )
}

/** The compact card the home screen shows in a row. */
export function InstanceTile({
  instance,
  onDelete
}: {
  instance: InstanceSummary
  onDelete: (instance: InstanceSummary) => void
}): JSX.Element {
  const iconSrc = useInstanceIcon(instance)
  const menu = useMenu()

  return (
    <>
      <div className="inst-tile" {...clickable(() => navigate(`/instances/${instance.id}`))}>
        <div className="inst-tile-top">
          <div className="inst-row-icon" style={{ width: 34, height: 34, fontSize: 17 }}>
            {iconSrc ? <img src={iconSrc} alt="" /> : (instance.appearance.icon ?? <IconCube size={16} />)}
          </div>
          <button className="sq-btn" style={{ width: 28, height: 28 }} aria-label="Mehr" onClick={menu.open}>
            <IconMore size={14} />
          </button>
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="inst-tile-name truncate">{instance.name}</div>
          <div className="inst-tile-ver">
            {instance.mcVersion} · {LOADER_LABELS[instance.loader]}
          </div>
        </div>

        <div className="inst-tile-foot">
          <LaunchButton instance={instance} />
        </div>
      </div>

      {menu.at && (
        <ContextMenu
          x={menu.at.x}
          y={menu.at.y}
          onClose={menu.close}
          items={instanceMenu(instance, () => onDelete(instance))}
        />
      )}
    </>
  )
}
