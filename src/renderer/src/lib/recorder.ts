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
 * hidden window still executes JavaScript, which is what makes this work at
 * all.
 */

/** Container and codec, best first. Chromium always has at least one of these. */
const CANDIDATE_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
]

/** How often a slice is handed to the main process, in milliseconds. */
const SLICE_MS = 2000

/** When the poster frame is grabbed. Late enough that the picture is not black. */
const POSTER_DELAY_MS = 1500

interface Active {
  recorder: MediaRecorder
  stream: MediaStream
  video: HTMLVideoElement
  startedAt: number
  timers: number[]
  /** Set once a stop is under way, so the two stop paths cannot both fire. */
  ending: boolean
}

let active: Active | null = null

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
  const video = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: request.sourceId,
      maxFrameRate: 60
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

  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) return false
  }
  return true
}

function grabPoster(video: HTMLVideoElement): void {
  const canvas = document.createElement('canvas')
  // Wide enough to look sharp in the grid without turning a thumbnail into a
  // megabyte of its own.
  const width = 480
  const ratio = video.videoHeight > 0 ? video.videoHeight / video.videoWidth : 9 / 16
  canvas.width = width
  canvas.height = Math.round(width * ratio)

  const context = canvas.getContext('2d')
  if (!context) return
  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  canvas.toBlob(
    (blob) => {
      if (!blob) return
      void blob.arrayBuffer().then((buffer) => window.gabi.recording.poster(buffer))
    },
    'image/jpeg',
    0.72
  )
}

function cleanUp(current: Active): void {
  for (const timer of current.timers) window.clearTimeout(timer)
  for (const track of current.stream.getTracks()) track.stop()
  current.video.srcObject = null
  current.video.remove()
}

/** Starts capturing what the main process picked. */
export async function startCapture(request: RecordingRequest): Promise<void> {
  if (active) return

  const mimeType = pickMimeType()
  if (!mimeType) {
    await window.gabi.recording.failed('Dieses System kann kein WebM aufnehmen.')
    return
  }

  let stream: MediaStream
  try {
    stream = await openStream(request)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await window.gabi.recording.failed(`Der Bildschirm konnte nicht erfasst werden: ${message}`)
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

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: request.videoBitsPerSecond
  })

  const current: Active = {
    recorder,
    stream,
    video,
    startedAt: Date.now(),
    timers: [],
    ending: false
  }
  active = current

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    void event.data.arrayBuffer().then((buffer) => window.gabi.recording.chunk(buffer))
  }

  recorder.onerror = () => {
    void stopCapture()
  }

  recorder.onstop = () => {
    const durationMs = Date.now() - current.startedAt
    cleanUp(current)
    if (active === current) active = null
    void window.gabi.recording.finished(durationMs)
  }

  // The user pulling the plug in the system's own screen-sharing bar ends the
  // track rather than the recorder, and without this the recorder would sit
  // there producing empty slices.
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => void stopCapture())
  }

  recorder.start(SLICE_MS)

  current.timers.push(
    window.setTimeout(() => {
      if (active !== current) return
      // A window capture that comes back black is the one failure mode that
      // looks like success: the file grows, the timer runs, and the result is
      // unwatchable. Better to say so than to hand over a black video.
      if (frameIsBlank(video)) {
        void window.gabi.recording
          .failed(
            'Das Spielfenster liefert kein Bild. Spiele im Fenstermodus oder randlosen Vollbild, dann klappt die Aufnahme.'
          )
          .then(() => stopCapture(true))
        return
      }
      grabPoster(video)
    }, POSTER_DELAY_MS)
  )

  current.timers.push(
    window.setTimeout(() => {
      if (active === current) void stopCapture()
    }, request.maxDurationMs)
  )
}

/**
 * Ends the current capture.
 *
 * `silent` skips the finish report, used when the failure has already been
 * reported and a second message would only contradict the first.
 */
export async function stopCapture(silent = false): Promise<void> {
  const current = active
  if (!current || current.ending) return
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
    await window.gabi.recording.finished(Date.now() - current.startedAt)
  }
}

export function isCapturing(): boolean {
  return active !== null
}
