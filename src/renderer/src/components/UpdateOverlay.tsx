import { useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from '../lib/store'
import { updateHeadline } from '../lib/format'
import { t } from '../lib/i18n'
import { Modal, ProgressBar } from './ui'

interface LogEntry {
  time: number
  text: string
}

/**
 * A dedicated view of the launcher's own update, instead of only a toast and
 * a line in Settings. The state machine and its progress already exist in
 * `updater.ts` and reach the renderer via `updateStatus`; this only turns
 * that stream into a visible window and a small log built from watching it
 * change, the same shape as the repair and launch overlays.
 */
export function UpdateOverlay(): JSX.Element | null {
  const { updateStatus } = useStore()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const lastState = useRef<string | null>(null)
  // Read inside the effect below without making visibility itself a
  // dependency: whether an error or "up to date" line is worth logging
  // depends on whether the window was already open going into this state
  // change, not on the effect re-running every time that flag flips.
  const visibleRef = useRef(false)
  visibleRef.current = visible

  useEffect(() => {
    if (!updateStatus) return
    const state = updateStatus.state

    if (state === lastState.current) {
      // Progress ticks within the same state, so the download percentage
      // still shows something moving instead of one line sitting at 0%.
      if (state === 'downloading') {
        const text = t('overlays', 'update.log.downloadProgress', {
          percent: Math.round(updateStatus.percent ?? 0)
        })
        setEntries((current) => {
          const last = current[current.length - 1]
          if (last?.text === text) return current
          return [...current, { time: Date.now(), text }].slice(-200)
        })
      }
      return
    }
    lastState.current = state

    // Only an update genuinely in progress opens this on its own. A routine
    // background check that finds nothing, or one that fails quietly, has no
    // business interrupting whatever the user is doing.
    if (state === 'downloading' || state === 'ready' || state === 'installing') {
      setVisible(true)
      setDismissed(false)
    }

    let text: string | null = null
    switch (state) {
      case 'checking':
        text = t('overlays', 'update.log.checking')
        break
      case 'available':
        text = t('overlays', 'update.log.available', { version: updateStatus.version ?? '' })
        break
      case 'downloading':
        text = t('overlays', 'update.log.downloading')
        break
      case 'ready':
        text = t('overlays', 'update.log.ready')
        break
      case 'installing':
        text = t('overlays', 'update.log.installing')
        break
      case 'up-to-date':
        text = visibleRef.current ? t('overlays', 'update.log.upToDate') : null
        break
      case 'error':
        text = visibleRef.current
          ? t('overlays', 'update.log.error', {
              error: updateStatus.error ?? t('overlays', 'update.log.errorFallback')
            })
          : null
        break
      default:
        text = null
    }

    if (text) setEntries((current) => [...current, { time: Date.now(), text: text! }].slice(-200))
  }, [updateStatus])

  if (!updateStatus || !visible || dismissed) return null

  const close = (): void => setDismissed(true)

  return (
    <Modal open title={t('overlays', 'update.title')} subtitle={updateHeadline(updateStatus)} onClose={close} width="wide" footer={<button className="btn" onClick={close}>{t('common', 'close')}</button>}>
      <div className="col gap-12">
        {updateStatus.state === 'downloading' && <ProgressBar value={(updateStatus.percent ?? 0) / 100} />}

        <div className="log-view" style={{ maxHeight: 280 }}>
          {entries.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>
              {t('overlays', 'update.noEvents')}
            </div>
          ) : (
            entries.map((entry, index) => (
              <div key={index} className="log-line launcher">
                <span className="log-time">
                  {new Date(entry.time).toLocaleTimeString('de-DE', { hour12: false })}
                </span>
                <span>{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
