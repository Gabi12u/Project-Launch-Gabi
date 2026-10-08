import { useEffect, useState, type JSX } from 'react'
import { saveSettings, useStore } from '../lib/store'
import { Modal } from './ui'
import { IconShield } from './Icons'
import { tr } from '@shared/i18n'

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
      title={tr('Dürfen wir Fehler sehen?', 'May we see errors?')}
      subtitle={tr('Einmal entscheiden, jederzeit änderbar.', 'Decide once, change any time.')}
      onClose={() => setDismissed(true)}
      footer={
        <>
          <button className="btn ghost" onClick={() => answer(false)}>
            {tr('Nein, danke', 'No, thanks')}
          </button>
          <button className="btn primary" onClick={() => answer(true)}>
            <IconShield size={14} />
            {tr('Ja, Fehler senden', 'Yes, send errors')}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p>
          {tr(
            'Wenn im Launcher etwas schiefgeht, kann automatisch ein kurzer Bericht an die Entwicklung gehen. Damit finden wir Fehler, von denen sonst nie jemand erfährt.',
            'When something goes wrong in the launcher, a short report can be sent to the developer automatically. That way we find errors nobody would otherwise ever hear about.'
          )}
        </p>

        <div className="setting-group" style={{ margin: 0 }}>
          <h3>{tr('Was gesendet wird', 'What is sent')}</h3>
          <ul className="hint bullet-list">
            <li>{tr('Die Fehlermeldung und wo im Programm sie aufgetreten ist', 'The error message and where in the program it happened')}</li>
            <li>{tr('Die Version von Launch Gabi und dein Betriebssystem', 'The version of Launch Gabi and your operating system')}</li>
            <li>
              {tr(
                'An wen: an den Launch-Gabi-Server und einen Discord-Kanal der Entwicklung. Der Server speichert dabei deine IP-Adresse mit dem Bericht, wie es jeder Server beim Empfang tun kann.',
                'To whom: the Launch Gabi server and a Discord channel of the developer. The server stores your IP address with the report, as any server receiving it can.'
              )}
            </li>
          </ul>

          <h3 style={{ marginTop: 14 }}>{tr('Was nicht gesendet wird', 'What is not sent')}</h3>
          <ul className="hint bullet-list">
            <li>{tr('Dein Minecraft-Name, deine UUID und deine Zugangsdaten', 'Your Minecraft name, your UUID and your credentials')}</li>
            <li>{tr('Dein Windows-Benutzername, auch nicht versteckt in Dateipfaden', 'Your Windows user name, not even hidden in file paths')}</li>

            <li>{tr('Nichts aus deinen Welten, Mods oder Screenshots', 'Nothing from your worlds, mods or screenshots')}</li>
          </ul>
        </div>

        <p className="hint">
          {tr(
            'Berichte werden immer auch bei dir gespeichert, damit du selbst nachsehen kannst, was gesendet wurde. Zu finden unter Einstellungen, Fehlerberichte.',
            'Reports are always stored on your computer too, so you can check yourself what was sent. You can find them under Settings, Error reports.'
          )}
        </p>
      </div>
    </Modal>
  )
}
