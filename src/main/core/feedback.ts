/**
 * Reports someone writes themselves, from the settings under error reports.
 *
 * Unlike the automatic reports this needs no consent: the user writes the
 * text, picks the pictures and decides whether the launcher log goes along,
 * and pressing send is the decision. It goes to the launcher's own server
 * only, with the same build token as the automatic reports.
 *
 * The pictures arrive here already shrunk and re-encoded by the renderer,
 * which drops their metadata, location included. They are still checked
 * again: count, size and that they really are PNG, JPEG or WebP. The log is
 * scrubbed the same way an automatic report is.
 */
import { app } from 'electron'
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { FeedbackInput } from '@shared/api'
import { tr } from '@shared/i18n'
import { getLogDirectory, log } from '../logger'
import { reportToken, reportingConfigured, scrub } from './reports'

const logger = log('feedback')

const FEEDBACK_URL = process.env.LG_FEEDBACK_URL || 'https://admin.launchgabi.com/api/feedback'

const MIN_MESSAGE = 10
const MAX_MESSAGE = 4000
const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
/** How much of the newest launcher log goes along, from its end. */
const LOG_TAIL_BYTES = 64 * 1024
const MAX_LOG = 12000

function isImage(buffer: Buffer): boolean {
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const webp = buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP'
  return png || jpeg || webp
}

/** The end of the newest launcher log, scrubbed, or '' when there is none. */
export function logTail(): string {
  try {
    const dir = getLogDirectory()
    const newest = readdirSync(dir)
      .filter((name) => /^launcher-.*\.log$/.test(name))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0]
    if (!newest) return ''
    const file = join(dir, newest.name)
    const size = statSync(file).size
    const length = Math.min(size, LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buffer, 0, length, size - length)
    } finally {
      closeSync(fd)
    }
    let text = buffer.toString('utf8')
    // Cut at a line break, so the first line is not half a line.
    if (length < size) text = text.slice(text.indexOf('\n') + 1)
    const cleaned = scrub(text)
    return cleaned.length > MAX_LOG ? cleaned.slice(cleaned.length - MAX_LOG) : cleaned
  } catch (err) {
    logger.warn('Protokoll für die Meldung nicht gelesen:', err)
    return ''
  }
}

export async function sendFeedback(input: FeedbackInput): Promise<{ id: string }> {
  if (!reportingConfigured()) {
    throw new Error(
      tr(
        'In dieser Version ist kein Empfänger hinterlegt, Meldungen lassen sich nicht senden.',
        'This version has no recipient set up, so reports cannot be sent.'
      )
    )
  }

  const message = String(input?.message ?? '').trim()
  if (message.length < MIN_MESSAGE) {
    throw new Error(tr('Beschreib bitte in ein paar Worten, was passiert ist.', 'Please describe in a few words what happened.'))
  }

  const images = Array.isArray(input?.images) ? input.images : []
  if (images.length > MAX_IMAGES) throw new Error(tr(`Höchstens ${MAX_IMAGES} Bilder.`, `At most ${MAX_IMAGES} pictures.`))
  for (const data of images) {
    const buffer = Buffer.from(String(data), 'base64')
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error(tr('Ein Bild ist zu groß.', 'A picture is too large.'))
    if (!isImage(buffer)) throw new Error(tr('Ein Bild ließ sich nicht lesen.', 'A picture could not be read.'))
  }

  const body = JSON.stringify({
    message: message.slice(0, MAX_MESSAGE),
    contact: String(input?.contact ?? '').trim().slice(0, 120),
    version: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    log: input?.includeLog ? logTail() : '',
    images: images.map((data) => ({ data: String(data) }))
  })

  let res: Response
  try {
    res = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-report-token': reportToken() },
      body,
      signal: AbortSignal.timeout(60_000)
    })
  } catch (err) {
    logger.warn('Meldung nicht gesendet:', err)
    throw new Error(tr('Keine Verbindung zum Launch-Gabi-Server. Prüfe deine Internetverbindung.', 'No connection to the Launch Gabi server. Check your internet connection.'), { cause: err })
  }
  const answer = (await res.json().catch(() => ({}))) as { id?: string }
  if (!res.ok) {
    logger.warn(`Meldung abgelehnt (HTTP ${res.status})`)
    // The server writes German only; every refusal it can send is answered
    // in the user's language here.
    throw new Error(
      res.status === 429
        ? tr('Du hast gerade schon mehrere Meldungen geschickt. Bitte versuch es in einer Viertelstunde noch einmal.', 'You have just sent several reports. Please try again in a quarter of an hour.')
        : res.status === 413 || res.status === 415
          ? tr('Ein Bild wurde nicht angenommen. Versuch es mit einem anderen Bild oder ohne.', 'A picture was not accepted. Try a different picture or none.')
          : tr(`Der Server hat die Meldung nicht angenommen (HTTP ${res.status}). Bitte später noch einmal versuchen.`, `The server did not accept the report (HTTP ${res.status}). Please try again later.`)
    )
  }
  logger.info(`Meldung ${answer.id ?? ''} gesendet`)
  return { id: String(answer.id ?? '') }
}
