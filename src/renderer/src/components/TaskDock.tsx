import { useEffect, useState, type JSX } from 'react'
import { useStore } from '../lib/store'
import { ProgressBar } from './ui'
import { IconChevronDown, IconX } from './Icons'

/** Floating panel that mirrors every long running job from the main process. */
export function TaskDock(): JSX.Element | null {
  const { tasks } = useStore()
  const [collapsed, setCollapsed] = useState(false)

  // Finished tasks linger briefly instead of vanishing the instant their state
  // flips. They used to disappear mid-list with no 100% and no confirmation,
  // which contradicts what App.tsx says this dock does.
  const [lingering, setLingering] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    const finished = tasks.filter((t) => t.state === 'done' || t.state === 'cancelled')
    const fresh = finished.filter((t) => !lingering.has(t.id))
    if (fresh.length === 0) return

    setLingering((current) => {
      const next = new Set(current)
      fresh.forEach((t) => next.add(t.id))
      return next
    })
    const timers = fresh.map((t) =>
      setTimeout(() => {
        setLingering((current) => {
          const next = new Set(current)
          next.delete(t.id)
          return next
        })
      }, 2600)
    )
    return () => timers.forEach(clearTimeout)
  }, [tasks, lingering])

  const visible = tasks.filter(
    (task) => task.state === 'running' || task.state === 'failed' || lingering.has(task.id)
  )
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
