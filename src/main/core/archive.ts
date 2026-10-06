import AdmZip from 'adm-zip'
import { ZipFile } from 'yazl'
import { openPromise as openZipForReading, type Entry as ZipReadEntry, type ZipFile as ZipReader } from 'yauzl'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { safeJoin } from '../paths'
import { log } from '../logger'
import { TaskCancelledError } from '../tasks'
import { tr } from '@shared/i18n'

const logger = log('archive')

/**
 * Upper bound for a single entry's decompressed size.
 *
 * Nothing legitimate this launcher ever unpacks (a mod jar, a resource pack,
 * a single world region file, a JDK class library) comes close to this. A
 * hand-crafted archive that declares a few kilobytes compressed but many
 * gigabytes decompressed does, and every extraction path below used to
 * inflate straight into memory with nothing checking the declared size
 * first, so a single such entry in an otherwise ordinary-looking modpack or
 * backup could exhaust memory before the launcher ever got to look at it.
 */
const MAX_ENTRY_SIZE = 1024 * 1024 * 1024

/** Throws before `entry.getData()` would inflate something absurd into memory. */
export function assertReasonableSize(entry: { header: { size: number }; entryName: string }): void {
  if (entry.header.size > MAX_ENTRY_SIZE) {
    throw new Error(
      tr(
        `${entry.entryName} entpackt auf mehr als ${Math.round(MAX_ENTRY_SIZE / 1024 / 1024)} MB, abgelehnt.`,
        `${entry.entryName} unpacks to more than ${Math.round(MAX_ENTRY_SIZE / 1024 / 1024)} MB, rejected.`
      )
    )
  }
}

/**
 * Upper bound for a single metadata entry read whole into memory as text or
 * JSON (modrinth.index.json, manifest.json, install_profile.json,
 * fabric.mod.json, ...). These are always small hand written or generated
 * files, nothing legitimate ever comes close. `readEntryText` used to call
 * `getData()` with no size check at all, so a 200 KB .mrpack whose
 * modrinth.index.json declared 200 MB got the full 200 MB inflated into
 * memory before anything ever looked at the content.
 */
const MAX_METADATA_SIZE = 32 * 1024 * 1024

function assertReasonableMetadataSize(entry: { header: { size: number }; entryName: string }): void {
  if (entry.header.size > MAX_METADATA_SIZE) {
    throw new Error(tr(`Die Datei "${entry.entryName}" im Archiv ist unplausibel groß.`, `The file "${entry.entryName}" in the archive is implausibly large.`))
  }
}

/**
 * Upper bounds for the whole archive, checked once before any entry is
 * touched. `assertReasonableSize` alone still let an archive with an absurd
 * number of entries, or an absurd total declared size across many
 * individually reasonable entries, run unchecked through every extraction
 * loop below. Real archives this launcher unpacks, the largest modpacks and a
 * full JDK included, stay far below either number.
 */
const MAX_ARCHIVE_ENTRIES = 200_000
const MAX_ARCHIVE_TOTAL_SIZE = 50 * 1024 * 1024 * 1024

function assertReasonableArchive(
  entries: { header: { size: number } }[],
  archivePath: string
): void {
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(
      tr(`${archivePath} enthält mehr als ${MAX_ARCHIVE_ENTRIES} Einträge, abgelehnt.`, `${archivePath} contains more than ${MAX_ARCHIVE_ENTRIES} entries, rejected.`)
    )
  }
  let total = 0
  for (const entry of entries) total += entry.header.size
  if (total > MAX_ARCHIVE_TOTAL_SIZE) {
    throw new Error(
      tr(
        `${archivePath} entpackt auf insgesamt mehr als ${Math.round(MAX_ARCHIVE_TOTAL_SIZE / 1024 / 1024 / 1024)} GB, abgelehnt.`,
        `${archivePath} unpacks to more than ${Math.round(MAX_ARCHIVE_TOTAL_SIZE / 1024 / 1024 / 1024)} GB in total, rejected.`
      )
    )
  }
}

export interface ZipEntryInfo {
  name: string
  isDirectory: boolean
  size: number
}

export function listEntries(archivePath: string): ZipEntryInfo[] {
  const zip = new AdmZip(archivePath)
  return zip.getEntries().map((e) => ({
    name: e.entryName,
    isDirectory: e.isDirectory,
    size: e.header.size
  }))
}

