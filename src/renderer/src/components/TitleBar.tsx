import { useEffect, useState, type JSX } from 'react'
import { setState, useStore } from '../lib/store'
import { IconClose, IconMaximize, IconMinimize, IconRestore, IconSearch } from './Icons'

export function TitleBar(): JSX.Element {
  const { maximized, tasks, instances } = useStore()
  const [platform, setPlatform] = useState('win32')

  useEffect(() => {
    void window.gabi.app.info().then((info) => setPlatform(info.platform))
  }, [])

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
