import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { BackupEntry } from '@shared/types'
import type { CloudBackup, CloudOverview } from '@shared/api'
import { navigate, saveSettings, toast, toastError, useStore } from '../lib/store'
import { LOADER_LABELS, formatBytes, formatDateTime, formatRelative, pluralise } from '../lib/format'
import { Confirm, EmptyState, Modal, ProgressBar } from '../components/ui'
import { IconCloud, IconDownload, IconExternal, IconFolder, IconRefresh, IconSave, IconTrash, IconUpload } from '../components/Icons'
import { tr } from '@shared/i18n'

const REASON_LABELS: Record<BackupEntry['reason'], string> = {
  manual: tr('Manuell', 'Manual'),
  automatic: tr('Automatisch', 'Automatic'),
  'pre-update': tr('Vor Mod-Update', 'Before mod update'),
  'pre-repair': tr('Vor Reparatur', 'Before repair'),
  cloud: tr('Aus der Cloud', 'From the cloud')
}

const FOLDER_LABELS: Record<string, string> = {
  saves: tr('Welten', 'Worlds'),
  config: tr('Konfiguration', 'Config'),
  mods: tr('Mods', 'Mods'),
  resourcepacks: tr('Resourcepacks', 'Resource packs'),
  shaderpacks: tr('Shader', 'Shaders'),
  screenshots: 'Screenshots'
}

/** What is waiting for the user to accept the cloud note first. */
type Pending = { kind: 'upload'; backup: BackupEntry } | { kind: 'download'; cloud: CloudBackup }