export async function readEntryText(archivePath: string, entryName: string): Promise<string | null> {
  try {
    const zip = new AdmZip(archivePath)
    const entry = zip.getEntry(entryName)
    if (!entry) return null
    assertReasonableMetadataSize(entry)
    return zip.readAsText(entry)
  } catch (err) {
    logger.warn(`Konnte ${entryName} aus ${archivePath} nicht lesen:`, err)
    return null
  }
}

export async function readEntryJson<T>(archivePath: string, entryName: string): Promise<T | null> {
  const text = await readEntryText(archivePath, entryName)
  if (text === null) return null
  try {
    // A byte order mark is legal at the start of a UTF-8 file and some
    // editors write one, but `JSON.parse` rejects it outright.
    return JSON.parse(text.replace(/^﻿/, '')) as T
  } catch {
    return null
  }
}

/** Thrown inside `readSmallEntries` to hand an unusual archive to adm-zip. */
class NeedsFullRead extends Error {}

/**
 * A few small entries of an archive, read through its central directory: the
 * end record, the directory itself, then only the entries asked for.
 *
 * `readEntryText` hands the path to adm-zip, which reads the whole file into
 * memory first, and yauzl reads the directory a few bytes per call. Either is
 * fine for one archive, but the compatibility check wants the metadata of
 * every jar in a modpack, and that meant hundreds of megabytes read, or
 * hundreds of thousands of tiny reads. Anything unusual (zip64, data in front
 * of the archive, an unknown compression) goes the adm-zip way instead, so
 * this never finds less than `readEntryText` would.
 */
export async function readSmallEntries(archivePath: string, names: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Set(names)
  const found = new Map<string, string>()
  const handle = await openFile(archivePath, 'r')
  try {
    const { size } = await handle.stat()
    const tailLength = Math.min(size, 22 + 0xffff)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, size - tailLength)
    let end = -1
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        end = i
        break
      }
    }
    if (end < 0) throw new NeedsFullRead()
    const count = tail.readUInt16LE(end + 10)
    const dirSize = tail.readUInt32LE(end + 12)
    const dirOffset = tail.readUInt32LE(end + 16)
    if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff || dirOffset + dirSize > size) {
      throw new NeedsFullRead()
    }

    const dir = Buffer.alloc(dirSize)
    await handle.read(dir, 0, dirSize, dirOffset)
    let pos = 0
    for (let n = 0; n < count && found.size < wanted.size; n++) {
      if (pos + 46 > dir.length || dir.readUInt32LE(pos) !== 0x02014b50) throw new NeedsFullRead()
      const method = dir.readUInt16LE(pos + 10)
      const compressed = dir.readUInt32LE(pos + 20)
      const uncompressed = dir.readUInt32LE(pos + 24)
      const nameLength = dir.readUInt16LE(pos + 28)
      const extraLength = dir.readUInt16LE(pos + 30)
      const commentLength = dir.readUInt16LE(pos + 32)
      const localOffset = dir.readUInt32LE(pos + 42)
      const name = dir.toString('utf8', pos + 46, pos + 46 + nameLength)
      pos += 46 + nameLength + extraLength + commentLength

      if (!wanted.has(name) || found.has(name)) continue
      if (compressed > MAX_METADATA_SIZE || uncompressed > MAX_METADATA_SIZE) continue
      if (method !== 0 && method !== 8) throw new NeedsFullRead()

      const header = Buffer.alloc(30)
      await handle.read(header, 0, 30, localOffset)
      if (header.readUInt32LE(0) !== 0x04034b50) throw new NeedsFullRead()
      const dataStart = localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      const data = Buffer.alloc(compressed)
      const { bytesRead } = await handle.read(data, 0, compressed, dataStart)
      if (bytesRead < compressed) throw new NeedsFullRead()
      const content = method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_METADATA_SIZE })
      found.set(name, content.toString('utf8'))
    }
    return found
  } catch (err) {
    if (!(err instanceof NeedsFullRead)) logger.debug(`Schnelles Lesen von ${archivePath} fehlgeschlagen, lese vollständig:`, err)
  } finally {
    await handle.close()
  }

  const slow = new Map<string, string>()
  for (const name of names) {
    const text = await readEntryText(archivePath, name)
    if (text !== null) slow.set(name, text)
  }
  return slow
}

