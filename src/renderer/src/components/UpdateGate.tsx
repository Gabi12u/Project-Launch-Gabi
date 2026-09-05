import { useState, type JSX } from 'react'
import { setState, toast, toastError, useStore } from '../lib/store'
import { pluralise } from '../lib/format'
import { startInstanceForced } from '../lib/actions'
import { t } from '../lib/i18n'
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
      toast(
        'success',
        t('overlays', 'updateGate.updated', {
          count: updated,
          mod: pluralise(updated, t('overlays', 'mod.singular'), t('overlays', 'mod.plural'))
        })
      )
      close()
      void startInstanceForced(instanceId, instanceName)
    } catch (err) {
      toastError(err, t('overlays', 'updateGate.updateFailed'))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Modal
      open
      title={t('overlays', 'updateGate.title')}
      subtitle={t('overlays', 'updateGate.subtitle', {
        name: instanceName,
        count,
        outdatedMod: pluralise(
          count,
          t('overlays', 'updateGate.outdatedMod.one'),
          t('overlays', 'updateGate.outdatedMod.other')
        )
      })}
      onClose={close}
      busy={updating}
      footer={
        <>
          <button className="btn ghost" onClick={playWithoutUpdating} disabled={updating}>
            {t('overlays', 'updateGate.notNow')}
          </button>
          <button className="btn primary" onClick={updateThenPlay} disabled={updating}>
            {updating ? <span className="spinner" /> : <IconDownload size={14} />}
            {t('overlays', 'updateGate.updateNow')}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
        <p style={{ margin: 0 }}>
          {t('overlays', 'updateGate.body', {
            count,
            mod: pluralise(count, t('overlays', 'mod.singular'), t('overlays', 'mod.plural'))
          })}
        </p>
      </div>
    </Modal>
  )
}
