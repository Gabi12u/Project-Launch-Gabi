import { desktopCapturer, globalShortcut } from 'electron'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  type WriteStream
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { EVENTS } from '@shared/ipc'
import type { RecordingQuality, RecordingState } from '@shared/types'
import type { RecordingRequest } from '@shared/api'
import { paths } from '../paths'
import { getSettings } from '../store'
import { emit, getMainWindow, notify } from '../events'
import { log } from '../logger'
import { listAdopted, listRunning, onRunningChanged } from './running'

const logger = log('recording')

/**
 * Video bitrates behind the three quality settings.
 *
 * Deliberately modest at the low end: someone recording a long session on a
 * laptop cares more about the file fitting than about the sharpest possible
 * grass texture.
 */
const BITRATE: Record<RecordingQuality, number> = {
  low: 2_500_000,
  medium: 6_000_000,
  high: 12_000_000
}

interface Session {
  instanceId: string
  startedAt: number
  file: string
  base: string
  stream: WriteStream
  bytes: number
  /** Fires if the renderer never reports a finish, see `GRACE_MS`. */
  guard: NodeJS.Timeout | null
  /** Set once a stop has been asked for, so a second press does nothing. */
  stopping: boolean
}

let session: Session | null = null

/**
 * How long the main process waits past the agreed maximum before it gives up.
 *
 * The renderer owns the actual timer, but a renderer that crashed or was
 * reloaded mid-recording would leave the file handle open and the indicator on
 * forever. This is the backstop, not the normal path.
 */
const GRACE_MS = 30_000

/** Hotkey currently handed to the OS, so it can be released again. */
let registered: string | null = null

export function getRecordingState(): RecordingState {
  return {
    active: session !== null,
    instanceId: session?.instanceId ?? null,
    startedAt: session?.startedAt ?? null,
    bytes: session?.bytes ?? 0
  }
}

function publish(): void {
  emit(EVENTS.recordingState, getRecordingState())
}

/* ------------------------------------------------------------------ *
 * Hotkey
 * ------------------------------------------------------------------ */

/**
 * Holds the hotkey only while a game is actually up.
 *
 * A global shortcut is taken from every other application on the machine for
 * as long as it is registered, so claiming F9 permanently would be rude: the
 * launcher spends most of its life sitting in the background doing nothing.
 * Registering on launch and releasing on exit keeps the key free the rest of
 * the time.
 */
/**
 * Instance ids with a game up, whoever started it.
 *
 * Adopted games count. The launcher can be restarted while Minecraft keeps
 * playing, and refusing to record then would be a dead spot with no reason a
 * user could see: the game is right there on screen.
 */
function playing(): string[] {
  return [...listRunning().map((game) => game.instanceId), ...listAdopted().map((game) => game.instanceId)]
}

export function syncRecordingHotkey(): void {
  const settings = getSettings()
  const wanted =
    settings.recordingEnabled && playing().length > 0 ? settings.recordingHotkey.trim() : null

  if (registered === wanted) return

  if (registered) {
    globalShortcut.unregister(registered)
    logger.debug(`Aufnahmetaste ${registered} freigegeben`)
    registered = null
  }
  if (!wanted) return

  try {
    const ok = globalShortcut.register(wanted, () => void toggleRecording())
    if (!ok) {
      // Another application already holds it. Nothing is broken, but the key
      // will do nothing, and silence here would look like the feature failing.
      logger.warn(`Aufnahmetaste ${wanted} ist bereits von einem anderen Programm belegt`)
      notify(
        'warning',
        'Aufnahmetaste belegt',
        `${wanted} wird bereits von einem anderen Programm verwendet. Wähle in den Einstellungen eine andere Taste.`,
        { route: '/settings?section=recording' }
      )
      return
    }
    registered = wanted
    logger.info(`Aufnahmetaste ${wanted} aktiv`)
  } catch (err) {
    // `register` throws on an accelerator Electron cannot parse, which a
    // hand-edited settings file can easily contain.
    logger.warn(`Aufnahmetaste ${wanted} konnte nicht belegt werden:`, err)
  }
}

/* ------------------------------------------------------------------ *
 * Start / stop
 * ------------------------------------------------------------------ */