/**
 * Unlike every other extraction function here, this used to hand the whole
 * job to adm-zip's own `extractAllTo`, which neither runs entries through
 * `safeJoin` nor checks a declared size before inflating it. Harmless while
 * the only caller was a JDK archive from Adoptium, but the same function
 * with the same blind spot is one copy-paste away from being pointed at
 * something less trustworthy. Entries are walked by hand instead, exactly
 * like the other extraction functions in this file already do.
 */
export function extractAll(archivePath: string, targetDir: string, overwrite = true): void {
  mkdirSync(targetDir, { recursive: true })
  const zip = new AdmZip(archivePath)
  const entries = zip.getEntries()
  assertReasonableArchive(entries, archivePath)

  for (const entry of entries) {
    const target = safeJoin(targetDir, entry.entryName)

    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true })
      continue
    }

    if (!overwrite && existsSync(target)) continue
    assertReasonableSize(entry)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.getData())
  }
}

/**
 * Unpacks an archive entry by entry, yielding between them.
 *
 * `extractAll` inflates and writes the whole thing in one blocking call, which
 * for a backup that includes world saves means the launcher stops answering
 * for as long as it takes, with no window, no progress, nothing to cancel.
 * This streams every entry instead, so the interface stays alive and the
 * caller can report how far along it is.
 */
export async function extractAllSlowly(
  archivePath: string,
  targetDir: string,
  onProgress?: (done: number, total: number) => void,
  /** Throws to abort. Lets the caller raise its own cancellation error. */
  checkCancelled?: () => void,
  /**
   * Restricts extraction to entries whose first path segment is in this set.
   * A restore only ever wants to write back the folders it parked aside
   * beforehand (see `restoreBackupUnlocked`); without this, anything else an
   * archive happens to contain lands in the game folder unasked for.
   */
  includeRoots?: ReadonlySet<string>
): Promise<number> {
  mkdirSync(targetDir, { recursive: true })
  // Streamed rather than opened with AdmZip, which reads the whole archive
  // into memory first. Node refuses that outright for files of 2 GB or more,
  // so a backup of a large world could be made but never restored, and the
  // launcher called it damaged. Smaller big archives froze the app while the
  // read ran.
  const zip = await openZipStreaming(archivePath)
  try {
    const allEntries = await readZipEntries(zip, archivePath)
    // Only the entry count is capped here. This path streams every entry to
    // disk, and the reader stops at one that inflates beyond its declared
    // size, so memory is never at stake. The size limits the in-memory paths
    // need made a backup with one file over 1 GB (a Distant Horizons
    // database, for one) impossible to restore after it had been created
    // without complaint.
    if (allEntries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(
        tr(`${archivePath} enthält mehr als ${MAX_ARCHIVE_ENTRIES} Einträge, abgelehnt.`, `${archivePath} contains more than ${MAX_ARCHIVE_ENTRIES} entries, rejected.`)
      )
    }
    const entries = includeRoots
      ? allEntries.filter((entry) => includeRoots.has(entry.fileName.split('/')[0]))
      : allEntries

    let done = 0
    let lastReport = 0
    for (const entry of entries) {
      // Asked before each entry, so a cancel takes effect within one file
      // instead of after the whole archive. Without this the button went
      // through, nothing checked it, and the run still reported success.
      checkCancelled?.()

      // The entry name comes out of the archive, so it decides where this
      // writes. `safeJoin` refuses anything that climbs out of the target.
      const target = safeJoin(targetDir, entry.fileName)

      if (entry.fileName.endsWith('/')) {
        mkdirSync(target, { recursive: true })
      } else {
        mkdirSync(dirname(target), { recursive: true })
        await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(target))
        try {
          const time = entry.getLastModDate()
          if (!Number.isNaN(time.getTime())) utimesSync(target, time, time)
        } catch {
          // Only the date is lost; the file itself is written.
        }
      }

      done++
      if (Date.now() - lastReport >= 100) {
        onProgress?.(done, entries.length)
        lastReport = Date.now()
      }
    }
    onProgress?.(done, entries.length)
    return done
  } finally {
    zip.close()
  }
}

