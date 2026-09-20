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
  /** Alternative sources, tried in order once `url` is exhausted. */
  mirrors?: string[]
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
      /** Mojang's own APIs answer with this key instead of `message`. */
      errorMessage?: string
      /** Modrinth's own error shape: `error` is a short code, this carries the text. */
      description?: string
      error?: string | { message?: string }
    }
    const detail =
      parsed.error_description ??
      parsed.message ??
      parsed.errorMessage ??
      parsed.description ??
      (typeof parsed.error === 'object' ? parsed.error?.message : undefined)
    if (detail) return `HTTP ${status}: ${detail}`
  } catch {
    // not a JSON error body
  }
  return `HTTP ${status} für ${url}`
}

/** Only the plain seconds form of `Retry-After`; the HTTP-date form is rare enough here not to bother with. */
function retryAfterSecondsOf(res: Response): number | undefined {
  const header = res.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

export class HttpError extends Error {
  /** Machine readable code, e.g. `authorization_pending`. */
  readonly code?: string

  constructor(
    readonly status: number,
    readonly url: string,
    /** Raw response body, kept so callers can react to API specific codes. */
    readonly body = '',
    /** Seconds the server asked us to wait, from a `Retry-After` header. */
    readonly retryAfterSeconds?: number
  ) {
    super(errorMessageOf(status, url, body))
    this.name = 'HttpError'
    this.code = errorCodeOf(body)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * How long to wait before the next attempt.
 *
 * A 429 used to always get the same exponential backoff as any other retry,
 * ignoring the wait time the server itself asked for in `Retry-After`. Both
 * Modrinth and CurseForge send that header on rate limiting, so guessing
 * instead of reading it meant giving up after a fixed ~2.8 seconds even when
 * the server would have accepted the next request one second later.
 */
function retryDelayMs(err: unknown, attempt: number): number {
  if (err instanceof HttpError && err.retryAfterSeconds !== undefined) {
    // Capped: a server-provided wait time is meant to be respected, not
    // followed off a cliff by a value some proxy sent by mistake.
    return Math.min(err.retryAfterSeconds * 1000, 30_000)
  }
  return 400 * 2 ** attempt
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
 * True for a loopback, private or link-local address, by literal IP only.
 *
 * This does not resolve hostnames, so a domain whose DNS record happens to
 * point at one of these ranges slips through; closing that fully would mean
 * resolving the name ourselves and connecting to the checked address
 * directly, a larger change than this one warrants. What this does stop is
 * the concrete, verified case: a download or a redirect target naming one of
 * these addresses directly, which is what a manipulated Location header or a
 * mod's own declared download URL would realistically contain.
 */
function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost') return true

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    return false
  }

  if (host === '::1' || host === '::') return true
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true

  return false
}

/**
 * `fetch` with `redirect: 'follow'` (the default) hands back only the final
 * response, with no way to see or reject an intermediate hop. A download or
 * API URL that redirects to a private address used to be followed without
 * question, turning a mod's own declared download URL into a way to make the
 * launcher issue a request to the user's own network. Each hop is checked
 * here before it is followed, capped well above anything a real redirect
 * chain needs.
 */
async function fetchFollowingSafeRedirects(url: string, init: RequestInit): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= 5; hop++) {
    const parsed = new URL(current)
    if (isPrivateAddress(parsed.hostname)) {
      throw new Error(`Adresse "${parsed.hostname}" ist eine lokale/interne Adresse und wird abgelehnt.`)
    }

    const res = await fetch(current, { ...init, redirect: 'manual' })
    const isRedirect = res.status >= 300 && res.status < 400
    const location = res.headers.get('location')
    if (!isRedirect || !location) return res

    current = new URL(location, current).toString()
  }
  throw new Error(`Zu viele Umleitungen für ${url}.`)
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

      const res = await fetchFollowingSafeRedirects(url, {
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
        throw new HttpError(res.status, url, body, retryAfterSecondsOf(res))
      }
      return res
    } catch (err) {
      // A cancel must never be retried or reported as a network fault.
      if (external?.aborted) throw new TaskCancelledError()
      lastError = err
      if (!isRetryable(err) || attempt === retries) break
      // Exponential backoff keeps us friendly to the APIs we depend on,
      // unless the server itself already told us exactly how long to wait.
      await sleep(retryDelayMs(err, attempt))
    }
  }
  throw lastError
}

/**
 * Reads the body inside the retry loop rather than after it.
 *
 * `httpRequest` returns as soon as the headers arrive, but the timeout signal
 * stays attached to the stream. On a slow connection a large body could
 * therefore be aborted while it was still arriving — outside the retry loop,
 * so there was exactly one attempt and the caller saw a bare AbortError. This
 * is the very first network step of a cold start, where a slow line is most
 * likely.
 */
