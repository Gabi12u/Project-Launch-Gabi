import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { paths } from '../paths'
import { getSettings } from '../store'
import { log } from '../logger'
import { TaskCancelledError, type Task } from '../tasks'

const logger = log('net')

const USER_AGENT = 'LaunchGabi/1.0.0 (Minecraft launcher; +https://launchgabi.gg)'

export interface DownloadItem {
  url: string
  /** Absolute destination path. */
  path: string
  sha1?: string
  size?: number
  /** Skip the download when the file already exists, even without a hash. */
  trustExisting?: boolean
}

/** Extracts the machine readable code most APIs put in an error body. */
function errorCodeOf(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: string | { code?: string } }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.error?.code
  } catch {
    return undefined
  }
}

function errorMessageOf(status: number, url: string, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error_description?: string
      message?: string
      error?: string | { message?: string }
    }
    const detail =
      parsed.error_description ??
      parsed.message ??
      (typeof parsed.error === 'object' ? parsed.error?.message : undefined)
    if (detail) return `HTTP ${status}: ${detail}`
  } catch {
    // not a JSON error body
  }
  return `HTTP ${status} für ${url}`
}

export class HttpError extends Error {
  /** Machine readable code, e.g. `authorization_pending`. */
  readonly code?: string

  constructor(
    readonly status: number,
    readonly url: string,
    /** Raw response body, kept so callers can react to API specific codes. */
    readonly body = ''
  ) {
    super(errorMessageOf(status, url, body))
    this.name = 'HttpError'
    this.code = errorCodeOf(body)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A 4xx other than 408/429 will never succeed on retry. */
function isRetryable(err: unknown): boolean {
  if (err instanceof TaskCancelledError) return false
  if (err instanceof HttpError) {
    return err.status >= 500 || err.status === 408 || err.status === 429
  }
  return true
}

/**
 * `httpRequest` covers the whole call including the body, which is what the
 * JSON and text helpers want. Streaming downloads need different handling and
 * manage their own request in `downloadFile`.
 */
export async function httpRequest(
  url: string,
  init: RequestInit = {},
  retries = 3
): Promise<Response> {
  const external = init.signal ?? undefined
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (external?.aborted) throw new TaskCancelledError()
    try {
      // `AbortSignal.any` cleans itself up, so this adds no listener that has
      // to be removed by hand.
      const signal = external
        ? AbortSignal.any([external, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000)

      const res = await fetch(url, {
        ...init,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          ...(init.headers as Record<string, string> | undefined)
        }
      })
      if (!res.ok) {
        // The body carries the reason; without it every failure looks alike.
        let body = ''
        try {
          body = await res.text()
        } catch {
          // some errors have no readable body
        }
        throw new HttpError(res.status, url, body)
      }
      return res
    } catch (err) {
      // A cancel must never be retried or reported as a network fault.
      if (external?.aborted) throw new TaskCancelledError()
      lastError = err
      if (!isRetryable(err) || attempt === retries) break
      // Exponential backoff keeps us friendly to the APIs we depend on.
      await sleep(400 * 2 ** attempt)
    }
  }
  throw lastError
}

export async function fetchJson<T>(url: string, init?: RequestInit, retries = 3): Promise<T> {
  const res = await httpRequest(url, init, retries)
  return (await res.json()) as T
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await httpRequest(url, init)
  return await res.text()
}

/* ------------------------------------------------------------------ *
 * Metadata cache
 * ------------------------------------------------------------------ */

interface CacheEnvelope<T> {
  fetchedAt: number
  data: T
}

/**
 * Caches JSON responses on disk. Manifests change rarely, and a cached copy
 * also means the launcher still works offline.
 */
export async function fetchJsonCached<T>(
  url: string,
  cacheKey: string,
  maxAgeMs: number
): Promise<T> {
  const file = join(paths.meta(), `${cacheKey}.json`)
  try {
    const raw = await readFile(file, 'utf8')
    const cached = JSON.parse(raw) as CacheEnvelope<T>
    if (Date.now() - cached.fetchedAt < maxAgeMs) return cached.data
  } catch {
    // no usable cache
  }

  try {
    const data = await fetchJson<T>(url)
    mkdirSync(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), data } satisfies CacheEnvelope<T>))
    return data
  } catch (err) {
    // Stale data beats no data when the network is down.
    try {
      const raw = await readFile(file, 'utf8')
      logger.warn(`Nutze veralteten Cache für ${cacheKey}:`, err)
      return (JSON.parse(raw) as CacheEnvelope<T>).data
    } catch {
      throw err
    }
  }
}