/** Opens an archive for reading entry by entry, without loading it whole. */
function openZipStreaming(archivePath: string): Promise<ZipReader> {
  // `validateEntrySizes` makes the reader stop at an entry that inflates to
  // more than it declared, so the size checks below cannot be talked around.
  return openZipForReading(archivePath, { lazyEntries: true, autoClose: false, validateEntrySizes: true })
}

/** Every entry of an opened archive, read from its central directory only. */
function readZipEntries(zip: ZipReader, archivePath: string): Promise<ZipReadEntry[]> {
  return new Promise((resolvePromise, reject) => {
    const entries: ZipReadEntry[] = []
    const onEntry = (entry: ZipReadEntry): void => {
      entries.push(entry)
      if (entries.length > MAX_ARCHIVE_ENTRIES) {
        cleanUp()
        reject(
          new Error(
            tr(`${archivePath} enthält mehr als ${MAX_ARCHIVE_ENTRIES} Einträge, abgelehnt.`, `${archivePath} contains more than ${MAX_ARCHIVE_ENTRIES} entries, rejected.`)
          )
        )
        return
      }
      zip.readEntry()
    }
    const onEnd = (): void => {
      cleanUp()
      resolvePromise(entries)
    }
    const onError = (err: Error): void => {
      cleanUp()
      reject(err)
    }
    const cleanUp = (): void => {
      zip.off('entry', onEntry)
      zip.off('end', onEnd)
      zip.off('error', onError)
    }
    zip.on('entry', onEntry)
    zip.on('end', onEnd)
    zip.on('error', onError)
    zip.readEntry()
  })
}

/**
 * The entries of an archive, read from its directory alone. The streaming
 * counterpart of `listEntries`, for archives that can be larger than the
 * 2 GB Node reads in one piece, such as backups of big worlds.
 */
export async function listEntriesStreaming(archivePath: string): Promise<ZipEntryInfo[]> {
  const zip = await openZipStreaming(archivePath)
  try {
    const entries = await readZipEntries(zip, archivePath)
    return entries.map((entry) => ({
      name: entry.fileName,
      isDirectory: entry.fileName.endsWith('/'),
      size: entry.uncompressedSize
    }))
  } finally {
    zip.close()
  }
}

/** Extracts only entries under `prefix`, stripping the prefix from the output path. */
export function extractSubtree(archivePath: string, prefix: string, targetDir: string): number {
  const zip = new AdmZip(archivePath)
  const entries = zip.getEntries()
  assertReasonableArchive(entries, archivePath)
  const slashed = prefix.replace(/\\/g, '/')
  const normalized = slashed.endsWith('/') ? slashed : `${slashed}/`
  let count = 0

  for (const entry of entries) {
    if (entry.isDirectory) continue
    // Some zip tools on Windows write `overrides\config\x.toml`. Matched as
    // written, none of those entries started with "overrides/", and the whole
    // folder was skipped while the import preview still counted it.
    const name = entry.entryName.replace(/\\/g, '/')
    if (!name.startsWith(normalized)) continue

    const rel = name.slice(normalized.length)
    // A folder entry written with a backslash is not flagged as a folder.
    if (!rel || rel.endsWith('/')) continue

    assertReasonableSize(entry)
    // `safeJoin` rejects '..', an absolute path and a ':', while a bare
    // `rel.includes('..')` check used to be the only guard, so an entry like
    // "overrides/mods/legit.jar:hidden.exe" reached `join()` untouched and
    // wrote an NTFS alternate data stream instead of the mod jar it looked like.
    const dest = safeJoin(targetDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, entry.getData())
    count++
  }
  return count
}

/**
 * Unpacks the platform natives of a library jar. Signature files and the
 * META-INF folder are always skipped, plus whatever the version JSON excludes.
 */
