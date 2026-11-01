/**
 * The beta programme.
 *
 * Beta builds (1.0.25-beta.1 and so on) are not on GitHub but on the admin
 * server, which hands them out only for a valid beta token. A key from the
 * admin panel is redeemed the way the cloud signs in: the server hands out a
 * random id, the launcher registers it with Mojang using its own session, and
 * the server asks Mojang who that was. The key then belongs to that Minecraft
 * account and works nowhere else. The access token never leaves this PC.
 *
 * The beta token lasts 30 days and is renewed the same way before it runs
 * out, with the key kept here for that. When the key is revoked or removed in
 * the panel, the launcher says so once and goes back to the normal updates.
 */
import { app, safeStorage } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { EVENTS } from '@shared/ipc'
import type { BetaStatus } from '@shared/types'
import { isPrerelease } from '@shared/versions'
import { tr } from '@shared/i18n'
import { getActiveAccount, getValidAccessToken } from '../auth/microsoft'
import { emit, notify } from '../events'
import { log } from '../logger'
import { readAccounts, readJson, writeJsonAtomic, type StoredAccount } from '../store'

const logger = log('beta')

/** Overridable for a local test server, never needed otherwise. */
const BETA_URL = (process.env.LG_BETA_URL || 'https://admin.launchgabi.com/api/beta').replace(/\/+$/, '')
const SESSION_SERVER = process.env.LG_BETA_SESSIONSERVER || 'https://sessionserver.mojang.com'

/** Renewed this long before it runs out, so a few days offline cost nothing. */
const RENEW_BEFORE_MS = 5 * 24 * 60 * 60 * 1000

const KEY_PATTERN = /^LGB(-[A-HJ-NP-Z2-9]{4}){4}$/

interface BetaFile {
  key: string
  keySecure: boolean
  token?: string
  tokenSecure?: boolean
  expiresAt?: string
  /** The Minecraft account the key is bound to, without dashes. */
  uuid: string
  playerName: string
  joinedAt: string
  ended?: 'revoked' | 'removed'
}

/** The newest beta on the server, from the last answer that named it. */
let lastBuild: BetaStatus['build'] = null

function betaFile(): string {
  return join(app.getPath('userData'), 'beta.json')
}

function readBeta(): BetaFile | null {
  const stored = readJson<BetaFile | null>(betaFile(), null)
  if (!stored || typeof stored !== 'object' || typeof stored.key !== 'string' || typeof stored.uuid !== 'string') return null
  return stored
}

function writeBeta(value: BetaFile | null): void {
  if (value) writeJsonAtomic(betaFile(), value)
  else rmSync(betaFile(), { force: true })
  emit(EVENTS.betaStatus, betaStatus())
}

function protect(value: string): { value: string; secure: boolean } {
  try {
    if (safeStorage.isEncryptionAvailable()) return { value: safeStorage.encryptString(value).toString('base64'), secure: true }
  } catch (err) {
    logger.warn('safeStorage nicht verfügbar, Beta-Daten werden im Klartext abgelegt:', err)
  }
  return { value, secure: false }
}

function reveal(value: string | undefined, secure: boolean | undefined): string | null {
  if (!value) return null
  if (!secure) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch (err) {
    logger.warn('Beta-Daten konnten nicht entschlüsselt werden:', err)
    return null
  }
}

const plainUuid = (uuid: string): string => uuid.replace(/-/g, '').toLowerCase()

/** The launcher's own account the key belongs to, if it is still signed in here. */
function boundAccount(file: BetaFile): StoredAccount | null {
  try {
    return readAccounts().find((account) => account.type === 'microsoft' && plainUuid(account.uuid) === file.uuid) ?? null
  } catch {
    return null
  }
}

export function betaStatus(): BetaStatus {
  const runningBeta = isPrerelease(app.getVersion())
  const file = readBeta()
  if (!file) return { state: 'none', runningBeta }
  if (file.ended) return { state: 'ended', endedReason: file.ended, playerName: file.playerName, runningBeta }
  return {
    state: 'active',
    playerName: file.playerName,
    accountMissing: !boundAccount(file),
    build: lastBuild,
    runningBeta
  }
}