export function BackupsView(): JSX.Element {
  const { instances, tasks, settings } = useStore()

  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<BackupEntry | null>(null)
  const [deleting, setDeleting] = useState<BackupEntry | null>(null)

  const [cloud, setCloud] = useState<CloudOverview | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [cloudLoading, setCloudLoading] = useState(true)
  const [askCloudFor, setAskCloudFor] = useState<BackupEntry | null>(null)
  const [consentFor, setConsentFor] = useState<Pending | null>(null)
  const [replaceFor, setReplaceFor] = useState<{ backup: BackupEntry; choices: CloudBackup[] } | null>(null)
  const [downloadFor, setDownloadFor] = useState<CloudBackup | null>(null)
  const [deletingCloud, setDeletingCloud] = useState<CloudBackup | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)

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

  const loadCloud = useCallback(async (): Promise<void> => {
    setCloudLoading(true)
    setCloudError(null)
    try {
      setCloud(await window.gabi.cloud.overview())
    } catch (err) {
      setCloudError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setCloudLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadCloud()
  }, [load, loadCloud])

  const filtered = useMemo(
    () => (filter === 'all' ? backups : backups.filter((b) => b.instanceId === filter)),
    [backups, filter]
  )

  const totalSize = backups.reduce((sum, b) => sum + b.size, 0)
  const cloudReady = cloud?.available === true

  /* --- Cloud actions ------------------------------------------------ */

  const withConsent = (pending: Pending, run: () => void): void => {
    if (settings.cloudBackups === 'on') run()
    else setConsentFor(pending)
  }

  const upload = async (backup: BackupEntry, replace?: string): Promise<void> => {
    setUploading(backup.id)
    try {
      const result = await window.gabi.cloud.upload(backup.instanceId, backup.id, replace)
      if (result.status === 'full') {
        setReplaceFor({ backup, choices: result.backups })
        return
      }
      toast('success', tr('In der Cloud gespeichert', 'Saved in the cloud'), `${backup.instanceName} · ${formatBytes(result.backup.size)}`)
      await loadCloud()
    } catch (err) {
      toastError(err, tr('Hochladen fehlgeschlagen', 'Upload failed'))
    } finally {
      setUploading(null)
    }
  }

  const startUpload = (backup: BackupEntry): void => withConsent({ kind: 'upload', backup }, () => void upload(backup))
  const startDownload = (item: CloudBackup): void => withConsent({ kind: 'download', cloud: item }, () => setDownloadFor(item))

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
          <button
            className="btn"
            onClick={() => {
              void load()
              void loadCloud()
            }}
            disabled={loading}
          >
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

      <CloudPanel
        cloud={cloud}
        error={cloudError}
        loading={cloudLoading}
        onRetry={loadCloud}
        onDownload={startDownload}
        onDelete={setDeletingCloud}
      />

      {instances.length > 1 && (
        <div className="row gap-12 wrap">
          <select
            className="select"
            style={{ width: 260 }}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label={tr('Instanz filtern', 'Filter by instance')}
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
          {filtered.map((backup) => {
            const inCloud = cloud?.backups.find((c) => c.instanceKey === backup.instanceId)
            return (
              <div key={backup.id} className="backup-row">
                <div className="backup-icon">
                  <IconSave size={18} />
                </div>

                <div className="grow" style={{ overflow: 'hidden' }}>
                  <div className="row gap-8">
                    <span className="content-name truncate">{backup.name}</span>
                    <span className="badge">{REASON_LABELS[backup.reason] ?? backup.reason}</span>
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
                  {cloudReady && (
                    <button
                      className="btn sm"
                      onClick={() => startUpload(backup)}
                      disabled={uploading !== null}
                      title={
                        inCloud
                          ? tr(
                              `Ersetzt das Cloud-Backup von ${inCloud.instanceName} vom ${formatDateTime(inCloud.uploadedAt)}`,
                              `Replaces the cloud backup of ${inCloud.instanceName} from ${formatDateTime(inCloud.uploadedAt)}`
                            )
                          : tr('Als Backup dieser Instanz in die Cloud legen', 'Put into the cloud as the backup of this instance')
                      }
                    >
                      {uploading === backup.id ? <span className="spinner" /> : <IconCloud size={13} />}
                      {tr('In die Cloud', 'To the cloud')}
                    </button>
                  )}
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
            )
          })}
        </div>
      )}

      <CreateBackupModal
        instanceId={createFor}
        onClose={() => setCreateFor(null)}
        onCreated={async (entry) => {
          await load()
          // Asked every time a backup is made by hand, as long as the cloud
          // is there at all.
          if (cloudReady) setAskCloudFor(entry)
        }}
      />

      <Confirm
        open={askCloudFor !== null}
        title={tr('Auch in der Cloud speichern?', 'Also save in the cloud?')}
        confirmLabel={tr('In die Cloud', 'To the cloud')}
        cancelLabel={tr('Nur auf diesem PC', 'Only on this PC')}
        message={
          askCloudFor ? (
            <>
              {(() => {
                const existing = cloud?.backups.find((c) => c.instanceKey === askCloudFor.instanceId)
                return existing
                  ? tr(
                      `In der Cloud liegt schon ein Backup von ${askCloudFor.instanceName} vom ${formatDateTime(existing.uploadedAt)}. Es wird durch das neue ersetzt.`,
                      `There already is a cloud backup of ${askCloudFor.instanceName} from ${formatDateTime(existing.uploadedAt)}. It is replaced by the new one.`
                    )
                  : tr(
                      `Dann kannst du ${askCloudFor.instanceName} auch auf einem anderen PC herunterladen, wenn du dich dort mit demselben Microsoft-Konto anmeldest.`,
                      `Then you can also download ${askCloudFor.instanceName} on another PC when you sign in there with the same Microsoft account.`
                    )
              })()}
            </>
          ) : null
        }
        onConfirm={async () => {
          const entry = askCloudFor
          setAskCloudFor(null)
          if (entry) startUpload(entry)
        }}
        onCancel={() => setAskCloudFor(null)}
      />

      <CloudConsentModal
        open={consentFor !== null}
        maxBackupBytes={cloud?.account?.limits.maxBackupBytes}
        onCancel={() => setConsentFor(null)}
        onAccept={async () => {
          const pending = consentFor
          setConsentFor(null)
          if (!(await saveSettings({ cloudBackups: 'on' }))) return
          if (pending?.kind === 'upload') void upload(pending.backup)
          if (pending?.kind === 'download') setDownloadFor(pending.cloud)
        }}
      />

      <ReplaceModal
        state={replaceFor}
        onCancel={() => setReplaceFor(null)}
        onReplace={(key) => {
          const pending = replaceFor
          setReplaceFor(null)
          if (pending) void upload(pending.backup, key)
        }}
      />

      <DownloadModal
        backup={downloadFor}
        onClose={() => setDownloadFor(null)}
        onDone={async (instanceId, created) => {
          setDownloadFor(null)
          toast(
            'success',
            created ? tr('Instanz angelegt', 'Instance created') : tr('Wiederhergestellt', 'Restored'),
            created
              ? tr('Das Cloud-Backup wurde in eine neue Instanz eingespielt.', 'The cloud backup was restored into a new instance.')
              : tr('Das Cloud-Backup wurde eingespielt.', 'The cloud backup was restored.')
          )
          await load()
          navigate(`/instances/${instanceId}`)
        }}
      />

      <Confirm
        open={deletingCloud !== null}
        title={tr('Cloud-Backup löschen?', 'Delete cloud backup?')}
        danger
        confirmLabel={tr('Löschen', 'Delete')}
        message={
          deletingCloud
            ? tr(
                `Das Cloud-Backup von ${deletingCloud.instanceName} wird endgültig gelöscht. Sicherungen auf diesem PC bleiben erhalten.`,
                `The cloud backup of ${deletingCloud.instanceName} is deleted for good. Backups on this PC stay.`
              )
            : null
        }
        onConfirm={async () => {
          if (!deletingCloud) return
          try {
            await window.gabi.cloud.remove(deletingCloud.instanceKey)
            toast('success', tr('Cloud-Backup gelöscht', 'Cloud backup deleted'), deletingCloud.instanceName)
            await loadCloud()
          } catch (err) {
            toastError(err, tr('Löschen fehlgeschlagen', 'Deleting failed'))
          } finally {
            setDeletingCloud(null)
          }
        }}
        onCancel={() => setDeletingCloud(null)}
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
            await load()
          } catch (err) {
            toastError(err, tr('Wiederherstellung fehlgeschlagen', 'Restore failed'))
          } finally {
            // Also after a failure, where the dialog otherwise stayed open.
            setRestoring(null)
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
            await load()
          } catch (err) {
            toastError(err, tr('Löschen fehlgeschlagen', 'Deleting failed'))
          } finally {
            setDeleting(null)
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Cloud
 * ------------------------------------------------------------------ */

function CloudPanel({
  cloud,
  error,
  loading,
  onRetry,
  onDownload,
  onDelete
}: {
  cloud: CloudOverview | null
  error: string | null
  loading: boolean
  onRetry: () => Promise<void>
  onDownload: (backup: CloudBackup) => void
  onDelete: (backup: CloudBackup) => void
}): JSX.Element {
  const header = (
    <div className="row-between wrap gap-8">
      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <IconCloud size={18} />
        <h2 className="section-title" style={{ margin: 0 }}>
          {tr('Cloud', 'Cloud')}
        </h2>
        {cloud?.available && cloud.account && (
          <span className="hint">
            {tr(
              `${cloud.backups.length} von ${cloud.account.limits.maxInstances} Instanzen · ${formatBytes(cloud.account.usedBytes)}`,
              `${cloud.backups.length} of ${cloud.account.limits.maxInstances} instances · ${formatBytes(cloud.account.usedBytes)}`
            )}
          </span>
        )}
      </div>
      {cloud?.available && cloud.website && (
        <button className="btn ghost sm" onClick={() => void window.gabi.app.openExternal(cloud.website as string)}>
          <IconExternal size={13} />
          {tr('Im Browser öffnen', 'Open in browser')}
        </button>
      )}
    </div>
  )

  if (loading && !cloud) {
    return (
      <section className="card col gap-12">
        {header}
        <div className="skeleton" style={{ height: 56 }} />
      </section>
    )
  }

  if (error) {
    return (
      <section className="card col gap-12">
        {header}
        <p className="hint" style={{ margin: 0 }}>
          {tr(`Die Cloud ist gerade nicht erreichbar: ${error}`, `The cloud cannot be reached right now: ${error}`)}
        </p>
        <div>
          <button className="btn sm" onClick={() => void onRetry()}>
            {tr('Erneut versuchen', 'Try again')}
          </button>
        </div>
      </section>
    )
  }

  if (!cloud?.available) {
    return (
      <section className="card col gap-12">
        {header}
        <p className="hint" style={{ margin: 0 }}>
          {tr(
            'Mit einem Microsoft-Konto kannst du bis zu drei Instanzen in der Cloud speichern und auf jedem PC herunterladen, auf dem du dich mit demselben Konto anmeldest. Melde dich dafür in der Seitenleiste mit Microsoft an.',
            'With a Microsoft account you can save up to three instances in the cloud and download them on every PC where you sign in with the same account. Sign in with Microsoft in the sidebar for that.'
          )}
        </p>
      </section>
    )
  }

  return (
    <section className="card col gap-12">
      {header}
      {cloud.backups.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          {tr(
            'Noch nichts in der Cloud. Wähle unten bei einer Sicherung „In die Cloud“, dann ist sie auch auf deinen anderen PCs da. Pro Instanz wird das neueste Backup gespeichert, für bis zu drei Instanzen.',
            'Nothing in the cloud yet. Choose "To the cloud" on a backup below, then it is on your other PCs too. The newest backup per instance is kept, for up to three instances.'
          )}
        </p>
      ) : (
        <div className="col gap-8">
          {cloud.backups.map((backup) => (
            <div key={backup.instanceKey} className="backup-row">
              <div className="backup-icon">
                <IconCloud size={18} />
              </div>
              <div className="grow" style={{ overflow: 'hidden' }}>
                <div className="row gap-8">
                  <span className="content-name truncate">{backup.instanceName}</span>
                  <span className="badge">
                    Minecraft {backup.mcVersion} · {LOADER_LABELS[backup.loader] ?? backup.loader}
                  </span>
                </div>
                <div className="content-meta">
                  <span>{formatBytes(backup.size)}</span>
                  <span title={formatDateTime(backup.uploadedAt)}>
                    {tr('hochgeladen', 'uploaded')} {formatRelative(backup.uploadedAt)}
                  </span>
                  <span>{backup.includes.map((key) => FOLDER_LABELS[key] ?? key).join(', ')}</span>
                </div>
              </div>
              <div className="content-actions">
                <button className="btn sm primary" onClick={() => onDownload(backup)}>
                  <IconDownload size={13} />
                  {tr('Herunterladen', 'Download')}
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => onDelete(backup)}
                  aria-label={tr(`Cloud-Backup von ${backup.instanceName} löschen`, `Delete cloud backup of ${backup.instanceName}`)}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {cloud.account?.deleteAfter && (
        <span className="hint">
          {tr(
            `Meldest du dich bis ${new Date(cloud.account.deleteAfter).toLocaleDateString()} nicht an, werden deine Cloud-Backups gelöscht.`,
            `If you do not sign in by ${new Date(cloud.account.deleteAfter).toLocaleDateString()}, your cloud backups are deleted.`
          )}
        </span>
      )}
    </section>
  )
}

/** The note shown once before anything goes to or comes from the cloud. */
function CloudConsentModal({
  open,
  maxBackupBytes,
  onCancel,
  onAccept
}: {
  open: boolean
  maxBackupBytes?: number
  onCancel: () => void
  onAccept: () => Promise<void>
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      title={tr('Cloud-Backups', 'Cloud backups')}
      subtitle={tr('Einmal kurz, bevor es losgeht.', 'Once, before you start.')}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            {tr('Abbrechen', 'Cancel')}
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onAccept()
              } finally {
                setBusy(false)
              }
            }}
          >
            {tr('Verstanden, weiter', 'Got it, continue')}
          </button>
        </>
      }
    >
      <ul className="hint bullet-list" style={{ margin: 0 }}>
        <li>
          {tr(
            'Das Backup wird so, wie es ist, auf den Server von Launch Gabi in Deutschland geladen, mit allen gewählten Ordnern, also auch Mods. Es ist an dein Minecraft-Konto gebunden.',
            'The backup is uploaded as it is to the Launch Gabi server in Germany, with all chosen folders, mods included. It is tied to your Minecraft account.'
          )}
        </li>
        <li>
          {tr(
            'Pro Instanz gibt es ein Cloud-Backup, ein neues ersetzt das alte. Insgesamt passen drei Instanzen hinein' +
              (maxBackupBytes ? `, jedes Backup höchstens ${formatBytes(maxBackupBytes)}.` : '.'),
            'There is one cloud backup per instance, a new one replaces the old one. Three instances fit in total' +
              (maxBackupBytes ? `, each backup at most ${formatBytes(maxBackupBytes)}.` : '.')
          )}
        </li>
        <li>
          {tr(
            'Auf dem Server liegen die Backups verschlüsselt. Als Betreiber könnte Launch Gabi technisch trotzdem darauf zugreifen, verspricht aber, das nie zu tun. Deine IP-Adresse wird nicht gespeichert.',
            'On the server the backups are stored encrypted. As the operator, Launch Gabi could still technically access them, but promises never to do so. Your IP address is not stored.'
          )}
        </li>
        <li>
          {tr(
            'Meldest du dich zwölf Monate lang nicht an, werden deine Cloud-Backups gelöscht. Auf cloud.launchgabi.com kannst du sie jederzeit ansehen, herunterladen und selbst löschen.',
            'If you do not sign in for twelve months, your cloud backups are deleted. On cloud.launchgabi.com you can view, download and delete them yourself at any time.'
          )}
        </li>
      </ul>
    </Modal>
  )
}

