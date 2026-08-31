import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { BackupEntry } from '@shared/types'
import { paths } from '../paths'
import { getSettings, readJson, writeJsonAtomic } from '../store'
import { log } from '../logger'
import { withTask } from '../tasks'
import { extractAllSlowly, listEntries, zipFolder } from './archive'
import { getInstance } from './instances'
import { withRestoreLock } from './restoreLock'
import { isRunning } from './running'

const logger = log('backups')

/**
 * Turns an index entry's file name into a path inside the backup folder.
 *
 * The name comes out of `backups.json`, a file on the user's disk that
 * nothing stops them or a broken write from filling with `../../something`.
 * Deleting instances and recordings both check their paths this way; the
 * pruning of old backups was the one deletion that trusted its input.
 */
function backupPath(instanceId: string, fileName: string): string {
  const dir = resolve(paths.instanceBackups(instanceId))
  const target = resolve(dir, fileName)
  if (!target.startsWith(dir + sep)) {
    throw new Error(`Die Sicherung ${fileName} liegt nicht im Sicherungsordner dieser Instanz.`)
  }
  return target
}

/** Folders that make sense to snapshot, in the order shown in the UI. */
export const BACKUP_TARGETS = [
  { key: 'saves', label: 'Welten' },
  { key: 'config', label: 'Konfiguration' },
  { key: 'mods', label: 'Mods' },
  { key: 'resourcepacks', label: 'Resourcepacks' },
  { key: 'shaderpacks', label: 'Shader' },
  { key: 'screenshots', label: 'Screenshots' }
] as const

function indexFile(instanceId: string): string {
  return join(paths.instanceBackups(instanceId), 'backups.json')
}

function readIndex(instanceId: string): BackupEntry[] {
  return readJson<BackupEntry[]>(indexFile(instanceId), [])
}

function writeIndex(instanceId: string, entries: BackupEntry[]): void {
  writeJsonAtomic(indexFile(instanceId), entries)
}

