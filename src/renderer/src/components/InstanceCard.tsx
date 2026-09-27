import { useState, type JSX } from 'react'
import type { InstanceSummary } from '@shared/types'
import { navigate, refreshInstances, toast, toastError, useStore } from '../lib/store'
import { startInstance, stopInstance, toggleFavorite } from '../lib/actions'
import { useInstanceIcon, useTilt } from '../lib/hooks'
import { clickable } from '../lib/a11y'
import { LOADER_LABELS, formatRelative, loaderColor, pluralise } from '../lib/format'
import { IconCopy, IconExternal, IconFolder, IconPlay, IconStar, IconStarFilled, IconStop, IconTrash } from './Icons'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'
import { Confirm } from './ui'
import { tr } from '@shared/i18n'

export function InstanceCard({ instance }: { instance: InstanceSummary }): JSX.Element {
  const { starting } = useStore()
  const iconSrc = useInstanceIcon(instance)
  const isStarting = starting.includes(instance.id)
  const tilt = useTilt<HTMLElement>(5)
  const menu = useContextMenu<null>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  const accent = instance.appearance.accent
  // Mirrors the guards the main process itself has against duplicating: it
  // refuses while the instance is running, starting, mid setup or mid mod
  // change, so the entry is greyed out here instead of failing on click.
  const duplicateBlocked = instance.running || isStarting || instance.installing || instance.contentBusy

  const duplicate = async (): Promise<void> => {
    setDuplicating(true)
    try {
      await window.gabi.instances.duplicate(instance.id)
      toast('success', tr('Instanz dupliziert', 'Instance duplicated'), instance.name)
      await refreshInstances()
    } catch (err) {
      toastError(err, tr('Instanz konnte nicht dupliziert werden', 'Instance could not be duplicated'))
    } finally {
      setDuplicating(false)
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await window.gabi.instances.remove(instance.id)
      toast('info', tr('Instanz gelöscht', 'Instance deleted'), instance.name)
      await refreshInstances()
    } catch (err) {
      toastError(err, tr('Instanz konnte nicht gelöscht werden', 'Instance could not be deleted'))
    } finally {
      setConfirmDelete(false)
    }
  }

  const menuItems: MenuItem[] = [
    {
      label: instance.running ? tr('Beenden', 'Stop') : tr('Spielen', 'Play'),
      icon: instance.running ? <IconStop size={14} /> : <IconPlay size={14} />,
      disabled: !instance.running && (isStarting || instance.installing),
      onSelect: () => {
        if (instance.running) void stopInstance(instance.id)
        else void startInstance(instance.id, instance.name)
      }
    },
    {
      label: tr('Öffnen', 'Open'),
      icon: <IconExternal size={14} />,
      onSelect: () => navigate(`/instances/${instance.id}`)
    },
    {
      label: tr('Ordner öffnen', 'Open folder'),
      icon: <IconFolder size={14} />,
      onSelect: () => void window.gabi.instances.openFolder(instance.id)
    },
    {
      label: tr('Duplizieren', 'Duplicate'),
      icon: <IconCopy size={14} />,
      disabled: duplicateBlocked || duplicating,
      disabledReason: tr('Die Instanz läuft gerade oder wird gerade bearbeitet.', 'The instance is running or being worked on right now.'),
      separated: true,
      onSelect: () => void duplicate()
    },
    {
      label: tr('Löschen', 'Delete'),
      icon: <IconTrash size={14} />,
      danger: true,
      disabled: instance.running,
      disabledReason: tr('Beende die Instanz zuerst.', 'Stop the instance first.'),
      onSelect: () => setConfirmDelete(true)
    }
  ]

  return (
    <>
    <article
      className="instance-card"
      style={{ ['--card-accent' as string]: accent }}
      aria-label={instance.name}
      {...clickable(() => navigate(`/instances/${instance.id}`))}
      {...tilt}
      onContextMenu={(event) => menu.onContextMenu(event, null)}
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
            aria-label={instance.favorite ? tr('Favorit entfernen', 'Remove favorite') : tr('Als Favorit markieren', 'Mark as favorite')}
          >
            {instance.favorite ? <IconStarFilled size={14} /> : <IconStar size={14} />}
          </button>
        </div>
      </div>

      <div className="instance-body">
        <div className="row-between" style={{ gap: 8 }}>
          <span className="instance-name truncate">{instance.name}</span>
          {instance.running && <span className="badge ok dot live">{tr('Läuft', 'Running')}</span>}
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
            <span className="badge accent">
              {instance.updateCount} {pluralise(instance.updateCount, 'Update', 'Updates')}
            </span>
          )}
        </div>

        <div className="instance-tags" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
          {tr('Zuletzt gespielt', 'Last played')}: {formatRelative(instance.lastPlayed)}
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
              {tr('Beenden', 'Stop')}
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
              {isStarting ? tr('Startet…', 'Starting…') : tr('Spielen', 'Play')}
            </button>
          )}
          <button
            className="btn sm"
            onClick={(event) => {
              event.stopPropagation()
              navigate(`/instances/${instance.id}`)
            }}
          >
            {tr('Öffnen', 'Open')}
          </button>
        </div>
      </div>
    </article>

    {menu.open && <ContextMenu x={menu.open.x} y={menu.open.y} items={menuItems} onClose={menu.close} />}

    <Confirm
      open={confirmDelete}
      title={tr('Instanz löschen?', 'Delete instance?')}
      danger
      confirmLabel={tr('Endgültig löschen', 'Delete permanently')}
      message={
        <>
          <strong>{instance.name}</strong> {tr('wird mit allen Mods, Welten, Screenshots, Aufnahmen und Sicherungen unwiderruflich gelöscht. Das lässt sich nicht rückgängig machen.', 'will be deleted permanently with all mods, worlds, screenshots, recordings and backups. This cannot be undone.')}
        </>
      }
      onConfirm={remove}
      onCancel={() => setConfirmDelete(false)}
    />
    </>
  )
}