/** Picks what to capture: the game's own window if we can find it. */
async function pickSource(): Promise<{ id: string; kind: 'window' | 'screen' } | null> {
  // A thumbnail is a full screen grab per source and we throw them all away,
  // so ask for none of it.
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 0, height: 0 }
  })

  const game = sources.find(
    (source) => source.id.startsWith('window:') && /minecraft/i.test(source.name)
  )
  if (game) return { id: game.id, kind: 'window' }

  const screenSource = sources.find((source) => source.id.startsWith('screen:'))
  if (screenSource) return { id: screenSource.id, kind: 'screen' }

  return null
}

function timestampName(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  )
}

async function startRecording(instanceId: string): Promise<void> {
  const window = getMainWindow()
  if (!window) {
    // The capture runs in the renderer, so with no window there is nothing to
    // run it in. This is reachable: "Launcher beim Start schließen" does
    // exactly that.
    notify(
      'warning',
      'Aufnahme nicht möglich',
      'Das Launcher-Fenster ist geschlossen. Aufnahmen brauchen ein offenes Fenster.'
    )
    return
  }

  const source = await pickSource()
  if (!source) {
    notify('error', 'Aufnahme nicht möglich', 'Es wurde keine Bildquelle gefunden.')
    return
  }

  const settings = getSettings()
  const dir = paths.recordings(instanceId)
  mkdirSync(dir, { recursive: true })

  const base = timestampName()
  const file = join(dir, `${base}.webm`)

  const stream = createWriteStream(file)
  stream.on('error', (err) => {
    logger.error('Aufnahme konnte nicht geschrieben werden:', err)
    void failRecording('Die Datei konnte nicht geschrieben werden.')
  })

  const maxDurationMs = Math.max(1, settings.recordingMaxMinutes) * 60_000

  session = {
    instanceId,
    startedAt: Date.now(),
    file,
    base,
    stream,
    bytes: 0,
    guard: setTimeout(() => {
      logger.warn('Aufnahme wurde nicht sauber beendet, wird selbst geschlossen')
      void finishRecording(maxDurationMs)
    }, maxDurationMs + GRACE_MS),
    stopping: false
  }

  const request: RecordingRequest = {
    instanceId,
    sourceId: source.id,
    sourceKind: source.kind,
    audio: settings.recordingAudio,
    videoBitsPerSecond: BITRATE[settings.recordingQuality] ?? BITRATE.medium,
    maxDurationMs
  }

  logger.info(`Aufnahme gestartet (${source.kind}) für ${instanceId}`)
  emit(EVENTS.recordingStart, request)
  publish()
  notify('info', 'Aufnahme läuft', `Nochmal ${settings.recordingHotkey} drücken beendet sie.`)
}

function stopRecording(): void {
  if (!session || session.stopping) return
  session.stopping = true
  logger.info('Aufnahme wird beendet')
  emit(EVENTS.recordingStop, null)
  publish()
}

/**
 * Starts or stops, which is what the hotkey does.
 *
 * Without an explicit instance it records whatever is running. With more than
 * one game up the first is taken, which is the only answer available: the key
 * press carries no hint about which window the user meant.
 */
export async function toggleRecording(instanceId?: string): Promise<RecordingState> {
  if (session) {
    stopRecording()
    return getRecordingState()
  }

  if (!getSettings().recordingEnabled) return getRecordingState()

  const target = instanceId ?? playing()[0]
  if (!target) {
    notify('info', 'Nichts aufzunehmen', 'Starte zuerst eine Instanz.')
    return getRecordingState()
  }

  await startRecording(target)
  return getRecordingState()
}

/* ------------------------------------------------------------------ *
 * Data coming back from the renderer
 * ------------------------------------------------------------------ */

export function appendChunk(data: ArrayBuffer | Uint8Array): void {
  if (!session) return
  const buffer = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data))
  session.bytes += buffer.byteLength
  session.stream.write(buffer)
  publish()
}

/** Stores the still frame the grid shows in place of the video itself. */
export function savePoster(data: ArrayBuffer | Uint8Array): void {
  if (!session) return
  const buffer = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data))
  try {
    writeFileSync(join(paths.recordings(session.instanceId), `${session.base}.jpg`), buffer)
  } catch (err) {
    // Only costs the preview picture, never the recording.
    logger.warn('Vorschaubild konnte nicht gespeichert werden:', err)
  }
}

function closeSession(): Session | null {
  const current = session
  if (!current) return null
  if (current.guard) clearTimeout(current.guard)
  current.stream.end()
  session = null
  return current
}

