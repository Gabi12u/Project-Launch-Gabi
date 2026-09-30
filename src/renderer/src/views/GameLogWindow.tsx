import { useEffect, useRef, useState, type JSX } from 'react'
import type { LaunchStatus, LogLine } from '@shared/types'
import { formatTime } from '../lib/format'
import { refreshSettings } from '../lib/store'
import { Ambient } from '../components/Ambient'
import { IconClose, IconMinimize } from '../components/Icons'
import { tr } from '@shared/i18n'

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
  // Whether the box was scrolled near its bottom just before the lines below
  // change, so a new burst of output does not yank the view down from under
  // someone who scrolled up to read something earlier. Starts true so the
  // very first batch of history still lands scrolled to the bottom.
  const nearBottomRef = useRef(true)

  const handleScroll = (): void => {
    const box = boxRef.current
    if (!box) return
    nearBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  }

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
          // A multiset, not a Set: two genuinely identical lines (same time and
          // text) can both be real output, and a plain Set would drop the
          // second one as if it were the same line arriving twice.
          const counts = new Map<string, number>()
          for (const line of history) {
            const key = `${line.time}|${line.text}`
            counts.set(key, (counts.get(key) ?? 0) + 1)
          }
          const fresh = streamed.filter((line) => {
            const key = `${line.time}|${line.text}`
            const remaining = counts.get(key) ?? 0
            if (remaining <= 0) return true
            counts.set(key, remaining - 1)
            return false
          })
          return [...history, ...fresh].slice(-1200)
        })
      })
      .catch(() => undefined)

    // One state update per batch rather than per line; see instanceLog.ts.
    const offLine = window.gabi.events.onLogLines((batch) => {
      const mine = batch.filter((line) => line.instanceId === instanceId)
      if (mine.length === 0) return
      setLines((current) => [...current, ...mine].slice(-1200))
    })
    const offStatus = window.gabi.events.onLaunchStatus((next) => {
      if (next.instanceId !== instanceId) return
      setStatus(next)
    })
    // The launch can race through its phases before this window has even
    // loaded; without asking once, the state badge stayed empty all session.
    void window.gabi.launch
      .status(instanceId)
      .then((current) => setStatus((existing) => existing ?? current))
      .catch(() => undefined)

    return () => {
      cancelled = true
      offLine()
      offStatus()
    }
  }, [instanceId])

  useEffect(() => {
    const box = boxRef.current
    if (box && nearBottomRef.current) box.scrollTop = box.scrollHeight
  }, [lines])

  // The window itself was created with a generic Electron title until this
  // runs; kept in sync here rather than left on the `BrowserWindow` option
  // alone, since the taskbar entry follows the document title, not that
  // initial value.
  useEffect(() => {
    document.title = tr(`Live-Log: ${instanceName}`, `Live log: ${instanceName}`)
  }, [instanceName])

  // This window is a separate renderer process with its own, otherwise
  // untouched document, so without this it never picks up the theme
  // (accent colour, aurora colours) the rest of the launcher runs with and
  // stayed on the plain default background regardless of what was chosen
  // under Einstellungen, Darstellung.
  useEffect(() => {
    void refreshSettings().catch(() => undefined)
  }, [])


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
            aria-label={tr('Minimieren', 'Minimize')}
          >
            <IconMinimize />
          </button>
          <button
            className="win-btn close no-drag"
            onClick={() => window.gabi.window.close()}
            aria-label={tr('Schließen', 'Close')}
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
            <button className="btn sm" onClick={() => window.gabi.window.showLauncher()}>
              {tr('Launcher öffnen', 'Open launcher')}
            </button>
            <button
              className="btn sm"
              onClick={() => void navigator.clipboard.writeText(lines.map((line) => line.text).join('\n'))}
            >
              {tr('Protokoll kopieren', 'Copy log')}
            </button>
            {/* Only once the game process exists: before that, stopping has
                nothing to act on and the button did nothing at all. */}
            {status?.phase === 'running' && (
              <button className="btn sm danger" onClick={() => void window.gabi.launch.stop(instanceId)}>
                {tr('Beenden', 'Stop')}
              </button>
            )}
          </div>
        </div>

        <div
          className="log-view grow"
          ref={boxRef}
          onScroll={handleScroll}
          style={{ flex: 1, minHeight: 0 }}
        >
          {lines.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>{tr('Noch keine Ausgabe.', 'No output yet.')}</div>
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
