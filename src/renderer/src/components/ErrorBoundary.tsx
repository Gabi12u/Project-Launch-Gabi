import { Component, type ErrorInfo, type ReactNode } from 'react'
import { navigate } from '../lib/store'
import { IconRefresh, IconWarning } from './Icons'

interface Props {
  children: ReactNode
  /**
   * 'view' sits around a single routed view: it offers a soft retry and a
   * way back to Home, and everything else in the window (navigation, task
   * dock, overlays) keeps working untouched. 'app' sits around everything
   * else as the last resort and only offers a full reload, since at that
   * point the surrounding chrome itself is what broke.
   */
  variant: 'view' | 'app'
  /** Clears a caught error whenever this changes, typically the route. */
  resetKey?: string
}

interface State {
  error: Error | null
}

/**
 * Stops an unexpected render error from blanking the whole window.
 *
 * Nothing in the interface used to catch a thrown render error at all: React
 * unmounts everything above the first component that threw, and with no
 * boundary anywhere, that meant the entire window, leaving the launcher
 * showing nothing but its background colour, recoverable only by closing and
 * reopening the whole program. A class component is the only way React
 * offers to catch this, there is no hook for it, which is why this one file
 * breaks from the rest of the codebase's function-component style.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // App.tsx already reports uncaught `window.onerror` and
    // `unhandledrejection` events. A render error caught here never reaches
    // either, by definition, so without this call it would simply stop being
    // reported the moment something started catching it.
    void window.gabi.reports
      .record('ui:boundary', error.message, `${error.stack ?? ''}\n${info.componentStack ?? ''}`)
      .catch(() => undefined)
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private retry = (): void => this.setState({ error: null })

  private goHome = (): void => {
    this.retry()
    navigate('')
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const full = this.props.variant === 'app'

    return (
      <div
        className={full ? 'app' : undefined}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          textAlign: 'center',
          padding: 32,
          minHeight: full ? '100vh' : '60vh'
        }}
      >
        <IconWarning size={30} />
        <div style={{ fontSize: 16, fontWeight: 650 }}>Hier ist etwas schiefgelaufen</div>
        <p className="hint" style={{ maxWidth: 440 }}>
          Diese Ansicht hat einen Fehler ausgelöst, mit dem nicht gerechnet wurde. Der Rest von
          Launch Gabi läuft weiter.
        </p>
        <p className="mono hint" style={{ maxWidth: 480, wordBreak: 'break-word', opacity: 0.8 }}>
          {error.message}
        </p>
        <div className="row gap-8">
          {full ? (
            <button className="btn primary" onClick={() => window.location.reload()}>
              <IconRefresh size={14} /> Launcher neu laden
            </button>
          ) : (
            <>
              <button className="btn" onClick={this.retry}>
                <IconRefresh size={14} /> Erneut versuchen
              </button>
              <button className="btn primary" onClick={this.goHome}>
                Zur Startseite
              </button>
            </>
          )}
        </div>
      </div>
    )
  }
}
