import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { BackupEntry } from '@shared/types'
import { navigate, toast, toastError, useStore } from '../lib/store'
import { formatBytes, formatDateTime, formatRelative, pluralise } from '../lib/format'
import { Confirm, EmptyState, Modal, ProgressBar } from '../components/ui'
import { IconFolder, IconRefresh, IconSave, IconTrash, IconUpload } from '../components/Icons'
import { tr } from '@shared/i18n'

const REASON_LABELS: Record<BackupEntry['reason'], string> = {
  manual: tr('Manuell', 'Manual'),
  automatic: tr('Automatisch', 'Automatic'),
  'pre-update': tr('Vor Mod-Update', 'Before mod update'),
  'pre-repair': tr('Vor Reparatur', 'Before repair')
}

const FOLDER_LABELS: Record<string, string> = {
  saves: tr('Welten', 'Worlds'),
  config: tr('Konfiguration', 'Config'),
  mods: tr('Mods', 'Mods'),
  resourcepacks: tr('Resourcepacks', 'Resource packs'),
  shaderpacks: tr('Shader', 'Shaders'),
  screenshots: 'Screenshots'
}

export function BackupsView(): JSX.Element {
  const { instances, tasks } = useStore()

  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<BackupEntry | null>(null)
  const [deleting, setDeleting] = useState<BackupEntry | null>(null)

  // `restoreBackup` already runs under `withTask`, with real progress from
  // `extractAllSlowly`, the same one the TaskDock shows. Matched by instance
  // and title rather than kept as a returned id, because the confirm dialog
  // fires the restore itself and only learns about the task the way every
  // other view does, through the store.
  const restoreTask = restoring
    ? tasks.find(
        (t) =>
          t.instanceId === restoring.instanceId && t.state === 'running' && t.title === tr('Sicherung wird eingespielt', 'Restoring backup')
      )
    : undefined

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setBackups(await window.gabi.backups.list())
    } catch (err) {
      toastError(err, tr('Sicherungen konnten nicht geladen werden', 'Backups could not be loaded'))
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
          <h1 className="page-title">{tr('Backups', 'Backups')}</h1>
          <p className="page-sub">
            {backups.length > 0
              ? tr(
                  `${backups.length} ${pluralise(backups.length, 'Sicherung', 'Sicherungen')} · ${formatBytes(totalSize)} belegt`,
                  `${backups.length} ${pluralise(backups.length, 'backup', 'backups')} · ${formatBytes(totalSize)} used`
                )
              : tr('Sichere deine Welten, bevor du an Mods schraubst.', 'Back up your worlds before you tinker with mods.')}
          </p>
        </div>

        <div className="row gap-8">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : <IconRefresh size={16} />}
            {tr('Aktualisieren', 'Refresh')}
          </button>
          <button
            className="btn primary"
            disabled={instances.length === 0}
            onClick={() => setCreateFor(instances[0]?.id ?? null)}
          >
            <IconSave size={16} />
            {tr('Sicherung erstellen', 'Create backup')}
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
            <option value="all">{tr('Alle Instanzen', 'All instances')}</option>
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
          title={tr('Keine Sicherungen', 'No backups')}
          message={tr(
            'Eine Sicherung packt Welten und Konfiguration einer Instanz in ein Archiv. Praktisch, bevor du Mods aktualisierst oder etwas Größeres umbaust.',
            'A backup packs the worlds and config of an instance into an archive. Handy before you update mods or change something bigger.'
          )}
          action={
            instances.length > 0 ? (
              <button className="btn primary" onClick={() => setCreateFor(instances[0].id)}>
                <IconSave size={16} />
                {tr('Erste Sicherung erstellen', 'Create first backup')}
              </button>
            ) : (
              <button className="btn" onClick={() => navigate('/instances')}>
                {tr('Zu den Instanzen', 'Go to instances')}
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
                  {tr('Wiederherstellen', 'Restore')}
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => void window.gabi.backups.openFolder(backup.instanceId)}
                  aria-label={tr('Ordner öffnen', 'Open folder')}
                >
                  <IconFolder size={14} />
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => setDeleting(backup)}
                  aria-label={tr('Löschen', 'Delete')}
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
        title={tr('Sicherung wiederherstellen?', 'Restore backup?')}
        confirmLabel={tr('Wiederherstellen', 'Restore')}
        message={
          restoring ? (
            restoreTask ? (
              <div className="col gap-8">
                <div>{restoreTask.detail}</div>
                <ProgressBar value={restoreTask.progress} />
              </div>
            ) : (
              <>
                {tr(
                  pluralise(restoring.includes.length, 'Der Ordner', 'Die Ordner'),
                  pluralise(restoring.includes.length, 'The folder', 'The folders')
                )}{' '}
                <strong>{restoring.includes.map((k) => FOLDER_LABELS[k] ?? k).join(', ')}</strong>{' '}
                {tr('in', 'in')} <strong>{restoring.instanceName}</strong>{' '}
                {tr(
                  `${pluralise(restoring.includes.length, 'wird', 'werden')} durch den Stand vom ${formatDateTime(restoring.createdAt)} ersetzt. Der aktuelle Stand wird vorher automatisch gesichert.`,
                  `${pluralise(restoring.includes.length, 'is', 'are')} replaced with the state from ${formatDateTime(restoring.createdAt)}. The current state is backed up automatically first.`
                )}
              </>
            )
          ) : null
        }
        onConfirm={async () => {
          if (!restoring) return
          try {
            await window.gabi.backups.restore(restoring.instanceId, restoring.id)
            toast('success', tr('Wiederhergestellt', 'Restored'), restoring.name)
            setRestoring(null)
            await load()
          } catch (err) {
            toastError(err, tr('Wiederherstellung fehlgeschlagen', 'Restore failed'))
          }
        }}
        onCancel={() => setRestoring(null)}
      />

      <Confirm
        open={deleting !== null}
        title={tr('Sicherung löschen?', 'Delete backup?')}
        danger
        confirmLabel={tr('Löschen', 'Delete')}
        message={
          deleting ? (
            <>
              <strong>{deleting.name}</strong> ({formatBytes(deleting.size)}){' '}
              {tr('wird endgültig gelöscht.', 'will be deleted permanently.')}
            </>
          ) : null
        }
        onConfirm={async () => {
          if (!deleting) return
          try {
            await window.gabi.backups.remove(deleting.instanceId, deleting.id)
            toast('success', tr('Sicherung gelöscht', 'Backup deleted'), deleting.name)
            setDeleting(null)
            await load()
          } catch (err) {
            toastError(err, tr('Löschen fehlgeschlagen', 'Deleting failed'))
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
  const { instances, tasks } = useStore()
  const [target, setTarget] = useState(instanceId ?? '')
  const [name, setName] = useState('')
  const [includes, setIncludes] = useState<string[]>(['saves', 'config'])
  const [busy, setBusy] = useState(false)

  // `createBackup` already runs under `withTask`, with real progress from
  // `zipFolder`, the same one the TaskDock shows. Matched by instance and
  // title, since this modal only ever learns about the task through the
  // store, the same way the rest of the app does.
  const targetName = instances.find((i) => i.id === target)?.name
  const createTask = busy
    ? tasks.find(
        (t) => t.instanceId === target && t.state === 'running' && t.title === tr(`Sicherung von ${targetName}`, `Backup of ${targetName}`)
      )
    : undefined

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
      toast('success', tr('Sicherung erstellt', 'Backup created'), `${entry.name} · ${formatBytes(entry.size)}`)
      await onCreated()
      onClose()
    } catch (err) {
      toastError(err, tr('Sicherung fehlgeschlagen', 'Backup failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={instanceId !== null}
      title={tr('Sicherung erstellen', 'Create backup')}
      subtitle={tr('Wähle aus, was gesichert werden soll.', 'Choose what to back up.')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {tr('Abbrechen', 'Cancel')}
          </button>
          <button className="btn primary" onClick={create} disabled={busy || includes.length === 0}>
            {busy ? <span className="spinner" /> : <IconSave size={15} />}
            {tr('Sicherung erstellen', 'Create backup')}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="field">
          <label className="label" htmlFor="bk-instanz">{tr('Instanz', 'Instance')}</label>
          <select id="bk-instanz" className="select" value={target} onChange={(event) => setTarget(event.target.value)}>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="bk-bezeichnung-optional">{tr('Bezeichnung (optional)', 'Name (optional)')}</label>
          <input id="bk-bezeichnung-optional"
            className="input"
            placeholder={tr('z. B. Vor dem großen Umbau', 'e.g. Before the big rebuild')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" id="bk-inhalte">{tr('Inhalte', 'Contents')}</label>
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
            {tr(
              'Welten und Konfiguration reichen meist. Mods mitzusichern macht das Archiv deutlich größer.',
              'Worlds and config are usually enough. Including mods makes the archive much bigger.'
            )}
          </span>
        </div>

        {createTask && (
          <div className="col gap-8">
            <div className="hint">{createTask.detail}</div>
            <ProgressBar value={createTask.progress} />
          </div>
        )}
      </div>
    </Modal>
  )
}
