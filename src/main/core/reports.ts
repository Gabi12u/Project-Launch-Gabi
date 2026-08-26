import { app } from 'electron'
import { request } from 'node:https'
import { userInfo } from 'node:os'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSettings, readAccounts } from '../store'
import { log } from '../logger'

const logger = log('reports')

/**
 * Where finished reports are sent.
 *
 * A Discord webhook, deliberately: the connection terminates at Discord, so
 * the address of the person reporting never reaches us. Pointing this at our
 * own server would put every reporter's IP in its access log, which is exactly
 * what we do not want to collect.
 *
 * Empty means the whole feature stays inert: reports are still written locally
 * and can be handed over by the user, but nothing leaves the machine.
 *
 * This address is readable by anyone with the app or the repository, which is
 * unavoidable for a client that posts on its own. It is not a key to anything:
 * it can only write into one channel, nothing can be read back through it, and
 * replacing it in Discord revokes it instantly.
 */
const WEBHOOK_URL =
  'https://discord.com/api/webhooks/1542163323036897300/lDjTzT3Ap5OYz4SBrXCEOm90SD-CGGtkgcO_m0FqdI-KqRwAZOb_HnSi2Rf_iIthJHqr'

/** Reports per launcher session, so a crash loop cannot flood the channel. */
const MAX_PER_SESSION = 5

/** Discord refuses anything longer, and a wall of text helps nobody anyway. */
const MAX_MESSAGE = 1800

let sentThisSession = 0

/** Fingerprints already reported, so the same fault is not sent twice. */
const seen = new Set<string>()

export interface ErrorReport {
  id: string
  at: number
  version: string
  platform: string
  /** Where it came from: 'main', 'renderer', 'launch', 'login', … */
  area: string
  message: string
  detail: string
}

function reportsDir(): string {
  return join(app.getPath('userData'), 'reports')
}

/* ------------------------------------------------------------------ *
 * Scrubbing
 * ------------------------------------------------------------------ */

/** Escapes a value so it can be used inside a regular expression. */
function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Removes everything personal before a report goes anywhere.
 *
 * A stack trace is full of it without looking like it, and an error body from
 * Microsoft is worse: the Xbox endpoints answer failures with the player's
 * gamertag, their XUID and their user hash, and that body is the single most
 * useful thing for diagnosing a login, so it travels in the report. None of
 * those identifiers help anyone read the error, and every one of them would be
 * careless to publish.
 *
 * The rules are ordered from most specific to most general, and each replaces
 * with a placeholder that no later rule can match again.
 */
