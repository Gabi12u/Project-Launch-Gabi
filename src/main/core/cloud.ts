/**
 * Cloud backups on cloud.launchgabi.com.
 *
 * One backup per instance, at most three instances per account. The account
 * is the Minecraft account itself: the launcher signs in the way a game
 * client joins a server. The cloud hands out a random id, the launcher
 * registers it with Mojang using its own session, and the cloud asks Mojang
 * who that was. The player's access token never leaves this PC.
 *
 * Backups are uploaded exactly as they lie on disk, with a SHA-256 the server
 * checks before it keeps anything. A download is checked against the same
 * sum, taken into the instance's own backup list and restored from there,
 * so it also stays on this PC afterwards.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CloudBackup, CloudOverview, CloudUploadResult } from '@shared/api'
import { getActiveAccount, getValidAccessToken } from '../auth/microsoft'
import { getSettings } from '../store'
import { isValidVersionString, paths } from '../paths'
import { log } from '../logger'
import { TaskCancelledError, withTask, type Task } from '../tasks'
import { addDownloadedBackup, backupArchive, restoreBackup } from './backups'
import { createInstance, getInstance, tryGetInstance } from './instances'
import { formatNumber, tr } from '@shared/i18n'

const logger = log('cloud')

/** Overridable for a local test server, never needed otherwise. */
const CLOUD_URL = (process.env.LG_CLOUD_URL || 'https://cloud.launchgabi.com').replace(/\/+$/, '')
const SESSION_SERVER = process.env.LG_CLOUD_SESSIONSERVER || 'https://sessionserver.mojang.com'

/** Shown on every error that came from the cloud itself, in the user's language. */
const SERVER_ERRORS: Record<string, () => string> = {
  'too-large': () => tr('Das Backup ist zu groß für die Cloud.', 'The backup is too large for the cloud.'),
  'disk-full': () => tr('Auf dem Cloud-Server ist gerade kein Platz. Bitte später noch einmal versuchen.', 'The cloud server is out of space right now. Please try again later.'),
  'slow-down': () => tr('Gerade wurden zu viele Anfragen gestellt. Bitte kurz warten.', 'Too many requests right now. Please wait a moment.'),
  checksum: () => tr('Das Backup kam beschädigt in der Cloud an. Bitte noch einmal versuchen.', 'The backup arrived damaged in the cloud. Please try again.'),
  incomplete: () => tr('Das Backup kam nicht vollständig in der Cloud an. Bitte noch einmal versuchen.', 'The backup did not arrive completely in the cloud. Please try again.'),
  'not-found': () => tr('Dieses Cloud-Backup gibt es nicht mehr.', 'This cloud backup no longer exists.'),
  'not-verified': () => tr('Mojang hat die Anmeldung bei der Cloud nicht bestätigt.', 'Mojang did not confirm the sign-in to the cloud.')
}

class CloudHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

function requestFor(url: string): typeof httpsRequest {
  return url.startsWith('http://') ? (httpRequest as unknown as typeof httpsRequest) : httpsRequest
}

/** A JSON request to the cloud. Throws `CloudHttpError` for every error answer. */
async function callJson<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CLOUD_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new Error(tr('Keine Verbindung zur Launch-Gabi-Cloud. Prüfe deine Internetverbindung.', 'No connection to the Launch Gabi cloud. Check your internet connection.'), { cause: err })
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof json.code === 'string' ? json.code : 'http'
    const message = SERVER_ERRORS[code]?.() ?? (typeof json.error === 'string' ? json.error : tr(`Die Cloud antwortete mit HTTP ${res.status}.`, `The cloud answered with HTTP ${res.status}.`))
    throw new CloudHttpError(res.status, code, message, json)
  }
  return json as T
}

/* ------------------------------------------------------------------ *
 * Sign-in
 * ------------------------------------------------------------------ */

interface CloudSession {
  accountId: string
  token: string
  expiresAt: number
}

let session: CloudSession | null = null
let signingIn: Promise<CloudSession> | null = null

/** The signed-in Microsoft account, or a sentence saying why there is none. */
function cloudAccount(): { id: string; username: string; uuid: string } {
  const account = getActiveAccount()
  if (!account || account.type !== 'microsoft') {
    throw new Error(
      tr(
        'Cloud-Backups gibt es nur mit einem Microsoft-Konto. Melde dich in der Seitenleiste mit Microsoft an.',
        'Cloud backups need a Microsoft account. Sign in with Microsoft in the sidebar.'
      )
    )
  }
  return account
}

