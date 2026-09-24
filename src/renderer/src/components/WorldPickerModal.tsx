import { useEffect, useState, type JSX } from 'react'
import type { WorldInfo } from '@shared/api'
import { toastError } from '../lib/store'
import { Modal } from './ui'

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
  title = 'Welten wählen',
  subtitle,
  initialSelected = [],
  onConfirm,
  onClose
}: Props): JSX.Element {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected))
  const [applying, setApplying] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let current = true
    void window.gabi.instances
      .worlds(instanceId)
      .then((list) => {
        if (current) setWorlds(list)
      })
      .catch((err) => {
        if (!current) return
        toastError(err, 'Welten konnten nicht geladen werden')
        setLoadFailed(true)
        setWorlds([])
      })
    return () => {
      current = false
    }
  }, [instanceId])

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
      title={title}
      subtitle={subtitle ?? 'Data Packs wirken nur in Welten, denen sie zugeordnet sind.'}
      onClose={onClose}
      busy={applying}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={applying}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={() => void confirm()} disabled={applying || worlds === null}>
            {applying && <span className="spinner" />}
            Übernehmen
          </button>
        </>
      }
    >
      {worlds === null ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : loadFailed ? (
        <p className="hint">Die Welten dieser Instanz konnten nicht gelesen werden. Schließe das Fenster und versuche es erneut.</p>
      ) : worlds.length === 0 ? (
        <p className="hint">
          Diese Instanz hat noch keine Welten. Sobald du eine erstellst, kannst du das Data Pack ihr
          zuordnen.
        </p>
      ) : (
        <div className="col gap-12">
          <button
            type="button"
            className={`badge ${allSelected ? 'accent' : ''}`}
            style={{ cursor: 'pointer', alignSelf: 'flex-start' }}
            onClick={() => setSelected(allSelected ? new Set() : new Set(worlds.map((w) => w.name)))}
          >
            Alle Welten
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
