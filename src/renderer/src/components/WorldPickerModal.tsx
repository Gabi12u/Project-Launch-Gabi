import { useCallback, useEffect, useState, type JSX } from 'react'
import type { WorldInfo } from '@shared/api'
import { toastError } from '../lib/store'
import { Modal } from './ui'
import { tr } from '@shared/i18n'

interface Props {
  instanceId: string
  title?: string
  subtitle?: string
  /** Worlds already checked when the modal opens. */
  initialSelected?: string[]
  onConfirm: (worlds: string[]) => void | Promise<void>
  onClose: () => void
}

/**
 * Lets the user pick which of an instance's worlds a datapack should be
 * copied into, the same choice Prism asks for on install.
 *
 * Used both right after installing a datapack and, later, from its row in
 * the installed-content list ("Welten wählen"), so the world list is always
 * fetched fresh rather than passed in: worlds created in between must show up.
 */
export function WorldPickerModal({
  instanceId,
  title,
  subtitle,
  initialSelected = [],
  onConfirm,
  onClose
}: Props): JSX.Element {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected))
  const [applying, setApplying] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  // Reused by the "Erneut versuchen" button below, so a failed load never
  // strands the user with nothing to do but close the modal.
  const load = useCallback(() => {
    let current = true
    setWorlds(null)
    setLoadFailed(false)
    void window.gabi.instances
      .worlds(instanceId)
      .then((list) => {
        if (!current) return
        setWorlds(list)
        // A world deleted since it was assigned had no checkbox left to untick
        // and made every save fail. Only worlds that exist stay selected.
        setSelected((previous) => new Set([...previous].filter((name) => list.some((world) => world.name === name))))
      })
      .catch((err) => {
        if (!current) return
        toastError(err, tr('Welten konnten nicht geladen werden', 'Worlds could not be loaded'))
        setLoadFailed(true)
        setWorlds([])
      })
    return () => {
      current = false
    }
  }, [instanceId])

  useEffect(() => load(), [load])

  const toggle = (name: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const allSelected = worlds !== null && worlds.length > 0 && worlds.every((w) => selected.has(w.name))

  const confirm = async (): Promise<void> => {
    setApplying(true)
    try {
      await onConfirm(Array.from(selected))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      open
      title={title ?? tr('Welten wählen', 'Choose worlds')}
      subtitle={subtitle ?? tr('Data Packs wirken nur in Welten, denen sie zugeordnet sind.', 'Data packs only work in worlds they are assigned to.')}
      onClose={onClose}
      busy={applying}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={applying}>
            {tr('Abbrechen', 'Cancel')}
          </button>
          <button className="btn primary" onClick={() => void confirm()} disabled={applying || worlds === null}>
            {applying && <span className="spinner" />}
            {tr('Übernehmen', 'Apply')}
          </button>
        </>
      }
    >
      {worlds === null ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : loadFailed ? (
        <div className="col gap-12" style={{ alignItems: 'flex-start' }}>
          <p className="hint">{tr('Die Welten dieser Instanz konnten nicht gelesen werden.', 'The worlds of this instance could not be read.')}</p>
          <button type="button" className="btn sm" onClick={() => load()}>
            {tr('Erneut versuchen', 'Try again')}
          </button>
        </div>
      ) : worlds.length === 0 ? (
        <p className="hint">
          {tr(
            'Diese Instanz hat noch keine Welten. Sobald du eine erstellst, kannst du das Data Pack ihr zuordnen.',
            'This instance has no worlds yet. As soon as you create one, you can assign the data pack to it.'
          )}
        </p>
      ) : (
        <div className="col gap-12">
          <button
            type="button"
            className={`badge ${allSelected ? 'accent' : ''}`}
            style={{ cursor: 'pointer', alignSelf: 'flex-start' }}
            onClick={() => setSelected(allSelected ? new Set() : new Set(worlds.map((w) => w.name)))}
          >
            {tr('Alle Welten', 'All worlds')}
          </button>

          <div className="col gap-4">
            {worlds.map((world) => (
              <label key={world.folder} className="row gap-8" style={{ cursor: 'pointer', padding: '6px 0' }}>
                <input type="checkbox" checked={selected.has(world.name)} onChange={() => toggle(world.name)} />
                <span style={{ fontSize: 13.5 }}>{world.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
