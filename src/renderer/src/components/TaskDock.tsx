import { useEffect, useRef, useState, type JSX } from 'react'
import { setState, useStore } from '../lib/store'
import { t } from '../lib/i18n'
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
  // Tracked outside React state on purpose: this effect must depend only on
  // `tasks`, never on `lingering` itself. It used to depend on both, so its
  // own call to `setLingering` triggered the next run before the timeout
  // below ever fired, and that run's cleanup cancelled the very timer meant
  // to end the lingering. A finished task never left the dock again, for the
  // rest of the session.
  const scheduled = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const finished = tasks.filter((t) => t.state === 'done' || t.state === 'cancelled')
    const fresh = finished.filter((t) => !scheduled.current.has(t.id))
    if (fresh.length === 0) return

    setLingering((current) => {
      const next = new Set(current)
      fresh.forEach((t) => next.add(t.id))
      return next
    })
    fresh.forEach((t) => {
      const timer = setTimeout(() => {
        scheduled.current.delete(t.id)
        setLingering((current) => {
          const next = new Set(current)
          next.delete(t.id)
          return next
        })
      }, 2600)
      scheduled.current.set(t.id, timer)
    })
  }, [tasks])

  useEffect(() => {
    const timers = scheduled.current
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [])

  const dismiss = (id: string): void => {
    setState((current) => ({ tasks: current.tasks.filter((t) => t.id !== id) }))
  }

  const visible = tasks.filter(
    (task) => task.state === 'running' || task.state === 'failed' || lingering.has(task.id)
  )
  if (visible.length === 0) return null

  const running = visible.filter((t) => t.state === 'running')
  const failed = visible.filter((t) => t.state === 'failed')

  // Before finished tasks were allowed to linger, only running and failed ones
  // were ever on screen, so "nothing running" could safely be labelled as a
  // failure. Now a completed task sits here for a moment too, and calling that
  // "Fehlgeschlagen" while its own detail line reads "Fertig" is simply wrong.
  const headline =
    running.length > 0
      ? t('overlays', running.length === 1 ? 'taskDock.running.one' : 'taskDock.running.other', {
          count: running.length
        })
      : failed.length > 0
        ? t('overlays', failed.length === 1 ? 'taskDock.failed.one' : 'taskDock.failed.other', {
            count: failed.length
          })
        : visible.every((task) => task.state === 'cancelled')
          ? t('overlays', 'taskDock.cancelled')
          : t('common', 'done')

  return (
    <div className="task-dock">
      <div className="task-dock-head">
        <span className="row gap-8">
          {running.length > 0 && <span className="spinner" style={{ width: 12, height: 12 }} />}
          {headline}
        </span>
        <button
          className="btn ghost icon sm"
          style={{ width: 24, height: 24 }}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? t('overlays', 'taskDock.expand') : t('overlays', 'taskDock.collapse')}
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
                    aria-label={t('common', 'cancel')}
                  >
                    <IconX size={12} />
                  </button>
                )}
                {task.state === 'failed' && (
                  <button
                    className="btn ghost icon sm"
                    style={{ width: 22, height: 22 }}
                    onClick={() => dismiss(task.id)}
                    aria-label={t('common', 'close')}
                  >
                    <IconX size={12} />
                  </button>
                )}
              </div>
            </div>

            {task.state === 'running' ? (
              <ProgressBar value={task.progress} />
            ) : task.state === 'failed' ? (
              <div className="badge danger">{t('overlays', 'taskDock.failedBadge')}</div>
            ) : task.state === 'cancelled' ? (
              <div className="badge warn">{t('overlays', 'taskDock.cancelled')}</div>
            ) : (
              <div className="badge ok">{t('common', 'done')}</div>
            )}

            <div className="task-detail truncate">{task.detail}</div>
          </div>
        ))}
    </div>
  )
}
