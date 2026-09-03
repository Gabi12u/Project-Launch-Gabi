import { useEffect, useRef, useState } from 'react'
import type { InstanceSummary } from '@shared/types'
import { getState } from './store'

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
