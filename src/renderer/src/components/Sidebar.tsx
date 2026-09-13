import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { navigate, parseRoute, refreshAccounts, setState, useStore } from '../lib/store'
import { initials, skinHeadStyle } from '../lib/format'
import { Logo } from './Logo'
import { AccountModal } from './AccountModal'
import {
  IconCompass,
  IconGrid,
  IconHome,
  IconPackage,
  IconSave,
  IconSearch,
  IconSettings
} from './Icons'

interface NavEntry {
  id: string
  label: string
  icon: JSX.Element
  route: string
  badge?: number
}

export function Sidebar(): JSX.Element {
  const { route, instances, accounts, updateReady } = useStore()
  const [accountOpen, setAccountOpen] = useState(false)

  const section = parseRoute(route).section
  const updateCount = instances.reduce((sum, i) => sum + i.updateCount, 0)
  const active = accounts.find((a) => a.active)
  const running = instances.filter((i) => i.running).length

  const entries: NavEntry[] = [
    { id: 'home', label: 'Home', icon: <IconHome />, route: '/home' },
    { id: 'instances', label: 'Instanzen', icon: <IconGrid />, route: '/instances' },
    { id: 'mods', label: 'Mods', icon: <IconPackage />, route: '/mods', badge: updateCount },
    { id: 'discover', label: 'Entdecken', icon: <IconCompass />, route: '/discover' },
    { id: 'backups', label: 'Backups', icon: <IconSave />, route: '/backups' }
  ]

  /* --- Sliding active pill ----------------------------------------- */
  const navRef = useRef<HTMLDivElement | null>(null)
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const container = navRef.current
    if (!container) return

    const measure = (): void => {
      const target = container.querySelector<HTMLElement>('[data-active="true"]')
      setPill(target ? { y: target.offsetTop, h: target.offsetHeight } : null)
    }

    measure()
    // Font loading and window resizes both move the buttons.
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [section])

  return (
    <>
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Logo size={32} />
          </div>
          <div className="brand-text">
            <span className="brand-name">Launch Gabi</span>
            <span className="brand-sub">{running > 0 ? `${running} aktiv` : 'Launcher'}</span>
          </div>
        </div>

        <button className="nav-search no-drag" onClick={() => setState({ paletteOpen: true })}>
          <IconSearch size={15} />
          <span>Suchen…</span>
          <span className="kbd">Strg K</span>
        </button>

        <div className="nav-list" ref={navRef}>
          <div
            className={`nav-pill ${pill ? 'ready' : ''}`}
            style={pill ? { transform: `translateY(${pill.y}px)`, height: pill.h } : undefined}
          />

          {entries.map((entry) => (
            <button
              key={entry.id}
              data-active={section === entry.id}
              className={`nav-item ${section === entry.id ? 'active' : ''}`}
              onClick={() => navigate(entry.route)}
            >
              {entry.icon}
              <span>{entry.label}</span>
              {entry.badge ? <span className="nav-badge">{entry.badge}</span> : null}
            </button>
          ))}

          <div className="nav-sep" />

          <button
            data-active={section === 'settings'}
            className={`nav-item ${section === 'settings' ? 'active' : ''}`}
            onClick={() => navigate(updateReady ? '/settings?section=updates' : '/settings')}
            title={updateReady ? `Update auf ${updateReady} wartet auf einen Neustart` : undefined}
          >
            <IconSettings />
            <span>Einstellungen</span>
            {/* A waiting update announced itself once, in a toast that faded
                after a few seconds, and nowhere else. This is the standing
                reminder for everyone who was not looking at that moment. */}
            {updateReady ? <span className="nav-dot" aria-label="Update bereit" /> : null}
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <button className="account-chip no-drag" onClick={() => setAccountOpen(true)}>
          <div
            className={`avatar${active && skinHeadStyle(active.skinUrl) ? ' skin-head' : ''}`}
            style={active ? (skinHeadStyle(active.skinUrl) ?? undefined) : undefined}
          >
            {/* The head is painted by the background layers, so the tile stays
                empty whenever a skin is available. Without one it falls back
                to the initials, which is the offline-account case. */}
            {active ? (skinHeadStyle(active.skinUrl) ? '' : initials(active.username)) : '?'}
          </div>
          <div className="col grow" style={{ overflow: 'hidden' }}>
            <span className="truncate" style={{ fontSize: 13, fontWeight: 620 }}>
              {active?.username ?? 'Kein Account'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
              {active
                ? active.type === 'microsoft'
                  ? 'Microsoft'
                  : 'Offline-Profil'
                : 'Zum Anmelden klicken'}
            </span>
          </div>
        </button>
      </nav>

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