/** All places are taken: which instance makes room. */
function ReplaceModal({
  state,
  onCancel,
  onReplace
}: {
  state: { backup: BackupEntry; choices: CloudBackup[] } | null
  onCancel: () => void
  onReplace: (instanceKey: string) => void
}): JSX.Element {
  const [picked, setPicked] = useState('')
  useEffect(() => {
    if (state) setPicked(state.choices[state.choices.length - 1]?.instanceKey ?? '')
  }, [state])

  return (
    <Modal
      open={state !== null}
      title={tr('Alle drei Plätze sind belegt', 'All three places are taken')}
      subtitle={
        state
          ? tr(
              `Welche Instanz soll für ${state.backup.instanceName} Platz machen? Ihr Cloud-Backup wird dabei gelöscht.`,
              `Which instance should make room for ${state.backup.instanceName}? Its cloud backup is deleted.`
            )
          : undefined
      }
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel}>
            {tr('Abbrechen', 'Cancel')}
          </button>
          <button className="btn danger" disabled={!picked} onClick={() => onReplace(picked)}>
            {tr('Ersetzen und hochladen', 'Replace and upload')}
          </button>
        </>
      }
    >
      <div className="col gap-8" role="radiogroup" aria-label={tr('Instanz zum Ersetzen', 'Instance to replace')}>
        {state?.choices.map((choice) => (
          <label key={choice.instanceKey} className="backup-row" style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="cloud-replace"
              checked={picked === choice.instanceKey}
              onChange={() => setPicked(choice.instanceKey)}
            />
            <div className="grow" style={{ overflow: 'hidden' }}>
              <div className="content-name truncate">{choice.instanceName}</div>
              <div className="content-meta">
                <span>Minecraft {choice.mcVersion}</span>
                <span>{formatBytes(choice.size)}</span>
                <span>
                  {tr('hochgeladen', 'uploaded')} {formatRelative(choice.uploadedAt)}
                </span>
              </div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  )
}

/** Where a cloud backup goes on this PC. */
function DownloadModal({
  backup,
  onClose,
  onDone
}: {
  backup: CloudBackup | null
  onClose: () => void
  onDone: (instanceId: string, created: boolean) => Promise<void>
}): JSX.Element {
  const { instances } = useStore()
  const [busy, setBusy] = useState(false)
  const existing = backup ? instances.find((i) => i.id === backup.instanceKey) : undefined
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  useEffect(() => {
    if (backup) setMode(existing ? 'existing' : 'new')
  }, [backup, existing])

  const run = async (): Promise<void> => {
    if (!backup) return
    setBusy(true)
    try {
      const result = await window.gabi.cloud.download(backup.instanceKey, mode === 'existing' && existing ? existing.id : undefined)
      await onDone(result.instanceId, result.created)
    } catch (err) {
      toastError(err, tr('Herunterladen fehlgeschlagen', 'Download failed'))
    } finally {
      setBusy(false)
    }
  }

  const folders = backup ? backup.includes.map((key) => FOLDER_LABELS[key] ?? key).join(', ') : ''

  return (
    <Modal
      open={backup !== null}
      title={backup ? tr(`${backup.instanceName} herunterladen`, `Download ${backup.instanceName}`) : ''}
      subtitle={
        backup
          ? tr(
              `${formatBytes(backup.size)}, hochgeladen am ${formatDateTime(backup.uploadedAt)}`,
              `${formatBytes(backup.size)}, uploaded on ${formatDateTime(backup.uploadedAt)}`
            )
          : undefined
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {tr('Abbrechen', 'Cancel')}
          </button>
          <button className="btn primary" onClick={run} disabled={busy}>
            {busy ? <span className="spinner" /> : <IconDownload size={15} />}
            {tr('Herunterladen und einspielen', 'Download and restore')}
          </button>
        </>
      }
    >
      {backup && (
        <div className="col gap-8" role="radiogroup" aria-label={tr('Ziel', 'Target')}>
          {existing && (
            <label className="backup-row" style={{ cursor: 'pointer' }}>
              <input type="radio" name="cloud-target" checked={mode === 'existing'} onChange={() => setMode('existing')} />
              <div className="grow">
                <div className="content-name">{tr(`In ${existing.name} einspielen`, `Restore into ${existing.name}`)}</div>
                <div className="hint">
                  {tr(
                    `${folders} dieser Instanz werden ersetzt. Der aktuelle Stand wird vorher automatisch gesichert.`,
                    `${folders} of this instance are replaced. The current state is backed up automatically first.`
                  )}
                </div>
              </div>
            </label>
          )}
          <label className="backup-row" style={{ cursor: 'pointer' }}>
            <input type="radio" name="cloud-target" checked={mode === 'new'} onChange={() => setMode('new')} />
            <div className="grow">
              <div className="content-name">{tr('Als neue Instanz anlegen', 'Create as a new instance')}</div>
              <div className="hint">
                {tr(
                  `${backup.instanceName} mit Minecraft ${backup.mcVersion} und ${LOADER_LABELS[backup.loader] ?? backup.loader}. Minecraft und der Mod-Loader werden dafür eingerichtet.`,
                  `${backup.instanceName} with Minecraft ${backup.mcVersion} and ${LOADER_LABELS[backup.loader] ?? backup.loader}. Minecraft and the mod loader are set up for it.`
                )}
              </div>
            </div>
          </label>
        </div>
      )}
    </Modal>
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
  onCreated: (entry: BackupEntry) => Promise<void>
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
      onClose()
      await onCreated(entry)
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
                aria-pressed={includes.includes(key)}
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
