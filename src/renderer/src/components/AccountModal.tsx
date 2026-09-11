import { useEffect, useState, type JSX, useRef} from 'react'
import type { Account, DeviceCodePrompt } from '@shared/types'
import { refreshAccounts, toast, toastError, useStore } from '../lib/store'
import { initials, skinHeadStyle } from '../lib/format'
import { t } from '../lib/i18n'
import { CopyButton, Confirm, Modal } from './ui'
import { IconCheck, IconExternal, IconTrash, IconUser } from './Icons'

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
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
      toast(
        'success',
        t('wizard', 'account.toast.loggedInTitle'),
        t('wizard', 'account.toast.loggedInBody', { name: account.username })
      )
      await refreshAccounts()
      setPrompt(null)
    } catch (err) {
      if (ticket !== attempt.current) return
      // A cancel the user asked for themselves is not a failure and needs no
      // alarming message; the dialog has already returned to its normal state.
      if (!(err instanceof Error && err.message === 'Anmeldung abgebrochen')) {
        toastError(err, t('wizard', 'account.toast.loginError'))
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

  const loginOffline = async (): Promise<void> => {
    if (!offlineName.trim() || creatingOffline) return
    // Without this guard a double click fires two concurrent requests and two
    // success toasts for one intent, unlike the Microsoft button which is
    // disabled while busy.
    setCreatingOffline(true)
    try {
      const account = await window.gabi.accounts.loginOffline(offlineName.trim())
      toast('success', t('wizard', 'account.toast.offlineCreatedTitle'), account.username)
      setOfflineName('')
      await refreshAccounts()
    } catch (err) {
      toastError(err, t('wizard', 'account.toast.offlineCreateError'))
    } finally {
      setCreatingOffline(false)
    }
  }

  const setActive = async (id: string): Promise<void> => {
    await window.gabi.accounts.setActive(id)
    await refreshAccounts()
  }

  const remove = async (): Promise<void> => {
    if (!confirmRemove) return
    try {
      await window.gabi.accounts.remove(confirmRemove.id)
      await refreshAccounts()
      setConfirmRemove(null)
    } catch (err) {
      toastError(err, t('wizard', 'account.toast.removeError'))
    }
  }

  return (
    <Modal
      open={open}
      title={t('wizard', 'account.modal.title')}
      subtitle={t('wizard', 'account.modal.subtitle')}
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
              {t('wizard', 'account.loginMicrosoftButton')}
            </button>

            <div className="row gap-12" style={{ color: 'var(--text-4)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              {t('wizard', 'account.or')}
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>

            <div className="field">
              <label className="label" id="am-offline-profil">{t('wizard', 'account.offlineProfileLabel')}</label>
              <div role="group" aria-labelledby="am-offline-profil" className="row gap-8">
                <input
                  className="input"
                  placeholder={t('wizard', 'account.usernamePlaceholder')}
                  value={offlineName}
                  maxLength={16}
                  onChange={(event) => setOfflineName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void loginOffline()}
                />
                <button
                  className="btn"
                  onClick={loginOffline}
                  disabled={creatingOffline || offlineName.trim().length < 3}
                >
                  {t('wizard', 'account.createOfflineButton')}
                </button>
              </div>
              <span className="hint">
                {t('wizard', 'account.offlineProfileHint')}
              </span>
            </div>
          </div>
        </>
      )}

      <Confirm
        open={confirmRemove !== null}
        title={t('wizard', 'account.removeConfirm.title')}
        danger
        message={
          confirmRemove
            ? t('wizard', 'account.removeConfirm.message', { name: confirmRemove.username })
            : ''
        }
        confirmLabel={t('wizard', 'account.removeConfirm.confirm')}
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
          <span>{account.type === 'microsoft' ? 'Microsoft-Account' : 'Offline-Profil'}</span>
          {expired && <span className="badge warn">Sitzung abgelaufen</span>}
          {account.active && (
            <span className="badge ok dot">
              <IconCheck size={11} /> Aktiv
            </span>
          )}
        </div>
      </div>

      <div className="content-actions">
        {!account.active && (
          <button className="btn sm" onClick={onActivate}>
            {t('wizard', 'account.selectButton')}
          </button>
        )}
        <button
          className="btn ghost icon sm"
          onClick={onRemove}
          aria-label={t('common', 'remove')}
        >
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
        <div style={{ fontSize: 15, fontWeight: 650 }}>{t('wizard', 'account.deviceCode.title')}</div>
        <p className="hint">{t('wizard', 'account.deviceCode.instructions')}</p>
      </div>

      <div className="device-code">{prompt.userCode}</div>

      <div className="row gap-8">
        <button
          className="btn primary grow"
          onClick={() => void window.gabi.app.openExternal(prompt.verificationUri)}
        >
          <IconExternal size={16} />
          {t('wizard', 'account.deviceCode.openPageButton')}
        </button>
        <CopyButton value={prompt.userCode} label={t('wizard', 'account.deviceCode.copyCodeLabel')} />
      </div>

      <div className="row-between">
        <span className="hint">
          <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
          {t('wizard', 'account.deviceCode.waiting', {
            minutes,
            seconds: String(seconds).padStart(2, '0')
          })}
        </span>
        <button className="btn ghost sm" onClick={onCancel}>
          {t('common', 'cancel')}
        </button>
      </div>
    </div>
  )
}
