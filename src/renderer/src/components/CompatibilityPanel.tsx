import { useEffect, useState, type JSX } from 'react'
import type { CompatibilityIssue, CompatibilityReport } from '@shared/types'
import { setState, toast, toastError, useStore } from '../lib/store'
import { pluralise } from '../lib/format'
import { startInstanceForced } from '../lib/actions'
import { Modal } from './ui'
import { IconCheckCircle, IconInfo, IconPlay, IconSparkle, IconWarning } from './Icons'
import { tr } from '@shared/i18n'

const ISSUE_ICON = {
  error: IconWarning,
  warning: IconWarning,
  info: IconInfo
}

export function IssueRow({
  issue,
  onFix,
  fixing,
  disabled
}: {
  issue: CompatibilityIssue
  onFix?: (issue: CompatibilityIssue) => void
  fixing?: boolean
  // Whether this button should be inert because some fix, not necessarily
  // this row's own, is currently running.
  disabled?: boolean
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
          disabled={disabled}
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
    // Also blocked while a fix-all is running, not just another single fix,
    // since the button below stays disabled the same way for both.
    if (!issue.fix || fixing !== null) return
    setFixing(issue.id)
    try {
      const next = await window.gabi.content.applyFix(instanceId, issue.fix)
      onChanged(next)
      toast('success', tr('Problem behoben', 'Problem fixed'), issue.title)
    } catch (err) {
      toastError(err, tr('Das Problem konnte nicht behoben werden', 'The problem could not be fixed'))
    } finally {
      // Clear only this row's own run. If a fix-all took over `fixing` in the
      // meantime this would otherwise reset it to null while the loop is
      // still going, making the panel look idle mid run.
      setFixing((current) => (current === issue.id ? null : current))
    }
  }

  const fixAll = async (): Promise<void> => {
    if (!report || fixing !== null) return
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
        tr('Fertig', 'Done'),
        done === 1
          ? tr('1 Problem wurde automatisch behoben.', '1 problem was fixed automatically.')
          : tr(`${done} Probleme wurden automatisch behoben.`, `${done} problems were fixed automatically.`)
      )
    } catch (err) {
      onChanged(latest)
      toastError(
        err,
        done > 0
          ? tr(
              `${done} von ${fixable.length} Problemen behoben, dann trat ein Fehler auf`,
              `${done} of ${fixable.length} problems fixed, then an error occurred`
            )
          : tr('Nicht alle Probleme konnten behoben werden', 'Not all problems could be fixed')
      )
    } finally {
      setFixing((current) => (current === 'all' ? null : current))
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="row gap-12">
          <span className="spinner" />
          <span className="muted">{tr('Mods werden geprüft…', 'Checking mods…')}</span>
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
            <div style={{ fontSize: 13.5, fontWeight: 650 }}>{tr('Alles in Ordnung', 'All good')}</div>
            <div className="hint">{tr('Keine Konflikte, keine fehlenden Abhängigkeiten.', 'No conflicts, no missing dependencies.')}</div>
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
              ? tr(`${errors} ${errors === 1 ? 'Problem' : 'Probleme'}`, `${errors} ${errors === 1 ? 'problem' : 'problems'}`)
              : tr(
                  `${report.issues.length} ${pluralise(report.issues.length, 'Hinweis', 'Hinweise')}`,
                  `${report.issues.length} ${pluralise(report.issues.length, 'note', 'notes')}`
                )}
          </span>
          {report.launchable && <span className="badge ok">{tr('Start möglich', 'Can start')}</span>}
        </div>
        {fixable > 1 && (
          <button className="btn sm primary" onClick={fixAll} disabled={fixing !== null}>
            {fixing === 'all' ? <span className="spinner" /> : <IconSparkle size={14} />}
            {tr('Alle automatisch beheben', 'Fix all automatically')}
          </button>
        )}
      </div>

      <div className="col gap-8">
        {report.issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            onFix={applyFix}
            fixing={fixing === issue.id}
            disabled={fixing !== null}
          />
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
        toast('success', tr('Probleme behoben', 'Problems fixed'), tr('Die Instanz kann jetzt gestartet werden.', 'The instance can start now.'))
        close()
        void startInstanceForced(compatGate.instanceId, compatGate.instanceName)
      }
    } catch (err) {
      setReport(latest)
      toastError(err, tr('Automatische Reparatur fehlgeschlagen', 'Automatic fix failed'))
    } finally {
      setFixing(false)
    }
  }

  const errors = current.issues.filter((i) => i.severity === 'error')
  const fixable = current.issues.filter((i) => i.fix).length

  return (
    <Modal
      open
      title={
        <span className="row gap-8" style={{ alignItems: 'center' }}>
          <IconWarning size={16} />
          {tr('Problem gefunden', 'Problem found')}
        </span>
      }
      subtitle={tr(
        `${compatGate.instanceName} kann so nicht gestartet werden.`,
        `${compatGate.instanceName} cannot start like this.`
      )}
      onClose={close}
      busy={fixing}
      width="wide"
      footer={
        <>
          <button className="btn ghost" onClick={close} disabled={fixing}>
            {tr('Abbrechen', 'Cancel')}
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
            {tr('Trotzdem starten', 'Start anyway')}
          </button>
          {fixable > 0 && (
            <button className="btn primary" onClick={fixAll} disabled={fixing}>
              {fixing ? <span className="spinner" /> : <IconSparkle size={15} />}
              {tr('Automatisch beheben', 'Fix automatically')}
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
