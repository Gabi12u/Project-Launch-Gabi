import { useEffect, useState, type JSX } from 'react'
import type { CompatibilityIssue, CompatibilityReport } from '@shared/types'
import { setState, toast, toastError, useStore } from '../lib/store'
import { pluralise } from '../lib/format'
import { startInstanceForced } from '../lib/actions'
import { Modal } from './ui'
import { IconCheckCircle, IconInfo, IconPlay, IconSparkle, IconWarning } from './Icons'

const ISSUE_ICON = {
  error: IconWarning,
  warning: IconWarning,
  info: IconInfo
}

export function IssueRow({
  issue,
  onFix,
  fixing
}: {
  issue: CompatibilityIssue
  onFix?: (issue: CompatibilityIssue) => void
  fixing?: boolean
}): JSX.Element {
  const Icon = ISSUE_ICON[issue.severity]

  return (
    <div className={`issue ${issue.severity}`}>
      <div className="issue-icon">
        <Icon size={17} />
      </div>
      <div className="grow">
        <div className="issue-title">{issue.title}</div>
        <div className="issue-detail">{issue.detail}</div>
      </div>
      {issue.fix && onFix && (
        <button
          className="btn sm primary"
          onClick={() => onFix(issue)}
          disabled={fixing}
          style={{ alignSelf: 'center', flexShrink: 0 }}
        >
          {fixing ? <span className="spinner" /> : <IconSparkle size={14} />}
          {issue.fix.label}
        </button>
      )}
    </div>
  )
}

interface PanelProps {
  report: CompatibilityReport | null
  instanceId: string
  onChanged: (report: CompatibilityReport) => void
  loading?: boolean
}

/** Inline version used on the instance page. */
export function CompatibilityPanel({ report, instanceId, onChanged, loading }: PanelProps): JSX.Element {
  const [fixing, setFixing] = useState<string | null>(null)

  const applyFix = async (issue: CompatibilityIssue): Promise<void> => {
    if (!issue.fix) return
    setFixing(issue.id)
    try {
      const next = await window.gabi.content.applyFix(instanceId, issue.fix)
      onChanged(next)
      toast('success', 'Problem behoben', issue.title)
    } catch (err) {
      toastError(err, 'Das Problem konnte nicht behoben werden')
    } finally {
      setFixing(null)
    }
  }

  const fixAll = async (): Promise<void> => {
    if (!report) return
    const fixable = report.issues.filter((i) => i.fix)
    setFixing('all')
    // Reported after every step, not only once the whole run finishes. Each
    // applyFix has already taken effect on disk by the time it returns, so
    // holding the result back meant a failure halfway through discarded the
    // successes before it and left the panel showing problems that were
    // already gone.
    let latest = report
    let done = 0
    try {
      for (const issue of fixable) {
        latest = await window.gabi.content.applyFix(instanceId, issue.fix!)
        done++
        onChanged(latest)
      }
      toast(
        'success',
        'Fertig',
        done === 1 ? '1 Problem wurde automatisch behoben.' : `${done} Probleme wurden automatisch behoben.`
      )
    } catch (err) {
      onChanged(latest)
      toastError(
        err,
        done > 0
          ? `${done} von ${fixable.length} Problemen behoben, dann trat ein Fehler auf`
          : 'Nicht alle Probleme konnten behoben werden'
      )
    } finally {
      setFixing(null)
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="row gap-12">
          <span className="spinner" />
          <span className="muted">Mods werden geprüft…</span>
        </div>
      </div>
    )
  }

  if (!report) return <></>

  if (report.issues.length === 0) {
    return (
      <div className="card">
        <div className="row gap-12">
          <div className="issue-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
            <IconCheckCircle size={17} />
          </div>
          <div className="col">
            <div style={{ fontSize: 13.5, fontWeight: 650 }}>Alles in Ordnung</div>
            <div className="hint">Keine Konflikte, keine fehlenden Abhängigkeiten.</div>
          </div>
        </div>
      </div>
    )
  }

  const errors = report.issues.filter((i) => i.severity === 'error').length
  const fixable = report.issues.filter((i) => i.fix).length

  return (
    <div className="col gap-12">
      <div className="row-between">
        <div className="row gap-8">
          <span className={`badge ${errors > 0 ? 'danger' : 'warn'} dot`}>
            {errors > 0
              ? `${errors} ${errors === 1 ? 'Problem' : 'Probleme'}`
              : `${report.issues.length} ${pluralise(report.issues.length, 'Hinweis', 'Hinweise')}`}
          </span>
          {report.launchable && <span className="badge ok">Start möglich</span>}
        </div>
        {fixable > 1 && (
          <button className="btn sm primary" onClick={fixAll} disabled={fixing !== null}>
            {fixing === 'all' ? <span className="spinner" /> : <IconSparkle size={14} />}
            Alle automatisch beheben
          </button>
        )}
      </div>

      <div className="col gap-8">
        {report.issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} onFix={applyFix} fixing={fixing === issue.id} />
        ))}
      </div>
    </div>
  )
}

