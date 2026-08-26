import { useEffect, useState, type JSX } from 'react'
import { setState, useStore } from '../lib/store'
import { IconClose, IconMaximize, IconMinimize, IconRestore, IconSearch } from './Icons'

/** mm:ss since the recording began, or 0:00 before the first tick. */
function elapsed(startedAt: number | null): string {
  if (!startedAt) return '0:00'
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function TitleBar(): JSX.Element {
  const { maximized, tasks, instances, recording } = useStore()
  const [platform, setPlatform] = useState('win32')
  // Only used to re-render the clock once a second. The value itself is the
  // start time in the store, so nothing is duplicated here.
  const [, tick] = useState(0)

  useEffect(() => {
    void window.gabi.app.info().then((info) => setPlatform(info.platform))
  }, [])

  // A recording runs with the launcher hidden behind the game, so the elapsed
  // time is the one thing that has to keep moving on its own. The interval
  // only exists while something is actually being recorded.
  useEffect(() => {
    if (!recording.active) return
    const timer = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording.active])

  const running = instances.filter((i) => i.running).length
  const activeTasks = tasks.filter((t) => t.state === 'running').length

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-title">Launch Gabi</span>

        {running > 0 && (
          <span className="badge ok dot live no-drag">
            {running === 1 ? 'Minecraft läuft' : `${running} Instanzen laufen`}
          </span>
        )}
        {recording.active && (
          <button
            className="rec-pill"
            title="Aufnahme beenden"
            onClick={() => void window.gabi.recording.toggle()}
          >
            <span className="rec-dot" />
            {elapsed(recording.startedAt)}
          </button>
        )}
        {activeTasks > 0 && (
          <span className="badge accent no-drag">
            <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
            {activeTasks} {activeTasks === 1 ? 'Vorgang' : 'Vorgänge'}
          </span>
        )}
      </div>

      {/* macOS draws its own traffic lights. */}
      {platform !== 'darwin' && (
        <div className="titlebar-right">
          <button
            className="win-btn wide no-drag"
            onClick={() => setState({ paletteOpen: true })}
            aria-label="Befehle suchen"
            data-tip="Strg + K"
          >
            <IconSearch size={15} />
          </button>
          <button className="win-btn" onClick={() => window.gabi.window.minimize()} aria-label="Minimieren">
            <IconMinimize />
          </button>
          <button
            className="win-btn"
            onClick={() => window.gabi.window.maximize()}
            aria-label={maximized ? 'Wiederherstellen' : 'Maximieren'}
          >
            {maximized ? <IconRestore /> : <IconMaximize />}
          </button>
          <button className="win-btn close" onClick={() => window.gabi.window.close()} aria-label="Schließen">
            <IconClose />
          </button>
        </div>
      )}
    </header>
  )
}