export function listBackups(instanceId?: string): BackupEntry[] {
  if (instanceId) {
    const index = readIndex(instanceId)
    // A hand-edited or truncated backups.json can parse as the wrong shape.
    if (!Array.isArray(index)) return []
    return index
      .filter(
        (entry) =>
          Boolean(entry?.fileName) &&
          existsSync(join(paths.instanceBackups(instanceId), entry.fileName))
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  const root = paths.backups()
  if (!existsSync(root)) return []

  const all: BackupEntry[] = []
  for (const id of readdirSync(root)) {
    // A stray file, a vanished directory or an unreadable entry must not take
    // the whole backup list down with it.
    try {
      if (!statSync(join(root, id)).isDirectory()) continue
      all.push(...listBackups(id))
    } catch (err) {
      logger.warn(`Sicherungen von ${id} nicht lesbar:`, err)
    }
  }
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export interface CreateBackupOptions {
  name?: string
  reason?: BackupEntry['reason']
  /** Folder keys from BACKUP_TARGETS; defaults to worlds and config. */
  includes?: string[]
}

/**
 * One chain of pending backup work per instance.
 *
 * Creating and restoring both rename and unpack whole folders inside the same
 * game directory, and both run for many seconds. The UI's own guards vanish
 * the moment the view unmounts — a deep link or a desktop shortcut navigating
 * away is enough — so the only place this can be enforced reliably is here.
 * Two restores landing on one instance would otherwise move each other's
 * folders aside and extract over the top.
 */
const instanceLocks = new Map<string, Promise<unknown>>()

async function withInstanceLock<T>(instanceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = instanceLocks.get(instanceId) ?? Promise.resolve()
  // A failed operation must not wedge the queue for everything after it.
  const run = previous.catch(() => undefined).then(fn)

  instanceLocks.set(instanceId, run)
  try {
    return await run
  } finally {
    if (instanceLocks.get(instanceId) === run) instanceLocks.delete(instanceId)
  }
}

export async function createBackup(
  instanceId: string,
  options: CreateBackupOptions = {}
): Promise<BackupEntry> {
  return withInstanceLock(instanceId, () => createBackupUnlocked(instanceId, options))
}

/**
 * The actual work, without taking the lock.
 *
 * `restoreBackup` already holds it when it takes its safety copy, so going
 * through the public entry point there would deadlock against itself.
 */
async function createBackupUnlocked(
  instanceId: string,
  options: CreateBackupOptions = {}
): Promise<BackupEntry> {
  const instance = getInstance(instanceId)
  const includes = options.includes?.length ? options.includes : ['saves', 'config']
  const reason = options.reason ?? 'manual'

  return withTask(
    `Sicherung von ${instance.name}`,
    'Dateien werden gepackt…',
    instanceId,
    async (task) => {
      const dir = paths.instanceBackups(instanceId)
      mkdirSync(dir, { recursive: true })

      // Date and time kept apart. Folding ':' and '.' into '-' made the
      // date's own separators indistinguishable from them, and the display
      // name further down turned every '-' back into ':' — printing
      // "2026:08:23" as the date.
      const now = new Date()
      const stamp = `${now.toISOString().slice(0, 10)}_${now
        .toISOString()
        .slice(11, 19)
        .replace(/:/g, '-')}`
      // The stamp only resolves to seconds, so two backups in the same second
      // would share a file name and the older index entry would point at the
      // newer archive.
      const fileName = `backup-${stamp}-${randomUUID().slice(0, 6)}.zip`
      const target = join(dir, fileName)

      const gameDir = paths.gameDir(instanceId)
      const existing = includes.filter((key) => existsSync(join(gameDir, key)))

      if (existing.length === 0) {
        throw new Error('Es gibt nichts zu sichern - die gewählten Ordner sind leer.')
      }

      const skipped: string[] = []
      try {
        await zipFolder(
          gameDir,
          target,
          { include: existing, onSkip: (file) => skipped.push(file) },
          (done, total) => {
            task.update(`${done} / ${total} Dateien`, total > 0 ? done / total : null)
          }
        )

        // A backup that is quietly missing files is worse than no backup, because
        // the user only finds out when they try to restore it. Minecraft holding
        // its world files open is the usual cause.
        if (skipped.length > 0) {
          const running = isRunning(instanceId)
          throw new Error(
            `${skipped.length} ${skipped.length === 1 ? 'Datei konnte' : 'Dateien konnten'} nicht ` +
              `gelesen werden (z. B. ${skipped[0]}), die Sicherung wäre unvollständig.` +
              (running ? ' Beende Minecraft und versuche es erneut.' : '')
          )
        }
      } catch (err) {
        // Never leave a half-written archive behind; it would look like a
        // usable backup in the folder.
        try {
          rmSync(target, { force: true })
        } catch {
          // best effort
        }
        throw err
      }

      const entry: BackupEntry = {
        id: randomUUID(),
        instanceId,
        instanceName: instance.name,
        name: options.name?.trim() || `Sicherung vom ${stamp.slice(0, 10)} ${stamp.slice(11).replace(/-/g, ':')}`,
        fileName,
        createdAt: Date.now(),
        size: statSync(target).size,
        reason,
        includes: existing
      }

      const entries = [entry, ...readIndex(instanceId)]
      writeIndex(instanceId, entries)

      // Tidying up old backups is housekeeping, and the new backup is already
      // written and indexed by now. Letting an EBUSY on some unrelated old
      // archive — one an antivirus or an Explorer preview still holds open —
      // escape from here reported the whole operation as failed, so the user
      // would retry and pile up a redundant copy.
      try {
        pruneAutomatic(instanceId)
      } catch (err) {
        logger.warn(`Alte Sicherungen von ${instance.name} nicht aufgeraeumt:`, err)
      }
      logger.info(`Sicherung ${fileName} für ${instance.name} erstellt`)

      return entry
    }
  )
}

/**
 * Backups that must survive a prune because a restore is currently reading one.
 *
 * `restoreBackup` takes a safety copy of the present state first, and every
 * `createBackup` prunes the oldest automatic entries afterwards. Restoring the
 * *oldest* automatic backup therefore used to delete that very archive moments
 * before it was unpacked — deterministically, as soon as the keep limit was
 * reached, destroying the restore point the user had just picked.
 */
const inUse = new Set<string>()

/** Keeps only the newest N automatic backups. */
function pruneAutomatic(instanceId: string): void {
  const keep = getSettings().automaticBackupKeep
  // The finite check is not decoration. Every comparison against a non-numeric
  // value is false, so `keep <= 0` waved it through and `slice(keep)` behaved
  // like `slice(0)`: the excess list became every automatic backup there was,
  // and one prune wiped all of them. The settings loader guards this too, this
  // is the second lock on a door that leads to unrecoverable data.
  if (!Number.isFinite(keep) || keep <= 0) return

  const entries = readIndex(instanceId)
  const automatic = entries.filter((e) => e.reason === 'automatic').sort((a, b) => b.createdAt - a.createdAt)
  const excess = automatic.slice(keep).filter((e) => !inUse.has(e.id))

  if (excess.length === 0) return

  for (const entry of excess) {
    rmSync(backupPath(instanceId, entry.fileName), { force: true })
  }
  writeIndex(
    instanceId,
    entries.filter((e) => !excess.some((x) => x.id === e.id))
  )
}

export async function restoreBackup(instanceId: string, backupId: string): Promise<void> {
  // The marker is what `launch.ts` and `instances.ts` read. The instance lock
  // below only keeps two backup operations apart; it says nothing to the rest
  // of the app, so pressing Play mid restore started a game against a folder
  // that was being unpacked underneath it.
  return withInstanceLock(instanceId, () =>
    withRestoreLock(instanceId, () => restoreBackupUnlocked(instanceId, backupId))
  )
}

async function restoreBackupUnlocked(instanceId: string, backupId: string): Promise<void> {
  if (isRunning(instanceId)) {
    throw new Error('Die Instanz läuft gerade. Beende Minecraft, bevor du eine Sicherung einspielst.')
  }

  const entry = readIndex(instanceId).find((e) => e.id === backupId)
  if (!entry) throw new Error('Sicherung nicht gefunden')

  const archive = backupPath(instanceId, entry.fileName)
  if (!existsSync(archive)) throw new Error('Die Sicherungsdatei fehlt auf der Festplatte.')

  const instance = getInstance(instanceId)
  const includes = entry.includes?.length ? entry.includes : ['saves', 'config']

  // Held for the whole restore, not just the safety-copy step: the archive is
  // not opened until `extractAll` near the end.
  inUse.add(entry.id)
  try {
    await withTask(
      `Sicherung wird eingespielt`,
      `${entry.name} wird wiederhergestellt…`,
      instanceId,
      async (task) => {
        // 1. Prove the archive is readable BEFORE touching a single game file.
        // `existsSync` above only says the file is there, not that it is intact.
        task.update('Sicherung wird geprüft…', null)
        let entryCount = 0
        try {
          entryCount = listEntries(archive).length
        } catch (err) {
          throw new Error(
            `Die Sicherung ist beschädigt und wurde nicht eingespielt. Deine Daten sind unverändert. (${
              err instanceof Error ? err.message : String(err)
            })`
          )
        }
        if (entryCount === 0) {
          throw new Error('Die Sicherung ist leer und wurde nicht eingespielt. Deine Daten sind unverändert.')
        }

        // 2. Safety net. A failure here used to be logged and ignored, which is
        // exactly the situation where the restore must NOT continue.
        task.update('Aktueller Stand wird gesichert…', null)
        const hasCurrentData = includes.some((key) => existsSync(join(paths.gameDir(instanceId), key)))
        if (hasCurrentData) {
          try {
            // Unlocked on purpose: this restore already holds the instance
            // lock, and the public entry point would wait on itself forever.
            await createBackupUnlocked(instanceId, {
              name: `Automatisch vor Wiederherstellung`,
              reason: 'automatic',
              includes
            })
          } catch (err) {
            throw new Error(
              `Die Sicherheitskopie des aktuellen Stands ist fehlgeschlagen, deshalb wurde nichts ` +
                `überschrieben. Deine Daten sind unverändert. (${
                  err instanceof Error ? err.message : String(err)
                })`
            )
          }
        }

        task.update('Dateien werden zurückgespielt…', null)
        const gameDir = paths.gameDir(instanceId)

        // 3. Move the current folders aside instead of deleting them, so a failed
        // extraction can be rolled back. Deleted files still disappear, because
        // the folders are gone before the archive is unpacked.
        const parked = join(paths.instanceBackups(instanceId), `restore-${randomUUID().slice(0, 8)}`)
        const moved: { key: string; from: string; to: string }[] = []

        try {
          for (const key of includes) {
            const from = join(gameDir, key)
            if (!existsSync(from)) continue
            const to = join(parked, key)
            mkdirSync(parked, { recursive: true })
            renameSync(from, to)
            moved.push({ key, from, to })
          }

          await extractAllSlowly(
            archive,
            gameDir,
            (done, total) => {
              task.update(`Wird entpackt… ${done} von ${total}`, total > 0 ? done / total : null)
            },
            // Cancelling now actually stops the unpacking. It used to only set
            // a flag nobody read, so the run carried on over the user's files
            // and finished with "Fertig". A cancel here lands in the catch
            // below, which puts the previous state back.
            () => task.throwIfCancelled()
          )
        } catch (err) {
          // Put everything back exactly as it was.
          const stranded: string[] = []
          for (const item of moved) {
            try {
              rmSync(item.from, { recursive: true, force: true })
              renameSync(item.to, item.from)
            } catch (rollbackErr) {
              logger.error(`Rollback von ${item.key} fehlgeschlagen:`, rollbackErr)
              // Noted, not just logged. Whatever could not be renamed back is
              // still sitting in the staging folder, and that folder used to be
              // deleted a few lines below no matter what. A single locked
              // directory was therefore enough to destroy the user's only
              // remaining copy while the message below promised the opposite.
              stranded.push(item.key)
            }
          }

          // Folders the backup introduces that the instance did not have are
          // never in `moved`, so a partial extraction would leave them behind
          // while the message below promises the previous state is back.
          const restoredKeys = new Set(moved.map((item) => item.key))
          for (const key of includes) {
            if (restoredKeys.has(key)) continue
            try {
              rmSync(join(gameDir, key), { recursive: true, force: true })
            } catch (cleanupErr) {
              logger.error(`Aufräumen von ${key} fehlgeschlagen:`, cleanupErr)
            }
          }

          // Only expendable once every folder is genuinely back. If a rename
          // failed, the staging folder holds the sole surviving copy of that
          // data and deleting it here would be the one truly unrecoverable
          // step in this function.
          if (stranded.length === 0) {
            try {
              rmSync(parked, { recursive: true, force: true })
            } catch {
              // best effort
            }
          }

          if (stranded.length > 0) {
            throw new Error(
              `Die Wiederherstellung ist fehlgeschlagen, und ${stranded.join(', ')} konnte nicht ` +
                `zurückgeholt werden. Deine Daten sind nicht verloren: sie liegen unverändert in ` +
                `${parked}. Schließe Minecraft und alles, was auf den Ordner zugreift, und schiebe ` +
                `ihn von Hand zurück. (${err instanceof Error ? err.message : String(err)})`
            )
          }

          throw new Error(
            `Die Wiederherstellung ist fehlgeschlagen, der vorherige Stand wurde zurückgeholt. (${
              err instanceof Error ? err.message : String(err)
            })`
          )
        }

        // 4. Only now is the old state expendable.
        rmSync(parked, { recursive: true, force: true })
        logger.info(`Sicherung ${entry.fileName} in ${instance.name} eingespielt`)
      }
    )
  } finally {
    inUse.delete(entry.id)
  }
}

/**
 * Removes one backup.
 *
 * Runs under the same per-instance lock as creating and restoring, and
 * respects the same `inUse` marker. Without both it was a second door into
 * exactly the hazard those were built for: deleting an archive while a restore
 * was still reading it, or slipping between another operation's read and write
 * of the index and silently dropping a just-created entry.
 */
export async function deleteBackup(instanceId: string, backupId: string): Promise<void> {
  return withInstanceLock(instanceId, async () => {
    const entries = readIndex(instanceId)
    const entry = entries.find((e) => e.id === backupId)
    if (!entry) return

    if (inUse.has(entry.id)) {
      throw new Error('Diese Sicherung wird gerade eingespielt und kann nicht gelöscht werden.')
    }

    rmSync(backupPath(instanceId, entry.fileName), { force: true })
    writeIndex(
      instanceId,
      entries.filter((e) => e.id !== backupId)
    )
    logger.info(`Sicherung ${entry.fileName} gelöscht`)
  })
}

export function backupFolder(instanceId: string): string {
  return paths.instanceBackups(instanceId)
}
