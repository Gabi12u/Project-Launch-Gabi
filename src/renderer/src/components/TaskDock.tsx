import { useState, type JSX } from 'react'
import { useStore } from '../lib/store'
import { ProgressBar } from './ui'
import { IconChevronDown, IconX } from './Icons'

/** Floating panel that mirrors every long running job from the main process. */
export function TaskDock(): JSX.Element | null {
  const { tasks } = useStore()
  const [collapsed, setCollapsed] = useState(false)

  const visible = tasks.filter((task) => task.state === 'running' || task.state === 'failed')
  if (visible.length === 0) return null

  const running = visible.filter((t) => t.state === 'running')

  return (
    <div className="task-dock">
      <div className="task-dock-head">
        <span className="row gap-8">
          {running.length > 0 && <span className="spinner" style={{ width: 12, height: 12 }} />}
          {running.length > 0
            ? `${running.length} ${running.length === 1 ? 'Vorgang läuft' : 'Vorgänge laufen'}`
            : 'Fehlgeschlagen'}
        </span>
        <button
          className="btn ghost icon sm"
          style={{ width: 24, height: 24 }}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Ausklappen' : 'Einklappen'}
        >
          <IconChevronDown
            size={14}
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}
          />
        </button>
      </div>

      {!collapsed &&
        visible.slice(0, 4).map((task) => (
          <div key={task.id} className="task-row">
            <div className="task-row-top">
              <span className="task-name truncate">{task.title}</span>
              <div className="row gap-8">
                {task.progress !== null && task.state === 'running' && (
                  <span className="mono" style={{ color: 'var(--text-3)' }}>
                    {Math.round(task.progress * 100)}%
                  </span>
                )}
                {task.state === 'running' && (
                  <button
                    className="btn ghost icon sm"
                    style={{ width: 22, height: 22 }}
                    onClick={() => void window.gabi.tasks.cancel(task.id)}
                    aria-label="Abbrechen"
                  >
                    <IconX size={12} />
                  </button>
                )}
              </div>
            </div>

            {task.state === 'running' ? (
              <ProgressBar value={task.progress} />
            ) : (
              <div className="badge danger">Fehlgeschlagen</div>
            )}

            <div className="task-detail truncate">{task.detail}</div>
          </div>
        ))}
    </div>
  )
}
