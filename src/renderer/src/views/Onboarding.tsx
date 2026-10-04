import { useEffect, useState, type JSX } from 'react'
import { ACCENT_CHOICES } from '@shared/defaults'
import { refreshAccounts, saveSettings, setState, toast, toastError, useStore } from '../lib/store'
import { useMemorySliderMax } from '../lib/hooks'
import { formatMemory } from '../lib/format'
import { accentName } from '../lib/accents'
import { LogoLockup } from '../components/Logo'
import { AccountModal } from '../components/AccountModal'
import { IconCheck, IconChevronRight, IconSparkle, IconUser } from '../components/Icons'
import { tr } from '@shared/i18n'


const TOTAL_STEPS = 3

/** First-run wizard: identity, look and account in three short steps. */
export function Onboarding(): JSX.Element {
  const { settings, accounts } = useStore()
  const memoryMax = useMemorySliderMax()
  // useMemorySliderMax answers instantly with a generous fallback ceiling
  // while the real installed RAM is still being fetched. Clamping against
  // that fallback before it resolves could cut a legitimate high value down
  // to the fallback for no reason, so the clamp is only applied once the
  // real number is confirmed to have arrived.
  const [memoryKnown, setMemoryKnown] = useState(false)

  const [step, setStep] = useState(0)
  const [accent, setAccent] = useState(settings.accentColor)
  const [memory, setMemory] = useState(settings.defaultMemoryMb)
  const [autoJava, setAutoJava] = useState(true)
  const [accountOpen, setAccountOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.gabi.app
      .info()
      .then((info) => {
        if (!cancelled && info.systemMemoryMb) setMemoryKnown(true)
      })
      // Without the real RAM size the slider keeps its fallback ceiling.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // The value that is actually shown and saved: never above what the machine
  // really has. Submitting the raw slider value used to save more memory
  // than exists on machines with less RAM than the 4096 MB default.
  const effectiveMemory = memoryKnown ? Math.min(memory, memoryMax) : memory

  const finish = async (): Promise<void> => {
    setFinishing(true)
    try {
      // The result decides, not the absence of an exception. saveSettings
      // handles its own errors, so a failed save used to reach the success
      // toast unchanged — while `onboarded` stayed false and the app kept
      // showing this very screen, right after telling the user setup worked.
      const saved = await saveSettings({
        accentColor: accent,
        defaultMemoryMb: effectiveMemory,
        javaAutoManage: autoJava,
        onboarded: true
      })
      if (saved) {
        toast('success', tr('Willkommen bei Launch Gabi', 'Welcome to Launch Gabi'), tr('Leg direkt deine erste Instanz an.', 'Go ahead and create your first instance.'))
        setState({ createOpen: true })
      }
    } catch (err) {
      toastError(err, tr('Einrichtung fehlgeschlagen', 'Setup failed'))
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-steps">
          <div className="onboarding-dots" aria-hidden="true">
            {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
              <span key={index} className={`onboarding-dot${index <= step ? ' done' : ''}`} />
            ))}
          </div>
          <span className="hint">
            {tr(`Schritt ${step + 1} von ${TOTAL_STEPS}`, `Step ${step + 1} of ${TOTAL_STEPS}`)}
          </span>
        </div>

        {step === 0 && (
          <div className="col gap-24">
            <LogoLockup />
            <div className="col gap-12">
              <h2 style={{ fontSize: 22 }}>{tr('Schön, dass du da bist.', 'Great to have you here.')}</h2>
              <p style={{ color: 'var(--text-2)', lineHeight: 1.7, fontSize: 14 }}>
                {tr(
                  'Launch Gabi verwaltet beliebig viele voneinander getrennte Minecraft-Installationen. Jede davon hat ihre eigene Version, ihre eigenen Mods und ihre eigenen Welten, nichts kommt sich in die Quere.',
                  'Launch Gabi manages as many separate Minecraft installations as you like. Each has its own version, its own mods and its own worlds, nothing gets in the way of anything else.'
                )}
              </p>
              <p style={{ color: 'var(--text-3)', lineHeight: 1.7, fontSize: 13.5 }}>
                {tr(
                  'Um Java, Mod Loader und Abhängigkeiten musst du dich nicht kümmern. Das erledigt der Launcher im Hintergrund.',
                  'You do not have to worry about Java, mod loaders and dependencies. The launcher takes care of that in the background.'
                )}
              </p>
            </div>
            <button className="btn primary lg" onClick={() => setStep(1)}>
              {tr('Einrichtung starten', 'Start setup')}
              <IconChevronRight size={16} />
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="col gap-24">
            <div className="col gap-6">
              <h2 style={{ fontSize: 22 }}>{tr('Wie soll es aussehen?', 'How should it look?')}</h2>
              <p className="hint">{tr('Kannst du später jederzeit ändern.', 'You can change this any time later.')}</p>
            </div>

            <div className="field">
              <label className="label" id="ob-akzentfarbe">{tr('Akzentfarbe', 'Accent color')}</label>
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
                    aria-label={accentName(color)}
                    aria-pressed={accent === color}
                  />
                ))}
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="ob-standard-arbeitsspeicher">
                {tr('Standard-Arbeitsspeicher', 'Default memory')}: {formatMemory(effectiveMemory)}
              </label>
              <input id="ob-standard-arbeitsspeicher"
                className="range"
                type="range"
                min={1024}
                max={memoryMax}
                step={512}
                value={effectiveMemory}
                onChange={(event) => setMemory(Number(event.target.value))}
              />
              <span className="hint">
                {tr('Für Vanilla reichen 2-4 GB. Große Modpacks laufen mit 6-8 GB am rundesten.', '2-4 GB is enough for vanilla. Large modpacks run best with 6-8 GB.')}
              </span>
            </div>

            <div className="option" style={{ cursor: 'default' }}>
              <div className="row-between">
                <div className="col gap-4">
                  <span className="option-name">{tr('Java automatisch verwalten', 'Manage Java automatically')}</span>
                  <span className="option-desc">
                    {tr('Launch Gabi lädt die passende Java-Version selbst herunter, du musst nichts installieren.', 'Launch Gabi downloads the right Java version by itself, you do not have to install anything.')}
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
                {tr('Zurück', 'Back')}
              </button>
              <div className="grow" />
              <button className="btn primary" onClick={() => setStep(2)}>
                {tr('Weiter', 'Next')}
                <IconChevronRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="col gap-24">
            <div className="col gap-6">
              <h2 style={{ fontSize: 22 }}>{tr('Dein Account', 'Your account')}</h2>
              <p className="hint">
                {tr('Für Online-Server brauchst du einen Microsoft-Account. Zum Ausprobieren reicht ein Offline-Profil.', 'For online servers you need a Microsoft account. An offline profile is enough to try things out.')}
              </p>
            </div>

            {accounts.length > 0 ? (
              <div className="issue" style={{ borderColor: 'rgba(61,220,151,0.3)' }}>
                <div className="issue-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
                  <IconCheck size={17} />
                </div>
                <div className="grow">
                  <div className="issue-title">
                    {tr(
                      `${accounts.find((a) => a.active)?.username ?? accounts[0].username} ist angemeldet`,
                      `${accounts.find((a) => a.active)?.username ?? accounts[0].username} is signed in`
                    )}
                  </div>
                  <div className="issue-detail">
                    {accounts.length > 1
                      ? tr(`${accounts.length} Profile hinterlegt.`, `${accounts.length} profiles saved.`)
                      : tr('Alles bereit.', 'All set.')}
                  </div>
                </div>
                <button className="btn sm" onClick={() => setAccountOpen(true)}>
                  {tr('Verwalten', 'Manage')}
                </button>
              </div>
            ) : (
              <button className="btn primary lg block" onClick={() => setAccountOpen(true)}>
                <IconUser size={17} />
                {tr('Account hinzufügen', 'Add account')}
              </button>
            )}

            <p className="hint">
              {tr('Du kannst diesen Schritt überspringen und dich später jederzeit über die Seitenleiste anmelden.', 'You can skip this step and sign in later at any time from the sidebar.')}
            </p>

            <div className="row gap-8">
              <button className="btn ghost" onClick={() => setStep(1)}>
                {tr('Zurück', 'Back')}
              </button>
              <div className="grow" />
              <button className="btn primary" onClick={finish} disabled={finishing}>
                {finishing ? <span className="spinner" /> : <IconSparkle size={15} />}
                {tr("Los geht's", "Let's go")}
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
        closeOnSuccess
      />
    </div>
  )
}
