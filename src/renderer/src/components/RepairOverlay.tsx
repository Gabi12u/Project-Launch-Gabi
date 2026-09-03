import { useEffect, useRef, useState, type JSX } from 'react'
import type { LogLine } from '@shared/types'
import { setState, useStore } from '../lib/store'
import { formatTime } from '../lib/format'
import { Modal, ProgressBar } from './ui'

/**
 * Live view of a repair in progress: the same phase text and progress the
 * task dock already carries, plus a scrolling log of every check, warning
 * and fix as `repair.ts` reports it, through the same log stream the
 * instance's own "Logs" tab reads. Stays open (and reachable from anywhere,
 * not just the instance page that started it) until the user closes it, so
 * the final banner is not just a toast that already faded.
 */
export function RepairOverlay(): JSX.Element | null {
  const { repairGate, tasks } = useStore()
  const [lines, setLines] = useState<LogLine[]>([])
  const boxRef = useRef<HTMLDivElement>(null)

  const gateInstanceId = repairGate?.instanceId ?? null

  useEffect(() => {
    setLines([])
    if (!gateInstanceId) return
    return window.gabi.events.onLogLine((line) => {
      if (line.instanceId !== gateInstanceId) return
      setLines((current) => [...current, line].slice(-800))
    })
  }, [gateInstanceId])

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines])

  if (!repairGate) return null

  const task = tasks.find(
    (t) => t.instanceId === repairGate.instanceId && t.title.endsWith('wird repariert')
  )
  const running = task ? task.state === 'running' : !repairGate.report
  const failed = repairGate.report?.steps.some((s) => s.status === 'failed') ?? false

  const close = (): void => setState({ repairGate: null })

  return (
    <Modal
      open
      title={`Reparatur: ${repairGate.instanceName}`}
      subtitle={running ? (task?.detail ?? 'Wird vorbereitet…') : undefined}
      onClose={close}
      busy={running}
      width="wide"
      footer={
        running ? (
          <span className="hint row gap-8">
            <span className="spinner" style={{ width: 12, height: 12 }} />
            Wird ausgeführt…
          </span>
        ) : (
          <button className="btn primary" onClick={close}>
            Fertig
          </button>
        )
      }
    >
      <div className="col gap-12">
        {running && <ProgressBar value={task?.progress ?? null} />}

        {!running && repairGate.report && (
          <div className={`badge ${failed ? 'warn' : 'ok'}`} style={{ fontSize: 13 }}>
            {failed ? '⚠ Einige Probleme konnten nicht automatisch behoben werden' : '✓ Reparatur erfolgreich'}
          </div>
        )}

        <div className="log-view" ref={boxRef} style={{ maxHeight: 340 }}>
          {lines.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>
              Noch keine Ausgabe.
            </div>
          ) : (
            lines.map((line, index) => (
              <div key={index} className={`log-line ${line.stream === 'launcher' ? 'launcher' : line.level}`}>
                <span className="log-time">{formatTime(line.time)}</span>
                <span>{line.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
