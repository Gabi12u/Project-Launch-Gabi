import { useEffect, useState, type JSX } from 'react'
import { saveSettings, useStore } from '../lib/store'
import { t } from '../lib/i18n'
import { Modal } from './ui'
import { IconShield } from './Icons'

/**
 * Asks once whether faults may be sent in, and never again.
 *
 * Deliberately a real question with a real "no" rather than a notice with an
 * "OK": sending someone's crash data somewhere is not something to assume
 * agreement for. The answer is remembered as `on` or `off`, and `unset` is
 * what brings this back, so declining is as final as accepting.
 *
 * It waits for onboarding to be finished. Stacking this on top of a first-run
 * wizard would be the wrong first impression, and it needs the launcher to
 * already make sense before the question means anything.
 */
export function ReportConsent(): JSX.Element | null {
  const { settings, ready } = useStore()
  const [configured, setConfigured] = useState<boolean | null>(null)
  // Escape, the backdrop and the X are a dismissal, not a decision: only the
  // two buttons below are meant to be final. Without this, closing the
  // window any other way silently saved "off" for good, and the question
  // never came back to ask again. This only holds the window shut for the
  // rest of the session; a restart brings it back, exactly like any other
  // question nobody has answered yet.
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    void window.gabi.reports
      .status()
      .then((status) => setConfigured(status.configured))
      .catch(() => setConfigured(false))
  }, [])

  // Nothing is asked while there is nowhere to send to. Asking for permission
  // we cannot act on would collect an answer under false pretences.
  if (!ready || !settings.onboarded || settings.crashReports !== 'unset') return null
  if (configured !== true) return null
  if (dismissed) return null

  const answer = (allowed: boolean): void => {
    void saveSettings({ crashReports: allowed ? 'on' : 'off' })
  }

  return (
    <Modal
      open
      title={t('instanceSettings', 'reportConsent.title')}
      subtitle={t('instanceSettings', 'reportConsent.subtitle')}
      onClose={() => setDismissed(true)}
      footer={
        <>
          <button className="btn ghost" onClick={() => answer(false)}>
            {t('instanceSettings', 'reportConsent.declineButton')}
          </button>
          <button className="btn primary" onClick={() => answer(true)}>
            <IconShield size={14} />
            {t('instanceSettings', 'reportConsent.acceptButton')}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p>
          {t('instanceSettings', 'reportConsent.intro')}
        </p>

        <div className="setting-group" style={{ margin: 0 }}>
          <h3>{t('instanceSettings', 'reportConsent.sentTitle')}</h3>
          <ul className="hint bullet-list">
            <li>{t('instanceSettings', 'reportConsent.sentItem1')}</li>
            <li>{t('instanceSettings', 'reportConsent.sentItem2')}</li>
          </ul>

          <h3 style={{ marginTop: 14 }}>{t('instanceSettings', 'reportConsent.notSentTitle')}</h3>
          <ul className="hint bullet-list">
            <li>{t('instanceSettings', 'reportConsent.notSentItem1')}</li>
            <li>{t('instanceSettings', 'reportConsent.notSentItem2')}</li>
            <li>{t('instanceSettings', 'reportConsent.notSentItem3')}</li>
            <li>{t('instanceSettings', 'reportConsent.notSentItem4')}</li>
          </ul>
        </div>

        <p className="hint">
          {t('instanceSettings', 'reportConsent.footerHint')}
        </p>
      </div>
    </Modal>
  )
}
