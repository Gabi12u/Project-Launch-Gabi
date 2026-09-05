import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { BackupEntry } from '@shared/types'
import { navigate, toast, toastError, useStore } from '../lib/store'
import { formatBytes, formatDateTime, formatRelative, pluralise } from '../lib/format'
import { t } from '../lib/i18n'
import { Confirm, EmptyState, Modal } from '../components/ui'
import { IconFolder, IconRefresh, IconSave, IconTrash, IconUpload } from '../components/Icons'

// Values hold instanceSettings translation keys, not display text, so the
// lookup happens at render time and stays reactive to a language switch.
const REASON_LABELS: Record<BackupEntry['reason'], string> = {
  manual: 'backups.reasonManual',
  automatic: 'backups.reasonAutomatic',
  'pre-update': 'backups.reasonPreUpdate',
  'pre-repair': 'backups.reasonPreRepair'
}

const FOLDER_LABELS: Record<string, string> = {
  saves: 'backups.folderSaves',
  config: 'backups.folderConfig',
  mods: 'backups.folderMods',
  resourcepacks: 'backups.folderResourcepacks',
  shaderpacks: 'backups.folderShaderpacks',
  screenshots: 'backups.folderScreenshots'
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
      toastError(err, t('instanceSettings', 'backups.loadFailedToast'))
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
          <h1 className="page-title">{t('instanceSettings', 'backups.pageTitle')}</h1>
          <p className="page-sub">
            {backups.length > 0
              ? t('instanceSettings', 'backups.subtitleCount', {
                  count: backups.length,
                  word: pluralise(
                    backups.length,
                    t('instanceSettings', 'backups.unitOne'),
                    t('instanceSettings', 'backups.unitMany')
                  ),
                  size: formatBytes(totalSize)
                })
              : t('instanceSettings', 'backups.subtitleEmpty')}
          </p>
        </div>

        <div className="row gap-8">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : <IconRefresh size={16} />}
            {t('common', 'refresh')}
          </button>
          <button
            className="btn primary"
            disabled={instances.length === 0}
            onClick={() => setCreateFor(instances[0]?.id ?? null)}
          >
            <IconSave size={16} />
            {t('instanceSettings', 'backups.createButton')}
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
            <option value="all">{t('instanceSettings', 'backups.allInstancesOption')}</option>
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
          title={t('instanceSettings', 'backups.emptyTitle')}
          message={t('instanceSettings', 'backups.emptyMessage')}
          action={
            instances.length > 0 ? (
              <button className="btn primary" onClick={() => setCreateFor(instances[0].id)}>
                <IconSave size={16} />
                {t('instanceSettings', 'backups.createFirstButton')}
              </button>
            ) : (
              <button className="btn" onClick={() => navigate('/instances')}>
                {t('instanceSettings', 'backups.goToInstancesButton')}
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
                  <span className="badge">{t('instanceSettings', REASON_LABELS[backup.reason])}</span>
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
                  <span>
                    {backup.includes
                      .map((key) => (FOLDER_LABELS[key] ? t('instanceSettings', FOLDER_LABELS[key]) : key))
                      .join(', ')}
                  </span>
                </div>
              </div>

              <div className="content-actions">
                <button className="btn sm primary" onClick={() => setRestoring(backup)}>
                  <IconUpload size={13} />
                  {t('instanceSettings', 'backups.restoreButton')}
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => void window.gabi.backups.openFolder(backup.instanceId)}
                  aria-label={t('instanceSettings', 'backups.openFolderAria')}
                >
                  <IconFolder size={14} />
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => setDeleting(backup)}
                  aria-label={t('common', 'delete')}
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
        title={t('instanceSettings', 'backups.restoreConfirmTitle')}
        confirmLabel={t('instanceSettings', 'backups.restoreButton')}
        message={
          restoring ? (
            <>
              {pluralise(
                restoring.includes.length,
                t('instanceSettings', 'backups.folderWordOne'),
                t('instanceSettings', 'backups.folderWordMany')
              )}{' '}
              <strong>
                {restoring.includes
                  .map((k) => (FOLDER_LABELS[k] ? t('instanceSettings', FOLDER_LABELS[k]) : k))
                  .join(', ')}
              </strong>{' '}
              {t('instanceSettings', 'backups.inConnector')}{' '}
              <strong>{restoring.instanceName}</strong>{' '}
              {t('instanceSettings', 'backups.restoreMessageTail', {
                verb: pluralise(
                  restoring.includes.length,
                  t('instanceSettings', 'backups.verbWordOne'),
                  t('instanceSettings', 'backups.verbWordMany')
                ),
                date: formatDateTime(restoring.createdAt)
              })}
            </>
          ) : null
        }
        onConfirm={async () => {
          if (!restoring) return
          try {
            await window.gabi.backups.restore(restoring.instanceId, restoring.id)
            toast('success', t('instanceSettings', 'backups.restoredToastTitle'), restoring.name)
            setRestoring(null)
            await load()
          } catch (err) {
            toastError(err, t('instanceSettings', 'backups.restoreFailedToast'))
          }
        }}
        onCancel={() => setRestoring(null)}
      />

      <Confirm
        open={deleting !== null}
        title={t('instanceSettings', 'backups.deleteConfirmTitle')}
        danger
        confirmLabel={t('common', 'delete')}
        message={
          deleting ? (
            <>
              <strong>{deleting.name}</strong>{' '}
              {t('instanceSettings', 'backups.deleteMessageTail', { size: formatBytes(deleting.size) })}
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
            toastError(err, t('instanceSettings', 'backups.deleteFailedToast'))
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
      toast(
        'success',
        t('instanceSettings', 'backups.createdToastTitle'),
        `${entry.name} · ${formatBytes(entry.size)}`
      )
      await onCreated()
      onClose()
    } catch (err) {
      toastError(err, t('instanceSettings', 'backups.createFailedToast'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={instanceId !== null}
      title={t('instanceSettings', 'backups.createButton')}
      subtitle={t('instanceSettings', 'backups.modalSubtitle')}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {t('common', 'cancel')}
          </button>
          <button className="btn primary" onClick={create} disabled={busy || includes.length === 0}>
            {busy ? <span className="spinner" /> : <IconSave size={15} />}
            {t('instanceSettings', 'backups.createButton')}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="field">
          <label className="label" htmlFor="bk-instanz">{t('instanceSettings', 'backups.instanceLabel')}</label>
          <select id="bk-instanz" className="select" value={target} onChange={(event) => setTarget(event.target.value)}>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="bk-bezeichnung-optional">{t('instanceSettings', 'backups.nameLabel')}</label>
          <input id="bk-bezeichnung-optional"
            className="input"
            placeholder={t('instanceSettings', 'backups.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" id="bk-inhalte">{t('instanceSettings', 'backups.contentsLabel')}</label>
          <div role="group" aria-labelledby="bk-inhalte" className="row gap-8 wrap">
            {Object.entries(FOLDER_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={`badge ${includes.includes(key) ? 'accent' : ''}`}
                style={{ cursor: 'pointer', height: 30, padding: '0 12px' }}
                onClick={() => toggle(key)}
              >
                {t('instanceSettings', label)}
              </button>
            ))}
          </div>
          <span className="hint">
            {t('instanceSettings', 'backups.contentsHint')}
          </span>
        </div>
      </div>
    </Modal>
  )
}
