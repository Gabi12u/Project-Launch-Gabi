import type { JSX } from 'react'
import { dismissToast, navigate, useStore } from '../lib/store'
import { IconCheckCircle, IconInfo, IconWarning, IconX } from './Icons'

const ICONS = {
  success: IconCheckCircle,
  error: IconWarning,
  warning: IconWarning,
  info: IconInfo
}

export function Toasts(): JSX.Element {
  const { toasts } = useStore()

  return (
    <div className="toasts">
      {toasts.map((item) => {
        const Icon = ICONS[item.kind]
        return (
          <div
            key={item.id}
            className={`toast ${item.kind}`}
            onClick={() => {
              if (item.route) {
                navigate(item.route)
                dismissToast(item.id)
              }
            }}
            style={item.route ? { cursor: 'pointer' } : undefined}
          >
            <Icon className="toast-icon" size={20} />
            <div className="grow">
              <div className="toast-title">{item.title}</div>
              {item.message && <div className="toast-msg">{item.message}</div>}
            </div>
            <button
              className="btn ghost icon sm"
              style={{ width: 24, height: 24, marginTop: -2 }}
              onClick={(event) => {
                event.stopPropagation()
                dismissToast(item.id)
              }}
              aria-label="Schließen"
            >
              <IconX size={13} />
            </button>

            {/* Drains in step with the dismiss timer, so the countdown is visible. */}
            {item.timeout && item.timeout > 0 ? (
              <span className="toast-timer" style={{ animationDuration: `${item.timeout}ms` }} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
