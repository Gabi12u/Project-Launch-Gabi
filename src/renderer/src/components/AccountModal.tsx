import { useEffect, useState, type JSX, useRef} from 'react'
import type { Account, DeviceCodePrompt } from '@shared/types'
import { refreshAccounts, toast, toastError, useStore } from '../lib/store'
import { initials, skinHeadStyle } from '../lib/format'
import { Confirm, CopyButton, Modal } from './ui'
import { IconCheck, IconExternal, IconTrash, IconUser } from './Icons'
import { tr } from '@shared/i18n'

/** Player names Mojang accepts for an offline profile. */
const OFFLINE_NAME_RE = /^[A-Za-z0-9_]{3,16}$/

export function AccountModal({
  open,
  onClose,
  closeOnSuccess
}: {
  open: boolean
  onClose: () => void
  /** Closes the dialog right after a successful sign in, for the onboarding flow. */
  closeOnSuccess?: boolean
}): JSX.Element {
  const { accounts } = useStore()
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null)
  const [busy, setBusy] = useState(false)
  const [offlineName, setOfflineName] = useState('')
  const [creatingOffline, setCreatingOffline] = useState(false)
  // A trash icon with no confirmation removed a Microsoft account on a single
  // stray click, forcing the full sign in again to get it back.
  const [confirmRemove, setConfirmRemove] = useState<Account | null>(null)

  useEffect(() => {
    return window.gabi.events.onDeviceCode((next) => setPrompt(next))
  }, [])

  useEffect(() => {
    if (open) void refreshAccounts()
  }, [open])

  /**
   * Identifies the attempt whose result may still touch the screen.
   *
   * A cancelled login rejects only later, after the current poll returns. By
   * then the user may already have started a second attempt, and the late
   * rejection of the first would clear the device code just put on screen and
   * re-enable the button while that second login is still running.
   */
  const attempt = useRef(0)

  const loginMicrosoft = async (): Promise<void> => {
    const ticket = ++attempt.current
    setBusy(true)
    try {
      const account = await window.gabi.accounts.loginMicrosoft()
      if (ticket !== attempt.current) return
      toast('success', tr('Angemeldet', 'Signed in'), tr(`Willkommen, ${account.username}!`, `Welcome, ${account.username}!`))
      await refreshAccounts()
      setPrompt(null)
      if (closeOnSuccess) onClose()
    } catch (err) {
      if (ticket !== attempt.current) return
      // A cancel the user asked for themselves is not a failure and needs no
      // alarming message; the dialog has already returned to its normal state.
      if (!(err instanceof Error && err.message === tr('Anmeldung abgebrochen', 'Sign-in cancelled'))) {
        toastError(err, tr('Anmeldung fehlgeschlagen', 'Sign-in failed'))
      }
      setPrompt(null)
    } finally {
      if (ticket === attempt.current) setBusy(false)
    }
  }

  const cancelLogin = async (): Promise<void> => {
    attempt.current++
    await window.gabi.accounts.cancelLogin()
    setPrompt(null)
    setBusy(false)
  }

  /** Closing the dialog must not leave a login running in the background. */
  const closeAndCancel = (): void => {
    if (busy) {
      attempt.current++
      void window.gabi.accounts.cancelLogin().catch(() => undefined)
    }
    setPrompt(null)
    setBusy(false)
    onClose()
  }

  const offlineValid = OFFLINE_NAME_RE.test(offlineName.trim())

  const loginOffline = async (): Promise<void> => {
    if (!offlineValid || creatingOffline) return
    // Without this guard a double click fires two concurrent requests and two
    // success toasts for one intent, unlike the Microsoft button which is
    // disabled while busy.
    setCreatingOffline(true)
    try {
      const account = await window.gabi.accounts.loginOffline(offlineName.trim())
      toast('success', tr('Offline-Profil angelegt', 'Offline profile created'), account.username)
      setOfflineName('')
      await refreshAccounts()
      if (closeOnSuccess) onClose()
    } catch (err) {
      toastError(err, tr('Profil konnte nicht angelegt werden', 'Profile could not be created'))
    } finally {
      setCreatingOffline(false)
    }
  }

  const setActive = async (id: string): Promise<void> => {
    try {
      await window.gabi.accounts.setActive(id)
      await refreshAccounts()
    } catch (err) {
      toastError(err, tr('Account konnte nicht ausgewählt werden', 'Could not select the account'))
    }
  }

  const remove = async (): Promise<void> => {
    if (!confirmRemove) return
    try {
      await window.gabi.accounts.remove(confirmRemove.id)
      await refreshAccounts()
      setConfirmRemove(null)
    } catch (err) {
      toastError(err, tr('Account konnte nicht entfernt werden', 'Account could not be removed'))
    }
  }

  return (
    <Modal
      open={open}
      title={tr('Accounts', 'Accounts')}
      subtitle={tr('Melde dich mit Microsoft an, um online zu spielen, oder nutze ein Offline-Profil zum Testen.', 'Sign in with Microsoft to play online, or use an offline profile for testing.')}
      // Every close path cancels a login in flight first. The old condition
      // (`busy && prompt`) left a gap: between clicking "log in" and the device
      // code arriving there is one network round trip during which closing went
      // through the plain `onClose`, which never cancels — so the login kept
      // polling invisibly for its full lifetime and could resurface later with
      // a code the user thought they had dismissed. Locking the dialog instead
      // would be worse, since that gap has no cancel button on screen yet.
      onClose={closeAndCancel}
      busy={false}
      width="wide"
    >
      {prompt ? (
        <DeviceCodePanel prompt={prompt} onCancel={cancelLogin} />
      ) : (
        <>
          {accounts.length > 0 && (
            <div className="col gap-8" style={{ marginBottom: 24 }}>
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onActivate={() => setActive(account.id)}
                  onRemove={() => setConfirmRemove(account)}
                />
              ))}
            </div>
          )}

          <div className="col gap-12">
            <button className="btn primary block lg" onClick={loginMicrosoft} disabled={busy}>
              {busy ? <span className="spinner" /> : <IconUser size={17} />}
              {tr('Mit Microsoft anmelden', 'Sign in with Microsoft')}
            </button>

            <div className="row gap-12" style={{ color: 'var(--text-4)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              {tr('oder', 'or')}
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>

            <div className="field">
              <label className="label" id="am-offline-profil">{tr('Offline-Profil', 'Offline profile')}</label>
              <div role="group" aria-labelledby="am-offline-profil" className="row gap-8">
                <input
                  className="input"
                  placeholder={tr('Spielername', 'Player name')}
                  value={offlineName}
                  maxLength={16}
                  onChange={(event) => setOfflineName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void loginOffline()}
                />
                <button
                  className="btn"
                  onClick={loginOffline}
                  disabled={creatingOffline || !offlineValid}
                >
                  {tr('Anlegen', 'Create')}
                </button>
              </div>
              {offlineName.length > 0 && !offlineValid && (
                <span className="hint" style={{ color: 'var(--danger)' }}>
                  {tr('Nur Buchstaben, Zahlen und Unterstriche, 3 bis 16 Zeichen.', 'Only letters, numbers and underscores, 3 to 16 characters.')}
                </span>
              )}
              <span className="hint">
                {tr(
                  'Offline-Profile funktionieren nur auf Servern ohne Online-Modus und in Einzelspieler-Welten. Mindestens 3 Zeichen, nur Buchstaben, Zahlen und Unterstriche.',
                  'Offline profiles only work on servers without online mode and in singleplayer worlds. At least 3 characters, only letters, numbers and underscores.'
                )}
              </span>
            </div>
          </div>
        </>
      )}

      <Confirm
        open={confirmRemove !== null}
        title={tr('Account entfernen?', 'Remove account?')}
        danger
        message={
          confirmRemove
            ? tr(
                `${confirmRemove.username} wird aus diesem Launcher entfernt. Ein Microsoft-Account lässt sich jederzeit erneut anmelden, ein Offline-Profil danach nicht wiederherstellen.`,
                `${confirmRemove.username} will be removed from this launcher. A Microsoft account can be signed in again at any time, an offline profile cannot be restored afterwards.`
              )
            : ''
        }
        confirmLabel={tr('Entfernen', 'Remove')}
        onConfirm={remove}
        onCancel={() => setConfirmRemove(null)}
      />
    </Modal>
  )
}