export function extractNatives(jarPath: string, targetDir: string, excludes: string[] = []): void {
  if (!existsSync(jarPath)) return
  mkdirSync(targetDir, { recursive: true })

  const zip = new AdmZip(jarPath)
  const entries = zip.getEntries()
  assertReasonableArchive(entries, jarPath)
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName

    if (name.startsWith('META-INF/')) continue
    if (excludes.some((ex) => name.startsWith(ex))) continue
    // Only actual native binaries are useful in the natives folder.
    if (!/\.(dll|so|dylib|jnilib)$/i.test(name)) continue

    assertReasonableSize(entry)
    const dest = join(targetDir, basename(name))
    const data = entry.getData()
    // A second instance of the same version extracts into the folder the
    // first one's game has loaded these libraries from, and Windows refuses
    // to overwrite a library in use. The file there is the same one, so it
    // is left alone instead of failing the launch.
    try {
      if (statSync(dest).size === data.length) continue
    } catch {
      // not there yet
    }
    try {
      writeFileSync(dest, data)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if ((code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') && existsSync(dest)) continue
      throw err
    }
  }
}

export interface ZipFolderOptions {
  /** Folders (relative to `sourceDir`) to include; all when omitted. */
  include?: string[]
  exclude?: string[]
  /** Extra in-memory files written into the archive. */
  extraFiles?: { name: string; content: string | Buffer }[]
  /** Prefix inside the archive, e.g. `overrides`. */
  prefix?: string
  /**
   * Called for every file that could not be read. Without this a locked file
   * is silently missing from the archive, which turns a backup into a promise
   * the launcher cannot keep.
   */
  onSkip?: (file: string, error: unknown) => void
  /**
   * Called for every symbolic link found instead of packing it. Separate from
   * `onSkip`: an unreadable file makes the backup incomplete and worth
   * failing over, but a link was never something a restore could recreate
   * either way, so it is only worth a warning, not aborting the whole backup.
   */
  onSkipLink?: (file: string) => void
  /** Throws `TaskCancelledError` at the next file boundary once aborted. */
  signal?: AbortSignal
}

/**
 * Marks a backup archive that `zipFolder` is still streaming into.
 *
 * The write goes to a file with this suffix next to the real target and is
 * renamed on top of it only once complete, so a temp file still carrying this
 * suffix means the process died mid write. Startup sweeps those away; a
 * finished archive never has this suffix, so nothing else is ever at risk of
 * matching it.
 */
export const ZIP_TEMP_SUFFIX = '.zip-part'

function walk(dir: string, out: string[] = [], onSymlink?: (full: string) => void): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    let stats: ReturnType<typeof lstatSync>
    try {
      stats = lstatSync(full)
    } catch {
      continue
    }
    // `lstatSync` sees the link itself, not its target. A link can point
    // outside `sourceDir` (an archive entry a restore can never write back
    // to where it came from) or form a cycle that would otherwise recurse
    // forever, so it is reported and left out rather than followed.
    if (stats.isSymbolicLink()) {
      onSymlink?.(full)
      continue
    }
    if (stats.isDirectory()) walk(full, out, onSymlink)
    else out.push(full)
  }
  return out
}

/**
 * Packs a folder into a zip archive, streaming both the read and the write
 * side so that a multi-gigabyte world never has to sit fully in memory at
 * once. `adm-zip`, used everywhere else in this file, only ever offered
 * `getData()`/`toBuffer()` (whole entry, whole archive), which for a backup
 * of a large world used to inflate the entire thing into memory before
 * writing a single byte out. `yazl` streams straight from disk instead.
 */
