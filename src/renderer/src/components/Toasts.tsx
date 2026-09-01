import type { JSX } from 'react'
import { dismissToast, navigate, useStore } from '../lib/store'
import { clickable } from '../lib/a11y'
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
        const hasActions = Boolean(item.actions && item.actions.length > 0)
        return (
          <div
            key={item.id}
            className={`toast ${item.kind}${hasActions ? ' with-actions' : ''}`}
            // Only the ones that navigate somewhere become a control; a plain
            // notification stays a passive region rather than an empty button
            // in the tab order. One with its own buttons is not a link either,
            // clicking the card itself should do nothing.
            {...(item.route && !hasActions
              ? clickable(() => {
                  navigate(item.route as string)
                  dismissToast(item.id)
                })
              : {})}
            style={item.route && !hasActions ? { cursor: 'pointer' } : undefined}
          >
            <Icon className="toast-icon" size={20} />
            <div className="grow">
              <div className="toast-title">{item.title}</div>
              {item.message && <div className="toast-msg">{item.message}</div>}
              {hasActions && (
                <div className="toast-actions">
                  {item.actions?.map((action, index) => (
                    <button
                      key={index}
                      className={`btn sm ${action.primary ? 'primary' : 'ghost'}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        action.onClick()
                        dismissToast(item.id)
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
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
