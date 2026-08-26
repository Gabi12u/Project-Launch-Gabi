import { useEffect, useState, type JSX } from 'react'
import { saveSettings, useStore } from '../lib/store'
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

  const answer = (allowed: boolean): void => {
    void saveSettings({ crashReports: allowed ? 'on' : 'off' })
  }

  return (
    <Modal
      open
      title="Dürfen wir Fehler sehen?"
      subtitle="Einmal entscheiden, jederzeit änderbar."
      onClose={() => answer(false)}
      footer={
        <>
          <button className="btn ghost" onClick={() => answer(false)}>
            Nein, danke
          </button>
          <button className="btn primary" onClick={() => answer(true)}>
            <IconShield size={14} />
            Ja, Fehler senden
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p>
          Wenn im Launcher etwas schiefgeht, kann automatisch ein kurzer Bericht an die
          Entwicklung gehen. Damit finden wir Fehler, von denen sonst nie jemand erfährt.
        </p>

        <div className="setting-group" style={{ margin: 0 }}>
          <h3>Was gesendet wird</h3>
          <ul className="hint bullet-list">
            <li>Die Fehlermeldung und wo im Programm sie aufgetreten ist</li>
            <li>Die Version von Launch Gabi und dein Betriebssystem</li>
          </ul>

          <h3 style={{ marginTop: 14 }}>Was nicht gesendet wird</h3>
          <ul className="hint bullet-list">
            <li>Dein Minecraft-Name, deine UUID und deine Zugangsdaten</li>
            <li>Dein Windows-Benutzername, auch nicht versteckt in Dateipfaden</li>
            <li>Deine IP-Adresse wird nicht gespeichert</li>
            <li>Nichts aus deinen Welten, Mods oder Screenshots</li>
          </ul>
        </div>

        <p className="hint">
          Berichte werden immer auch bei dir gespeichert, damit du selbst nachsehen kannst, was
          gesendet wurde. Zu finden unter Einstellungen, Fehlerberichte.
        </p>
      </div>
    </Modal>
  )
}