export async function finishRecording(durationMs: number): Promise<void> {
  const current = closeSession()
  if (!current) return
  publish()

  // Nothing was ever written: a capture that failed before the first slice
  // would otherwise leave a zero-byte file in the folder for the user to find.
  if (current.bytes === 0) {
    try {
      rmSync(current.file, { force: true })
    } catch {
      // an empty leftover file is not worth a second error
    }
    notify('warning', 'Aufnahme leer', 'Es wurden keine Bilddaten empfangen, die Datei wurde verworfen.')
    return
  }

  // The length is written beside the file. A webm from MediaRecorder carries
  // no duration in its header, so reading it back later would mean decoding
  // the whole video just to put a number under a thumbnail.
  try {
    writeFileSync(
      `${current.file}.json`,
      JSON.stringify({ durationMs, recordedAt: current.startedAt, instanceId: current.instanceId }, null, 2)
    )
  } catch (err) {
    logger.warn('Begleitdaten der Aufnahme konnten nicht geschrieben werden:', err)
  }

  const mb = (current.bytes / 1024 / 1024).toFixed(1)
  const seconds = Math.round(durationMs / 1000)
  logger.info(`Aufnahme fertig: ${current.file} (${mb} MB, ${seconds}s)`)
  notify(
    'success',
    'Aufnahme gespeichert',
    `${seconds} Sekunden, ${mb} MB. Zu finden im Reiter Aufnahmen.`,
    { route: `/instances/${current.instanceId}?tab=recordings` }
  )
}

export async function failRecording(message: string): Promise<void> {
  const current = closeSession()
  if (!current) return
  publish()

  try {
    rmSync(current.file, { force: true })
  } catch {
    // best effort, the message below matters more
  }
  logger.warn(`Aufnahme fehlgeschlagen: ${message}`)
  notify('error', 'Aufnahme fehlgeschlagen', message)
}

/* ------------------------------------------------------------------ *
 * Listing
 * ------------------------------------------------------------------ */

export interface StoredRecording {
  file: string
  fileName: string
  recordedAt: number
  sizeBytes: number
  durationMs: number
  posterFile: string | null
}

export function listRecordings(instanceId: string, limit = 40): StoredRecording[] {
  const dir = paths.recordings(instanceId)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.webm'))
    .map((name) => {
      const file = join(dir, name)
      const stats = statSync(file)
      let durationMs = 0
      let recordedAt = stats.mtimeMs
      try {
        const meta = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as {
          durationMs?: number
          recordedAt?: number
        }
        if (typeof meta.durationMs === 'number' && Number.isFinite(meta.durationMs)) {
          durationMs = meta.durationMs
        }
        if (typeof meta.recordedAt === 'number' && Number.isFinite(meta.recordedAt)) {
          recordedAt = meta.recordedAt
        }
      } catch {
        // A recording without its sidecar still lists, just without a length.
      }

      const poster = join(dir, `${name.replace(/\.webm$/i, '')}.jpg`)
      return {
        file,
        fileName: name,
        recordedAt,
        sizeBytes: stats.size,
        durationMs,
        posterFile: existsSync(poster) ? poster : null
      }
    })
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, limit)
}

/** Removes a recording together with its sidecar and preview picture. */
export function deleteRecording(instanceId: string, file: string): void {
  const dir = paths.recordings(instanceId)
  const target = resolve(file)

  // The path comes from the renderer, so it is only trustworthy after this.
  if (!target.startsWith(resolve(dir) + sep) || !target.toLowerCase().endsWith('.webm')) {
    throw new Error('Diese Datei gehört nicht zu den Aufnahmen dieser Instanz.')
  }

  rmSync(target, { force: true })
  rmSync(`${target}.json`, { force: true })
  rmSync(target.replace(/\.webm$/i, '.jpg'), { force: true })
  logger.info(`Aufnahme gelöscht: ${target}`)
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export function initRecording(): void {
  // The hotkey follows the games, so it is claimed the moment one starts and
  // handed back the moment the last one exits.
  onRunningChanged(() => {
    syncRecordingHotkey()
    // A game that closes mid-recording ends it rather than carrying on
    // filming an empty desktop.
    if (session && playing().length === 0) stopRecording()
  })
  syncRecordingHotkey()
}

export function disposeRecording(): void {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = null
  }
  const current = closeSession()
  if (current) logger.info('Laufende Aufnahme beim Beenden geschlossen')
}
