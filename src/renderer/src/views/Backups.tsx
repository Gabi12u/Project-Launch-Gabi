import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { BackupEntry } from '@shared/types'
import { navigate, toast, toastError, useStore } from '../lib/store'
import { formatBytes, formatDateTime, formatRelative, pluralise } from '../lib/format'
import { Confirm, EmptyState, Modal } from '../components/ui'
import { IconFolder, IconRefresh, IconSave, IconTrash, IconUpload } from '../components/Icons'

const REASON_LABELS: Record<BackupEntry['reason'], string> = {
  manual: 'Manuell',
  automatic: 'Automatisch',
  'pre-update': 'Vor Mod-Update',
  'pre-repair': 'Vor Reparatur'
}

const FOLDER_LABELS: Record<string, string> = {
  saves: 'Welten',
  config: 'Konfiguration',
  mods: 'Mods',
  resourcepacks: 'Resourcepacks',
  shaderpacks: 'Shader',
  screenshots: 'Screenshots'
}

export function BackupsView(): JSX.Element {
  const { instances } = useStore()

  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<BackupEntry | null>(null)
  const [deleting, setDeleting] = useState<BackupEntry | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setBackups(await window.gabi.backups.list())
    } catch (err) {
      toastError(err, 'Sicherungen konnten nicht geladen werden')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () => (filter === 'all' ? backups : backups.filter((b) => b.instanceId === filter)),
    [backups, filter]
  )

  const totalSize = backups.reduce((sum, b) => sum + b.size, 0)

  return (
    <div className="col gap-24">
      <header className="row-between wrap">
        <div>
          <h1 className="page-title">Backups</h1>
          <p className="page-sub">
            {backups.length > 0
              ? `${backups.length} ${pluralise(backups.length, 'Sicherung', 'Sicherungen')} · ${formatBytes(totalSize)} belegt`
              : 'Sichere deine Welten, bevor du an Mods schraubst.'}
          </p>
        </div>

        <div className="row gap-8">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : <IconRefresh size={16} />}
            Aktualisieren
          </button>
          <button
            className="btn primary"
            disabled={instances.length === 0}
            onClick={() => setCreateFor(instances[0]?.id ?? null)}
          >
            <IconSave size={16} />
            Sicherung erstellen
          </button>
        </div>
      </header>

      {instances.length > 1 && (
        <div className="row gap-12 wrap">
          <select
            className="select"
            style={{ width: 260 }}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">Alle Instanzen</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="col gap-8">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 72 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconSave size={26} />}
          title="Keine Sicherungen"
          message="Eine Sicherung packt Welten und Konfiguration einer Instanz in ein Archiv. Praktisch, bevor du Mods aktualisierst oder etwas Größeres umbaust."
          action={
            instances.length > 0 ? (
              <button className="btn primary" onClick={() => setCreateFor(instances[0].id)}>
                <IconSave size={16} />
                Erste Sicherung erstellen
              </button>
            ) : (
              <button className="btn" onClick={() => navigate('/instances')}>
                Zu den Instanzen
              </button>
            )
          }
        />
      ) : (
        <div className="col gap-8 stagger">
          {filtered.map((backup) => (
            <div key={backup.id} className="backup-row">
              <div className="backup-icon">
                <IconSave size={18} />
              </div>

              <div className="grow" style={{ overflow: 'hidden' }}>
                <div className="row gap-8">
                  <span className="content-name truncate">{backup.name}</span>
                  <span className="badge">{REASON_LABELS[backup.reason]}</span>
                </div>
                <div className="content-meta">
                  <button
                    className="link"
                    style={{ background: 'none', padding: 0 }}
                    onClick={() => navigate(`/instances/${backup.instanceId}`)}
                  >
                    {backup.instanceName}
                  </button>
                  <span>{formatBytes(backup.size)}</span>
                  <span title={formatDateTime(backup.createdAt)}>{formatRelative(backup.createdAt)}</span>
                  <span>{backup.includes.map((key) => FOLDER_LABELS[key] ?? key).join(', ')}</span>
                </div>
              </div>

              <div className="content-actions">
                <button className="btn sm primary" onClick={() => setRestoring(backup)}>
                  <IconUpload size={13} />
                  Wiederherstellen
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => void window.gabi.backups.openFolder(backup.instanceId)}
                  aria-label="Ordner öffnen"
                >
                  <IconFolder size={14} />
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => setDeleting(backup)}
                  aria-label="Löschen"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateBackupModal
        instanceId={createFor}
        onClose={() => setCreateFor(null)}
        onCreated={load}
      />

      <Confirm
        open={restoring !== null}
        title="Sicherung wiederherstellen?"
        confirmLabel="Wiederherstellen"
        message={
          restoring ? (
            <>
              {pluralise(restoring.includes.length, 'Der Ordner', 'Die Ordner')}{' '}
              <strong>{restoring.includes.map((k) => FOLDER_LABELS[k] ?? k).join(', ')}</strong> in{' '}
              <strong>{restoring.instanceName}</strong>{' '}
              {pluralise(restoring.includes.length, 'wird', 'werden')} durch den Stand vom{' '}
              {formatDateTime(restoring.createdAt)} ersetzt. Der aktuelle Stand wird vorher automatisch
              gesichert.
            </>
          ) : null
        }
        onConfirm={async () => {
          if (!restoring) return
          try {
            await window.gabi.backups.restore(restoring.instanceId, restoring.id)
            toast('success', 'Wiederhergestellt', restoring.name)
            setRestoring(null)
            await load()
          } catch (err) {
            toastError(err, 'Wiederherstellung fehlgeschlagen')
          }
        }}
        onCancel={() => setRestoring(null)}
      />

      <Confirm
        open={deleting !== null}
        title="Sicherung löschen?"
        danger
        confirmLabel="Löschen"
        message={
          deleting ? (
            <>
              <strong>{deleting.name}</strong> ({formatBytes(deleting.size)}) wird endgültig gelöscht.
            </>
          ) : null
        }
        onConfirm={async () => {
          if (!deleting) return
          try {
            await window.gabi.backups.remove(deleting.instanceId, deleting.id)
            setDeleting(null)
            await load()
          } catch (err) {
            toastError(err, 'Löschen fehlgeschlagen')
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CreateBackupModal({
  instanceId,
  onClose,
  onCreated
}: {
  instanceId: string | null
  onClose: () => void
  onCreated: () => Promise<void>
}): JSX.Element {
  const { instances } = useStore()
  const [target, setTarget] = useState(instanceId ?? '')
  const [name, setName] = useState('')
  const [includes, setIncludes] = useState<string[]>(['saves', 'config'])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (instanceId) {
      setTarget(instanceId)
      setName('')
      setIncludes(['saves', 'config'])
    }
  }, [instanceId])

  const toggle = (key: string): void => {
    setIncludes((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    )
  }

  const create = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    try {
      const entry = await window.gabi.backups.create(target, {
        name: name.trim() || undefined,
        includes
      })
      toast('success', 'Sicherung erstellt', `${entry.name} · ${formatBytes(entry.size)}`)
      await onCreated()
      onClose()
    } catch (err) {
      toastError(err, 'Sicherung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={instanceId !== null}
      title="Sicherung erstellen"
      subtitle="Wähle aus, was gesichert werden soll."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={create} disabled={busy || includes.length === 0}>
            {busy ? <span className="spinner" /> : <IconSave size={15} />}
            Sicherung erstellen
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="field">
          <label className="label" htmlFor="bk-instanz">Instanz</label>
          <select id="bk-instanz" className="select" value={target} onChange={(event) => setTarget(event.target.value)}>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="bk-bezeichnung-optional">Bezeichnung (optional)</label>
          <input id="bk-bezeichnung-optional"
            className="input"
            placeholder="z. B. Vor dem großen Umbau"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" id="bk-inhalte">Inhalte</label>
          <div role="group" aria-labelledby="bk-inhalte" className="row gap-8 wrap">
            {Object.entries(FOLDER_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={`badge ${includes.includes(key) ? 'accent' : ''}`}
                style={{ cursor: 'pointer', height: 30, padding: '0 12px' }}
                onClick={() => toggle(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="hint">
            Welten und Konfiguration reichen meist. Mods mitzusichern macht das Archiv deutlich größer.
          </span>
        </div>
      </div>
    </Modal>
  )
}