/* ------------------------------------------------------------------ *
 * Talking to the server
 * ------------------------------------------------------------------ */

/** What the server says for each refusal, in the user's language. */
const SERVER_ERRORS: Record<string, () => string> = {
  unknown: () => tr('Diesen Beta-Key gibt es nicht. Prüfe, ob du ihn richtig abgetippt hast.', 'This beta key does not exist. Check that you typed it correctly.'),
  revoked: () => tr('Dieser Beta-Key ist gesperrt.', 'This beta key has been revoked.'),
  bound: () => tr('Dieser Beta-Key gehört schon zu einem anderen Minecraft-Konto.', 'This beta key already belongs to another Minecraft account.'),
  unverified: () =>
    tr(
      'Mojang konnte dein Minecraft-Konto nicht bestätigen. Melde dich im Launcher einmal neu an und versuche es dann erneut.',
      'Mojang could not confirm your Minecraft account. Sign in again in the launcher and then try once more.'
    ),
  mojang: () => tr('Mojang ist gerade nicht erreichbar. Bitte später noch einmal versuchen.', 'Mojang cannot be reached right now. Please try again later.'),
  challenge: () => tr('Die Prüfung hat zu lange gedauert. Bitte noch einmal versuchen.', 'The check took too long. Please try again.'),
  locked: () => tr('Zu viele Versuche. Bitte eine Minute warten.', 'Too many attempts. Please wait a minute.')
}

class BetaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

async function callBeta<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BETA_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-beta-token': token } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new Error(tr('Keine Verbindung zum Beta-Server. Prüfe deine Internetverbindung.', 'No connection to the beta server. Check your internet connection.'), { cause: err })
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof json.code === 'string' ? json.code : 'http'
    const message = SERVER_ERRORS[code]?.() ?? tr(`Der Beta-Server antwortete mit HTTP ${res.status}.`, `The beta server answered with HTTP ${res.status}.`)
    throw new BetaHttpError(res.status, code, message)
  }
  return json as T
}

interface Redeemed {
  token: string
  expiresAt: string
  name: string
  uuid: string
}

