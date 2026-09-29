import { useEffect, useRef, useState, type AnimationEvent, type JSX } from 'react'
import { useStore } from '../lib/store'
import { Ambient } from './Ambient'
import { LogoIntro } from './LogoIntro'
import { tr } from '@shared/i18n'

/** Pause on the finished logo before the splash fades. */
const HOLD_MS = 350
const LEAVE_MS = 320
/** Opens the launcher even if the intro never reports its end. */
const FALLBACK_MS = 7000

type Phase = 'loading' | 'intro' | 'leaving'

/**
 * The start screen. While the launcher loads it shows only the loading bar;
 * once everything is in, the logo intro plays and the launcher opens.
 *
 * Driven by the animation's own end rather than a fixed timer: CSS
 * animations only start once the window actually paints, so a window
 * covered by another one started the intro late while a timer had already
 * moved on, and the launcher opened over a half drawn logo.
 *
 * No intro at all when it is switched off in the settings, with reduced
 * motion (the launcher's own setting or the system's) or when the window is
 * not visible when loading finishes, as with "start minimised". A click or
 * Escape skips it.
 */
export function BootSplash({ ready, onDone }: { ready: boolean; onDone: () => void }): JSX.Element {
  const { settings } = useStore()
  const [phase, setPhase] = useState<Phase>('loading')
  const finished = useRef(false)

  const finish = (): void => {
    if (finished.current) return
    finished.current = true
    onDone()
  }

  const leave = (): void => {
    setPhase((current) => (current === 'intro' ? 'leaving' : current))
  }

  useEffect(() => {
    if (!ready) return
    const reduced =
      settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!settings.bootIntro || reduced || document.visibilityState === 'hidden') {
      finish()
      return
    }
    setPhase('intro')
    const fallback = setTimeout(leave, FALLBACK_MS)
    return () => clearTimeout(fallback)
    // Runs once, the moment loading finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = setTimeout(finish, LEAVE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    if (phase === 'loading') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // The light pass is the last part of the intro.
  const onAnimationEnd = (event: AnimationEvent): void => {
    if (phase === 'intro' && event.animationName === 'lg-sweep') setTimeout(leave, HOLD_MS)
  }

  return (
    <div className="app">
      <Ambient />
      <div
        className={`app-body boot is-${phase}`}
        onClick={phase === 'loading' ? undefined : finish}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="boot-inner">
          <div className="boot-logo">
            <LogoIntro size={76} playing={phase !== 'loading'} />
          </div>
          {/* The loading bar and the wordmark share one spot: the bar fades
              out as the wordmark is uncovered, so nothing shifts. */}
          <div className="boot-status">
            <div className="boot-bar">
              <span />
            </div>
            <span className="boot-word">{tr('Launch Gabi startet', 'Launch Gabi is starting')}</span>
            <div className="boot-wordmark" aria-hidden={phase === 'loading'}>
              <div className="boot-wordmark-title">
                Launch <span className="boot-wordmark-accent">Gabi</span>
              </div>
              <div className="boot-wordmark-sub">{tr('Minecraft Launcher', 'Minecraft Launcher')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
