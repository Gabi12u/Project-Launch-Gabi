import { safeStorage } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import type { Account, DeviceCodePrompt } from '@shared/types'
import { EVENTS } from '@shared/ipc'
import { emit } from '../events'
import { getSettings, readAccounts, writeAccounts, type StoredAccount } from '../store'
import { fetchJson, httpRequest, HttpError } from '../core/net'
import { log } from '../logger'

const logger = log('auth')

/*
 * Microsoft runs two separate OAuth systems and the right one depends on how
 * the application was registered:
 *
 *   - Apps registered in Azure AD have a GUID as client id and use the
 *     `login.microsoftonline.com` consumers tenant.
 *   - Legacy Microsoft-Account apps (including the official Minecraft
 *     launcher, id 00000000402b5328) only exist in the older `login.live.com`
 *     system and are rejected by Azure AD with AADSTS700016.
 *
 * Both speak the device code flow, so we pick the endpoint pair by client id.
 */
const AZURE_DEVICE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const AZURE_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const LIVE_DEVICE_URL = 'https://login.live.com/oauth20_connect.srf'
const LIVE_TOKEN_URL = 'https://login.live.com/oauth20_token.srf'

const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const MC_ENTITLEMENTS_URL = 'https://api.minecraftservices.com/entitlements/mcstore'

const SCOPE = 'XboxLive.signin offline_access'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Endpoints {
  device: string
  token: string
  /** `login.live.com` insists on an explicit response type. */
  deviceExtra: Record<string, string>
  kind: 'azure' | 'live'
}

function endpointsFor(clientId: string): Endpoints {
  if (GUID.test(clientId.trim())) {
    return { device: AZURE_DEVICE_URL, token: AZURE_TOKEN_URL, deviceExtra: {}, kind: 'azure' }
  }
  return {
    device: LIVE_DEVICE_URL,
    token: LIVE_TOKEN_URL,
    deviceExtra: { response_type: 'device_code' },
    kind: 'live'
  }
}

/* ------------------------------------------------------------------ *
 * Token storage
 * ------------------------------------------------------------------ */

function encrypt(value: string): { value: string; secure: boolean } {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { value: safeStorage.encryptString(value).toString('base64'), secure: true }
    }
  } catch (err) {
    logger.warn('safeStorage nicht verfügbar:', err)
  }
  return { value, secure: false }
}

function decrypt(value: string, secure: boolean | undefined): string {
  if (!secure) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch (err) {
    logger.warn('Token konnte nicht entschlüsselt werden:', err)
    return ''
  }
}

/* ------------------------------------------------------------------ *
 * OAuth device code flow
 * ------------------------------------------------------------------ */

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
  /** Only Azure AD sends a ready-made instruction text. */
  message?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface XboxResponse {
  Token: string
  DisplayClaims: { xui: { uhs: string }[] }
}

interface MinecraftLoginResponse {
  access_token: string
  expires_in: number
  username: string
}

interface MinecraftProfile {
  id: string
  name: string
  skins?: { url: string; state: string; variant?: string }[]
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  }
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  }
}

/**
 * Every login whose poll loop has not exited yet.
 *
 * A single slot meant a second login attempt silently orphaned the first: its
 * loop kept polling, unreachable by `cancelLogin`, and could still push its
 * own (expired) device code over the one the user was looking at.
 */
const activeLogins = new Set<{ cancelled: boolean }>()

export function cancelLogin(): void {
  for (const session of activeLogins) session.cancelled = true
}

/**
 * Runs the full Microsoft -> Xbox Live -> XSTS -> Minecraft chain.
 * The user code is pushed to the renderer so the UI can show it while we poll.
 */
