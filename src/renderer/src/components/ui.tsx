import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconX } from './Icons'

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: 'normal' | 'wide' | 'xwide'
  /** Blocks closing while a long action runs. */
  busy?: boolean
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'normal',
  busy = false
}: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, busy])

  if (!open) return null

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className={`modal ${width === 'normal' ? '' : width}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="col gap-4">
            <div className="card-title">{title}</div>
            {subtitle && <div className="hint">{subtitle}</div>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose} disabled={busy} aria-label="Schließen">
            <IconX size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ *
 * Confirm dialog
 * ------------------------------------------------------------------ */

interface ConfirmProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmProps): JSX.Element {
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={run} disabled={busy}>
            {busy && <span className="spinner" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>{message}</div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Small controls
 * ------------------------------------------------------------------ */

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  /** Read out instead of just "switch, on" when there is no visible label. */
  label?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    />
  )
}

export function SettingToggle({
  label,
  hint,
  checked,
  onChange,
  disabled
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="switch-row">
      <div className="col">
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      {/* The visible text sits in a plain span, which no assistive technology
          connects to the control on its own. Without this the switch is
          announced as "switch, on" with no hint what it toggles. */}
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({
  value,
  indeterminate
}: {
  value: number | null
  indeterminate?: boolean
}): JSX.Element {
  const isIndeterminate = indeterminate || value === null
  return (
    <div className="progress">
      <div
        className={`progress-fill ${isIndeterminate ? 'indeterminate' : ''}`}
        style={{ width: isIndeterminate ? '100%' : `${Math.round((value ?? 0) * 100)}%` }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Play button
 * ------------------------------------------------------------------ */

/**
 * The headline launch button. Adds a click ripple that starts where the
 * pointer landed — the one piece of feedback that makes a big button feel
 * physical rather than painted on.
 */
export function PlayButton({
  children,
  stop = false,
  disabled = false,
  onClick
}: {
  children: ReactNode
  stop?: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    const button = buttonRef.current
    if (button) {
      const rect = button.getBoundingClientRect()
      const ripple = document.createElement('span')
      const size = Math.max(rect.width, rect.height) * 2.2

      ripple.className = 'ripple'
      ripple.style.width = `${size}px`
      ripple.style.height = `${size}px`
      ripple.style.left = `${event.clientX - rect.left}px`
      ripple.style.top = `${event.clientY - rect.top}px`
      ripple.addEventListener('animationend', () => ripple.remove())
      button.appendChild(ripple)
    }
    onClick()
  }

  return (
    <button
      ref={buttonRef}
      className={`btn-play ${stop ? 'stop' : ''}`}
      disabled={disabled}
      onClick={handleClick}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Empty state
 * ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  message,
  action
}: {
  icon: ReactNode
  title: string
  message: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && <div className="mt-8">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Copy-to-clipboard button
 * ------------------------------------------------------------------ */

export function CopyButton({ value, label }: { value: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  return (
    <button
      className="btn sm"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
    >
      {copied ? <IconCheck size={14} /> : null}
      {copied ? 'Kopiert' : (label ?? 'Kopieren')}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Skeleton list
 * ------------------------------------------------------------------ */

export function SkeletonRows({ count = 5, height = 68 }: { count?: number; height?: number }): JSX.Element {
  return (
    <div className="col gap-8">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}
