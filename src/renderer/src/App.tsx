import { useEffect, type JSX } from 'react'
import {
  applyTheme,
  navigate,
  parseRoute,
  pushNotification,
  refreshAccounts,
  refreshInstances,
  refreshSettings,
  setState,
  useStore
} from './lib/store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { TaskDock } from './components/TaskDock'
import { Ambient } from './components/Ambient'
import { CommandPalette } from './components/CommandPalette'
import { Logo } from './components/Logo'
import { CompatibilityGate } from './components/CompatibilityPanel'
import { CreateInstanceWizard } from './views/CreateInstanceWizard'
import { Onboarding } from './views/Onboarding'
import { HomeView } from './views/Home'
import { InstancesView } from './views/Instances'
import { InstanceDetailView } from './views/InstanceDetail'
import { ModsView } from './views/Mods'
import { DiscoverView } from './views/Discover'
import { BackupsView } from './views/Backups'
import { SettingsView } from './views/Settings'

export function App(): JSX.Element {
  const { route, ready, settings, createOpen } = useStore()

  /* --- Bootstrap ------------------------------------------------- */
  useEffect(() => {
    const boot = async (): Promise<void> => {
      try {
        const loaded = await refreshSettings()
        applyTheme(loaded)
      } catch {
        // fall back to the built-in defaults
      }
      await Promise.all([refreshInstances(), refreshAccounts()])

      try {
        setState({ tasks: await window.gabi.tasks.list() })
      } catch {
        // tasks are optional at boot
      }

      setState({ ready: true })
    }
    void boot()
  }, [])

  /* --- Main process events --------------------------------------- */
  useEffect(() => {
    const unsubscribe = [
      window.gabi.events.onTask((task) => {
        setState((current) => {
          const others = current.tasks.filter((t) => t.id !== task.id)
          // Finished tasks disappear from the dock but stay long enough to read.
          return { tasks: [...others, task] }
        })
      }),

      window.gabi.events.onInstanceChanged(() => {
        void refreshInstances()
      }),

      window.gabi.events.onLaunchStatus((status) => {
        setState((current) => ({
          launchStatus: { ...current.launchStatus, [status.instanceId]: status }
        }))
        if (status.phase === 'running' || status.phase === 'stopped' || status.phase === 'crashed') {
          void refreshInstances()
        }
      }),

      window.gabi.events.onNotification((notification) => pushNotification(notification)),

      window.gabi.events.onNavigate((target) => navigate(target)),

      window.gabi.events.onWindowState((state) => setState({ maximized: state.maximized }))
    ]

    return () => unsubscribe.forEach((off) => off())
  }, [])

  /* --- Idle when unfocused --------------------------------------- */
  /*
   * Marks the document idle whenever the launcher is in the background. The
   * stylesheet pauses every animation on that flag, so a window the user is
   * not looking at costs essentially no CPU.
   */
  useEffect(() => {
    const setIdle = (idle: boolean): void => {
      document.documentElement.dataset.idle = idle ? 'true' : 'false'
    }

    const onFocus = (): void => setIdle(false)
    const onBlur = (): void => setIdle(true)
    const onVisibility = (): void => setIdle(document.hidden || !document.hasFocus())

    setIdle(!document.hasFocus())
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  /* --- Keyboard shortcuts ---------------------------------------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setState({ createOpen: true })
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setState((current) => ({ paletteOpen: !current.paletteOpen }))
        return
      }
      // A bare "/" is the second habit people bring from other apps.
      if (!typing && event.key === '/') {
        event.preventDefault()
        setState({ paletteOpen: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const parsed = parseRoute(route)

  if (!ready) {
    return (
      <div className="app">
        <Ambient />
        <div className="app-body boot">
          <div className="boot-inner">
            <div className="boot-logo">
              <Logo size={76} glow />
            </div>
            <div className="boot-bar">
              <span />
            </div>
            <span className="boot-word">Launch Gabi startet</span>
          </div>
        </div>
      </div>
    )
  }

  if (!settings.onboarded) {
    return <Onboarding />
  }

  return (
    <div className="app">
      <Ambient />
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="main">
          <div className="view">
            <div className="view-inner" key={parsed.section + (parsed.param ?? '')}>
              <RouteView section={parsed.section} param={parsed.param} query={parsed.query} />
            </div>
          </div>
        </main>
      </div>

      <TaskDock />
      <Toasts />
      <CommandPalette />
      <CompatibilityGate />
      <CreateInstanceWizard open={createOpen} onClose={() => setState({ createOpen: false })} />
    </div>
  )
}

function RouteView({
  section,
  param,
  query
}: {
  section: string
  param?: string
  query: URLSearchParams
}): JSX.Element {
  switch (section) {
    case 'instances':
      return param ? <InstanceDetailView instanceId={param} query={query} /> : <InstancesView />
    case 'mods':
      return <ModsView />
    case 'discover':
      return <DiscoverView query={query} />
    case 'backups':
      return <BackupsView />
    case 'settings':
      return <SettingsView />
    case 'home':
    default:
      return <HomeView />
  }
}
