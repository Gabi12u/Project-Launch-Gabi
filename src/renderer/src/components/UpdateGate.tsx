import { useState, type JSX } from 'react'
import { refreshInstances, setState, toast, toastError, useStore } from '../lib/store'
import { pluralise } from '../lib/format'
import { startInstanceForced } from '../lib/actions'
import { Modal } from './ui'
import { IconDownload } from './Icons'
import { tr } from '@shared/i18n'

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
      toast('success', tr(`${updated} ${pluralise(updated, 'Mod', 'Mods')} aktualisiert`, `${updated} ${pluralise(updated, 'mod', 'mods')} updated`))
      await refreshInstances()
      close()
      // Not routed back through startInstance: it would read the update count
      // from the store, which was only just refreshed above and could still
      // reopen this same gate. Checking compatibility directly here, the same
      // API CompatibilityGate uses, only skips the update check while still
      // catching mod conflicts caused by the update itself.
      const report = await window.gabi.content.compatibility(instanceId)
      if (report.launchable) {
        void startInstanceForced(instanceId, instanceName)
      } else {
        setState({ compatGate: { instanceId, instanceName, report } })
      }
    } catch (err) {
      toastError(err, tr('Update fehlgeschlagen', 'Update failed'))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Modal
      open
      title={tr('Mods sind veraltet', 'Mods are outdated')}
      subtitle={tr(
        `${instanceName} hat ${count} ${pluralise(count, 'veralteten Mod', 'veraltete Mods')}.`,
        `${instanceName} has ${count} ${pluralise(count, 'outdated mod', 'outdated mods')}.`
      )}
      onClose={close}
      busy={updating}
      footer={
        <>
          <button className="btn ghost" onClick={playWithoutUpdating} disabled={updating}>
            {tr('Nicht jetzt', 'Not now')}
          </button>
          <button className="btn primary" onClick={updateThenPlay} disabled={updating}>
            {updating ? <span className="spinner" /> : <IconDownload size={14} />}
            {tr('Jetzt aktualisieren', 'Update now')}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
        <p style={{ margin: 0 }}>
          {tr(
            `Es gibt neuere Versionen für ${count} ${pluralise(count, 'Mod', 'Mods')} dieser Instanz. Du kannst jetzt aktualisieren oder mit den bisherigen Versionen weiterspielen und später aktualisieren.`,
            `There are newer versions for ${count} ${pluralise(count, 'mod', 'mods')} of this instance. You can update now, or keep playing with the current versions and update later.`
          )}
        </p>
      </div>
    </Modal>
  )
}
