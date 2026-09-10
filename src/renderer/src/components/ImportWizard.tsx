import { type JSX } from 'react'
import type { ImportAnalysis, ImportCheck, ImportFinding } from '@shared/types'
import { setState, useStore } from '../lib/store'
import { confirmImport } from '../lib/actions'
import { formatBytes } from '../lib/format'
import { t } from '../lib/i18n'
import { Modal } from './ui'
import { IconCheckCircle, IconDownload, IconInfo, IconPackage, IconWarning } from './Icons'

/**
 * Shows what an import found before anything is written, and what the result
 * looks like afterwards.
 *
 * Built on the same `Modal` the update and repair overlays use, on purpose:
 * an import is the other moment where the launcher does something large on
 * the user's behalf, and it should not look like a different program while it
 * does it.
 */

const FINDING_ICON = {
  ok: IconCheckCircle,
  warn: IconWarning,
  blocker: IconWarning
}

/** Maps a finding level onto the severity classes the stylesheet already has. */
const FINDING_CLASS: Record<ImportFinding['level'], string> = {
  ok: 'info',
  warn: 'warning',
  blocker: 'error'
}

function FindingRow({ finding }: { finding: ImportFinding }): JSX.Element {
  const Icon = FINDING_ICON[finding.level]
  return (
    <div className={`issue ${FINDING_CLASS[finding.level]}`}>
      <div className="issue-icon">
        <Icon size={16} />
      </div>
      <div className="grow">
        <div className="issue-title">{finding.title}</div>
        {finding.detail && <div className="issue-detail">{finding.detail}</div>}
      </div>
    </div>
  )
}

/** One number with its label, the row of them across the top of the report. */
function CountTile({ value, label }: { value: number; label: string }): JSX.Element {
  return (
    <div className="card" style={{ padding: '10px 14px', minWidth: 92 }}>
      <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
      <div className="hint" style={{ fontSize: 11.5 }}>
        {label}
      </div>
    </div>
  )
}

function Report({ analysis }: { analysis: ImportAnalysis }): JSX.Element {
  const { counts } = analysis
  return (
    <div className="col gap-16">
      <div className="card">
        <div className="row gap-12">
          <div className="issue-icon">
            <IconPackage size={16} />
          </div>
          <div className="grow">
            <div className="card-title">{analysis.name}</div>
            <div className="hint">
              {analysis.sourceLabel}
              {analysis.mcVersion ? ` · Minecraft ${analysis.mcVersion}` : ''}
              {analysis.loader && analysis.loader !== 'vanilla'
                ? ` · ${analysis.loader}${analysis.loaderVersion ? ` ${analysis.loaderVersion}` : ''}`
                : ''}
              {analysis.estimatedBytes > 0 ? ` · ${formatBytes(analysis.estimatedBytes)}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
        <CountTile value={counts.mods} label={t('wizard', 'import.counts.mods')} />
        <CountTile value={counts.worlds} label={t('wizard', 'import.counts.worlds')} />
        <CountTile value={counts.resourcePacks} label={t('wizard', 'import.counts.resourcePacks')} />
        <CountTile value={counts.shaderPacks} label={t('wizard', 'import.counts.shaderPacks')} />
        <CountTile value={counts.configs} label={t('wizard', 'import.counts.configs')} />
      </div>

      <div className="col gap-8">{analysis.findings.map((finding, index) => <FindingRow key={index} finding={finding} />)}</div>
    </div>
  )
}

function CheckResult({ check }: { check: ImportCheck | null }): JSX.Element {
  if (!check) {
    return (
      <div className="card">
        <div className="row gap-12">
          <div className="issue-icon">
            <IconInfo size={16} />
          </div>
          <div className="grow">
            <div className="issue-title">{t('wizard', 'import.check.unavailable')}</div>
            <div className="issue-detail">{t('wizard', 'import.check.unavailableDetail')}</div>
          </div>
        </div>
      </div>
    )
  }

  return <div className="col gap-8">{check.findings.map((finding, index) => <FindingRow key={index} finding={finding} />)}</div>
}

export function ImportWizard(): JSX.Element | null {
  const { importGate } = useStore()
  if (!importGate) return null

  const { stage, analysis, error, check } = importGate
  const busy = stage === 'analyzing' || stage === 'importing'
  const close = (): void => setState({ importGate: null })

  const blockers = analysis?.findings.filter((finding) => finding.level === 'blocker') ?? []
  const hasBlockers = blockers.length > 0

  const title =
    stage === 'done'
      ? t('wizard', 'import.title.done')
      : stage === 'failed'
        ? t('wizard', 'import.title.failed')
        : t('wizard', 'import.title.analysis')

  const subtitle =
    stage === 'analyzing'
      ? t('wizard', 'import.subtitle.analyzing')
      : stage === 'importing'
        ? t('wizard', 'import.subtitle.importing')
        : stage === 'done'
          ? check?.looksStartable === false
            ? t('wizard', 'import.subtitle.donePartial')
            : t('wizard', 'import.subtitle.done')
          : stage === 'failed'
            ? t('wizard', 'import.subtitle.failed')
            : analysis?.path

  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      onClose={close}
      busy={busy}
      width="wide"
      footer={
        stage === 'report' ? (
          <>
            <button className="btn ghost" onClick={close}>
              {t('common', 'cancel')}
            </button>
            <button
              className="btn primary"
              onClick={() => void confirmImport()}
              disabled={!analysis?.canImport && !hasBlockers}
            >
              <IconDownload size={14} />
              {hasBlockers ? t('wizard', 'import.tryAnyway') : t('wizard', 'import.create')}
            </button>
          </>
        ) : stage === 'failed' ? (
          <>
            <button className="btn ghost" onClick={close}>
              {t('common', 'close')}
            </button>
            {analysis && (
              <button className="btn primary" onClick={() => void confirmImport()}>
                {t('wizard', 'import.retry')}
              </button>
            )}
          </>
        ) : (
          <button className="btn" onClick={close} disabled={busy}>
            {t('common', 'close')}
          </button>
        )
      }
    >
      {stage === 'analyzing' && (
        <div className="row gap-12" style={{ padding: '8px 0' }}>
          <span className="spinner" />
          <span className="muted">{t('wizard', 'import.analyzing')}</span>
        </div>
      )}

      {stage === 'importing' && (
        <div className="col gap-12">
          <div className="row gap-12" style={{ padding: '8px 0' }}>
            <span className="spinner" />
            <span className="muted">{t('wizard', 'import.importing')}</span>
          </div>
          {analysis && <Report analysis={analysis} />}
        </div>
      )}

      {stage === 'report' && analysis && (
        <div className="col gap-16">
          <Report analysis={analysis} />
          {hasBlockers && (
            <div className="hint">{t('wizard', 'import.blockerHint')}</div>
          )}
        </div>
      )}

      {stage === 'done' && (
        <div className="col gap-16">
          <CheckResult check={check} />
          <div className="hint">{t('wizard', 'import.doneHint')}</div>
        </div>
      )}

      {stage === 'failed' && (
        <div className="col gap-16">
          <div className="issue error">
            <div className="issue-icon">
              <IconWarning size={16} />
            </div>
            <div className="grow">
              <div className="issue-title">{t('wizard', 'import.failedTitle')}</div>
              {error && <div className="issue-detail">{error}</div>}
            </div>
          </div>
          {analysis && (
            <>
              <div className="hint">{t('wizard', 'import.failedFound')}</div>
              <Report analysis={analysis} />
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
