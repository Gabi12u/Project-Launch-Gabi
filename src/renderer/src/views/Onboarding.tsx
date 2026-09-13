import { useState, type JSX } from 'react'
import { ACCENT_CHOICES } from '@shared/defaults'
import { refreshAccounts, saveSettings, toast, toastError, useStore } from '../lib/store'
import { formatMemory } from '../lib/format'
import { LogoLockup } from '../components/Logo'
import { AccountModal } from '../components/AccountModal'
import { IconCheck, IconChevronRight, IconSparkle, IconUser } from '../components/Icons'

/** First-run wizard: identity, look and account in three short steps. */
export function Onboarding(): JSX.Element {
  const { settings, accounts } = useStore()

  const [step, setStep] = useState(0)
  const [accent, setAccent] = useState(settings.accentColor)
  const [memory, setMemory] = useState(settings.defaultMemoryMb)
  const [autoJava, setAutoJava] = useState(true)
  const [accountOpen, setAccountOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)

  const finish = async (): Promise<void> => {
    setFinishing(true)
    try {
      // The result decides, not the absence of an exception. saveSettings
      // handles its own errors, so a failed save used to reach the success
      // toast unchanged — while `onboarded` stayed false and the app kept
      // showing this very screen, right after telling the user setup worked.
      const saved = await saveSettings({
        accentColor: accent,
        defaultMemoryMb: memory,
        javaAutoManage: autoJava,
        onboarded: true
      })
      if (saved) {
        toast('success', 'Willkommen bei Launch Gabi', 'Lege jetzt deine erste Instanz an.')
      }
    } catch (err) {
      toastError(err, 'Einrichtung fehlgeschlagen')
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        {step === 0 && (
          <div className="col gap-24">
            <LogoLockup />
            <div className="col gap-12">
              <h2 style={{ fontSize: 22 }}>Schön, dass du da bist.</h2>
              <p style={{ color: 'var(--text-2)', lineHeight: 1.7, fontSize: 14 }}>
                Launch Gabi verwaltet beliebig viele voneinander getrennte Minecraft-Installationen. Jede
                davon hat ihre eigene Version, ihre eigenen Mods und ihre eigenen Welten, nichts kommt sich
                in die Quere.
              </p>
              <p style={{ color: 'var(--text-3)', lineHeight: 1.7, fontSize: 13.5 }}>
                Um Java, Mod Loader und Abhängigkeiten musst du dich nicht kümmern. Das erledigt der Launcher
                im Hintergrund.
              </p>
            </div>
            <button className="btn primary lg" onClick={() => setStep(1)}>
              Einrichtung starten
              <IconChevronRight size={16} />
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="col gap-24">
            <div className="col gap-6">
              <h2 style={{ fontSize: 22 }}>Wie soll es aussehen?</h2>
              <p className="hint">Kannst du später jederzeit ändern.</p>
            </div>

            <div className="field">
              <label className="label" id="ob-akzentfarbe">Akzentfarbe</label>
              <div role="group" aria-labelledby="ob-akzentfarbe" className="swatches">
                {ACCENT_CHOICES.map((color) => (
                  <button
                    key={color}
                    className={`swatch ${accent === color ? 'selected' : ''}`}
                    style={{ background: color, color, width: 34, height: 34 }}
                    onClick={() => {
                      setAccent(color)
                      // Apply immediately so the choice is visible right away.
                      void saveSettings({ accentColor: color })
                    }}
                    aria-label={color}
                  />
                ))}
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="ob-standard-arbeitsspeicher">Standard-Arbeitsspeicher: {formatMemory(memory)}</label>
              <input id="ob-standard-arbeitsspeicher"
                className="range"
                type="range"
                min={1024}
                max={16384}
                step={512}
                value={memory}
                onChange={(event) => setMemory(Number(event.target.value))}
              />
              <span className="hint">
                Für Vanilla reichen 2-4 GB. Große Modpacks laufen mit 6-8 GB am rundesten.
              </span>
            </div>

            <div className="option" style={{ cursor: 'default' }}>
              <div className="row-between">
                <div className="col gap-4">
                  <span className="option-name">Java automatisch verwalten</span>
                  <span className="option-desc">
                    Launch Gabi lädt die passende Java-Version selbst herunter, du musst nichts installieren.
                  </span>
                </div>
                <button
                  className={`switch ${autoJava ? 'on' : ''}`}
                  onClick={() => setAutoJava((value) => !value)}
                  role="switch"
                  aria-checked={autoJava}
                />
              </div>
            </div>

            <div className="row gap-8">
              <button className="btn ghost" onClick={() => setStep(0)}>
                Zurück
              </button>
              <div className="grow" />
              <button className="btn primary" onClick={() => setStep(2)}>
                Weiter
                <IconChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="col gap-24">
            <div className="col gap-6">
              <h2 style={{ fontSize: 22 }}>Dein Account</h2>
              <p className="hint">
                Für Online-Server brauchst du einen Microsoft-Account. Zum Ausprobieren reicht ein
                Offline-Profil.
              </p>
            </div>

            {accounts.length > 0 ? (
              <div className="issue" style={{ borderColor: 'rgba(61,220,151,0.3)' }}>
                <div className="issue-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
                  <IconCheck size={17} />
                </div>
                <div className="grow">
                  <div className="issue-title">
                    {accounts.find((a) => a.active)?.username ?? accounts[0].username} ist angemeldet
                  </div>
                  <div className="issue-detail">
                    {accounts.length > 1 ? `${accounts.length} Profile hinterlegt.` : 'Alles bereit.'}
                  </div>
                </div>
                <button className="btn sm" onClick={() => setAccountOpen(true)}>
                  Verwalten
                </button>
              </div>
            ) : (
              <button className="btn primary lg block" onClick={() => setAccountOpen(true)}>
                <IconUser size={17} />
                Account hinzufügen
              </button>
            )}

            <p className="hint">
              Du kannst diesen Schritt überspringen und dich später jederzeit über die Seitenleiste anmelden.
            </p>

            <div className="row gap-8">
              <button className="btn ghost" onClick={() => setStep(1)}>
                Zurück
              </button>
              <div className="grow" />
              <button className="btn primary" onClick={finish} disabled={finishing}>
                {finishing ? <span className="spinner" /> : <IconSparkle size={15} />}
                Los geht's
              </button>
            </div>
          </div>
        )}
      </div>

      <AccountModal
        open={accountOpen}
        onClose={() => {
          setAccountOpen(false)
          void refreshAccounts()
        }}
      />
    </div>
  )
}
