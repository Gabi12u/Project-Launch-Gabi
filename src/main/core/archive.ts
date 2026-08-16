import AdmZip from 'adm-zip'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { log } from '../logger'

const logger = log('archive')

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
    return entry ? zip.readAsText(entry) : null
  } catch (err) {
    logger.warn(`Konnte ${entryName} aus ${archivePath} nicht lesen:`, err)
    return null
  }
}

export async function readEntryJson<T>(archivePath: string, entryName: string): Promise<T | null> {
  const text = await readEntryText(archivePath, entryName)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export function extractAll(archivePath: string, targetDir: string, overwrite = true): void {
  mkdirSync(targetDir, { recursive: true })
  new AdmZip(archivePath).extractAllTo(targetDir, overwrite)
}

/** Extracts only entries under `prefix`, stripping the prefix from the output path. */
export function extractSubtree(archivePath: string, prefix: string, targetDir: string): number {
  const zip = new AdmZip(archivePath)
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`
  let count = 0

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!entry.entryName.startsWith(normalized)) continue

    const rel = entry.entryName.slice(normalized.length)
    if (!rel || rel.includes('..')) continue

    const dest = join(targetDir, ...rel.split('/'))
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
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = entry.entryName

    if (name.startsWith('META-INF/')) continue
    if (excludes.some((ex) => name.startsWith(ex))) continue
    // Only actual native binaries are useful in the natives folder.
    if (!/\.(dll|so|dylib|jnilib)$/i.test(name)) continue

    const dest = join(targetDir, basename(name))
    writeFileSync(dest, entry.getData())
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
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export async function zipFolder(
  sourceDir: string,
  targetFile: string,
  options: ZipFolderOptions = {},
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const zip = new AdmZip()

  const roots = options.include?.length
    ? options.include.map((p) => join(sourceDir, p))
    : [sourceDir]

  const files: string[] = []
  for (const rootDir of roots) files.push(...walk(rootDir))

  const filtered = files.filter((file) => {
    const rel = relative(sourceDir, file).split(sep).join('/')
    if (options.exclude?.some((ex) => rel === ex || rel.startsWith(`${ex}/`))) return false
    return true
  })

  let done = 0
  for (const file of filtered) {
    const rel = relative(sourceDir, file).split(sep).join('/')
    const entryName = options.prefix ? `${options.prefix}/${rel}` : rel
    try {
      zip.addFile(entryName, await readFile(file))
    } catch (err) {
      logger.warn(`Überspringe ${file}:`, err)
      options.onSkip?.(rel, err)
    }
    done++
    if (done % 25 === 0) onProgress?.(done, filtered.length)
  }

  for (const extra of options.extraFiles ?? []) {
    zip.addFile(extra.name, Buffer.isBuffer(extra.content) ? extra.content : Buffer.from(extra.content, 'utf8'))
  }

  onProgress?.(filtered.length, filtered.length)

  mkdirSync(dirname(targetFile), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    zip.toBuffer(
      (buffer) => {
        const stream = createWriteStream(targetFile)
        stream.on('error', reject)
        stream.on('finish', () => resolve())
        stream.end(buffer)
      },
      (err) => reject(err)
    )
  })

  return filtered.length
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
  let pendingHeader: { path: string; size: number; type: string } | null = null
  let remaining = 0
  let sink: number[] = []
  let longName: string | null = null

  const flushFile = (): void => {
    if (!pendingHeader) return
    const name = longName ?? pendingHeader.path
    longName = null
    const dest = join(targetDir, ...name.split('/').filter((p) => p && p !== '..'))

    if (pendingHeader.type === '5') {
      mkdirSync(dest, { recursive: true })
    } else if (pendingHeader.type === 'L') {
      longName = Buffer.from(sink).toString('utf8').replace(/\0+$/, '')
    } else {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, Buffer.from(sink))
    }
    sink = []
    pendingHeader = null
  }

  const consumer = new Writable({
    write(chunk: Buffer, _enc, callback) {
      buffer = Buffer.concat([buffer, chunk])

      for (;;) {
        if (remaining > 0) {
          const take = Math.min(remaining, buffer.length)
          if (take === 0) break
          for (let i = 0; i < take; i++) sink.push(buffer[i])
          buffer = buffer.subarray(take)
          remaining -= take
          if (remaining === 0) {
            const padding = (512 - (sink.length % 512)) % 512
            if (buffer.length < padding) break
            buffer = buffer.subarray(padding)
            flushFile()
          }
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
        const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')

        pendingHeader = { path: prefix ? `${prefix}/${name}` : name, size, type }
        remaining = size

        if (size === 0) flushFile()
      }
      callback()
    }
  })

  await pipeline(createReadStream(archivePath), createGunzip(), consumer)
}
