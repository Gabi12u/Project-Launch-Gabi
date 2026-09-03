import type { JSX } from 'react'
import { useStore } from '../lib/store'
import { formatRelative, updateHeadline } from '../lib/format'
import { EmptyState, ProgressBar } from '../components/ui'
import { IconDownload } from '../components/Icons'

/**
 * Everything the launcher is fetching or has just fetched, in one place.
 *
 * The floating dock in the corner shows the same tasks, but only while they
 * run and only four at a time. This is the page for "what happened", and it
 * includes the launcher's own update, which lived in Settings alone before.
 */
export function DownloadsView(): JSX.Element {
  const { tasks, updateStatus } = useStore()

  const running = tasks.filter((t) => t.state === 'running')
  const finished = tasks.filter((t) => t.state !== 'running')

  return (
    <div className="col gap-24">
      <header>
        <h1 className="page-title">Downloads</h1>
        <p className="hint">Laufende und zuletzt abgeschlossene Vorgänge</p>
      </header>

      {updateStatus && updateStatus.state !== 'idle' && updateStatus.state !== 'disabled' && (
        <section className="card col gap-10">
          <div className="row-between">
            <span className="card-title">Launcher</span>
            <span className="badge">{updateStatus.currentVersion}</span>
          </div>
          <span className="hint">{updateHeadline(updateStatus)}</span>
          {updateStatus.state === 'downloading' && (
            <ProgressBar value={(updateStatus.percent ?? 0) / 100} />
          )}
        </section>
      )}

      {running.length === 0 && finished.length === 0 ? (
        <EmptyState
          icon={<IconDownload size={26} />}
          title="Nichts unterwegs"
          message="Installationen, Updates und Reparaturen erscheinen hier, solange sie laufen."
        />
      ) : (
        <>
          {running.length > 0 && (
            <section className="col gap-8">
              <h2 className="section-title">Läuft gerade</h2>
              {running.map((task) => (
                <div key={task.id} className="card col gap-8">
                  <div className="row-between">
                    <span className="content-name truncate">{task.title}</span>
                    <button className="btn ghost sm" onClick={() => void window.gabi.tasks.cancel(task.id)}>
                      Abbrechen
                    </button>
                  </div>
                  <ProgressBar value={task.progress} />
                  <span className="hint truncate">{task.detail}</span>
                </div>
              ))}
            </section>
          )}

          {finished.length > 0 && (
            <section className="col gap-8">
              <h2 className="section-title">Zuletzt</h2>
              {finished.map((task) => (
                <div key={task.id} className="content-row">
                  <div className="content-icon">
                    <IconDownload size={18} />
                  </div>
                  <div className="grow" style={{ overflow: 'hidden' }}>
                    <div className="row gap-8">
                      <span className="content-name truncate">{task.title}</span>
                      <span
                        className={`badge ${
                          task.state === 'failed' ? 'danger' : task.state === 'cancelled' ? 'warn' : 'ok'
                        }`}
                      >
                        {task.state === 'failed'
                          ? 'Fehlgeschlagen'
                          : task.state === 'cancelled'
                            ? 'Abgebrochen'
                            : 'Fertig'}
                      </span>
                    </div>
                    <div className="content-meta">
                      <span className="truncate">{task.detail}</span>
                      <span>{formatRelative(task.updatedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
