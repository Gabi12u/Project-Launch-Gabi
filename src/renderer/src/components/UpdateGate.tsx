import { useState, type JSX } from 'react'
import { setState, toast, toastError, useStore } from '../lib/store'
import { pluralise } from '../lib/format'
import { startInstanceForced } from '../lib/actions'
import { Modal } from './ui'
import { IconDownload } from './Icons'

/**
 * Modal shown when Play is pressed and outdated mods are already known
 * about, so an update is at least offered before playing an old version
 * rather than only ever surfacing as a badge someone has to notice on their
 * own.
 */
export function UpdateGate(): JSX.Element | null {
  const { modUpdateGate } = useStore()
  const [updating, setUpdating] = useState(false)

  if (!modUpdateGate) return null

  const { instanceId, instanceName, count } = modUpdateGate

  const close = (): void => setState({ modUpdateGate: null })

  const playWithoutUpdating = (): void => {
    close()
    void startInstanceForced(instanceId, instanceName)
  }

  const updateThenPlay = async (): Promise<void> => {
    setUpdating(true)
    try {
      const updated = await window.gabi.content.updateAll(instanceId)
      toast('success', `${updated} ${pluralise(updated, 'Mod', 'Mods')} aktualisiert`)
      close()
      void startInstanceForced(instanceId, instanceName)
    } catch (err) {
      toastError(err, 'Update fehlgeschlagen')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Modal
      open
      title="Mods sind veraltet"
      subtitle={`${instanceName} hat ${count} ${pluralise(count, 'veraltete Mod', 'veraltete Mods')}.`}
      onClose={close}
      busy={updating}
      footer={
        <>
          <button className="btn ghost" onClick={playWithoutUpdating} disabled={updating}>
            Nicht jetzt
          </button>
          <button className="btn primary" onClick={updateThenPlay} disabled={updating}>
            {updating ? <span className="spinner" /> : <IconDownload size={14} />}
            Jetzt updaten
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
        <p style={{ margin: 0 }}>
          Es gibt neuere Versionen für {count} {pluralise(count, 'Mod', 'Mods')} dieser Instanz. Du kannst
          jetzt aktualisieren, oder mit den bisherigen Versionen weiterspielen und später updaten.
        </p>
      </div>
    </Modal>
  )
}