async function signIn(account: { id: string; username: string; uuid: string }): Promise<CloudSession> {
  const { serverId } = await callJson<{ serverId: string }>('POST', '/api/auth/launcher/challenge')
  const accessToken = await getValidAccessToken(account.id)

  // Exactly what the game does when joining a server.
  let joined: Response
  try {
    joined = await fetch(`${SESSION_SERVER}/session/minecraft/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken, selectedProfile: account.uuid.replace(/-/g, ''), serverId }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new Error(tr('Mojang ist gerade nicht erreichbar. Prüfe deine Internetverbindung.', 'Mojang cannot be reached right now. Check your internet connection.'), { cause: err })
  }
  if (!joined.ok) {
    logger.warn(`Anmeldung bei Mojang für die Cloud abgelehnt (HTTP ${joined.status})`)
    throw new Error(
      joined.status === 403
        ? tr(
            'Mojang lässt die Anmeldung bei der Cloud nicht zu. Das passiert, wenn im Microsoft-Konto das Spielen im Mehrspieler gesperrt ist, etwa bei Kinderkonten.',
            'Mojang does not allow signing in to the cloud. That happens when multiplayer is blocked for the Microsoft account, for example on child accounts.'
          )
        : tr(
            `Mojang hat die Anmeldung bei der Cloud abgelehnt (HTTP ${joined.status}). Melde dich im Launcher einmal neu an und versuche es dann erneut.`,
            `Mojang refused the sign-in to the cloud (HTTP ${joined.status}). Sign in again in the launcher and then try once more.`
          )
    )
  }

  const verified = await callJson<{ token: string; expiresAt: number }>('POST', '/api/auth/launcher/verify', {
    username: account.username,
    serverId
  })
  return { accountId: account.id, token: verified.token, expiresAt: verified.expiresAt }
}

/** A valid cloud session for the active account, signing in when needed. */
async function cloudSession(): Promise<CloudSession> {
  const account = cloudAccount()
  if (session && session.accountId === account.id && session.expiresAt - 60_000 > Date.now()) return session
  // One sign-in at a time: the overview and an upload asking together must
  // not both start their own.
  if (!signingIn) {
    signingIn = signIn(account).finally(() => {
      signingIn = null
    })
  }
  session = await signingIn
  return session
}

/** A JSON call with the session, signing in again once if it has expired on the server. */
async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  const first = await cloudSession()
  try {
    return await callJson<T>(method, path, body, first.token)
  } catch (err) {
    if (!(err instanceof CloudHttpError) || err.status !== 401) throw err
    session = null
    const fresh = await cloudSession()
    return callJson<T>(method, path, body, fresh.token)
  }
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

export async function cloudOverview(): Promise<CloudOverview> {
  const account = getActiveAccount()
  if (!account || account.type !== 'microsoft') return { available: false, backups: [] }
  const result = await authed<{ backups: CloudBackup[]; account: CloudOverview['account'] }>('GET', '/api/backups')
  return { available: true, playerName: account.username, backups: result.backups, account: result.account, website: CLOUD_URL }
}

function assertConsent(): void {
  if (getSettings().cloudBackups !== 'on') {
    throw new Error(tr('Bitte bestätige zuerst den Hinweis zu Cloud-Backups.', 'Please accept the note on cloud backups first.'))
  }
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

function sha256File(file: string, task: Task): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    const onAbort = (): void => {
      stream.destroy()
      reject(new TaskCancelledError())
    }
    task.signal.addEventListener('abort', onAbort, { once: true })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => {
      task.signal.removeEventListener('abort', onAbort)
      resolvePromise(hash.digest('hex'))
    })
  })
}

function megabytes(bytes: number): string {
  return `${formatNumber(bytes / 1024 / 1024, 1)} MB`
}

/** Streams a file to the cloud with progress. Resolves with the parsed answer. */
function putFile(
  path: string,
  file: string,
  size: number,
  headers: Record<string, string>,
  token: string,
  task: Task
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolvePromise, reject) => {
    const url = `${CLOUD_URL}${path}`
    const req = requestFor(url)(
      url,
      {
        method: 'PUT',
        headers: { ...headers, 'content-length': String(size), authorization: `Bearer ${token}` }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          let json: Record<string, unknown> = {}
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          } catch {
            json = {}
          }
          resolvePromise({ status: res.statusCode ?? 0, json })
        })
        res.on('error', reject)
      }
    )
    let sent = 0
    let lastReport = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        sent += chunk.length
        if (Date.now() - lastReport > 200) {
          lastReport = Date.now()
          task.update(
            tr(`${megabytes(sent)} von ${megabytes(size)} hochgeladen`, `${megabytes(sent)} of ${megabytes(size)} uploaded`),
            sent / size
          )
        }
        done(null, chunk)
      }
    })
    const onAbort = (): void => {
      req.destroy()
      reject(new TaskCancelledError())
    }
    task.signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', (err) => {
      if (task.signal.aborted) return
      reject(new Error(tr('Die Verbindung zur Cloud ist abgebrochen. Bitte noch einmal versuchen.', 'The connection to the cloud dropped. Please try again.'), { cause: err }))
    })
    pipeline(createReadStream(file), meter, req).catch(() => {
      // Reported through the request's own error above.
    })
  })
}

/**
 * Puts a local backup into the cloud as the backup of its instance.
 *
 * With all three places taken by other instances and no `replace`, nothing
 * is uploaded and the three are returned, so the user can pick one.
 */
export async function uploadToCloud(instanceId: string, backupId: string, replace?: string): Promise<CloudUploadResult> {
  assertConsent()
  const { entry, file } = backupArchive(instanceId, backupId)
  const instance = getInstance(instanceId)
  const size = statSync(file).size

  // Asked before the upload starts: a full cloud is a question for the user,
  // not a failed task in the list.
  const overview = await authed<{ backups: CloudBackup[]; account: NonNullable<CloudOverview['account']> }>('GET', '/api/backups')
  const taken = overview.backups.some((b) => b.instanceKey === instanceId)
  if (!taken && overview.backups.length >= overview.account.limits.maxInstances && !replace) {
    return { status: 'full', backups: overview.backups }
  }
  if (size > overview.account.limits.maxBackupBytes) {
    throw new Error(
      tr(
        `Dieses Backup ist ${megabytes(size)} groß. In die Cloud passen höchstens ${megabytes(overview.account.limits.maxBackupBytes)} pro Backup. Ein Backup ohne Mods oder Screenshots ist meist deutlich kleiner.`,
        `This backup is ${megabytes(size)}. The cloud takes at most ${megabytes(overview.account.limits.maxBackupBytes)} per backup. A backup without mods or screenshots is usually much smaller.`
      )
    )
  }

  const meta = {
    instanceName: instance.name,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    includes: entry.includes,
    createdAt: entry.createdAt
  }

  const backup = await withTask(
    tr(`${instance.name} in die Cloud`, `${instance.name} to the cloud`),
    tr('Prüfsumme wird berechnet…', 'Computing checksum…'),
    instanceId,
    async (task) => {
      const sha256 = await sha256File(file, task)
      task.throwIfCancelled()
      const path = `/api/backups/${encodeURIComponent(instanceId)}${replace ? `?replace=${encodeURIComponent(replace)}` : ''}`
      const headers = {
        'x-backup-meta': Buffer.from(JSON.stringify(meta)).toString('base64url'),
        'x-content-sha256': sha256
      }
      let answer = await putFile(path, file, size, headers, (await cloudSession()).token, task)
      if (answer.status === 401) {
        // The session ran out on the server mid-way: once more with a new one.
        session = null
        answer = await putFile(path, file, size, headers, (await cloudSession()).token, task)
      }
      if (answer.status !== 201) {
        const code = typeof answer.json.code === 'string' ? answer.json.code : 'http'
        throw new Error(SERVER_ERRORS[code]?.() ?? (typeof answer.json.error === 'string' ? answer.json.error : tr(`Die Cloud antwortete mit HTTP ${answer.status}.`, `The cloud answered with HTTP ${answer.status}.`)))
      }
      task.update(tr('In der Cloud gespeichert', 'Saved in the cloud'), 1)
      return answer.json.backup as CloudBackup
    }
  )
  logger.info(`Backup von ${instanceId} in die Cloud geladen (${megabytes(size)})`)
  return { status: 'uploaded', backup }
}

/* ------------------------------------------------------------------ *
 * Download
 * ------------------------------------------------------------------ */

/** Downloads a cloud backup into a file, checking its size and checksum. */
function downloadTo(instanceKey: string, target: string, expected: CloudBackup, token: string, task: Task): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const url = `${CLOUD_URL}/api/backups/${encodeURIComponent(instanceKey)}/download`
    const req = requestFor(url)(url, { headers: { authorization: `Bearer ${token}` } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return resolvePromise(res.statusCode ?? 0)
      }
      const hash = createHash('sha256')
      let received = 0
      let lastReport = 0
      const meter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          received += chunk.length
          hash.update(chunk)
          if (Date.now() - lastReport > 200) {
            lastReport = Date.now()
            task.update(
              tr(`${megabytes(received)} von ${megabytes(expected.size)} geladen`, `${megabytes(received)} of ${megabytes(expected.size)} downloaded`),
              received / Math.max(expected.size, 1)
            )
          }
          done(null, chunk)
        }
      })
      pipeline(res, meter, createWriteStream(target))
        .then(() => {
          if (received !== expected.size || hash.digest('hex') !== expected.sha256) {
            reject(new Error(tr('Das Cloud-Backup kam unvollständig oder beschädigt an. Bitte noch einmal versuchen.', 'The cloud backup arrived incomplete or damaged. Please try again.')))
            return
          }
          resolvePromise(200)
        })
        .catch((err: unknown) => {
          if (task.signal.aborted) return reject(new TaskCancelledError())
          reject(new Error(tr('Die Verbindung zur Cloud ist abgebrochen. Bitte noch einmal versuchen.', 'The connection to the cloud dropped. Please try again.'), { cause: err }))
        })
    })
    const onAbort = (): void => {
      req.destroy()
      reject(new TaskCancelledError())
    }
    task.signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', (err) => {
      if (task.signal.aborted) return
      reject(new Error(tr('Keine Verbindung zur Launch-Gabi-Cloud. Prüfe deine Internetverbindung.', 'No connection to the Launch Gabi cloud. Check your internet connection.'), { cause: err }))
    })
    req.end()
  })
}

/**
 * Brings a cloud backup to this PC and restores it.
 *
 * `into` is an instance on this PC to restore into. Without one, a new
 * instance is created from what the backup says about itself: name,
 * Minecraft version and mod loader.
 */
export async function downloadFromCloud(instanceKey: string, into?: string): Promise<{ instanceId: string; created: boolean }> {
  assertConsent()
  const { backups } = await authed<{ backups: CloudBackup[] }>('GET', '/api/backups')
  const backup = backups.find((b) => b.instanceKey === instanceKey)
  if (!backup) throw new Error(SERVER_ERRORS['not-found']())
  if (into && !tryGetInstance(into)) throw new Error(tr('Diese Instanz gibt es auf diesem PC nicht mehr.', 'This instance no longer exists on this PC.'))
  if (!into && (!isValidVersionString(backup.mcVersion) || (backup.loaderVersion && !isValidVersionString(backup.loaderVersion)))) {
    throw new Error(tr('Die Angaben zur Version in diesem Cloud-Backup sind ungültig.', 'The version details in this cloud backup are invalid.'))
  }

  mkdirSync(paths.cache(), { recursive: true })
  const temp = join(paths.cache(), `cloud-${randomUUID()}.zip`)
  try {
    await withTask(
      tr(`${backup.instanceName} aus der Cloud`, `${backup.instanceName} from the cloud`),
      tr('Wird geladen…', 'Downloading…'),
      into,
      async (task) => {
        let status = await downloadTo(instanceKey, temp, backup, (await cloudSession()).token, task)
        if (status === 401) {
          session = null
          status = await downloadTo(instanceKey, temp, backup, (await cloudSession()).token, task)
        }
        if (status === 404) throw new Error(SERVER_ERRORS['not-found']())
        if (status !== 200) throw new Error(tr(`Die Cloud antwortete mit HTTP ${status}.`, `The cloud answered with HTTP ${status}.`))
        task.update(tr('Heruntergeladen', 'Downloaded'), 1)
      }
    )

    let instanceId = into
    let created = false
    if (!instanceId) {
      const instance = await createInstance({
        name: backup.instanceName,
        mcVersion: backup.mcVersion,
        loader: backup.loader,
        loaderVersion: backup.loaderVersion || undefined,
        description: tr('Aus der Launch-Gabi-Cloud', 'From the Launch Gabi cloud')
      })
      instanceId = instance.id
      created = true
    }

    const entry = await addDownloadedBackup(instanceId, temp, {
      name: tr(
        `Aus der Cloud, hochgeladen am ${new Date(backup.uploadedAt).toLocaleDateString()}`,
        `From the cloud, uploaded on ${new Date(backup.uploadedAt).toLocaleDateString()}`
      ),
      includes: backup.includes,
      createdAt: backup.createdAt
    })
    await restoreBackup(instanceId, entry.id)
    logger.info(`Cloud-Backup ${instanceKey} in ${instanceId} eingespielt${created ? ' (neue Instanz)' : ''}`)
    return { instanceId, created }
  } finally {
    rmSync(temp, { force: true })
  }
}

/* ------------------------------------------------------------------ *
 * Deleting
 * ------------------------------------------------------------------ */

export async function deleteFromCloud(instanceKey: string): Promise<void> {
  await authed('DELETE', `/api/backups/${encodeURIComponent(instanceKey)}`)
}

export async function deleteCloudAccount(): Promise<void> {
  await authed('DELETE', '/api/account')
  session = null
}
