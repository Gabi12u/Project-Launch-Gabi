import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayId } from './ui'

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

  // On the same overlay stack as Modal and the command palette: a menu opened
  // over a modal must not let Escape also close that modal underneath.
  const isTop = useOverlayId(true)

  // Reset whenever the menu is re-anchored, which is what happens when the
  // user right-clicks a different row without closing first. The component
  // stays mounted in that case, so without this the highlight stayed on
  // whatever entry was selected for the previous row — and since "Entfernen"
  // is the last entry and asks no confirmation, a stray Enter could delete
  // the wrong mod outright.
  // Keyed on this signature rather than on `items` itself: the caller builds
  // that array inline on every render, so its reference changes on every
  // unrelated store update while the menu is open, which reset the highlight
  // back to the first entry constantly. The signature only changes when the
  // entries themselves actually do (a different row, or one flipping
  // enabled/disabled), which is the only time a reset makes sense.
  const signature = useMemo(
    () => items.map((item) => `${item.label}:${item.disabled ? 1 : 0}`).join('|'),
    [items]
  )
  useLayoutEffect(() => {
    setCursor(0)
  }, [x, y, signature])

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
      // Something opened on top (the command palette) owns the keyboard, so
      // neither Escape nor Enter may act on this menu underneath it.
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.preventDefault()
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
    window.addEventListener('resize', onClose)
    // Capture phase: the menu is anchored to a point on screen, not to the
    // row it was opened for, so scrolling any list underneath it (most of
    // them scroll in their own container, which never bubbles a scroll event
    // up to window) has to close it too. Left open, it kept floating over
    // whatever row ended up under it, and choosing an entry acted on the
    // instance it was opened for, not the one now visible underneath.
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [items, cursor, onClose, isTop])

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