export async function zipFolder(
  sourceDir: string,
  targetFile: string,
  options: ZipFolderOptions = {},
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  // `include` names folders relative to `sourceDir` (backups.ts passes the
  // fixed `BACKUP_TARGETS` keys, but nothing here enforced that): a plain
  // `join` let an entry with "../" segments walk out of `sourceDir` entirely
  // and pack an arbitrary, unrelated folder into the archive. `safeJoin`
  // throws for exactly that instead of silently resolving outside.
  const roots = options.include?.length
    ? options.include.map((p) => safeJoin(sourceDir, p))
    : [sourceDir]

  const files: string[] = []
  const links: string[] = []
  for (const rootDir of roots) walk(rootDir, files, (full) => links.push(full))

  for (const full of links) {
    const rel = relative(sourceDir, full).split(sep).join('/')
    logger.warn(`Verknüpfung wird nicht gesichert: ${rel}`)
    options.onSkipLink?.(rel)
  }

  const filtered = files.filter((file) => {
    const rel = relative(sourceDir, file).split(sep).join('/')
    if (options.exclude?.some((ex) => rel === ex || rel.startsWith(`${ex}/`))) return false
    return true
  })
  // The readers refuse an archive past this many entries, so writing one
  // made a backup that could be created but never restored.
  if (filtered.length + (options.extraFiles?.length ?? 0) > MAX_ARCHIVE_ENTRIES) {
    throw new Error(
      tr(
        `Das sind mehr als ${MAX_ARCHIVE_ENTRIES.toLocaleString()} Dateien, so ein Archiv ließe sich später nicht mehr entpacken. Wähle weniger Ordner aus.`,
        `That is more than ${MAX_ARCHIVE_ENTRIES.toLocaleString()} files, an archive like that could not be unpacked later. Choose fewer folders.`
      )
    )
  }

  mkdirSync(dirname(targetFile), { recursive: true })
  // Written into a temp file next to the target first, renamed onto it only
  // once the whole archive is down: a crash or a killed process mid write
  // leaves an obviously temporary file instead of a truncated archive under
  // the real backup name. `ZIP_TEMP_SUFFIX` is what the startup sweep removes.
  const tempTarget = `${targetFile}.${process.pid}.${randomUUID().slice(0, 8)}${ZIP_TEMP_SUFFIX}`

  const zip = new ZipFile()
  const out = createWriteStream(tempTarget)
  let done = 0

  const written = new Promise<void>((resolvePromise, reject) => {
    // yazl attaches no error handler to the read streams it is handed, so a
    // read failing mid file would be an unhandled error that takes the
    // whole main process down. Every stream below forwards its error here.
    zip.on('error', reject)
    out.on('error', reject)
    out.on('finish', () => resolvePromise())
  })
  zip.outputStream.pipe(out)

  for (const file of filtered) {
    if (options.signal?.aborted) break

    const rel = relative(sourceDir, file).split(sep).join('/')
    // Defensive: `walk` does not follow links, so this should be
    // unreachable, but an entry name escaping `sourceDir` is exactly what
    // `safeJoin` guards against again on the way back in during a restore.
    if (rel === '..' || rel.startsWith('../')) {
      logger.warn(`Überspringe Eintrag außerhalb des Sicherungsordners: ${rel}`)
      options.onSkip?.(rel, new Error(tr('Pfad liegt außerhalb des Sicherungsordners', 'Path is outside the backup folder')))
      continue
    }
    const entryName = options.prefix ? `${options.prefix}/${rel}` : rel

    // Probed and closed right away, so a file Minecraft still has locked
    // reaches `onSkip` here, while only one handle is ever open at a time:
    // the real read happens lazily once yazl gets to this entry.
    let size: number
    let mtime: Date
    try {
      closeSync(openSync(file, 'r'))
      const stat = statSync(file)
      size = stat.size
      mtime = stat.mtime
    } catch (err) {
      logger.warn(`Überspringe ${file}:`, err)
      options.onSkip?.(rel, err)
      continue
    }

    // Without mtime yazl stamps every entry with the backup's own time, and a
    // restore then made every world look just played and shuffled screenshots.
    zip.addReadStreamLazy(entryName, { size, mtime }, (cb) => {
      if (options.signal?.aborted) {
        zip.emit('error', new TaskCancelledError())
        return
      }
      const stream = createReadStream(file)
      stream.on('error', (err) => {
        logger.warn(`Datei beim Packen gesperrt: ${file}:`, err)
        // The open probe above passed, but a file can still fail once yazl
        // actually starts reading it (Minecraft autosaving a region file, an
        // antivirus scan taking its own lock). Yazl cannot drop a single entry
        // mid stream, so this fails the whole archive; the raw fs error is
        // never forwarded, since it carries the absolute path and the Windows
        // user name.
        zip.emit(
          'error',
          new Error(
            tr(
              `Die Datei ${rel} wurde während der Sicherung von einem anderen Programm gesperrt. Beende Minecraft oder versuche es erneut.`,
              `The file ${rel} was locked by another program during the backup. Close Minecraft or try again.`
            )
          )
        )
      })
      done++
      if (done % 25 === 0) onProgress?.(done, filtered.length)
      cb(null, stream)
    })
  }

  for (const extra of options.extraFiles ?? []) {
    zip.addBuffer(
      Buffer.isBuffer(extra.content) ? extra.content : Buffer.from(extra.content, 'utf8'),
      extra.name
    )
  }
  zip.end()

  try {
    await written
    if (options.signal?.aborted) throw new TaskCancelledError()
    renameSync(tempTarget, targetFile)
  } catch (err) {
    // Closed before removing: Windows refuses to delete a file still open.
    if (!out.closed) {
      const closed = new Promise((r) => out.once('close', r))
      out.destroy()
      await closed
    }
    try {
      rmSync(tempTarget, { force: true })
    } catch {
      // best effort; the startup sweep catches it otherwise
    }
    throw err
  }

  onProgress?.(filtered.length, filtered.length)
  return filtered.length
}

