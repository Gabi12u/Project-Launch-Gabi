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
import { tryGetInstance } from './instances'
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

/**
 * Frames per second per quality.
 *
 * This was fixed at 60, which is the most expensive thing the feature could
 * ask for: every frame is encoded in software, so halving the rate halves the
 * work on a machine that is already busy running Minecraft.
 *
 * A ceiling on the picture size belongs here too and was tried, but a
 * `maxWidth`/`maxHeight` on a desktop-capture track stops it delivering frames
 * altogether in this Electron build: the stream opens and reports the rate it
 * was asked for, then the encoder receives nothing at all and the recording
 * comes out empty. Measured, not assumed, so the ceiling stays out.
 */
const SHAPE: Record<RecordingQuality, { fps: number }> = {
  low: { fps: 30 },
  medium: { fps: 30 },
  high: { fps: 60 }
}

interface Session {
  /**
   * Generation counter, sent to the renderer and returned with every message.
   *
   * Without it the main process only knew "some recording is running", not
   * "the one these bytes belong to". A slice still in flight from a recording
   * that just ended would be written into whatever file happened to be open,
   * corrupting a perfectly good new recording with the tail of an old one.
   */
  id: number
  instanceId: string
  startedAt: number
  file: string
  base: string
  stream: WriteStream
  bytes: number
  /** Fires if the renderer never reports back, see `armGuard`. */
  guard: NodeJS.Timeout | null
  /** Set once a stop has been asked for, so a second press does nothing. */
  stopping: boolean
}

let session: Session | null = null

/**
 * True from the moment a start is requested until the session exists.
 *
 * `startRecording` has to await the source lookup before it can create the
 * session, and a second hotkey press during that gap used to sail past the
 * "already recording?" check and start a whole second recording. The first was
 * then orphaned: its file handle stayed open and its guard timer later fired
 * into an unrelated recording and cut that one short.
 */
let starting = false

/** A stop that arrived while the start was still in flight. */
let stopWanted = false

let counter = 0

/**
 * How long the main process waits past the agreed maximum before giving up.
 *
 * The renderer owns the actual timer; this is the backstop for a renderer that
 * crashed or was reloaded mid-recording.
 */
const GRACE_MS = 30_000

/**
 * The much shorter deadline once a stop has actually been asked for.
 *
 * Flushing the last slice takes a moment, not minutes. Leaving the original
 * deadline in place meant a renderer that died right after the stop press kept
 * the recording wedged for the entire configured maximum: the hotkey did
 * nothing, the indicator stayed on, and the file handle stayed open.
 */
const STOP_GRACE_MS = 12_000

/** Hotkey currently handed to the OS, so it can be released again. */
let registered: string | null = null

/** The key we last complained about, so the warning is not repeated endlessly. */
let warned: string | null = null

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

/** (Re)schedules the backstop that closes a session nobody else closed. */
function armGuard(current: Session, afterMs: number): void {
  if (current.guard) clearTimeout(current.guard)
  current.guard = setTimeout(() => {
    // Only ever acts on the session that armed it. The timer used to call
    // through to whatever `session` happened to be by then, which after a
    // restart meant ending someone else's recording.
    if (session !== current) return
    logger.warn('Aufnahme wurde nicht sauber beendet, wird selbst geschlossen')
    // Measured rather than assumed: reporting the configured maximum labelled
    // a clip that broke off after ten seconds as half an hour long.
    void finishRecording(Math.max(0, Date.now() - current.startedAt), current.id)
  }, afterMs)
}

/* ------------------------------------------------------------------ *
 * Hotkey
 * ------------------------------------------------------------------ */

/**
 * Instance ids with a game up, whoever started it.
 *
 * Adopted games count. The launcher can be restarted while Minecraft keeps
 * playing, and refusing to record then would be a dead spot with no reason a
 * user could see: the game is right there on screen.
 */
function playing(): string[] {
  return [
    ...listRunning().map((game) => game.instanceId),
    ...listAdopted().map((game) => game.instanceId)
  ]
}

/**
 * Holds the hotkey only while a game is actually up.
 *
 * A global shortcut is taken from every other application on the machine for
 * as long as it is registered, so claiming F9 permanently would be rude: the
 * launcher spends most of its life sitting in the background doing nothing.
 * Registering on launch and releasing on exit keeps the key free the rest of
 * the time.
 */
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
      // Once per key. This runs again on every launch and every exit, and a
      // conflict that stays put would otherwise produce a fresh popup every
      // time the user starts a game.
      if (warned !== wanted) {
        warned = wanted
        notify(
          'warning',
          'Aufnahmetaste belegt',
          `${wanted} wird bereits von einem anderen Programm verwendet. Wähle in den Einstellungen eine andere Taste.`,
          { route: '/settings?section=recording' }
        )
      }
      return
    }
    registered = wanted
    warned = null
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

