import { useEffect, useRef, useState, type JSX } from 'react'
import type { LaunchStatus, LogLine } from '@shared/types'
import { formatTime } from '../lib/format'
import { refreshSettings } from '../lib/store'
import { Ambient } from '../components/Ambient'
import { IconClose, IconMinimize } from '../components/Icons'

/**
 * The whole content of the separate live-log window opened for every launch,
 * one per running instance, in the style of a classic launcher console
 * window rather than a panel inside the main window.
 *
 * Mounted instead of the normal `App` when the window was opened with a
 * `gameLog` query parameter (see `main.tsx`), so this never shares a window
 * with the rest of the launcher and closing it has no effect on anything else.
 */
export function GameLogWindow({
  instanceId,
  instanceName
}: {
  instanceId: string
  instanceName: string
}): JSX.Element {
  const [lines, setLines] = useState<LogLine[]>([])
  const [status, setStatus] = useState<LaunchStatus | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.gabi.launch
      .logs(instanceId)
      .then((history) => {
        if (cancelled) return
        // The subscription below is already live by the time this resolves,
        // so lines can arrive while the history is still in flight. Replacing
        // the array outright would drop them.
        setLines((streamed) => {
          const seen = new Set(history.map((line) => `${line.time}|${line.text}`))
          const fresh = streamed.filter((line) => !seen.has(`${line.time}|${line.text}`))
          return [...history, ...fresh].slice(-1200)
        })
      })
      .catch(() => undefined)

    const offLine = window.gabi.events.onLogLine((line) => {
      if (line.instanceId !== instanceId) return
      setLines((current) => [...current, line].slice(-1200))
    })
    const offStatus = window.gabi.events.onLaunchStatus((next) => {
      if (next.instanceId !== instanceId) return
      setStatus(next)
    })

    return () => {
      cancelled = true
      offLine()
      offStatus()
    }
  }, [instanceId])

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines])

  // The window itself was created with a generic Electron title until this
  // runs; kept in sync here rather than left on the `BrowserWindow` option
  // alone, since the taskbar entry follows the document title, not that
  // initial value.
  useEffect(() => {
    document.title = `Live-Log: ${instanceName}`
  }, [instanceName])

  // This window is a separate renderer process with its own, otherwise
  // untouched document, so without this it never picks up the theme
  // (accent colour, aurora colours) the rest of the launcher runs with and
  // stayed on the plain default background regardless of what was chosen
  // under Einstellungen, Darstellung.
  useEffect(() => {
    void refreshSettings().catch(() => undefined)
  }, [])

  const ended = status?.phase === 'stopped' || status?.phase === 'crashed' || status?.phase === 'idle'

  return (
    <div className="app col" style={{ height: '100vh' }}>
      <Ambient />
      <header className="titlebar">
        <div className="titlebar-left">
          <span className="titlebar-title">{instanceName}</span>
        </div>
        <div className="titlebar-right">
          <button
            className="win-btn no-drag"
            onClick={() => window.gabi.window.minimize()}
            aria-label="Minimieren"
          >
            <IconMinimize />
          </button>
          <button
            className="win-btn close no-drag"
            onClick={() => window.gabi.window.close()}
            aria-label="Schließen"
          >
            <IconClose />
          </button>
        </div>
      </header>

      <div className="col" style={{ flex: 1, minHeight: 0, padding: 16, gap: 12 }}>
        <div className="row-between" style={{ flexShrink: 0 }}>
          {status ? (
            <div
              className={`badge ${status.phase === 'crashed' ? 'danger' : status.phase === 'running' ? 'ok' : ''}`}
            >
              {status.detail}
            </div>
          ) : (
            <span />
          )}
          <div className="row gap-8">
            <button
              className="btn sm"
              onClick={() => void navigator.clipboard.writeText(lines.map((line) => line.text).join('\n'))}
            >
              Protokoll kopieren
            </button>
            {!ended && (
              <button className="btn sm danger" onClick={() => void window.gabi.launch.stop(instanceId)}>
                Beenden
              </button>
            )}
          </div>
        </div>

        <div className="log-view grow" ref={boxRef} style={{ flex: 1, minHeight: 0 }}>
          {lines.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>Noch keine Ausgabe.</div>
          ) : (
            lines.map((line, index) => (
              <div key={index} className={`log-line ${line.stream === 'launcher' ? 'launcher' : line.level}`}>
                <span className="log-time">{formatTime(line.time)}</span>
                <span>{line.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
