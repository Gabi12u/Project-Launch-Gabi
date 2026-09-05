import { useEffect, useRef, useState, type JSX } from 'react'
import type { LogLine } from '@shared/types'
import { setState, useStore } from '../lib/store'
import { repairInstanceWithOverlay } from '../lib/actions'
import { formatTime } from '../lib/format'
import { t } from '../lib/i18n'
import { Modal, ProgressBar } from './ui'
import { IconWrench } from './Icons'

interface CrashAnalysis {
  cause: string
  suggestRepair: boolean
}

/**
 * Best-effort reading of the last lines before a crash, not a real
 * diagnosis. It only recognises a handful of well-known shapes (a mixin
 * failing to apply, a missing dependency, a Java/Minecraft version
 * mismatch, running out of heap) and says plainly when none of them match,
 * rather than inventing a specific-sounding cause it has no basis for.
 */
function analyzeCrash(lines: LogLine[]): CrashAnalysis {
  const text = lines.map((line) => line.text).join('\n')

  if (!text.trim()) {
    return {
      cause: t('overlays', 'launch.crash.noLog'),
      suggestRepair: true
    }
  }
  if (/OutOfMemoryError/i.test(text)) {
    return {
      cause: t('overlays', 'launch.crash.outOfMemory'),
      suggestRepair: false
    }
  }
  if (/UnsupportedClassVersionError|has been compiled by a more recent version/i.test(text)) {
    return { cause: t('overlays', 'launch.crash.javaVersion'), suggestRepair: true }
  }
  if (/mixin.*(apply|inject).*fail|MixinApplicatorStandard|mixin\.injection\.throwables/i.test(text)) {
    return {
      cause: t('overlays', 'launch.crash.mixinFailed'),
      suggestRepair: true
    }
  }
  if (/ModResolutionException|requires[^\n]*but[^\n]*(is|was) (not present|missing)|duplicate mod id/i.test(text)) {
    return { cause: t('overlays', 'launch.crash.modDependency'), suggestRepair: true }
  }
  if (/was designed for minecraft|is incompatible with/i.test(text)) {
    return { cause: t('overlays', 'launch.crash.modIncompatible'), suggestRepair: true }
  }
  if (/Exception|Error/i.test(text)) {
    return {
      cause: t('overlays', 'launch.crash.unexpectedError'),
      suggestRepair: true
    }
  }
  return { cause: t('overlays', 'launch.crash.unknown'), suggestRepair: true }
}

const SETTLED_PHASES = new Set(['running', 'crashed', 'stopped', 'idle'])

/**
 * Shown from the moment Play is accepted until Minecraft is up (or the
 * launch failed), using the phase text `launch.ts` already produces and the
 * same live log stream the "Logs" tab reads. A crash keeps it open with a
 * best-effort explanation and a direct way into the repair overlay, instead
 * of just leaving the instance back on "Beendet" with no further comment.
 */
export function LaunchOverlay(): JSX.Element | null {
  const { launchOverlay, launchStatus } = useStore()
  const [lines, setLines] = useState<LogLine[]>([])
  const boxRef = useRef<HTMLDivElement>(null)

  const instanceId = launchOverlay?.instanceId ?? null
  const status = instanceId ? launchStatus[instanceId] : undefined

  useEffect(() => {
    setLines([])
    if (!instanceId) return
    return window.gabi.events.onLogLine((line) => {
      if (line.instanceId !== instanceId) return
      setLines((current) => [...current, line].slice(-600))
    })
  }, [instanceId])

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines])

  // A clean "running" reads as a status window, not something to dismiss by
  // hand every time — it closes itself a moment after the message shows. A
  // crash or an immediate failure stays up, since that is exactly when the
  // explanation and the repair button matter.
  useEffect(() => {
    if (status?.phase !== 'running' || !instanceId) return
    const timer = setTimeout(() => {
      setState((current) => (current.launchOverlay?.instanceId === instanceId ? { launchOverlay: null } : {}))
    }, 2500)
    return () => clearTimeout(timer)
  }, [status?.phase, instanceId])

  if (!launchOverlay) return null

  const close = (): void => setState({ launchOverlay: null })
  const crashed = status?.phase === 'crashed'
  const failedEarly = status?.phase === 'idle' && !!status.detail
  const analysis = crashed ? analyzeCrash(lines) : null
  const settled = status ? SETTLED_PHASES.has(status.phase) : false

  const repairNow = (): void => {
    close()
    void repairInstanceWithOverlay(launchOverlay.instanceId, launchOverlay.instanceName)
  }

  return (
    <Modal
      open
      title={launchOverlay.instanceName}
      subtitle={status?.detail ?? t('overlays', 'launch.preparing')}
      onClose={close}
      busy={!settled}
      width="wide"
      footer={
        crashed || failedEarly ? (
          <>
            <button className="btn ghost" onClick={close}>
              {t('common', 'close')}
            </button>
            {(!crashed || analysis?.suggestRepair) && (
              <button className="btn primary" onClick={repairNow}>
                <IconWrench size={14} />
                {t('overlays', 'launch.repairAction')}
              </button>
            )}
          </>
        ) : settled ? (
          <button className="btn primary" onClick={close}>
            {t('common', 'close')}
          </button>
        ) : (
          <span className="hint row gap-8">
            <span className="spinner" style={{ width: 12, height: 12 }} />
            {t('overlays', 'launch.starting')}
          </span>
        )
      }
    >
      <div className="col gap-12">
        {!settled && <ProgressBar value={status?.progress ?? null} />}

        {crashed && analysis && (
          <div className="col gap-8">
            <div className="badge danger">{t('overlays', 'launch.crashedBadge')}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
              <strong>{t('overlays', 'launch.possibleCause')}</strong> {analysis.cause}
            </div>
          </div>
        )}

        {status?.phase === 'running' && <div className="badge ok">{t('overlays', 'launch.startedBadge')}</div>}

        <div className="log-view" ref={boxRef} style={{ maxHeight: 320 }}>
          {lines.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>
              {t('overlays', 'launch.noOutput')}
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