/**
 * A file name nothing else holds.
 *
 * The stamp only resolves to the second, so two recordings begun within the
 * same second produced the same path and two write streams truncated each
 * other.
 */
function freeFile(dir: string): { file: string; base: string } {
  const stamp = timestampName()
  let base = stamp
  let attempt = 2
  while (existsSync(join(dir, `${base}.webm`))) {
    base = `${stamp}_${attempt}`
    attempt++
  }
  return { file: join(dir, `${base}.webm`), base }
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

  const { file, base } = freeFile(dir)
  const id = ++counter

  const stream = createWriteStream(file)
  stream.on('error', (err) => {
    logger.error('Aufnahme konnte nicht geschrieben werden:', err)
    void failRecording('Die Datei konnte nicht geschrieben werden.', id)
  })

  const maxDurationMs = Math.max(1, settings.recordingMaxMinutes) * 60_000
  const shape = SHAPE[settings.recordingQuality] ?? SHAPE.medium

  const current: Session = {
    id,
    instanceId,
    startedAt: Date.now(),
    file,
    base,
    stream,
    bytes: 0,
    guard: null,
    stopping: false
  }
  session = current
  armGuard(current, maxDurationMs + GRACE_MS)

  const request: RecordingRequest = {
    sessionId: id,
    instanceId,
    sourceId: source.id,
    sourceKind: source.kind,
    audio: settings.recordingAudio,
    videoBitsPerSecond: BITRATE[settings.recordingQuality] ?? BITRATE.medium,
    fps: shape.fps,
    maxDurationMs
  }

  logger.info(`Aufnahme ${id} gestartet (${source.kind}) für ${instanceId}`)
  emit(EVENTS.recordingStart, request)
  publish()
  notify('info', 'Aufnahme läuft', `Nochmal ${settings.recordingHotkey} drücken beendet sie.`)
}

function stopRecording(): void {
  if (!session || session.stopping) return
  session.stopping = true
  // Shortened now that someone is actually waiting for it to end.
  armGuard(session, STOP_GRACE_MS)
  logger.info(`Aufnahme ${session.id} wird beendet`)
  emit(EVENTS.recordingStop, session.id)
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

  // A press during the gap before the session exists means "never mind", not
  // "start a second one".
  if (starting) {
    stopWanted = true
    return getRecordingState()
  }

  if (!getSettings().recordingEnabled) return getRecordingState()

  const target = instanceId ?? playing()[0]
  if (!target) {
    notify('info', 'Nichts aufzunehmen', 'Starte zuerst eine Instanz.')
    return getRecordingState()
  }

  starting = true
  stopWanted = false
  try {
    await startRecording(target)
  } finally {
    starting = false
  }

  // Honoured as soon as there is something to stop.
  if (stopWanted) {
    stopWanted = false
    stopRecording()
  }
  return getRecordingState()
}

/* ------------------------------------------------------------------ *
 * Data coming back from the renderer
 * ------------------------------------------------------------------ */

function toBuffer(data: ArrayBuffer | Uint8Array): Buffer {
  return data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data))
}

/**
 * Writes one encoded slice.
 *
 * Resolves only once the stream has room again. The renderer awaits this, so a
 * data directory slower than the encoder slows the sender down instead of
 * letting Node buffer an entire recording in memory.
 */
export async function appendChunk(sessionId: number, data: ArrayBuffer | Uint8Array): Promise<void> {
  const current = session
  if (!current || current.id !== sessionId) return

  const buffer = toBuffer(data)
  current.bytes += buffer.byteLength
  const room = current.stream.write(buffer)
  publish()
  if (room) return

  await new Promise<void>((done) => {
    // `once` rather than `on`: this listener belongs to a single write, and the
    // stream outlives many of them.
    current.stream.once('drain', done)
  })
}

/** Stores the still frame the grid shows in place of the video itself. */
export function savePoster(sessionId: number, data: ArrayBuffer | Uint8Array): void {
  const current = session
  if (!current || current.id !== sessionId) return
  try {
    writeFileSync(join(paths.recordings(current.instanceId), `${current.base}.jpg`), toBuffer(data))
  } catch (err) {
    // Only costs the preview picture, never the recording.
    logger.warn('Vorschaubild konnte nicht gespeichert werden:', err)
  }
}

/** Ends the stream and resolves once the bytes are really on disk. */
async function closeSession(): Promise<Session | null> {
  const current = session
  if (!current) return null
  if (current.guard) clearTimeout(current.guard)
  session = null
  publish()

  await new Promise<void>((done) => {
    // Waited for, not fired and forgotten. Everything below touches the same
    // file, and on Windows reading or deleting a path whose handle is still
    // closing fails outright.
    current.stream.end(() => done())
  })
  return current
}

