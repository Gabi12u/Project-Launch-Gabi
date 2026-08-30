import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Greyed out, with the reason shown as a tooltip. */
  disabled?: boolean
  disabledReason?: string
  /** Renders in the danger colour, for destructive entries. */
  danger?: boolean
  /** Draws a divider above this entry. */
  separated?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** Distance kept from the window edge when the menu has to be nudged inwards. */
const MARGIN = 8

/**
 * A right-click menu anchored at the pointer.
 *
 * Rendered through a portal so it is never clipped by a scrolling list, and
 * positioned after mount: the size is only known once it exists, and a menu
 * opened near the bottom right corner has to flip back inside the window.
 */
export function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })
  const [cursor, setCursor] = useState(0)

  // Reset whenever the menu is re-anchored, which is what happens when the
  // user right-clicks a different row without closing first. The component
  // stays mounted in that case, so without this the highlight stayed on
  // whatever entry was selected for the previous row — and since "Entfernen"
  // is the last entry and asks no confirmation, a stray Enter could delete
  // the wrong mod outright.
  useLayoutEffect(() => {
    setCursor(0)
  }, [x, y, items])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN)),
      ready: true
    })
  }, [x, y])

  useEffect(() => {
    // Pointer down rather than click: a click listener would also catch the
    // release of the very right-click that opened this menu.
    const onPointer = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      const usable = items.filter((item) => !item.disabled)
      if (usable.length === 0) return

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((current) => {
          const step = event.key === 'ArrowDown' ? 1 : -1
          let next = current
          // Skip past disabled entries so the highlight never parks on one.
          for (let i = 0; i < items.length; i++) {
            next = (next + step + items.length) % items.length
            if (!items[next].disabled) break
          }
          return next
        })
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const item = items[cursor]
        if (item && !item.disabled) {
          event.preventDefault()
          onClose()
          item.onSelect()
        }
      }
    }

    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    // Scrolling would leave the menu floating over unrelated content.
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [items, cursor, onClose])

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{
        left: pos.left,
        top: pos.top,
        // Hidden for the single frame before the measured position is known,
        // otherwise it visibly jumps when it has to be nudged inwards.
        visibility: pos.ready ? 'visible' : 'hidden'
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          role="menuitem"
          className={`context-item${item.danger ? ' danger' : ''}${index === cursor ? ' active' : ''}${
            item.separated ? ' separated' : ''
          }`}
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          onMouseEnter={() => !item.disabled && setCursor(index)}
          onClick={() => {
            // Checked here too, not only through the `disabled` attribute. The
            // keyboard path already re-checks; leaving the mouse path relying
            // purely on the browser means one stray `pointer-events` rule in
            // the stylesheet would silently re-arm "Entfernen".
            if (item.disabled) return
            onClose()
            item.onSelect()
          }}
        >
          {item.icon && <span className="context-icon">{item.icon}</span>}
          <span className="grow truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}

/**
 * Tracks where a right-click landed.
 *
 * Kept as a hook so a list can share one menu instead of mounting one per row,
 * which for a few hundred mods would be a few hundred portals.
 */
export function useContextMenu<T>(): {
  open: { x: number; y: number; target: T } | null
  onContextMenu: (event: { preventDefault: () => void; clientX: number; clientY: number }, target: T) => void
  close: () => void
} {
  const [open, setOpen] = useState<{ x: number; y: number; target: T } | null>(null)

  return {
    open,
    onContextMenu: (event, target) => {
      event.preventDefault()
      setOpen({ x: event.clientX, y: event.clientY, target })
    },
    close: () => setOpen(null)
  }
}