function AccountRow({
  account,
  onActivate,
  onRemove
}: {
  account: Account
  onActivate: () => void
  onRemove: () => void
}): JSX.Element {
  const expired = account.expiresAt !== undefined && account.expiresAt < Date.now()

  return (
    <div className="content-row">
      <div
        className={`avatar lg${skinHeadStyle(account.skinUrl) ? ' skin-head' : ''}`}
        style={skinHeadStyle(account.skinUrl) ?? undefined}
      >
        {skinHeadStyle(account.skinUrl) ? '' : initials(account.username)}
      </div>

      <div className="grow">
        <div className="content-name">{account.username}</div>
        <div className="content-meta">
          <span>{account.type === 'microsoft' ? tr('Microsoft-Account', 'Microsoft account') : tr('Offline-Profil', 'Offline profile')}</span>
          {expired && <span className="badge warn">{tr('Sitzung abgelaufen', 'Session expired')}</span>}
          {account.active && (
            <span className="badge ok dot">
              <IconCheck size={11} /> {tr('Aktiv', 'Active')}
            </span>
          )}
        </div>
      </div>

      <div className="content-actions">
        {!account.active && (
          <button className="btn sm" onClick={onActivate}>
            {tr('Auswählen', 'Select')}
          </button>
        )}
        <button className="btn ghost icon sm" onClick={onRemove} aria-label={tr('Entfernen', 'Remove')}>
          <IconTrash size={15} />
        </button>
      </div>
    </div>
  )
}