export async function finishRecording(durationMs: number, sessionId?: number): Promise<void> {
  if (sessionId !== undefined && session?.id !== sessionId) return
  const current = await closeSession()
  if (!current) return

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

  // Clamped, because a clock that moves backwards mid-recording (an NTP
  // resync, a manual change) produced a negative length that rendered as
  // nonsense like "-1:-5 Min" under the thumbnail.
  const length = Math.max(0, durationMs)

  // The length is written beside the file. A webm from MediaRecorder carries
  // no duration in its header, so reading it back later would mean decoding
  // the whole video just to put a number under a thumbnail.
  try {
    writeFileSync(
      `${current.file}.json`,
      JSON.stringify(
        { durationMs: length, recordedAt: current.startedAt, instanceId: current.instanceId },
        null,
        2
      )
    )
  } catch (err) {
    logger.warn('Begleitdaten der Aufnahme konnten nicht geschrieben werden:', err)
  }

  const mb = (current.bytes / 1024 / 1024).toFixed(1)
  const seconds = Math.round(length / 1000)
  logger.info(`Aufnahme fertig: ${current.file} (${mb} MB, ${seconds}s)`)
  notify(
    'success',
    'Aufnahme gespeichert',
    `${seconds} Sekunden, ${mb} MB. Zu finden im Reiter Aufnahmen.`,
    { route: `/instances/${current.instanceId}?tab=recordings` }
  )
}

export async function failRecording(message: string, sessionId?: number): Promise<void> {
  if (sessionId !== undefined && session?.id !== sessionId) return
  const current = await closeSession()
  if (!current) return

  try {
    rmSync(current.file, { force: true })
  } catch (err) {
    // Reported rather than swallowed. The message below says the recording was
    // discarded, and it should not claim that while the broken file is still
    // sitting in the folder.
    logger.warn(`Fehlgeschlagene Aufnahme ${current.file} konnte nicht entfernt werden:`, err)
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

  const found: StoredRecording[] = []
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.webm')) continue
    const file = join(dir, name)

    try {
      const stats = statSync(file)
      let durationMs = 0
      let recordedAt = stats.mtimeMs
      try {
        const meta = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as {
          durationMs?: number
          recordedAt?: number
        }
        if (typeof meta.durationMs === 'number' && Number.isFinite(meta.durationMs)) {
          durationMs = Math.max(0, meta.durationMs)
        }
        if (typeof meta.recordedAt === 'number' && Number.isFinite(meta.recordedAt)) {
          recordedAt = meta.recordedAt
        }
      } catch {
        // A recording without its sidecar still lists, just without a length.
      }

      const poster = join(dir, `${name.replace(/\.webm$/i, '')}.jpg`)
      found.push({
        file,
        fileName: name,
        recordedAt,
        sizeBytes: stats.size,
        durationMs,
        posterFile: existsSync(poster) ? poster : null
      })
    } catch (err) {
      // One unreadable file used to reject the whole request, so a single clip
      // deleted between the listing and the stat, or momentarily locked by a
      // virus scanner, emptied the entire tab.
      logger.debug(`Aufnahme ${name} konnte nicht gelesen werden:`, err)
    }
  }

  return found.sort((a, b) => b.recordedAt - a.recordedAt).slice(0, limit)
}

/** Removes a recording together with its sidecar and preview picture. */
export function deleteRecording(instanceId: string, file: string): void {
  // The instance has to exist. Both arguments come from the renderer, and
  // checking only the file was not enough: the folder the check compares
  // against is itself built from the id, so an id carrying path segments moved
  // the permitted folder anywhere on disk and the comparison then passed.
  // `deleteBackup` and `removeContent` guard the same way.
  if (!tryGetInstance(instanceId)) {
    throw new Error('Diese Instanz existiert nicht.')
  }

  const dir = resolve(paths.recordings(instanceId))
  const target = resolve(file)

  if (!target.startsWith(dir + sep) || !target.toLowerCase().endsWith('.webm')) {
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
    // Tied to the instance being recorded, not to the machine going quiet. A
    // screen capture has no window handle to die with it, so recording one
    // instance while a second stayed open kept filming the empty desktop long
    // after the game in the picture had closed.
    if (session && !playing().includes(session.instanceId)) stopRecording()
  })
  syncRecordingHotkey()
}

/**
 * Asks a running recording to finish, and waits a moment for it.
 *
 * Called while the app is quitting. Ending the stream outright would throw
 * away whatever the encoder still had buffered, which is the last few seconds
 * of what the user was recording.
 */
export async function flushRecording(): Promise<void> {
  if (!session) return
  stopRecording()

  await new Promise<void>((done) => {
    const deadline = Date.now() + 4000
    const poll = setInterval(() => {
      if (!session || Date.now() > deadline) {
        clearInterval(poll)
        done()
      }
    }, 100)
  })
}

export async function disposeRecording(): Promise<void> {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = null
  }
  const current = await closeSession()
  if (current) logger.info('Laufende Aufnahme beim Beenden geschlossen')
}
