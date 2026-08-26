import type { RecordingRequest } from '@shared/api'

/**
 * The capture half of the recording feature.
 *
 * Screen capture only exists in a renderer: `MediaRecorder` and
 * `getUserMedia` are browser APIs, and the main process has neither. So the
 * main process decides *what* to record and where the file goes, and this
 * module does the actual capturing, handing finished slices straight back over
 * IPC rather than holding a whole video in memory.
 *
 * It keeps running while the launcher window is hidden behind the game. A
 * hidden window still executes JavaScript, which is what makes this work.
 */

/**
 * Container and codec, cheapest first.
 *
 * VP9 used to lead this list, which was the wrong way round for a live
 * capture: both it and VP8 are encoded in software here, and VP9 costs
 * markedly more processor time per frame for a quality gain nobody watching a
 * gameplay clip is looking for. The machine is already running Minecraft.
 * VP9 stays at the back as a fallback rather than being dropped.
 */
const CANDIDATE_TYPES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm'
]

/** How often a slice is handed to the main process, in milliseconds. */
const SLICE_MS = 2000

/** When the poster frame is grabbed. Late enough that the picture is not black. */
const POSTER_DELAY_MS = 1500

interface Active {
  sessionId: number
  recorder: MediaRecorder
  stream: MediaStream
  video: HTMLVideoElement
  startedAt: number
  timers: number[]
  /** Set once a stop is under way, so the two stop paths cannot both fire. */
  ending: boolean
  /**
   * Serialises the slice handovers.
   *
   * Each slice is converted with `Blob.arrayBuffer()`, which is asynchronous
   * and carries no ordering guarantee between separate calls. Sending them as
   * they happened to resolve could interleave the WebM byte stream and produce
   * a file that will not play, with nothing anywhere reporting a problem.
   * Chaining keeps them in the order the encoder produced them, and because
   * the main process only resolves once the bytes are written, it doubles as
   * backpressure.
   */
  queue: Promise<void>
}

let active: Active | null = null

/**
 * True while a start is in flight but `active` does not exist yet.
 *
 * Opening the capture stream is asynchronous, and a stop arriving during that
 * window used to find `active` still null and quietly do nothing. The main
 * process meanwhile treated the stop as delivered, so the recording could not
 * be stopped at all afterwards.
 */
let opening = false
let stopWanted = false

function pickMimeType(): string | null {
  for (const type of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

/**
 * Builds the constraints Chromium wants for a desktop source.
 *
 * The `mandatory` shape is not standard `getUserMedia`, it is Chromium's own
 * desktop-capture extension, which is why it has to be cast past the DOM types.
 */
function constraintsFor(request: RecordingRequest, withAudio: boolean): MediaStreamConstraints {
  // Only the frame rate. A `maxWidth`/`maxHeight` alongside these makes the
  // desktop-capture track stop delivering frames entirely, which was measured
  // rather than guessed: the stream opens and reports the requested rate, and
  // the encoder then receives nothing at all.
  const video = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: request.sourceId,
      maxFrameRate: request.fps
    }
  }
  const audio = {
    mandatory: {
      chromeMediaSource: 'desktop'
    }
  }
  return {
    audio: withAudio ? (audio as unknown as MediaTrackConstraints) : false,
    video: video as unknown as MediaTrackConstraints
  }
}

async function openStream(request: RecordingRequest): Promise<MediaStream> {
  // Desktop audio on Windows is a loopback of the whole sound output and is
  // only offered for screen sources. Asking for it alongside a single window
  // makes the whole call fail, taking the picture with it, so a refusal falls
  // back to video rather than giving up.
  if (request.audio) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraintsFor(request, true))
    } catch {
      // fall through to the picture-only attempt below
    }
  }
  return navigator.mediaDevices.getUserMedia(constraintsFor(request, false))
}

/** True when the frame is essentially black, which is how a failed capture looks. */
function frameIsBlank(video: HTMLVideoElement): boolean {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 36
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return false

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) return false
    }
    return true
  } catch {
    // A frame that cannot be drawn tells us nothing either way, and claiming
    // "blank" here would throw away a recording that is probably fine.
    return false
  }
}

function grabPoster(sessionId: number, video: HTMLVideoElement): void {
  // Both dimensions, not just one. A height with a zero width made the ratio
  // infinite and the canvas degenerate, and `drawImage` then threw.
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return

  try {
    const canvas = document.createElement('canvas')
    // Wide enough to look sharp in the grid without turning a thumbnail into a
    // megabyte of its own.
    const width = 480
    canvas.width = width
    canvas.height = Math.round((width * video.videoHeight) / video.videoWidth)

    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        void blob
          .arrayBuffer()
          .then((buffer) => window.gabi.recording.poster(sessionId, buffer))
          .catch(() => undefined)
      },
      'image/jpeg',
      0.72
    )
  } catch {
    // The preview picture is a nicety; losing it must never affect the video.
  }
}

function cleanUp(current: Active): void {
  for (const timer of current.timers) window.clearTimeout(timer)
  current.timers.length = 0
  for (const track of current.stream.getTracks()) track.stop()
  current.video.srcObject = null
  current.video.remove()
}

