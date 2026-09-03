import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { navigate, parseRoute, refreshAccounts, setState, useStore } from '../lib/store'
import { initials, skinHeadStyle } from '../lib/format'
import { NAV_ENTRIES } from '../lib/nav'
import { Logo } from './Logo'
import { AccountModal } from './AccountModal'
import {
  IconChevronDown,
  IconClose,
  IconMaximize,
  IconMinimize,
  IconRestore,
  IconSearch
} from './Icons'

/** mm:ss since the recording began, or 0:00 before the first tick. */
function elapsed(startedAt: number | null): string {
  if (!startedAt) return '0:00'
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The navigation as a bar across the top: logo, the entries as tabs, then
 * the account and the window buttons. Replaces both the title bar and the
 * side column when that layout is chosen, so the window keeps exactly one
 * row of chrome instead of stacking two.
 */
export function TopBar(): JSX.Element {
  const { route, instances, accounts, updateReady, maximized, tasks, recording } = useStore()
  const [accountOpen, setAccountOpen] = useState(false)
  const [platform, setPlatform] = useState('win32')
  // Only used to re-render the recording clock once a second.
  const [, tick] = useState(0)

  const section = parseRoute(route).section
  const updateCount = instances.reduce((sum, i) => sum + i.updateCount, 0)
  const active = accounts.find((a) => a.active)
  const running = instances.filter((i) => i.running).length
  const activeTasks = tasks.filter((t) => t.state === 'running').length

  useEffect(() => {
    void window.gabi.app.info().then((info) => setPlatform(info.platform))
  }, [])

  useEffect(() => {
    if (!recording.active) return
    const timer = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording.active])

  /* --- Sliding underline ------------------------------------------- */
  const navRef = useRef<HTMLDivElement | null>(null)
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const container = navRef.current
    if (!container) return

    const measure = (): void => {
      const target = container.querySelector<HTMLElement>('[data-active="true"]')
      setBar(target ? { x: target.offsetLeft, w: target.offsetWidth } : null)
    }

    measure()
    // Font loading and window resizes both move the tabs.
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [section])

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">
          <Logo size={26} />
          <span className="topbar-brand-name">
            Launch<span className="topbar-brand-accent">Gabi</span>
          </span>
        </div>

        <div className="topbar-nav no-drag" ref={navRef}>
          <div
            className={`topbar-underline ${bar ? 'ready' : ''}`}
            style={bar ? { transform: `translateX(${bar.x}px)`, width: bar.w } : undefined}
          />
          {NAV_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              data-active={section === entry.id}
              className={`topbar-tab ${section === entry.id ? 'active' : ''} ${entry.trailing ? 'trailing' : ''}`}
              onClick={() => navigate(entry.id === 'settings' && updateReady ? '/settings?section=updates' : entry.route)}
              title={entry.id === 'settings' && updateReady ? `Update auf ${updateReady} wartet` : undefined}
            >
              {entry.label}
              {entry.id === 'mods' && updateCount > 0 ? <span className="nav-badge">{updateCount}</span> : null}
              {entry.id === 'settings' && updateReady ? <span className="nav-dot" aria-label="Update bereit" /> : null}
            </button>
          ))}
        </div>

        <div className="topbar-status">
          {running > 0 && (
            <span className="badge ok dot live no-drag">
              {running === 1 ? 'Minecraft läuft' : `${running} laufen`}
            </span>
          )}
          {recording.active && (
            <button
              className="rec-pill no-drag"
              title="Aufnahme beenden"
              aria-label={`Aufnahme beenden, läuft seit ${elapsed(recording.startedAt)}`}
              onClick={() => void window.gabi.recording.toggle()}
            >
              <span className="rec-dot" />
              {elapsed(recording.startedAt)}
            </button>
          )}
          {activeTasks > 0 && (
            <span className="badge accent no-drag">
              <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
              {activeTasks}
            </span>
          )}
        </div>

        <button className="topbar-account no-drag" onClick={() => setAccountOpen(true)}>
          <div
            className={`avatar sm${active && skinHeadStyle(active.skinUrl) ? ' skin-head' : ''}`}
            style={active ? (skinHeadStyle(active.skinUrl) ?? undefined) : undefined}
          >
            {active ? (skinHeadStyle(active.skinUrl) ? '' : initials(active.username)) : '?'}
          </div>
          <span className="truncate">{active?.username ?? 'Kein Account'}</span>
          <IconChevronDown size={13} />
        </button>

        {platform !== 'darwin' && (
          <div className="topbar-window">
            <button
              className="win-btn no-drag"
              onClick={() => setState({ paletteOpen: true })}
              aria-label="Befehle suchen"
              data-tip="Strg + K"
            >
              <IconSearch size={15} />
            </button>
            <button className="win-btn no-drag" onClick={() => window.gabi.window.minimize()} aria-label="Minimieren">
              <IconMinimize />
            </button>
            <button
              className="win-btn no-drag"
              onClick={() => window.gabi.window.maximize()}
              aria-label={maximized ? 'Wiederherstellen' : 'Maximieren'}
            >
              {maximized ? <IconRestore /> : <IconMaximize />}
            </button>
            <button className="win-btn close no-drag" onClick={() => window.gabi.window.close()} aria-label="Schließen">
              <IconClose />
            </button>
          </div>
        )}
      </header>

      <AccountModal
        open={accountOpen}
        onClose={() => {
          setAccountOpen(false)
          void refreshAccounts()
        }}
      />
    </>
  )
}
