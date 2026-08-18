import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import type { InstanceSummary } from '@shared/types'
import { getState } from './store'

/**
 * Writes the cursor position into `--mx` / `--my` on the element so CSS can
 * draw a highlight that follows the pointer. Values are percentages, which
 * keeps the CSS readable and avoids a second layout read.
 */
export function useSpotlight<T extends HTMLElement>(): {
  onMouseMove: (event: MouseEvent<T>) => void
  onMouseLeave: (event: MouseEvent<T>) => void
} {
  const onMouseMove = useCallback((event: MouseEvent<T>) => {
    const element = event.currentTarget
    const rect = element.getBoundingClientRect()
    element.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`)
    element.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`)
    element.style.setProperty('--spot', '1')
  }, [])

  const onMouseLeave = useCallback((event: MouseEvent<T>) => {
    event.currentTarget.style.setProperty('--spot', '0')
  }, [])

  return { onMouseMove, onMouseLeave }
}

/**
 * Tilts an element towards the cursor. `max` is the rotation in degrees at the
 * far corners; 6 is about as far as it can go before it looks like a gimmick.
 */
export function useTilt<T extends HTMLElement>(max = 6): {
  onMouseMove: (event: MouseEvent<T>) => void
  onMouseLeave: (event: MouseEvent<T>) => void
} {
  const spotlight = useSpotlight<T>()

  const onMouseMove = useCallback(
    (event: MouseEvent<T>) => {
      spotlight.onMouseMove(event)
      if (getState().settings.reduceMotion) return

      const element = event.currentTarget
      const rect = element.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width - 0.5
      const y = (event.clientY - rect.top) / rect.height - 0.5
      element.style.setProperty('--tilt-x', `${(-y * max).toFixed(2)}deg`)
      element.style.setProperty('--tilt-y', `${(x * max).toFixed(2)}deg`)
    },
    [max, spotlight]
  )

  const onMouseLeave = useCallback(
    (event: MouseEvent<T>) => {
      spotlight.onMouseLeave(event)
      const element = event.currentTarget
      element.style.setProperty('--tilt-x', '0deg')
      element.style.setProperty('--tilt-y', '0deg')
    },
    [spotlight]
  )

  return { onMouseMove, onMouseLeave }
}

/**
 * Counts from zero to `target` once, easing out. Numbers that animate into
 * place read as "just measured" rather than "hardcoded".
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(target)
  const previous = useRef(target)

  useEffect(() => {
    if (getState().settings.reduceMotion) {
      setValue(target)
      previous.current = target
      return
    }

    const from = previous.current
    const delta = target - from
    if (delta === 0) return

    let frame = 0
    const started = performance.now()

    const step = (now: number): void => {
      const progress = Math.min((now - started) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(from + delta * eased)
      if (progress < 1) frame = requestAnimationFrame(step)
      else previous.current = target
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return value
}

/** Ticks once a second so relative timestamps stay honest without a refresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Moves the background of a hero image against the cursor. The offset is tiny
 * on purpose — enough to feel three-dimensional, not enough to notice as motion.
 */
export function useParallax<T extends HTMLElement>(
  ref: RefObject<T | null>,
  strength = 14
): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    const onMove = (event: globalThis.MouseEvent): void => {
      if (getState().settings.reduceMotion) return
      const rect = element.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width - 0.5
      const y = (event.clientY - rect.top) / rect.height - 0.5
      element.style.setProperty('--px', `${(-x * strength).toFixed(1)}px`)
      element.style.setProperty('--py', `${(-y * strength).toFixed(1)}px`)
    }

    const onLeave = (): void => {
      element.style.setProperty('--px', '0px')
      element.style.setProperty('--py', '0px')
    }

    element.addEventListener('mousemove', onMove)
    element.addEventListener('mouseleave', onLeave)
    return () => {
      element.removeEventListener('mousemove', onMove)
      element.removeEventListener('mouseleave', onLeave)
    }
  }, [ref, strength])
}

/**
 * Resolves an instance's custom picture icon to a displayable URL.
 *
 * `appearance.icon` is either an emoji or `img:<filename>`; the filename only
 * becomes a real path through the main process. Anything rendering the raw
 * field shows the literal string "img:a1b2c3.png" instead of the picture, so
 * every place that displays an instance icon goes through here.
 *
 * Returns null for emoji icons, which the caller renders directly.
 */
export function useInstanceIcon(instance: InstanceSummary): string | null {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!instance.appearance.icon.startsWith('img:')) {
      setSrc(null)
      return
    }

    // Cleared before the new lookup, not after it resolves. A component that
    // stays mounted while its `instance` prop changes — the featured card on
    // the home page does exactly that when the last-played instance changes —
    // would otherwise keep showing the previous instance's picture next to the
    // new one's name until the round trip finished.
    setSrc(null)

    let cancelled = false
    void window.gabi.instances
      .get(instance.id)
      .then((detail) => {
        // Windows separators have to become forward slashes for a file:// URL.
        if (!cancelled && detail.resolvedIcon) {
          setSrc(`file://${detail.resolvedIcon.replace(/\\/g, '/')}`)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [instance.id, instance.appearance.icon])

  return src
}