/** Starts capturing what the main process picked. */
export async function startCapture(request: RecordingRequest): Promise<void> {
  if (active || opening) return

  const mimeType = pickMimeType()
  if (!mimeType) {
    await window.gabi.recording.failed(request.sessionId, 'Dieses System kann kein WebM aufnehmen.')
    return
  }

  opening = true
  stopWanted = false

  let stream: MediaStream
  try {
    stream = await openStream(request)
  } catch (err) {
    opening = false
    const message = err instanceof Error ? err.message : String(err)
    await window.gabi.recording.failed(
      request.sessionId,
      `Der Bildschirm konnte nicht erfasst werden: ${message}`
    )
    return
  }

  // A real element, because a poster frame has to be drawn from something that
  // decodes video. Kept out of the layout and out of the accessibility tree.
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.style.position = 'fixed'
  video.style.opacity = '0'
  video.style.pointerEvents = 'none'
  video.style.width = '1px'
  video.style.height = '1px'
  video.setAttribute('aria-hidden', 'true')
  document.body.appendChild(video)
  try {
    await video.play()
  } catch {
    // Autoplay of a muted local stream is allowed; if it is refused anyway the
    // recorder below still works, only the poster frame is lost.
  }

  // Everything from here to `recorder.start()` can throw, and an escape used
  // to leave `active` pointing at a recorder that never ran: the stream stayed
  // open, the OS kept showing its capture indicator, and every later start
  // silently returned at the guard above. The feature was dead until restart.
  const abandon = async (message: string): Promise<void> => {
    opening = false
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
    video.remove()
    active = null
    await window.gabi.recording.failed(request.sessionId, message)
  }

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: request.videoBitsPerSecond
    })
  } catch (err) {
    await abandon(
      `Die Aufnahme konnte nicht vorbereitet werden: ${err instanceof Error ? err.message : String(err)}`
    )
    return
  }

  const current: Active = {
    sessionId: request.sessionId,
    recorder,
    stream,
    video,
    startedAt: Date.now(),
    timers: [],
    ending: false,
    queue: Promise.resolve()
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    // Queued, so slices reach the file in the order they were encoded.
    current.queue = current.queue
      .then(async () => {
        const buffer = await event.data.arrayBuffer()
        await window.gabi.recording.chunk(current.sessionId, buffer)
      })
      .catch(() => undefined)
  }

  recorder.onerror = () => {
    // Reported as the failure it is. Routing this through the normal stop made
    // the main process announce "Aufnahme gespeichert" for a file the encoder
    // had just given up on, which is very likely truncated or unplayable.
    void stopCapture(true).then(() =>
      window.gabi.recording.failed(current.sessionId, 'Die Aufnahme ist beim Kodieren gescheitert.')
    )
  }

  recorder.onstop = () => {
    const durationMs = Math.max(0, Date.now() - current.startedAt)
    cleanUp(current)
    if (active === current) active = null
    // After the queue, so the last slice is written before the length is
    // recorded and the file is closed.
    void current.queue
      .then(() => window.gabi.recording.finished(current.sessionId, durationMs))
      .catch(() => undefined)
  }

  // The user pulling the plug in the system's own screen-sharing bar ends the
  // track rather than the recorder, and without this the recorder would sit
  // there producing empty slices.
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => void stopCapture())
  }

  try {
    recorder.start(SLICE_MS)
  } catch (err) {
    await abandon(
      `Die Aufnahme konnte nicht gestartet werden: ${err instanceof Error ? err.message : String(err)}`
    )
    return
  }

  active = current
  opening = false

  current.timers.push(
    window.setTimeout(() => {
      if (active !== current) return
      // A window capture that comes back black is the one failure mode that
      // looks like success: the file grows, the timer runs, and the result is
      // unwatchable. Better to say so than to hand over a black video.
      if (frameIsBlank(video)) {
        void stopCapture(true).then(() =>
          window.gabi.recording.failed(
            current.sessionId,
            'Das Spielfenster liefert kein Bild. Spiele im Fenstermodus oder randlosen Vollbild, dann klappt die Aufnahme.'
          )
        )
        return
      }
      grabPoster(current.sessionId, video)

      // Released the moment it has done its one job. This element exists only
      // to draw a still frame from, but attaching the stream to it made
      // Chromium decode and composite the whole capture for as long as the
      // recording ran, on top of encoding it. Nobody was ever looking at it.
      video.srcObject = null
      video.remove()
    }, POSTER_DELAY_MS)
  )

  current.timers.push(
    window.setTimeout(() => {
      if (active === current) void stopCapture()
    }, request.maxDurationMs)
  )

  // A stop that arrived while the stream was opening is honoured now rather
  // than lost.
  if (stopWanted) {
    stopWanted = false
    void stopCapture()
  }
}

/**
 * Ends the current capture.
 *
 * `silent` skips the finish report, used when the caller sends its own
 * outcome and a second message would only contradict the first.
 */
export async function stopCapture(silent = false): Promise<void> {
  const current = active
  if (!current) {
    // Remembered rather than dropped. The start is probably still opening the
    // stream, and it checks this the moment it has something to stop.
    if (opening) stopWanted = true
    return
  }
  if (current.ending) return
  current.ending = true

  if (silent) {
    current.recorder.onstop = null
    active = null
    try {
      current.recorder.stop()
    } catch {
      // already stopped, nothing left to do
    }
    cleanUp(current)
    return
  }

  try {
    // Flushes whatever is buffered into one last `ondataavailable` before the
    // `onstop` handler reports the finish.
    current.recorder.stop()
  } catch {
    cleanUp(current)
    active = null
    await current.queue.catch(() => undefined)
    await window.gabi.recording.finished(
      current.sessionId,
      Math.max(0, Date.now() - current.startedAt)
    )
  }
}

export function isCapturing(): boolean {
  return active !== null
}
