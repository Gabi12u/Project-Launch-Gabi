import { useEffect, useState, type JSX } from 'react'
import type { Account, DeviceCodePrompt } from '@shared/types'
import { refreshAccounts, toast, toastError, useStore } from '../lib/store'
import { initials, skinHeadStyle } from '../lib/format'
import { CopyButton, Modal } from './ui'
import { IconCheck, IconExternal, IconTrash, IconUser } from './Icons'

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { accounts } = useStore()
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null)
  const [busy, setBusy] = useState(false)
  const [offlineName, setOfflineName] = useState('')
  const [creatingOffline, setCreatingOffline] = useState(false)

  useEffect(() => {
    return window.gabi.events.onDeviceCode((next) => setPrompt(next))
  }, [])

  useEffect(() => {
    if (open) void refreshAccounts()
  }, [open])

  const loginMicrosoft = async (): Promise<void> => {
    setBusy(true)
    try {
      const account = await window.gabi.accounts.loginMicrosoft()
      toast('success', 'Angemeldet', `Willkommen, ${account.username}!`)
      await refreshAccounts()
      setPrompt(null)
    } catch (err) {
      toastError(err, 'Anmeldung fehlgeschlagen')
      setPrompt(null)
    } finally {
      setBusy(false)
    }
  }

  const cancelLogin = async (): Promise<void> => {
    await window.gabi.accounts.cancelLogin()
    setPrompt(null)
    setBusy(false)
  }

  /** Closing the dialog must not leave a login running in the background. */
  const closeAndCancel = (): void => {
    if (busy) {
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
      toast('success', 'Offline-Profil angelegt', account.username)
      setOfflineName('')
      await refreshAccounts()
    } catch (err) {
      toastError(err, 'Profil konnte nicht angelegt werden')
    } finally {
      setCreatingOffline(false)
    }
  }

  const setActive = async (id: string): Promise<void> => {
    await window.gabi.accounts.setActive(id)
    await refreshAccounts()
  }

  const remove = async (id: string): Promise<void> => {
    await window.gabi.accounts.remove(id)
    await refreshAccounts()
  }

  return (
    <Modal
      open={open}
      title="Accounts"
      subtitle="Melde dich mit Microsoft an, um online zu spielen, oder nutze ein Offline-Profil zum Testen."
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
                  onRemove={() => remove(account.id)}
                />
              ))}
            </div>
          )}

          <div className="col gap-12">
            <button className="btn primary block lg" onClick={loginMicrosoft} disabled={busy}>
              {busy ? <span className="spinner" /> : <IconUser size={17} />}
              Mit Microsoft anmelden
            </button>

            <div className="row gap-12" style={{ color: 'var(--text-4)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              oder
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>

            <div className="field">
              <label className="label" id="am-offline-profil">Offline-Profil</label>
              <div role="group" aria-labelledby="am-offline-profil" className="row gap-8">
                <input
                  className="input"
                  placeholder="Spielername"
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
                  Anlegen
                </button>
              </div>
              <span className="hint">
                Offline-Profile funktionieren nur auf Servern ohne Online-Modus und in Einzelspieler-Welten.
              </span>
            </div>
          </div>
        </>
      )}
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
            Auswählen
          </button>
        )}
        <button className="btn ghost icon sm" onClick={onRemove} aria-label="Entfernen">
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
        <div style={{ fontSize: 15, fontWeight: 650 }}>Anmeldung bei Microsoft</div>
        <p className="hint">
          Öffne die Seite, melde dich mit deinem Microsoft-Konto an und gib dort den folgenden Code ein.
          Danach geht es hier automatisch weiter.
        </p>
      </div>

      <div className="device-code">{prompt.userCode}</div>

      <div className="row gap-8">
        <button
          className="btn primary grow"
          onClick={() => void window.gabi.app.openExternal(prompt.verificationUri)}
        >
          <IconExternal size={16} />
          Anmeldeseite öffnen
        </button>
        <CopyButton value={prompt.userCode} label="Code kopieren" />
      </div>

      <div className="row-between">
        <span className="hint">
          <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
          Warte auf Bestätigung… (noch {minutes}:{String(seconds).padStart(2, '0')})
        </span>
        <button className="btn ghost sm" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  )
}