/** Modal shown when a launch is blocked. */
export function CompatibilityGate(): JSX.Element | null {
  const { compatGate } = useStore()
  const [fixing, setFixing] = useState(false)
  const [report, setReport] = useState<CompatibilityReport | null>(null)

  const gateInstanceId = compatGate?.instanceId ?? null

  // The gate in the store can be swapped to another instance without `close()`
  // ever running — the command palette is reachable while this modal is open.
  // Without the reset the new instance's name would sit above the previous
  // instance's issue list.
  useEffect(() => {
    setReport(null)
  }, [gateInstanceId])

  const current = report ?? compatGate?.report ?? null

  if (!compatGate || !current) return null

  const close = (): void => {
    setReport(null)
    setState({ compatGate: null })
  }

  const fixAll = async (): Promise<void> => {
    setFixing(true)
    // Same reasoning as the panel above: publish each result as it lands, so a
    // failure partway through does not throw away the fixes that succeeded.
    let latest = current
    try {
      for (const issue of current.issues.filter((i) => i.fix)) {
        latest = await window.gabi.content.applyFix(compatGate.instanceId, issue.fix!)
        setReport(latest)
      }

      if (latest.launchable) {
        toast('success', 'Probleme behoben', 'Die Instanz kann jetzt gestartet werden.')
        close()
        void startInstanceForced(compatGate.instanceId, compatGate.instanceName)
      }
    } catch (err) {
      setReport(latest)
      toastError(err, 'Automatische Reparatur fehlgeschlagen')
    } finally {
      setFixing(false)
    }
  }

  const errors = current.issues.filter((i) => i.severity === 'error')
  const fixable = current.issues.filter((i) => i.fix).length

  return (
    <Modal
      open
      title="⚠️ Problem gefunden"
      subtitle={`${compatGate.instanceName} kann so nicht gestartet werden.`}
      onClose={close}
      busy={fixing}
      width="wide"
      footer={
        <>
          <button className="btn ghost" onClick={close} disabled={fixing}>
            Abbrechen
          </button>
          <button
            className="btn"
            onClick={() => {
              close()
              void startInstanceForced(compatGate.instanceId, compatGate.instanceName)
            }}
            disabled={fixing}
          >
            <IconPlay size={14} />
            Trotzdem starten
          </button>
          {fixable > 0 && (
            <button className="btn primary" onClick={fixAll} disabled={fixing}>
              {fixing ? <span className="spinner" /> : <IconSparkle size={15} />}
              Automatisch beheben
            </button>
          )}
        </>
      }
    >
      <div className="col gap-8">
        {errors.map((issue) => (
          <IssueRow key={issue.id} issue={issue} />
        ))}
        {current.issues
          .filter((i) => i.severity !== 'error')
          .map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
      </div>
    </Modal>
  )
}