function DeviceCodePanel({
  prompt,
  onCancel
}: {
  prompt: DeviceCodePrompt
  onCancel: () => void
}): JSX.Element {
  const [remaining, setRemaining] = useState(prompt.expiresIn)

  useEffect(() => {
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60

  return (
    <div className="col gap-20">
      <div className="col gap-8">
        <div style={{ fontSize: 15, fontWeight: 650 }}>{tr('Anmeldung bei Microsoft', 'Signing in with Microsoft')}</div>
        <p className="hint">
          {tr(
            'Öffne die Seite, melde dich mit deinem Microsoft-Account an und gib dort den folgenden Code ein. Danach geht es hier automatisch weiter.',
            'Open the page, sign in with your Microsoft account and enter the following code there. After that it continues here automatically.'
          )}
        </p>
      </div>

      <div className="device-code">{prompt.userCode}</div>

      <div className="row gap-8">
        <button
          className="btn primary grow"
          onClick={() => void window.gabi.app.openExternal(prompt.verificationUri)}
        >
          <IconExternal size={16} />
          {tr('Anmeldeseite öffnen', 'Open sign-in page')}
        </button>
        <CopyButton value={prompt.userCode} label={tr('Code kopieren', 'Copy code')} />
      </div>

      <div className="row-between">
        <span className="hint">
          <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
          {remaining > 0
            ? tr(
                `Warte auf Bestätigung… (noch ${minutes}:${String(seconds).padStart(2, '0')})`,
                `Waiting for confirmation… (${minutes}:${String(seconds).padStart(2, '0')} left)`
              )
            : tr('Code abgelaufen, wird geprüft…', 'Code expired, checking…')}
        </span>
        <button className="btn ghost sm" onClick={onCancel}>
          {tr('Abbrechen', 'Cancel')}
        </button>
      </div>
    </div>
  )
}