/* ------------------------------------------------------------------ *
 * File downloads
 * ------------------------------------------------------------------ */

export function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1')
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** True when the file on disk already matches the expected hash/size. */
export async function isSatisfied(item: DownloadItem): Promise<boolean> {
  if (!existsSync(item.path)) return false
  try {
    if (item.sha1) return (await sha1File(item.path)) === item.sha1.toLowerCase()
    if (item.size !== undefined) return statSync(item.path).size === item.size
    // With neither hash nor size an empty file is the one corruption we can
    // still recognise, and it is the usual result of an interrupted write.
    if (statSync(item.path).size === 0) return false
    return item.trustExisting !== false
  } catch {
    return false
  }
}

/**
 * Destination path -> in-flight download. Two instances installing the same
 * shared library or asset must not write the same file at the same time, so
 * the second caller waits on the first instead of racing it.
 */
const inFlight = new Map<string, Promise<void>>()

/** One attempt: fetch, hash, verify, then atomically move into place. */
async function fetchToFile(
  item: DownloadItem,
  onBytes: ((delta: number) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  const controller = new AbortController()
  const relay = (): void => controller.abort()
  signal?.addEventListener('abort', relay, { once: true })

  // Unique per attempt. A shared `<file>.part` lets two writers interleave into
  // one file, and on Windows makes the rename fail with EPERM.
  const tmp = `${item.path}.${process.pid}.${randomUUID().slice(0, 8)}.part`

  let watchdog: NodeJS.Timeout | undefined
  let attemptBytes = 0

  // Inactivity timeout rather than a total one: a slow but live transfer is
  // allowed to finish, a stalled socket is not allowed to hang forever.
  const arm = (): void => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => controller.abort(), 60_000)
  }

  try {
    arm()
    const res = await fetch(item.url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) {
      let body = ''
      try {
        body = await res.text()
      } catch {
        // some errors have no readable body
      }
      throw new HttpError(res.status, item.url, body)
    }
    if (!res.body) throw new Error(`Leere Antwort für ${item.url}`)

    const hash = createHash('sha1')
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      arm()
      hash.update(chunk)
      attemptBytes += chunk.length
      onBytes?.(chunk.length)
    })

    mkdirSync(dirname(item.path), { recursive: true })
    await pipeline(source, createWriteStream(tmp))

    if (item.sha1) {
      const actual = hash.digest('hex')
      if (actual !== item.sha1.toLowerCase()) {
        throw new Error(`Prüfsumme falsch für ${item.url} (erwartet ${item.sha1}, erhalten ${actual})`)
      }
    } else if (item.size !== undefined && attemptBytes !== item.size) {
      // Without a hash the length is the only integrity signal available.
      throw new Error(
        `Unvollständiger Download von ${item.url} (${attemptBytes} statt ${item.size} Bytes)`
      )
    }

    renameSync(tmp, item.path)
  } catch (err) {
    // Hand back what this attempt already reported, so a retry cannot drive
    // the progress bar past 100%.
    if (attemptBytes > 0) onBytes?.(-attemptBytes)
    throw err
  } finally {
    clearTimeout(watchdog)
    signal?.removeEventListener('abort', relay)
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // a leftover temp file is harmless
    }
  }
}

