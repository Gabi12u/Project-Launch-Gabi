import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { BackupEntry } from '@shared/types'
import { paths } from '../paths'
import { getSettings, readJson, writeJsonAtomic } from '../store'
import { log } from '../logger'
import { notify } from '../events'
import { withTask } from '../tasks'
import { extractAllSlowly, listEntries, zipFolder, ZIP_TEMP_SUFFIX } from './archive'
import { getInstance } from './instances'
import { withRestoreLock } from './restoreLock'
import { isRunning, isStarting } from './running'
import { isContentBusy } from './contentLock'
// Not imported from `repair.ts` directly: that file imports `content.ts`,
// which imports this one for its own safety copy, so reading the marker
// straight out of `repair.ts` here would close that loop. See the comment on
// `repairLock.ts` itself.
import { isRepairing } from './repairLock'

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

/**
 * Confirms `instanceId` cannot walk `paths.instanceBackups` outside the
 * shared backups root, without requiring a live instance to exist for it.
 *
 * Deleting an instance removes its folder and its backup folder in two
 * separate steps, on purpose, because a locked file (a virus scanner, an
 * indexer) can make the second one fail while the first already succeeded.
 * The backup folder that is left behind then belongs to no instance any
 * more, and listing/deleting it from the all-instances backup view is the
 * only cleanup path a user has for that case. Requiring `getInstance` to
 * succeed here, the same way `restoreBackupUnlocked` correctly does before
 * writing into a game folder that must exist, would make that orphaned
 * folder permanently invisible instead. This checks the one thing that
 * actually matters for these two read/delete operations: that the id still
 * resolves inside the backups root, not that it currently names a real
 * instance.
 */
function assertBackupIdSafe(instanceId: string): void {
  const root = resolve(paths.backups())
  const dir = resolve(paths.instanceBackups(instanceId))
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new Error(`Ungültige Instanz-Kennung für Sicherungen: ${instanceId}`)
  }
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

const BACKUP_TARGET_KEYS = new Set<string>(BACKUP_TARGETS.map((t) => t.key))

/**
 * Keeps only the folder keys this feature actually knows about.
 *
 * `includes` reaches `createBackupUnlocked` straight from `instance:update`'s
 * neighbour `backups:create`, and `entry.includes` written into `backups.json`
 * is read back by a restore later. Both used to be handed to `join()`
 * unchecked; a key with "../" segments packed, and on restore moved aside,
 * a folder that was never part of the game directory at all. Every real
 * caller only ever needs one of the six fixed keys below, so anything else
 * is simply dropped rather than trusted.
 */