export async function fetchJson<T>(url: string, init?: RequestInit, retries = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await httpRequest(url, init, 0)
      return (await res.json()) as T
    } catch (err) {
      lastError = err
      if (!isRetryable(err) || attempt === retries) break
      await sleep(retryDelayMs(err, attempt))
    }
  }
  throw lastError
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

  let data: T
  try {
    data = await fetchJson<T>(url)
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

  // Separated from the fetch above on purpose: a disk error writing the
  // cache (a full disk, a permissions problem) used to fall into the same
  // catch block and hand back the old cached copy instead, discarding data
  // that had just arrived successfully over the network.
  try {
    mkdirSync(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), data } satisfies CacheEnvelope<T>))
  } catch (err) {
    logger.warn(`Cache für ${cacheKey} konnte nicht geschrieben werden:`, err)
  }
  return data
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
    const res = await fetchFollowingSafeRedirects(item.url, {
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
    } else if (item.size === undefined) {
      // Neither hash nor expected size: loader libraries resolved through a
      // bare `library.url` arrive that way. Previously nothing was verified at
      // all, so a connection dropped mid-transfer was written out as if
      // complete — and `isSatisfied` then treats any non-empty file as done,
      // making the damage permanent. It only ever surfaces much later as a
      // NoClassDefFoundError at launch. The server's own Content-Length is the
      // one signal left, so use it when it is there.
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > 0 && attemptBytes !== declared) {
        throw new Error(
          `Unvollständiger Download von ${item.url} (${attemptBytes} statt ${declared} Bytes)`
        )
      }
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
  // The failure of whoever held the slot while we waited. Under contention
  // this call may never get a turn of its own, and that other writer's error
  // is then the real reason nothing landed on disk.
  let waitedError: unknown

  // Bounded because every round either claims the slot and downloads, or waits
  // for a write to this path that is genuinely in flight.
  for (let round = 0; round < 8; round++) {
    if (await isSatisfied(item)) {
      // Someone else's write satisfied us. The caller's batch counted this
      // file's bytes in its total, so without this credit its progress bar
      // stalls short of 100% for every shared library or asset.
      if (round > 0 && item.size !== undefined) onBytes?.(item.size)
      return
    }

    // Read and claim in one synchronous step, so two callers that both saw an
    // empty slot cannot both start writing the same destination.
    const running = inFlight.get(item.path)

    if (!running) {
      const run = async (): Promise<void> => {
        // The primary source first, then any mirrors. Modpack manifests list
        // several precisely so a yanked or 404'd CDN link does not sink the
        // file when a working copy is named right next to it.
        const sources = [item.url, ...(item.mirrors ?? [])]
        let lastError: unknown

        for (const [index, url] of sources.entries()) {
          if (index > 0) logger.warn(`Weiche auf Spiegel aus für ${item.path}: ${url}`)

          for (let attempt = 0; attempt <= retries; attempt++) {
            if (signal?.aborted) throw new TaskCancelledError()
            try {
              await fetchToFile({ ...item, url }, onBytes, signal)
              return
            } catch (err) {
              if (signal?.aborted) throw new TaskCancelledError()
              lastError = err
              if (!isRetryable(err) || attempt === retries) break
              await sleep(400 * 2 ** attempt)
            }
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

    if (signal?.aborted) throw new TaskCancelledError()

    // Wait for the other writer rather than racing it for the same path — but
    // do not adopt its result. The slot is keyed by destination alone, so it
    // may have been fetching different bytes for the same file name; only our
    // own hash and size decide whether what landed there is what we asked for.
    await running.catch((err: unknown) => {
      waitedError = err
    })
  }

  // Prefer the concrete failure over "you never got a turn": a 404, a blocked
  // host or a checksum mismatch tells the user what to do, the bound alone
  // tells them nothing.
  if (waitedError !== undefined) throw waitedError
  throw new Error(`Download für ${item.path} kam nicht zum Zug`)
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
  /**
   * Decides what a single failed file means for the batch. The default is
   * `fail`, which is right for a game install where a missing library breaks
   * everything. A modpack is the opposite case: one mod its author forbade
   * third-party downloads for should not throw away the other three hundred.
   */
  onError?: (item: DownloadItem, err: unknown) => 'skip' | 'fail'
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
  const { task, label = 'Lade Dateien', onFile, onError } = options
  // `Math.max(1, NaN)` is NaN, and a NaN worker count builds an empty pool:
  // the batch resolved immediately, reporting every download as done without a
  // single byte transferred.
  const wanted = options.concurrency ?? getSettings().concurrentDownloads
  const concurrency = Number.isFinite(wanted) ? Math.max(1, wanted) : 8

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

      try {
        await downloadFile(
          item,
          (delta) => {
            doneBytes += delta
            report()
          },
          3,
          task?.signal
        )
      } catch (err) {
        // A cancellation is never a per-file decision.
        if (err instanceof TaskCancelledError || task?.cancelled) throw err
        if (onError?.(item, err) !== 'skip') throw err
        // Credit the skipped size so the bar still reaches the end.
        if (item.size !== undefined) doneBytes += item.size
      }

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