export async function downloadFile(
  item: DownloadItem,
  onBytes?: (delta: number) => void,
  retries = 3,
  signal?: AbortSignal
): Promise<void> {
  if (await isSatisfied(item)) return

  const running = inFlight.get(item.path)
  if (running) return running

  const run = async (): Promise<void> => {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw new TaskCancelledError()
      try {
        await fetchToFile(item, onBytes, signal)
        return
      } catch (err) {
        if (signal?.aborted) throw new TaskCancelledError()
        lastError = err
        if (!isRetryable(err) || attempt === retries) break
        await sleep(400 * 2 ** attempt)
      }
    }
    throw lastError
  }

  const promise = run().finally(() => {
    inFlight.delete(item.path)
  })
  inFlight.set(item.path, promise)
  return promise
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export interface DownloadAllOptions {
  task?: Task
  label?: string
  concurrency?: number
  /** Called after every completed file. */
  onFile?: (item: DownloadItem, index: number, total: number) => void
}

/**
 * Downloads a batch in parallel. Progress is reported by bytes when sizes are
 * known and by file count otherwise, so both asset packs (many tiny files with
 * sizes) and loader jars (few files, no sizes) get a sensible bar.
 */
export async function downloadAll(
  items: DownloadItem[],
  options: DownloadAllOptions = {}
): Promise<void> {
  const { task, label = 'Lade Dateien', onFile } = options
  const concurrency = Math.max(1, options.concurrency ?? getSettings().concurrentDownloads)

  // Asset indexes map several names onto one hash, so the same destination can
  // appear more than once in a batch. Two workers writing one path is exactly
  // the race `inFlight` guards against; dropping the duplicate is cheaper.
  const unique: DownloadItem[] = []
  const byPath = new Set<string>()
  for (const item of items) {
    if (byPath.has(item.path)) continue
    byPath.add(item.path)
    unique.push(item)
  }

  // Filter out everything already present so the progress bar reflects real
  // work. Verification hashes thousands of asset files, so it runs in parallel.
  const pending: DownloadItem[] = []
  const checkConcurrency = Math.max(concurrency, 8)
  for (let offset = 0; offset < unique.length; offset += checkConcurrency) {
    task?.throwIfCancelled()
    const slice = unique.slice(offset, offset + checkConcurrency)
    const satisfied = await Promise.all(slice.map((item) => isSatisfied(item)))
    slice.forEach((item, index) => {
      if (!satisfied[index]) pending.push(item)
    })
  }

  if (pending.length === 0) {
    task?.update(`${label}: nichts zu tun`, 1)
    return
  }

  const totalBytes = pending.reduce((sum, i) => sum + (i.size ?? 0), 0)
  const haveSizes = pending.every((i) => i.size !== undefined) && totalBytes > 0

  let doneBytes = 0
  let doneFiles = 0
  let lastReport = 0

  const report = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastReport < 120) return
    lastReport = now
    if (haveSizes) {
      task?.update(
        `${label} · ${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`,
        doneBytes / totalBytes
      )
    } else {
      task?.update(`${label} · ${doneFiles} / ${pending.length}`, doneFiles / pending.length)
    }
  }

  report(true)

  let cursor = 0
  let failure: unknown

  // Fail fast: one broken file usually means the whole install is broken. The
  // flag stops the other workers from picking up new files, and the task's
  // signal tears down the transfers they already have open.
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      if (failure !== undefined) return
      if (task?.cancelled) throw new TaskCancelledError()
      const index = cursor++
      const item = pending[index]
      await downloadFile(
        item,
        (delta) => {
          doneBytes += delta
          report()
        },
        3,
        task?.signal
      )
      doneFiles++
      onFile?.(item, doneFiles, pending.length)
      report()
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () =>
    worker().catch((err: unknown) => {
      failure ??= err
    })
  )

  // `allSettled` semantics on purpose: returning while workers are still
  // writing files would let them mutate a task the caller already failed.
  await Promise.all(workers)

  if (failure !== undefined) throw failure
  report(true)
}