function sanitizeIncludes(includes: readonly string[]): string[] {
  return includes.filter((key) => BACKUP_TARGET_KEYS.has(key))
}

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
    assertBackupIdSafe(instanceId)
    const index = readIndex(instanceId)
    // A hand-edited or truncated backups.json can parse as the wrong shape.
    if (!Array.isArray(index)) return []
    const present = index.filter(
      (entry) =>
        Boolean(entry?.fileName) &&
        existsSync(join(paths.instanceBackups(instanceId), entry.fileName))
    )

    // An entry whose zip is gone (a manual delete outside the app, a failed
    // write) used to stay in backups.json forever, just hidden from view. It
    // is only worth writing the cleaned list back when nothing is currently
    // touching this instance's backups; mid-operation the index can briefly
    // disagree with the disk on purpose (see `createBackupUnlocked`), and
    // this cleanup is a nice-to-have, not worth racing that.
    if (present.length !== index.length && !instanceLocks.has(instanceId)) {
      try {
        writeIndex(instanceId, present)
      } catch (err) {
        logger.warn(`Bereinigter Sicherungsindex von ${instanceId} nicht geschrieben:`, err)
      }
    }

    return present.sort((a, b) => b.createdAt - a.createdAt)
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
  const requested = options.includes?.length ? sanitizeIncludes(options.includes) : []
  const includes = requested.length > 0 ? requested : ['saves', 'config']
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
      const skippedLinks: string[] = []
      try {
        await zipFolder(
          gameDir,
          target,
          {
            include: existing,
            onSkip: (file) => skipped.push(file),
            onSkipLink: (file) => skippedLinks.push(file)
          },
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

      // A link was never something a restore could recreate anyway, so it is
      // only worth telling the user about, not failing a backup that is
      // otherwise complete over.
      if (skippedLinks.length > 0) {
        const one = skippedLinks.length === 1
        notify(
          'warning',
          `${instance.name}: Verknüpfungen nicht gesichert`,
          `${skippedLinks.length} ${one ? 'Verknüpfung wurde' : 'Verknüpfungen wurden'} übersprungen und ` +
            `${one ? 'ist' : 'sind'} nicht in der Sicherung enthalten (z. B. ${skippedLinks[0]}).`
        )
      }

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

/**
 * Applies a newly lowered `automaticBackupKeep` immediately.
 *
 * `pruneAutomatic` above only ever runs right after a fresh backup is
 * written, so lowering the setting left every instance's existing overflow
 * sitting on disk until its next backup happened to occur, defeating the
 * point of lowering it at all. Walks every folder under the backups root the
 * same way `listBackups()`'s all-instances view does, since a folder orphaned
 * by a deleted instance (see `assertBackupIdSafe`) still holds real files.
 */
export function pruneAllAutomaticBackups(): void {
  const root = paths.backups()
  if (!existsSync(root)) return

  for (const id of readdirSync(root)) {
    try {
      if (!statSync(join(root, id)).isDirectory()) continue
    } catch {
      continue
    }
    // A create, restore or delete already running for this id touches the
    // same backups.json and the same files; pruning underneath it would race
    // it instead of helping, so it is left for that operation's own prune.
    if (instanceLocks.has(id)) continue
    try {
      pruneAutomatic(id)
    } catch (err) {
      logger.warn(`Automatische Sicherungen von ${id} nicht aufgeräumt:`, err)
    }
  }
}

/**
 * What a restore has done so far, written before it touches a single folder.
 *
 * `moved` is only the folders that actually existed and were parked aside;
 * `newKeys` are folders the archive is about to create that the instance did
 * not have before. Both are exactly what `recoverInterruptedRestores` needs
 * to undo the parking and remove what the interrupted extraction created,
 * without having to guess from whatever state the folders happen to be in.
 */
interface RestoreJournal {
  moved: { key: string; from: string; to: string }[]
  newKeys: string[]
}

function journalFile(stagingDir: string): string {
  return join(stagingDir, 'journal.json')
}

/**
 * Sweeps `zipFolder`'s own leftover temp files after a crash mid backup.
 *
 * Only ever removes a file ending in the exact suffix `zipFolder` writes
 * itself (see `ZIP_TEMP_SUFFIX`); nothing else under the backups root is
 * touched here, deliberately, so this can never grow into a general
 * "delete old backups" cleanup, which is not what this is for.
 */
function cleanupTempBackupFiles(): void {
  const root = paths.backups()
  if (!existsSync(root)) return

  let instanceIds: string[]
  try {
    instanceIds = readdirSync(root)
  } catch (err) {
    logger.warn('Sicherungsordner konnte für das Aufräumen von Zwischendateien nicht gelesen werden:', err)
    return
  }

  for (const instanceId of instanceIds) {
    const instanceDir = join(root, instanceId)
    let entries: string[]
    try {
      if (!statSync(instanceDir).isDirectory()) continue
      entries = readdirSync(instanceDir)
    } catch (err) {
      logger.warn(`Sicherungsordner von ${instanceId} nicht lesbar:`, err)
      continue
    }

    for (const name of entries) {
      if (!name.endsWith(ZIP_TEMP_SUFFIX)) continue
      try {
        rmSync(join(instanceDir, name), { force: true })
        logger.info(`Unvollständige Sicherungsdatei ${name} von ${instanceId} entfernt`)
      } catch (err) {
        logger.warn(`Zwischendatei ${name} von ${instanceId} nicht entfernt:`, err)
      }
    }
  }
}

/**
 * Puts back whatever a restore parked aside but never got to finish, because
 * the launcher died between moving the originals out of the way and cleaning
 * up after itself (a crash, a forced update, a power loss). Also sweeps
 * leftover temp files from an interrupted backup write (see
 * `cleanupTempBackupFiles`); bundled into this one function rather than a
 * second startup call, since both are the same kind of "the process died
 * mid write" cleanup over the same backups folder tree.
 *
 * Called once at startup, before instances are loaded or a window exists, so
 * nothing ever reads a game folder while it is still in this half moved
 * state. Every failure is caught per staging folder: one instance's stuck
 * restore must not stop another's from being recovered, and must not take
 * startup down with it.
 */
export function recoverInterruptedRestores(): string[] {
  cleanupTempBackupFiles()

  const recovered: string[] = []
  const root = paths.backups()
  if (!existsSync(root)) return recovered

  let instanceIds: string[]
  try {
    instanceIds = readdirSync(root)
  } catch (err) {
    logger.warn('Sicherungsordner konnte für die Wiederherstellungsprüfung nicht gelesen werden:', err)
    return recovered
  }

  for (const instanceId of instanceIds) {
    const instanceDir = join(root, instanceId)
    let stagingNames: string[]
    try {
      if (!statSync(instanceDir).isDirectory()) continue
      stagingNames = readdirSync(instanceDir).filter((name) => name.startsWith('restore-'))
    } catch (err) {
      logger.warn(`Sicherungsordner von ${instanceId} nicht lesbar:`, err)
      continue
    }

    for (const name of stagingNames) {
      try {
        if (recoverOneInterruptedRestore(instanceId, join(instanceDir, name))) recovered.push(instanceId)
      } catch (err) {
        logger.error(`Wiederherstellung nach Absturz für ${instanceId}/${name} fehlgeschlagen:`, err)
      }
    }
  }
  return recovered
}

function recoverOneInterruptedRestore(instanceId: string, staging: string): boolean {
  if (!existsSync(staging) || !statSync(staging).isDirectory()) return false

  const file = journalFile(staging)
  // No journal means either an older build's leftover or a folder some other
  // process is still writing to; neither is something this function can
  // safely interpret, so it is left alone rather than guessed at.
  if (!existsSync(file)) return false

  const journal = readJson<RestoreJournal | null>(file, null)
  if (!journal || !Array.isArray(journal.moved) || !Array.isArray(journal.newKeys)) {
    logger.warn(`Journal in ${staging} ist beschädigt oder unvollständig, wird übersprungen`)
    return false
  }

  let ok = true
  for (const item of journal.moved) {
    // The parked copy missing means the rename that would have created it
    // never ran, so `from`, whatever is there, is the untouched original.
    if (!existsSync(item.to)) continue
    try {
      if (existsSync(item.from)) rmSync(item.from, { recursive: true, force: true })
      renameSync(item.to, item.from)
    } catch (err) {
      ok = false
      logger.error(
        `${item.key} von ${instanceId} konnte nach einem Absturz nicht zurückgeholt werden, ` +
          `die gesicherte Kopie bleibt in ${staging} liegen:`,
        err
      )
    }
  }

  const gameDir = paths.gameDir(instanceId)
  for (const key of journal.newKeys) {
    try {
      rmSync(join(gameDir, key), { recursive: true, force: true })
    } catch (err) {
      // Only a leftover new folder, not lost data, so this alone does not
      // hold back deleting the staging folder below.
      logger.warn(`${key} von ${instanceId} nach Absturz nicht aufgeräumt:`, err)
    }
  }

  // Something above could not be undone: the staging folder, journal
  // included, is the only record of it and stays put for the next startup
  // to try again, instead of being deleted here and losing that record.
  if (!ok) return false

  try {
    rmSync(staging, { recursive: true, force: true })
  } catch (err) {
    logger.warn(`Staging-Ordner ${staging} konnte nicht entfernt werden:`, err)
    return false
  }

  logger.info(`Abgebrochene Wiederherstellung für ${instanceId} nach Absturz rückgängig gemacht`)

  return true
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
  // Unlike `listBackups`/`deleteBackup`, which only need `instanceId` to stay
  // inside the backups root (see `assertBackupIdSafe`), this one genuinely
  // needs a live instance: it is about to move that instance's own game
  // folder aside and unpack into it. `getInstance` throwing for an id that
  // never belonged to a real instance is exactly the guard wanted here, not
  // merely a stand-in for a path check.
  getInstance(instanceId)

  if (isRunning(instanceId)) {
    throw new Error('Die Instanz läuft gerade. Beende Minecraft, bevor du eine Sicherung einspielst.')
  }
  // `launchInstance` refuses to start while a restore is in progress
  // (`isRestoring`), but this was never the other half of that: between
  // `markStarting` and the game actually appearing as running, a launch can
  // spend minutes downloading missing files or a whole Java runtime.
  // `isRunning` is false for that entire window, so a restore begun during it
  // moved the worlds aside and unpacked an archive over a folder the launch
  // was about to write into.
  if (isStarting(instanceId)) {
    throw new Error('Die Instanz wird gerade gestartet. Warte, bis das abgeschlossen ist.')
  }

  // A repair rewrites the same subfolders (saves, config, possibly mods) a
  // restore is about to move aside and overwrite. Without this, the two could
  // run at the same time and leave half written files behind depending on
  // timing.
  if (isRepairing(instanceId)) {
    throw new Error('Diese Instanz wird gerade repariert. Warte, bis das abgeschlossen ist.')
  }

  // Content work (installing, updating, removing) writes into `mods` while
  // holding `withContentLock`, which a restore can include in `includes`. The
  // repair guard above does not cover this: repairing takes its own marker,
  // but ordinary content operations only take the content lock.
  if (isContentBusy(instanceId)) {
    throw new Error(
      'An den Mods dieser Instanz wird gerade gearbeitet. Warte, bis das abgeschlossen ist.'
    )
  }

  const entry = readIndex(instanceId).find((e) => e.id === backupId)
  if (!entry) throw new Error('Sicherung nicht gefunden')

  const archive = backupPath(instanceId, entry.fileName)
  if (!existsSync(archive)) throw new Error('Die Sicherungsdatei fehlt auf der Festplatte.')

  const instance = getInstance(instanceId)
  // `entry.includes` is data written to `backups.json` at an earlier point in
  // time, potentially by an older build or a hand edit, not necessarily
  // already-sanitized input. Filtered the same way `createBackupUnlocked`
  // filters a fresh request, for the same reason: every `join(gameDir, key)`
  // and `join(parked, key)` below trusts `key` completely.
  const sanitized = entry.includes?.length ? sanitizeIncludes(entry.includes) : []
  const includes = sanitized.length > 0 ? sanitized : ['saves', 'config']

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

        // Written before a single folder is touched: if the process dies
        // anywhere below, this is what tells `recoverInterruptedRestores` on
        // the next startup what was about to happen and how to undo it,
        // instead of the parked originals sitting there forever unexplained.
        const plan = includes.map((key) => ({ key, from: join(gameDir, key), to: join(parked, key) }))
        writeJsonAtomic(journalFile(parked), {
          moved: plan.filter((item) => existsSync(item.from)),
          newKeys: includes.filter((key) => !existsSync(join(gameDir, key)))
        } satisfies RestoreJournal)

        try {
          for (const { key, from, to } of plan) {
            if (!existsSync(from)) continue
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
            () => task.throwIfCancelled(),
            // Only the parked folders may be overwritten. Without this an
            // archive with entries outside `includes` (an older build, a hand
            // edit of the zip) wrote into folders that were never moved aside
            // and never backed up either.
            new Set(includes)
          )
        } catch (err) {
          // Put everything back exactly as it was.
          const stranded: string[] = []
          // Subset of `stranded` where the current (partially extracted)
          // folder could not even be removed, so it is still sitting in
          // `gameDir` on top of the untouched original stuck in `parked`.
          const strandedLeftover: string[] = []
          for (const item of moved) {
            let removedCurrent = false
            try {
              rmSync(item.from, { recursive: true, force: true })
              removedCurrent = true
              renameSync(item.to, item.from)
            } catch (rollbackErr) {
              logger.error(`Rollback von ${item.key} fehlgeschlagen:`, rollbackErr)
              // Noted, not just logged. Whatever could not be renamed back is
              // still sitting in the staging folder, and that folder used to be
              // deleted a few lines below no matter what. A single locked
              // directory was therefore enough to destroy the user's only
              // remaining copy while the message below promised the opposite.
              stranded.push(item.key)
              if (!removedCurrent) strandedLeftover.push(item.key)
            }
          }

          // Folders the backup introduces that the instance did not have are
          // never in `moved`, so a partial extraction would leave them behind
          // while the message below promises the previous state is back.
          const restoredKeys = new Set(moved.map((item) => item.key))
          const newLeftover: string[] = []
          for (const key of includes) {
            if (restoredKeys.has(key)) continue
            try {
              rmSync(join(gameDir, key), { recursive: true, force: true })
            } catch (cleanupErr) {
              logger.error(`Aufräumen von ${key} fehlgeschlagen:`, cleanupErr)
              newLeftover.push(key)
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

          const reason = `(${err instanceof Error ? err.message : String(err)})`

          // Only this case may say the previous state is truly back: every
          // parked folder was renamed back and nothing new was left behind.
          if (stranded.length === 0 && newLeftover.length === 0) {
            throw new Error(
              `Die Wiederherstellung ist fehlgeschlagen, der vorherige Stand wurde zurückgeholt. ${reason}`
            )
          }

          const details: string[] = []
          if (strandedLeftover.length > 0) {
            details.push(
              `${strandedLeftover.join(', ')} konnte(n) nicht zurückgeholt werden; der alte Stand liegt ` +
                `unverändert in ${parked}, im Instanzordner selbst kann aber noch ein unvollständig ` +
                `entpackter Rest der Wiederherstellung liegen`
            )
          }
          const strandedMissing = stranded.filter((key) => !strandedLeftover.includes(key))
          if (strandedMissing.length > 0) {
            details.push(
              `${strandedMissing.join(', ')} konnte(n) nicht zurückgeholt werden; der alte Stand liegt ` +
                `unverändert in ${parked} und fehlt im Moment im Instanzordner`
            )
          }
          if (newLeftover.length > 0) {
            details.push(
              `${newLeftover.join(', ')} gab es vorher nicht und konnte(n) nicht wieder entfernt werden; ` +
                `dort liegt jetzt möglicherweise ein unvollständig entpackter Rest der Sicherung`
            )
          }

          throw new Error(
            `Die Wiederherstellung ist fehlgeschlagen, und der vorherige Stand wurde NICHT vollständig ` +
              `zurückgeholt. ${details.join('. ')}. Schließe Minecraft und alles, was auf den ` +
              `Instanzordner zugreift, und ordne die genannten Ordner von Hand. ${reason}`
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
  assertBackupIdSafe(instanceId)
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

/**
 * Folder holding one instance's backups, for the "open folder" button.
 *
 * `paths.instanceBackups` is a plain `join`, with no check that `instanceId`
 * names a real instance. `getInstance` throws on an unknown id, which is
 * enough here: a real instance id comes out of `slugify()` in instances.ts and
 * can never contain a slash or a dot, so nothing crafted to escape the backups
 * folder ever matches a cached instance. Without this, an id with ".."
 * segments could resolve to a different launcher-owned folder entirely, and
 * `shell.openPath` behind this same button runs a `.exe` on Windows instead of
 * merely showing it.
 */
export function backupFolder(instanceId: string): string {
  getInstance(instanceId)
  return paths.instanceBackups(instanceId)
}