export async function loginWithMicrosoft(): Promise<Account> {
  const clientId = getSettings().microsoftClientId
  if (!clientId) {
    throw new Error(
      'Es ist keine Microsoft-Anwendungs-ID hinterlegt. Trage sie in den Einstellungen unter "Accounts" ein.'
    )
  }

  const session = { cancelled: false }
  // Starting a new login retires any older one, so only the code currently on
  // screen belongs to a loop that is still allowed to talk to the UI.
  for (const previous of activeLogins) previous.cancelled = true
  activeLogins.add(session)

  const endpoints = endpointsFor(clientId)
  logger.info(`Anmeldung über ${endpoints.kind === 'live' ? 'login.live.com' : 'Azure AD'}`)

  try {
    const device = await fetchJson<DeviceCodeResponse>(
      endpoints.device,
      form({ client_id: clientId, scope: SCOPE, ...endpoints.deviceExtra })
    )

    const prompt: DeviceCodePrompt = {
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresIn: device.expires_in,
      message:
        device.message ??
        `Öffne ${device.verification_uri} und gib den Code ${device.user_code} ein.`
    }
    emit(EVENTS.deviceCode, prompt)
    logger.info(`Device-Code ${device.user_code} ausgegeben, gültig ${device.expires_in}s`)

    const token = await pollForToken(clientId, device, session, endpoints)
    const account = await completeMinecraftLogin(token)

    emit(EVENTS.deviceCode, null)
    return account
  } finally {
    activeLogins.delete(session)
  }
}

async function pollForToken(
  clientId: string,
  device: DeviceCodeResponse,
  session: { cancelled: boolean },
  endpoints: Endpoints
): Promise<TokenResponse> {
  const deadline = Date.now() + device.expires_in * 1000
  let interval = Math.max(device.interval, 1) * 1000

  while (Date.now() < deadline) {
    if (session.cancelled) throw new Error('Anmeldung abgebrochen')
    await new Promise((resolve) => setTimeout(resolve, interval))
    if (session.cancelled) throw new Error('Anmeldung abgebrochen')

    try {
      const res = await httpRequest(
        endpoints.token,
        form({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: clientId,
          device_code: device.device_code
        }),
        0
      )
      return (await res.json()) as TokenResponse
    } catch (err) {
      if (!(err instanceof HttpError)) throw err

      // Until the user finishes in the browser, both systems answer with an
      // error code rather than a token.
      switch (err.code) {
        case 'authorization_pending':
          continue
        case 'slow_down':
          interval += 5000
          continue
        case 'authorization_declined':
          throw new Error('Die Anmeldung wurde im Browser abgelehnt.')
        case 'expired_token':
        case 'code_expired':
          throw new Error('Der Anmeldecode ist abgelaufen. Bitte erneut versuchen.')
        case 'bad_verification_code':
          throw new Error('Der Anmeldecode wurde nicht akzeptiert. Bitte erneut versuchen.')
        default:
          break
      }

      // Rate limiting without a code, or a body we could not parse.
      if (err.status === 429) {
        interval += 5000
        continue
      }
      if (err.status === 400 && !err.code) continue

      throw err
    }
  }

  throw new Error('Der Anmeldecode ist abgelaufen. Bitte erneut versuchen.')
}