/**
 * Recreates a tar link entry.
 *
 * Symlink ('2') and hardlink ('1') headers carry their target in the header's
 * `linkname` field and have no data body, so the generic write-a-file branch
 * turned them into empty files. JDK archives link shared files under `legal/`
 * this way, which silently lost their contents.
 */
function extractLink(type: string, link: string, dest: string, targetDir: string): void {
  if (!link || existsSync(dest)) return
  // A backslash or ':' in the target is either a drive letter / NTFS
  // alternate data stream marker or, on Windows, an extra path separator the
  // containment check below never expected. No real JDK archive link target
  // needs either, and a missing legal notice is not worth failing the whole
  // extraction over, so the link is skipped rather than trusted.
  if (link.includes('\\') || link.includes(':')) return
  mkdirSync(dirname(dest), { recursive: true })

  // A symlink target is relative to the entry's own folder, a hardlink target
  // to the archive root. Either way it must stay inside the extraction folder.
  const base = type === '2' ? dirname(dest) : targetDir
  const resolvedRoot = resolve(targetDir)
  const resolvedLink = resolve(base, link)
  // `resolve()` already puts a trailing separator on a drive root ("C:\") but
  // never on anything deeper, so appending one unconditionally doubled it
  // whenever `targetDir` was a drive root and rejected every link underneath.
  // Same fix as `safeJoin` in paths.ts.
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  if (resolvedLink !== resolvedRoot && !resolvedLink.startsWith(rootWithSep)) return

  try {
    if (type === '2') symlinkSync(link, dest)
    else linkSync(resolvedLink, dest)
  } catch {
    // Windows needs a privilege for symlinks, and a target can appear later in
    // the archive than the link to it. A copy keeps the content either way.
    try {
      if (existsSync(resolvedLink)) copyFileSync(resolvedLink, dest)
    } catch {
      // A missing legal notice is not worth failing the whole extraction.
    }
  }
}