export function scrub(text: string): string {
  let out = text

  // Windows, macOS and Linux home directories, whatever the account is called.
  out = out.replace(/([A-Za-z]:\\Users\\)[^\\\r\n"']+/g, '$1<Nutzer>')
  out = out.replace(/(\/Users\/)[^/\r\n"']+/g, '$1<Nutzer>')
  out = out.replace(/(\/home\/)[^/\r\n"']+/g, '$1<Nutzer>')

  // And the account name itself, wherever else it turns up. The rules above
  // only catch it directly after a home directory, but people name folders
  // after themselves and then put the data directory there.
  try {
    const name = userInfo().username
    if (name && name.length >= 3) {
      out = out.replace(new RegExp(`\\b${literal(name)}\\b`, 'g'), '<Nutzer>')
    }
  } catch {
    // No account name available is not a reason to abandon the rest.
  }

  // The account names and ids actually stored on this machine. Bounded by word
  // edges and a minimum length, because a player may legitimately be called
  // "Max" or "der", and a blind replacement turned "MaxHeapSize" into
  // "<Spieler>HeapSize" and shredded the diagnosis along with the name.
  for (const account of readAccounts()) {
    if (account.username && account.username.length >= 3) {
      out = out.replace(new RegExp(`\\b${literal(account.username)}\\b`, 'g'), '<Spieler>')
    }
    if (account.uuid && account.uuid.length >= 8) {
      out = out.split(account.uuid).join('<UUID>')
      // Mojang hands the same id back without dashes, and that form matched
      // neither this nor the generic rule below.
      out = out.split(account.uuid.replace(/-/g, '')).join('<UUID>')
    }
  }

  // Xbox Live and the Minecraft services name the player outright in their
  // error bodies. These field names are the whole reason a failed login could
  // publish a gamertag.
  out = out.replace(/("(?:gtg|gamertag)"\s*:\s*")[^"]*/gi, '$1<Spieler>')
  // A gamertag written as prose rather than as a field is deliberately NOT
  // handled. A name on its own is not recognisable as a name by any rule,
  // and an attempt at it did not work reliably, so it is left out rather
  // than left in looking like protection. What Microsoft actually returns
  // is the JSON form above, and that is covered.
  out = out.replace(/("(?:xid|uhs|xuid|Identity|agg)"\s*:\s*")[^"]*/gi, '$1<Kennung>')
  // The bare numeric form, which is how an XUID appears outside quotes.
  out = out.replace(/\b\d{15,20}\b/g, '<Kennung>')

  // Email addresses. Microsoft echoes them back in more than one error text,
  // and there was no rule for them at all.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<E-Mail>')

  // Anything token-shaped, whether or not we know where it came from.
  out = out.replace(/\b(ey[A-Za-z0-9_-]{10,})/g, '<Token>')
  out = out.replace(/("?(?:access_?|refresh_?|id_?)token"?\s*[:=]\s*"?)[^"'\s,}]+/gi, '$1<Token>')
  // Microsoft account refresh tokens, which start neither with "ey" nor under
  // a key we recognise: M.C534_BAY.2.U.AbCd...
  out = out.replace(/\bM\.[A-Z]\w*_[A-Z]{3}\.[^\s"',}]+/g, '<Token>')
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, '$1<Token>')
  out = out.replace(/([?&](?:code|access_token|id_token)=)[^&\s"']+/gi, '$1<Token>')
  // The opaque blobs the Xbox endpoints hand back under their own key names.
  out = out.replace(/("(?:Token|X-Token|Signature)"\s*:\s*")[^"]*/g, '$1<Token>')

  // Dashed ids first, then the bare 32-hex form Mojang's API actually returns.
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
  out = out.replace(/\b[0-9a-f]{32}\b/gi, '<UUID>')

  // The CurseForge key lives in the settings and can end up in a request dump.
  const key = getSettings().curseForgeApiKey
  if (key && key.length > 8) out = out.split(key).join('<Schlüssel>')

  return out
}

/* ------------------------------------------------------------------ *
 * Recording a report
 * ------------------------------------------------------------------ */

/** Groups the same fault together, so a repeat is not sent again. */
function fingerprint(area: string, message: string): string {
  return createHash('sha1').update(`${area}|${message}`).digest('hex').slice(0, 12)
}

function writeLocally(report: ErrorReport): void {
  try {
    const dir = reportsDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${report.id}.json`), JSON.stringify(report, null, 2), 'utf8')
  } catch (err) {
    // Reporting must never become the thing that breaks.
    logger.warn('Fehlerbericht konnte nicht gespeichert werden:', err)
    return
  }

  // Separately, because a failure here means the report was saved and only the
  // tidying up went wrong. Inside the block above it reported the opposite.
  try {
    prune()
  } catch (err) {
    logger.warn('Alte Fehlerberichte konnten nicht aufgeräumt werden:', err)
  }
}

/** Keeps the newest 50, so the folder cannot grow without end. */
function prune(): void {
  const dir = reportsDir()
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)

  for (const extra of files.slice(50)) {
    rmSync(join(dir, extra.name), { force: true })
  }
}

/**
 * Records a fault, and sends it on if the user agreed to that.
 *
 * Everything is written locally either way. That is the part the user can hand
 * over themselves, and it is what makes the feature useful even with no
 * webhook configured and no consent given.
 */
export function reportError(area: string, error: unknown, extra?: string): void {
  try {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error && error.stack ? error.stack : ''

    const print = fingerprint(area, message)
    if (seen.has(print)) return
    // Bounded, because a very long session with many distinct faults would
    // otherwise grow this without end. Forgetting the oldest at most means one
    // very old fault could be reported a second time.
    if (seen.size > 500) seen.clear()
    seen.add(print)

    const report: ErrorReport = {
      id: `${Date.now()}-${print}`,
      at: Date.now(),
      version: app.getVersion(),
      platform: `${process.platform} ${process.arch}`,
      area,
      message: scrub(message),
      detail: scrub([stack, extra].filter(Boolean).join('\n\n')).slice(0, 6000)
    }

    writeLocally(report)
    // Caught here rather than left floating. An unhandled rejection would reach
    // the process-wide handler, which calls straight back into this function.
    void send(report).catch((err: unknown) => {
      logger.warn('Fehlerbericht konnte nicht gesendet werden:', err)
    })
  } catch (err) {
    logger.warn('Fehlerbericht konnte nicht erstellt werden:', err)
  }
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

function shouldSend(): boolean {
  if (!WEBHOOK_URL) return false
  if (getSettings().crashReports !== 'on') return false
  return sentThisSession < MAX_PER_SESSION
}

async function send(report: ErrorReport): Promise<void> {
  if (!shouldSend()) return

  const body = JSON.stringify({
    // No mentions, ever: a report should never be able to ping a whole server.
    allowed_mentions: { parse: [] },
    content: [
      `**${report.area}** in ${report.version} auf ${report.platform}`,
      '```',
      `${report.message}\n\n${report.detail}`.slice(0, MAX_MESSAGE),
      '```'
    ].join('\n')
  })

  await new Promise<void>((done) => {
    try {
      const req = request(
        WEBHOOK_URL,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
          timeout: 8000
        },
        (res) => {
          res.resume()
          if (res.statusCode && res.statusCode >= 400) {
            logger.warn(`Fehlerbericht abgelehnt (HTTP ${res.statusCode})`)
          } else {
            // Counted only once something actually arrived. Counting on the way
            // out meant a revoked webhook or a dead connection used up the whole
            // session's budget without a single report ever landing.
            sentThisSession++
            logger.info(`Fehlerbericht ${report.id} gesendet`)
          }
          done()
        }
      )
      // Every failure path ends the same way: give up quietly. A launcher that
      // cannot report an error must not make a second error out of that.
      req.on('error', (err) => {
        logger.warn('Fehlerbericht konnte nicht gesendet werden:', err)
        done()
      })
      req.on('timeout', () => {
        req.destroy()
        done()
      })
      req.end(body)
    } catch (err) {
      logger.warn('Fehlerbericht konnte nicht gesendet werden:', err)
      done()
    }
  })
}

/* ------------------------------------------------------------------ *
 * For the interface
 * ------------------------------------------------------------------ */

export function listReports(limit = 20): ErrorReport[] {
  const dir = reportsDir()
  if (!existsSync(dir)) return []

  const found: ErrorReport[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      found.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as ErrorReport)
    } catch {
      // One unreadable report must not hide the rest.
    }
  }
  return found.sort((a, b) => b.at - a.at).slice(0, limit)
}

export function clearReports(): void {
  const dir = reportsDir()
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json')) rmSync(join(dir, name), { force: true })
  }
  logger.info('Fehlerberichte gelöscht')
}

/** True when the webhook is configured, so the interface can be honest. */
export function reportingConfigured(): boolean {
  return WEBHOOK_URL.length > 0
}

export function reportsFolder(): string {
  const dir = reportsDir()
  // Created on the way out, because the button in the settings opens this path
  // and the shell refuses a folder that does not exist yet. Before the first
  // fault there is nothing to create it, so "Ordner öffnen" failed on exactly
  // the machines where everything was working.
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // The caller still gets the path; opening it is what may fail then.
  }
  return dir
}