/** Challenge, Mojang, activate: proves this account owns the Minecraft profile. */
async function redeem(key: string, account: StoredAccount): Promise<Redeemed> {
  const { serverId } = await callBeta<{ serverId: string }>('POST', '/challenge', { key })
  const accessToken = await getValidAccessToken(account.id)

  // Exactly what the game does when joining a server.
  let joined: Response
  try {
    joined = await fetch(`${SESSION_SERVER}/session/minecraft/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken, selectedProfile: plainUuid(account.uuid), serverId }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new Error(tr('Mojang ist gerade nicht erreichbar. Prüfe deine Internetverbindung.', 'Mojang cannot be reached right now. Check your internet connection.'), { cause: err })
  }
  if (!joined.ok) {
    logger.warn(`Anmeldung bei Mojang für das Beta-Programm abgelehnt (HTTP ${joined.status})`)
    throw new Error(
      joined.status === 403
        ? tr(
            'Mojang lässt die Bestätigung nicht zu. Das passiert, wenn im Microsoft-Konto das Spielen im Mehrspieler gesperrt ist, etwa bei Kinderkonten.',
            'Mojang does not allow the confirmation. That happens when multiplayer is blocked for the Microsoft account, for example on child accounts.'
          )
        : tr(
            `Mojang hat die Bestätigung abgelehnt (HTTP ${joined.status}). Melde dich im Launcher einmal neu an und versuche es dann erneut.`,
            `Mojang refused the confirmation (HTTP ${joined.status}). Sign in again in the launcher and then try once more.`
          )
    )
  }

  return callBeta<Redeemed>('POST', '/activate', { key, serverId, username: account.username })
}

/* ------------------------------------------------------------------ *
 * Joining and leaving
 * ------------------------------------------------------------------ */

/** Upper case, no spaces; null when it cannot be a key at all. */
export function normaliseKey(input: string): string | null {
  const key = String(input || '').toUpperCase().replace(/\s+/g, '')
  return KEY_PATTERN.test(key) ? key : null
}

export async function joinBeta(input: string): Promise<BetaStatus> {
  const key = normaliseKey(input)
  if (!key) {
    throw new Error(
      tr(
        'Das ist kein gültiger Beta-Key. Er sieht so aus: LGB-XXXX-XXXX-XXXX-XXXX.',
        'That is not a valid beta key. It looks like this: LGB-XXXX-XXXX-XXXX-XXXX.'
      )
    )
  }
  const account = getActiveAccount()
  if (!account || account.type !== 'microsoft') {
    throw new Error(
      tr(
        'Für das Beta-Programm musst du mit einem Microsoft-Konto angemeldet sein. Der Key gehört danach zu diesem Minecraft-Konto.',
        'The beta programme needs a Microsoft account. The key then belongs to that Minecraft account.'
      )
    )
  }

  const result = await redeem(key, account)
  const storedKey = protect(key)
  const storedToken = protect(result.token)
  writeBeta({
    key: storedKey.value,
    keySecure: storedKey.secure,
    token: storedToken.value,
    tokenSecure: storedToken.secure,
    expiresAt: result.expiresAt,
    uuid: plainUuid(result.uuid),
    playerName: result.name,
    joinedAt: new Date().toISOString()
  })
  logger.info(`Beta-Programm beigetreten als ${result.name}`)
  await refreshBeta().catch(() => undefined)
  return betaStatus()
}

/** Back to the normal updates. Also how an `ended` notice is put away. */
export function leaveBeta(): BetaStatus {
  if (readBeta()) {
    writeBeta(null)
    logger.info('Beta-Programm verlassen')
  }
  lastBuild = null
  return betaStatus()
}

/** The key was revoked or removed: say so once and stop using the beta feed. */
function endBeta(file: BetaFile, reason: 'revoked' | 'removed'): void {
  if (file.ended) return
  logger.info(reason === 'revoked' ? 'Beta-Key wurde gesperrt' : 'Beta-Key gilt nicht mehr')
  writeBeta({ ...file, token: undefined, tokenSecure: undefined, expiresAt: undefined, ended: reason })
  lastBuild = null
  notify(
    'warning',
    tr('Nicht mehr im Beta-Programm', 'No longer in the beta programme'),
    (reason === 'revoked'
      ? tr('Dein Beta-Key wurde gesperrt. ', 'Your beta key has been revoked. ')
      : tr('Dein Beta-Key gilt nicht mehr. ', 'Your beta key is no longer valid. ')) +
      tr('Ab jetzt bekommst du wieder die normalen Updates.', 'From now on you get the normal updates again.') +
      // Only true for someone who actually has a beta installed.
      (isPrerelease(app.getVersion())
        ? tr(
            ' Deine Beta-Version bleibt installiert, bis die nächste normale Version erscheint.',
            ' Your beta version stays installed until the next normal version comes out.'
          )
        : ''),
    { route: '/settings?section=updates', timeout: 0 }
  )
}

/**
 * Redeems the stored key again for a fresh token. Ends the membership when
 * the server says the key is revoked, gone or bound to someone else.
 */
async function renew(file: BetaFile): Promise<string | null> {
  // One at a time: the start-up check and an update check asking together
  // would otherwise both go through Mojang for a token each.
  if (!renewing) renewing = renewOnce(file).finally(() => { renewing = null })
  return renewing
}

let renewing: Promise<string | null> | null = null

async function renewOnce(file: BetaFile): Promise<string | null> {
  const key = reveal(file.key, file.keySecure)
  const account = boundAccount(file)
  if (!key || !account) {
    logger.warn(key ? 'Beta-Zugang nicht erneuert, das Konto ist nicht mehr im Launcher angemeldet' : 'Beta-Key ist unlesbar geworden')
    return null
  }
  try {
    const result = await redeem(key, account)
    const storedToken = protect(result.token)
    writeBeta({ ...file, token: storedToken.value, tokenSecure: storedToken.secure, expiresAt: result.expiresAt, playerName: result.name })
    logger.info('Beta-Zugang erneuert')
    return result.token
  } catch (err) {
    if (err instanceof BetaHttpError) {
      if (err.code === 'revoked') endBeta(file, 'revoked')
      else if (err.code === 'unknown' || err.code === 'bound') endBeta(file, 'removed')
    }
    logger.warn('Beta-Zugang nicht erneuert:', err instanceof Error ? err.message : err)
    return null
  }
}

/** A usable beta token, renewed when it is close to running out. Null outside the programme. */
async function validToken(): Promise<string | null> {
  const file = readBeta()
  if (!file || file.ended) return null
  const token = reveal(file.token, file.tokenSecure)
  const expires = file.expiresAt ? Date.parse(file.expiresAt) : 0
  if (token && expires - Date.now() > RENEW_BEFORE_MS) return token
  const fresh = await renew(file)
  if (fresh) return fresh
  // Renewing failed for a passing reason, offline or the account signed out:
  // the old token still works until its date.
  return token && expires > Date.now() ? token : null
}

/**
 * Handles a refusal of the beta token. 403 is a revoked key. 401 means the
 * token is unknown or expired, after the key was unbound in the panel for
 * instance: redeeming again settles which. Returns a fresh token when that
 * worked.
 */
async function onRefused(status: number): Promise<string | null> {
  const file = readBeta()
  if (!file || file.ended) return null
  if (status === 403) {
    endBeta(file, 'revoked')
    return null
  }
  return renew(file)
}

/** Asks the server whether the key still holds, and which beta is current. */
export async function refreshBeta(): Promise<void> {
  let token = await validToken()
  if (!token) return
  for (let attempt = 0; attempt < 2 && token; attempt++) {
    try {
      const answer = await callBeta<{ build: BetaStatus['build'] }>('GET', '/status', undefined, token)
      lastBuild = answer.build ?? null
      emit(EVENTS.betaStatus, betaStatus())
      return
    } catch (err) {
      if (!(err instanceof BetaHttpError) || (err.status !== 401 && err.status !== 403)) {
        logger.warn('Beta-Status nicht abgefragt:', err instanceof Error ? err.message : err)
        return
      }
      token = await onRefused(err.status)
    }
  }
}

/* ------------------------------------------------------------------ *
 * For the updater
 * ------------------------------------------------------------------ */

/** The manifest name electron-updater looks for, `beta.yml` on Windows. */
export function channelFile(channel: string): string {
  if (process.platform === 'darwin') return `${channel}-mac.yml`
  if (process.platform === 'linux') return `${channel}-linux${process.arch === 'x64' ? '' : `-${process.arch}`}.yml`
  return `${channel}.yml`
}

export interface BetaFeed {
  url: string
  token: string
  /** Null when the server has no beta for this system right now. */
  version: string | null
}

/**
 * The beta feed and the version it offers, or null outside the programme.
 * A refused token is handled on the way: renewed, or the membership ended.
 */
export async function betaFeed(): Promise<BetaFeed | null> {
  let token = await validToken()
  const url = `${BETA_URL}/feed`
  for (let attempt = 0; attempt < 2 && token; attempt++) {
    let res: Response
    try {
      res = await fetch(`${url}/${channelFile('beta')}`, { headers: { 'x-beta-token': token }, signal: AbortSignal.timeout(20_000) })
    } catch (err) {
      logger.warn('Beta-Feed nicht erreichbar:', err instanceof Error ? err.message : err)
      return { url, token, version: null }
    }
    if (res.status === 401 || res.status === 403) {
      token = await onRefused(res.status)
      continue
    }
    if (!res.ok) return { url, token, version: null }
    const text = await res.text()
    const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1] ?? null
    if (version) lastBuild = { version, releaseDate: /^releaseDate:\s*['"]?([^'"\s]+)/m.exec(text)?.[1] ?? null }
    return { url, token, version }
  }
  return null
}