/** Extracts a tar.gz archive (used by the Linux/macOS Java runtimes). */
export async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  const { createGunzip } = await import('node:zlib')
  const { createReadStream } = await import('node:fs')
  const { pipeline } = await import('node:stream/promises')
  const { Writable } = await import('node:stream')

  mkdirSync(targetDir, { recursive: true })

  // Minimal tar reader: enough for the Adoptium archives, which only contain
  // regular files, directories and the occasional long-name header.
  let buffer = Buffer.alloc(0)
  let pendingHeader: { path: string; size: number; type: string; link: string } | null = null
  let remaining = 0
  // Padding is tracked separately from `remaining` rather than folded into it.
  // A file's data can finish exactly at a stream chunk boundary, before any of
  // its 0-511 padding bytes have arrived yet; folding padding into `remaining`
  // meant that case hit `break` with `remaining` already at 0, so the next
  // write() skipped straight to header parsing on the still-unstripped
  // padding — corrupting every entry after it for the rest of the archive.
  let paddingRemaining = 0
  let sink: Buffer[] = []
  let longName: string | null = null
  // Counted as headers are parsed, since a tar stream carries no upfront
  // index the way a zip's central directory does; the same limit as the zip
  // functions below, checked as early as the format allows.
  let entryCount = 0
  // Declared sizes add up across entries the same way the zip archives are
  // checked in `assertReasonableArchive`, so a tar with many individually
  // reasonable entries cannot still add up to an absurd total.
  let totalSize = 0

  const flushFile = (): void => {
    if (!pendingHeader) return
    const name = longName ?? pendingHeader.path
    longName = null
    // A literal backslash or ':' in the entry name is either an NTFS
    // alternate data stream in disguise ("legit.jar:hidden.exe") or, since
    // `join` treats a backslash as its own path separator on Windows, a
    // traversal the '..'-segment filter below never sees because it is never
    // split out into a segment of its own.
    if (name.includes('\\') || name.includes(':')) {
      throw new Error(tr(`Ungültiger Pfad im Archiv: "${name}"`, `Invalid path in archive: "${name}"`))
    }
    const dest = join(targetDir, ...name.split('/').filter((p) => p && p !== '..'))

    if (pendingHeader.type === '5') {
      mkdirSync(dest, { recursive: true })
    } else if (pendingHeader.type === 'L') {
      longName = Buffer.concat(sink).toString('utf8').replace(/\0+$/, '')
    } else if (pendingHeader.type === '1' || pendingHeader.type === '2') {
      extractLink(pendingHeader.type, pendingHeader.link, dest, targetDir)
    } else {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, Buffer.concat(sink))
    }
    sink = []
    pendingHeader = null
  }

  const consumer = new Writable({
    write(chunk: Buffer, _enc, callback) {
      // Wrapped so a thrown limit or path check below reaches `pipeline()` as
      // a normal rejection instead of an uncaught exception from inside a
      // stream callback.
      try {
        buffer = Buffer.concat([buffer, chunk])

        for (;;) {
          if (remaining > 0) {
            const take = Math.min(remaining, buffer.length)
            if (take === 0) break
            sink.push(buffer.subarray(0, take))
            buffer = buffer.subarray(take)
            remaining -= take
            if (remaining === 0) {
              // The content is fully buffered now, so the file is written
              // immediately rather than waiting for its padding to arrive too,
              // padding is only bytes to skip, not part of the file.
              const size = pendingHeader?.size ?? 0
              flushFile()
              paddingRemaining = (512 - (size % 512)) % 512
            }
            continue
          }

          if (paddingRemaining > 0) {
            const skip = Math.min(paddingRemaining, buffer.length)
            if (skip === 0) break
            buffer = buffer.subarray(skip)
            paddingRemaining -= skip
            continue
          }

          if (buffer.length < 512) break
          const header = buffer.subarray(0, 512)
          buffer = buffer.subarray(512)

          const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
          if (!name) continue

          const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
          const size = parseInt(sizeField, 8) || 0
          const type = String.fromCharCode(header[156]) || '0'
          // `linkname`, only populated for link entries.
          const link = header.subarray(157, 257).toString('utf8').replace(/\0.*$/, '')
          const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')

          entryCount++
          if (entryCount > MAX_ARCHIVE_ENTRIES) {
            throw new Error(
              tr(`${archivePath} enthält mehr als ${MAX_ARCHIVE_ENTRIES} Einträge, abgelehnt.`, `${archivePath} contains more than ${MAX_ARCHIVE_ENTRIES} entries, rejected.`)
            )
          }

          const fullPath = prefix ? `${prefix}/${name}` : name
          // Checked as early as a tar header alone allows, the same limits the
          // zip extraction paths enforce via `assertReasonableSize` /
          // `assertReasonableArchive` before this used to inflate a declared
          // size straight into memory with nothing looking at it first.
          if (size > MAX_ENTRY_SIZE) {
            throw new Error(
              tr(
                `${fullPath} entpackt auf mehr als ${Math.round(MAX_ENTRY_SIZE / 1024 / 1024)} MB, abgelehnt.`,
                `${fullPath} unpacks to more than ${Math.round(MAX_ENTRY_SIZE / 1024 / 1024)} MB, rejected.`
              )
            )
          }
          totalSize += size
          if (totalSize > MAX_ARCHIVE_TOTAL_SIZE) {
            throw new Error(
              tr(
                `${archivePath} entpackt auf insgesamt mehr als ${Math.round(MAX_ARCHIVE_TOTAL_SIZE / 1024 / 1024 / 1024)} GB, abgelehnt.`,
                `${archivePath} unpacks to more than ${Math.round(MAX_ARCHIVE_TOTAL_SIZE / 1024 / 1024 / 1024)} GB in total, rejected.`
              )
            )
          }

          pendingHeader = { path: fullPath, size, type, link }
          remaining = size

          if (size === 0) flushFile()
        }
        callback()
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })

  await pipeline(createReadStream(archivePath), createGunzip(), consumer)
}