async function xboxLogin(microsoftAccessToken: string): Promise<{ token: string; uhs: string }> {
  const xbl = await fetchJson<XboxResponse>(
    XBL_URL,
    json({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${microsoftAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  )

  const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs
  if (!uhs) throw new Error('Xbox Live hat keine Benutzerkennung geliefert')
  return { token: xbl.Token, uhs }
}

async function xstsAuthorize(xblToken: string): Promise<{ token: string; uhs: string }> {
  try {
    const xsts = await fetchJson<XboxResponse>(
      XSTS_URL,
      json({
        Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      })
    )
    const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs
    // Same guard as `xboxLogin`: a 200 with an unexpected body shape would
    // otherwise surface as a raw TypeError instead of a readable message.
    if (!uhs) throw new Error('XSTS hat keine Benutzerkennung geliefert')
    return { token: xsts.Token, uhs }
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new Error(
        'Dieses Microsoft-Konto hat kein Xbox-Profil oder unterliegt einer Kindersicherung. ' +
          'Melde dich einmal auf minecraft.net an und versuche es erneut.'
      )
    }
    throw err
  }
}

async function completeMinecraftLogin(token: TokenResponse): Promise<Account> {
  const xbl = await xboxLogin(token.access_token)
  const xsts = await xstsAuthorize(xbl.token)

  const mc = await fetchJson<MinecraftLoginResponse>(
    MC_LOGIN_URL,
    json({ identityToken: `XBL3.0 x=${xsts.uhs};${xsts.token}` })
  )

  // A missing entitlement means the account does not own the game; the profile
  // request below would fail with a confusing 404 otherwise.
  // The answer is kept apart from whether we got one at all. Telling the two
  // cases apart used to rely on the German word "Lizenz" appearing in the
  // thrown message, so a timeout, a 429 or an edit to that message text would
  // silently disable the check.
  let owned: boolean | null = null
  try {
    const entitlements = await fetchJson<{ items: { name: string }[] }>(MC_ENTITLEMENTS_URL, {
      headers: { Authorization: `Bearer ${mc.access_token}` }
    })
    owned = Boolean(entitlements.items?.length)
  } catch (err) {
    // A transient failure is no evidence either way, so the check is skipped
    // rather than turned into a false "no licence".
    logger.warn('Lizenzprüfung übersprungen:', err)
  }

  if (owned === false) {
    throw new Error('Dieses Konto besitzt keine Minecraft-Java-Edition-Lizenz.')
  }

  const profile = await fetchJson<MinecraftProfile>(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mc.access_token}` }
  })

  const uuid = formatUuid(profile.id)
  const skin = profile.skins?.find((s) => s.state === 'ACTIVE')?.url

  const accounts = readAccounts()
  const existingIndex = accounts.findIndex((a) => a.uuid === uuid && a.type === 'microsoft')

  const accessEnc = encrypt(mc.access_token)
  const refreshEnc = token.refresh_token ? encrypt(token.refresh_token) : undefined

  const stored: StoredAccount = {
    id: existingIndex >= 0 ? accounts[existingIndex].id : randomUUID(),
    type: 'microsoft',
    username: profile.name,
    uuid,
    expiresAt: Date.now() + mc.expires_in * 1000,
    skinUrl: skin,
    active: true,
    accessToken: accessEnc.value,
    refreshToken: refreshEnc?.value,
    secure: accessEnc.secure
  }

  const next = accounts.map((a) => ({ ...a, active: false }))
  if (existingIndex >= 0) next[existingIndex] = stored
  else next.push(stored)

  writeAccounts(next)
  logger.info(`Microsoft-Account ${profile.name} angemeldet`)

  return toPublicAccount(stored)
}

function formatUuid(raw: string): string {
  if (raw.includes('-')) return raw
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    raw.slice(12, 16),
    raw.slice(16, 20),
    raw.slice(20)
  ].join('-')
}

/* ------------------------------------------------------------------ *
 * Refresh
 * ------------------------------------------------------------------ */

/**
 * Account id -> in-flight refresh.
 *
 * A refresh token is single use: the moment one grant succeeds, Microsoft
 * invalidates the token the other caller is still holding. Two concurrent
 * calls — launching while the account panel validates the same session is
 * enough — would leave the loser with `invalid_grant` and send the user
 * through a full re-login for nothing.
 */
const refreshing = new Map<string, Promise<string>>()

/** Returns a valid Minecraft access token, refreshing it when needed. */
export async function getValidAccessToken(accountId: string): Promise<string> {
  const accounts = readAccounts()
  const account = accounts.find((a) => a.id === accountId)
  if (!account) throw new Error('Account nicht gefunden')
  if (account.type === 'offline') return ''

  const stillValid = account.expiresAt && account.expiresAt - 60_000 > Date.now()
  if (stillValid && account.accessToken) {
    return decrypt(account.accessToken, account.secure)
  }

  const running = refreshing.get(accountId)
  if (running) return running

  const run = refreshAccessToken(accountId).finally(() => {
    refreshing.delete(accountId)
  })
  refreshing.set(accountId, run)
  return run
}

async function refreshAccessToken(accountId: string): Promise<string> {
  // Re-read rather than reusing the caller's snapshot: whoever won a race for
  // this account may have written fresh tokens while we were queued.
  const accounts = readAccounts()
  const account = accounts.find((a) => a.id === accountId)
  if (!account) throw new Error('Account nicht gefunden')

  const stillValid = account.expiresAt && account.expiresAt - 60_000 > Date.now()
  if (stillValid && account.accessToken) {
    return decrypt(account.accessToken, account.secure)
  }

  const refreshToken = account.refreshToken ? decrypt(account.refreshToken, account.secure) : ''
  if (!refreshToken) {
    throw new Error(`Die Sitzung von ${account.username} ist abgelaufen. Bitte neu anmelden.`)
  }

  logger.info(`Erneuere Token für ${account.username}`)

  const clientId = getSettings().microsoftClientId
  const token = await fetchJson<TokenResponse>(
    endpointsFor(clientId).token,
    form({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE
    })
  )

  const xbl = await xboxLogin(token.access_token)
  const xsts = await xstsAuthorize(xbl.token)
  const mc = await fetchJson<MinecraftLoginResponse>(
    MC_LOGIN_URL,
    json({ identityToken: `XBL3.0 x=${xsts.uhs};${xsts.token}` })
  )

  const accessEnc = encrypt(mc.access_token)
  const refreshEnc = token.refresh_token ? encrypt(token.refresh_token) : undefined

  // The profile carries the currently worn skin. Without re-reading it here the
  // stored skinUrl stays frozen at whatever it was during the very first login,
  // so a player who changes their skin keeps seeing the old head forever.
  // A failure here must not cost the caller its token, so it degrades to the
  // previous value.
  let skinUrl: string | undefined
  try {
    const profile = await fetchJson<MinecraftProfile>(MC_PROFILE_URL, {
      headers: { Authorization: `Bearer ${mc.access_token}` }
    })
    skinUrl = profile.skins?.find((s) => s.state === 'ACTIVE')?.url
  } catch (err) {
    logger.warn(`Profil von ${account.username} nicht erneuerbar, Skin bleibt wie er war:`, err)
  }

  // Re-read immediately before writing rather than reusing the snapshot from
  // the top of this function. The four network calls above take seconds, and
  // writeAccounts overwrites the whole file: anything the user did meanwhile
  // (removing an account, adding an offline profile, switching the active one)
  // would otherwise be silently rolled back.
  const latest = readAccounts()
  if (latest.some((a) => a.id === accountId)) {
    writeAccounts(
      latest.map((a) =>
        a.id === accountId
          ? {
              ...a,
              accessToken: accessEnc.value,
              refreshToken: refreshEnc?.value ?? a.refreshToken,
              secure: accessEnc.secure,
              expiresAt: Date.now() + mc.expires_in * 1000,
              skinUrl: skinUrl ?? a.skinUrl
            }
          : a
      )
    )
  } else {
    // Removed while we were refreshing. Handing back the token lets the
    // operation that asked for it finish, but the account stays deleted.
    logger.info(`${account.username} wurde waehrend der Erneuerung entfernt, nicht zurueckgeschrieben`)
  }

  return mc.access_token
}

/* ------------------------------------------------------------------ *
 * Offline accounts
 * ------------------------------------------------------------------ */

/** Offline UUIDs follow Mojang's `OfflinePlayer:<name>` MD5 scheme. */
export function offlineUuid(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`).digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return formatUuid(hex)
}

export function createOfflineAccount(username: string): Account {
  const clean = username.trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) {
    throw new Error('Der Name muss 3-16 Zeichen lang sein und darf nur Buchstaben, Zahlen und _ enthalten.')
  }

  const accounts = readAccounts().map((a) => ({ ...a, active: false }))
  const uuid = offlineUuid(clean)

  const existing = accounts.find((a) => a.type === 'offline' && a.uuid === uuid)
  if (existing) {
    existing.active = true
    writeAccounts(accounts)
    return toPublicAccount(existing)
  }

  const account: StoredAccount = {
    id: randomUUID(),
    type: 'offline',
    username: clean,
    uuid,
    active: true
  }
  accounts.push(account)
  writeAccounts(accounts)
  return toPublicAccount(account)
}

/* ------------------------------------------------------------------ *
 * Account list management
 * ------------------------------------------------------------------ */

export function toPublicAccount(account: StoredAccount): Account {
  return {
    id: account.id,
    type: account.type,
    username: account.username,
    uuid: account.uuid,
    expiresAt: account.expiresAt,
    skinUrl: account.skinUrl,
    active: account.active
  }
}

export function listAccounts(): Account[] {
  return readAccounts().map(toPublicAccount)
}

export function getActiveAccount(): StoredAccount | null {
  const accounts = readAccounts()
  return accounts.find((a) => a.active) ?? accounts[0] ?? null
}

export function setActiveAccount(id: string): Account[] {
  const accounts = readAccounts().map((a) => ({ ...a, active: a.id === id }))
  writeAccounts(accounts)
  return accounts.map(toPublicAccount)
}

export function removeAccount(id: string): Account[] {
  const accounts = readAccounts().filter((a) => a.id !== id)
  // Never leave the launcher without an active account when one remains.
  if (accounts.length > 0 && !accounts.some((a) => a.active)) accounts[0].active = true
  writeAccounts(accounts)
  return accounts.map(toPublicAccount)
}
