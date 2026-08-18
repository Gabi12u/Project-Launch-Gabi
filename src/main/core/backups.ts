import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupEntry } from '@shared/types'
import { paths } from '../paths'
import { getSettings, readJson, writeJsonAtomic } from '../store'
import { log } from '../logger'
import { withTask } from '../tasks'
import { extractAll, listEntries, zipFolder } from './archive'
import { getInstance } from './instances'
import { isRunning } from './running'

const logger = log('backups')

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

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19)
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
        name: options.name?.trim() || `Sicherung vom ${stamp.replace('T', ' ').replace(/-/g, ':')}`,
        fileName,
        createdAt: Date.now(),
        size: statSync(target).size,
        reason,
        includes: existing
      }

      const entries = [entry, ...readIndex(instanceId)]
      writeIndex(instanceId, entries)

      pruneAutomatic(instanceId)
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
  if (keep <= 0) return

  const entries = readIndex(instanceId)
  const automatic = entries.filter((e) => e.reason === 'automatic').sort((a, b) => b.createdAt - a.createdAt)
  const excess = automatic.slice(keep).filter((e) => !inUse.has(e.id))

  if (excess.length === 0) return

  for (const entry of excess) {
    rmSync(join(paths.instanceBackups(instanceId), entry.fileName), { force: true })
  }
  writeIndex(
    instanceId,
    entries.filter((e) => !excess.some((x) => x.id === e.id))
  )
}

export async function restoreBackup(instanceId: string, backupId: string): Promise<void> {
  return withInstanceLock(instanceId, () => restoreBackupUnlocked(instanceId, backupId))
}

async function restoreBackupUnlocked(instanceId: string, backupId: string): Promise<void> {
  if (isRunning(instanceId)) {
    throw new Error('Die Instanz läuft gerade. Beende Minecraft, bevor du eine Sicherung einspielst.')
  }

  const entry = readIndex(instanceId).find((e) => e.id === backupId)
  if (!entry) throw new Error('Sicherung nicht gefunden')

  const archive = join(paths.instanceBackups(instanceId), entry.fileName)
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

          extractAll(archive, gameDir, true)
        } catch (err) {
          // Put everything back exactly as it was.
          for (const item of moved) {
            try {
              rmSync(item.from, { recursive: true, force: true })
              renameSync(item.to, item.from)
            } catch (rollbackErr) {
              logger.error(`Rollback von ${item.key} fehlgeschlagen:`, rollbackErr)
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

          // The staging folder is empty now; leaving it would litter one per
          // failed attempt.
          try {
            rmSync(parked, { recursive: true, force: true })
          } catch {
            // best effort
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

export function deleteBackup(instanceId: string, backupId: string): void {
  const entries = readIndex(instanceId)
  const entry = entries.find((e) => e.id === backupId)
  if (!entry) return

  rmSync(join(paths.instanceBackups(instanceId), entry.fileName), { force: true })
  writeIndex(
    instanceId,
    entries.filter((e) => e.id !== backupId)
  )
  logger.info(`Sicherung ${entry.fileName} gelöscht`)
}

export function backupFolder(instanceId: string): string {
  return paths.instanceBackups(instanceId)
}
