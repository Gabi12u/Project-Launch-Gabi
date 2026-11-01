/**
 * Prueft das Beta-Programm im Launcher:
 *
 *   node scripts/test-beta-programme.mjs
 *
 * Der Beta-Server, Mojang und GitHub sind durch eine nachgebaute
 * Gegenstelle ersetzt, electron-updater durch eine Attrappe, die sich merkt,
 * wohin er zeigen sollte. Echt sind beta.ts, updater.ts, die Ablage der
 * Konten und die Reihenfolge der Versionen.
 *
 * 1. Versionen: eine Beta kommt vor ihrer Version, danach geht es weiter.
 * 2. Ohne Beta-Programm bleibt der Updater, wie er ausgeliefert wurde.
 * 3. Beitreten: falscher Key, Offline-Konto, fremdes Konto, dann richtig.
 *    Das Token liegt nur verschluesselt auf der Platte.
 * 4. Mit Beta-Programm zeigt der Updater auf den Beta-Feed, solange die
 *    Beta vorne liegt, und das Token geht nur an den Beta-Server.
 * 5. Erscheint die richtige Version, kommt sie von GitHub, ohne Token.
 * 6. Ein Token kurz vor Ablauf wird ueber Mojang erneuert.
 * 7. Zurueckgesetzt (401): neu einloesen und weiter.
 * 8. Gesperrt (403): einmal Bescheid, zurueck auf GitHub.
 * 9. Geloescht: einmal Bescheid, als "gilt nicht mehr".
 * 10. Wer dabei ist, sendet Fehlerberichte, auch mit ausgeschalteter
 *     Einstellung. Nach dem Verlassen gilt wieder die Einstellung.
 * 11. Mac: der Knopf laedt die passende Beta, prueft die Pruefsumme und
 *     oeffnet sie. Eine beschaedigte Datei bleibt nicht liegen.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-beta-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

const BETA = 'https://admin.test.invalid/api/beta'
const SESSION = 'https://session.test.invalid'
const ALICE = { id: 'acc-alice', uuid: '0f0e0d0c-0b0a-4908-8776-655443322110', name: 'Alice', access: 'mc-access-alice' }
const BOB = { id: 'acc-bob', uuid: '11111111-2222-3333-4444-555555555555', name: 'Bob', access: 'mc-access-bob' }
const plain = (uuid) => uuid.replace(/-/g, '')

/* --- The other side: beta server, Mojang and GitHub ------------------- */

const server = {
  keys: new Map(),
  challenges: new Map(),
  joins: new Map(),
  betaVersion: '1.0.25-beta.1',
  stableVersion: '1.0.24',
  macDownloads: [],
  damageMac: false,
  tokenDays: 30,
  counter: 0,
  requests: []
}
function addKey(key) {
  server.keys.set(key, { uuid: null, revoked: false, tokens: new Map() })
}
function findToken(token) {
  for (const entry of server.keys.values()) if (entry.tokens.has(token)) return entry
  return null
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
  const body = init.body ? JSON.parse(init.body) : {}
  server.requests.push({ url: url.href, headers })

  if (url.origin === SESSION && url.pathname === '/session/minecraft/join') {
    const who = [ALICE, BOB].find((a) => a.access === body.accessToken && plain(a.uuid) === body.selectedProfile)
    if (!who) return new Response('', { status: 403 })
    server.joins.set(body.serverId, who)
    return new Response(null, { status: 204 })
  }

  if (url.hostname === 'github.com') {
    if (url.pathname.endsWith('/latest.yml')) return new Response(`version: ${server.stableVersion}\npath: x.exe\n`, { status: 200 })
    return new Response('nicht da', { status: 404 })
  }

  if (!url.href.startsWith(BETA)) return new Response('unerwartet', { status: 599 })
  const path = url.href.slice(BETA.length)

  if (path === '/challenge') {
    const entry = server.keys.get(body.key)
    if (!entry) return json(404, { code: 'unknown' })
    if (entry.revoked) return json(403, { code: 'revoked' })
    const serverId = `sid-${++server.counter}`
    server.challenges.set(serverId, body.key)
    return json(200, { serverId })
  }
  if (path === '/activate') {
    const entry = server.keys.get(body.key)
    if (!entry || server.challenges.get(body.serverId) !== body.key) return json(400, { code: 'challenge' })
    server.challenges.delete(body.serverId)
    const who = server.joins.get(body.serverId)
    if (!who || who.name !== body.username) return json(403, { code: 'unverified' })
    if (entry.uuid && entry.uuid !== plain(who.uuid)) return json(409, { code: 'bound' })
    entry.uuid = plain(who.uuid)
    const token = `beta-token-${++server.counter}-${'x'.repeat(30)}`
    const expiresAt = new Date(Date.now() + server.tokenDays * 86400000).toISOString()
    entry.tokens.set(token, expiresAt)
    return json(200, { token, expiresAt, name: who.name, uuid: entry.uuid })
  }

  const token = headers['x-beta-token']
  const entry = token ? findToken(token) : null
  if (!entry) return json(401, { code: 'invalid' })
  if (entry.revoked) return json(403, { code: 'revoked' })
  if (path === '/status') return json(200, { name: 'Alice', build: { version: server.betaVersion, releaseDate: '2026-11-01T10:00:00Z' } })
  if (path === '/feed/beta.yml') {
    if (!server.betaVersion) return json(404, { error: 'nicht da' })
    return new Response(`version: ${server.betaVersion}\npath: launch-gabi-${server.betaVersion}-setup.exe\nreleaseDate: '2026-11-01T10:00:00.000Z'\n`, { status: 200 })
  }
  if (path === '/feed/beta-mac.yml') {
    const lines = [`version: ${server.betaVersion}`, 'files:']
    for (const arch of ['x64', 'arm64']) {
      lines.push(`  - url: ${macName(arch)}`, `    sha512: ${sha512(macImage(arch))}`, `    size: ${macImage(arch).length}`)
    }
    lines.push(`path: ${macName('x64')}`, `releaseDate: '2026-11-01T10:00:00.000Z'`)
    return new Response(lines.join('\n') + '\n', { status: 200 })
  }
  for (const arch of ['x64', 'arm64']) {
    if (path === `/feed/${macName(arch)}`) {
      server.macDownloads.push(arch)
      return new Response(server.damageMac ? Buffer.from('kaputt') : macImage(arch), { status: 200 })
    }
  }
  return json(404, {})
}

const macName = (arch) => `launch-gabi-${server.betaVersion}-mac-${arch}.dmg`
const macImage = (arch) => Buffer.from(`Disk-Image ${server.betaVersion} fuer ${arch} `.repeat(4000))
const sha512 = (data) => createHash('sha512').update(data).digest('base64')

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })

  // safeStorage as on a machine with encryption: reversible, but nothing
  // stored through it is readable as plain text.
  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `const path = ${JSON.stringify(userData)}
     module.exports = {
       app: { getPath: () => path, getVersion: () => globalThis.__lgVersion, isPackaged: true, getName: () => 'launch-gabi' },
       safeStorage: {
         isEncryptionAvailable: () => true,
         encryptString: (text) => Buffer.from('ENC:' + Buffer.from(text).toString('hex')),
         decryptString: (buf) => Buffer.from(buf.toString().slice(4), 'hex').toString()
       },
       shell: {
         openPath: async (file) => { globalThis.__lgOpened.push(file); return '' },
         showItemInFolder: (file) => globalThis.__lgShown.push(file)
       },
       dialog: {}, BrowserWindow: { getAllWindows: () => [] },
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )
  // Where the updater is told to look, recorded instead of followed.
  const updaterStub = join(work, 'updater-stub.js')
  writeFileSync(
    updaterStub,
    `const handlers = {}
     const autoUpdater = {
       channel: null, allowDowngrade: false, allowPrerelease: false, requestHeaders: null,
       disableDifferentialDownload: false, autoDownload: true, autoInstallOnAppQuit: true, logger: null,
       on(event, fn) { handlers[event] = fn },
       setFeedURL(options) { globalThis.__lgFeeds.push(JSON.parse(JSON.stringify(options))) },
       async checkForUpdates() {
         globalThis.__lgChecks.push({
           feed: globalThis.__lgFeeds[globalThis.__lgFeeds.length - 1] || 'packaged',
           channel: autoUpdater.channel, allowDowngrade: autoUpdater.allowDowngrade,
           allowPrerelease: autoUpdater.allowPrerelease, headers: autoUpdater.requestHeaders,
           differential: !autoUpdater.disableDifferentialDownload
         })
         if (handlers['update-not-available']) handlers['update-not-available']()
         return null
       }
     }
     module.exports = { autoUpdater }`
  )
  const eventsStub = join(work, 'events-stub.js')
  writeFileSync(
    eventsStub,
    `module.exports = {
       emit: (channel, payload) => globalThis.__lgEmits.push({ channel, payload }),
       notify: (kind, title, message, extra) => globalThis.__lgNotes.push({ kind, title, message, extra }),
       navigate() {}, setMainWindow() {}, getMainWindow: () => null
     }`
  )
  const launchStub = join(work, 'launch-stub.js')
  writeFileSync(launchStub, 'module.exports = { startingCount: () => 0 }')
  // Error reports leave through node:https; recorded here instead.
  const httpsStub = join(work, 'https-stub.js')
  writeFileSync(
    httpsStub,
    `module.exports = {
       request(url, options, callback) {
         const sent = { url, headers: options.headers, body: '' }
         return {
           on() { return this },
           destroy() {},
           end(body) {
             sent.body = String(body || '')
             globalThis.__lgPanel.push(sent)
             setImmediate(() => callback({ statusCode: 202, resume() {} }))
           }
         }
       }
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       beta: require(${JSON.stringify(join(root, 'src/main/core/beta.ts'))}),
       updater: require(${JSON.stringify(join(root, 'src/main/core/updater.ts'))}),
       versions: require(${JSON.stringify(join(root, 'src/shared/versions.ts'))}),
       store: require(${JSON.stringify(join(root, 'src/main/store.ts'))}),
       reports: require(${JSON.stringify(join(root, 'src/main/core/reports.ts'))}),
       membership: require(${JSON.stringify(join(root, 'src/main/core/betaMembership.ts'))})
     }`
  )
  const stubs = { 'electron-updater': updaterStub, './launch': launchStub, 'node:https': httpsStub }
  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    define: { 'process.env.LG_REPORT_PANEL_TOKEN': JSON.stringify('test-berichtswort') },
    plugins: [
      {
        name: 'stubs',
        setup(build) {
          build.onResolve({ filter: /^(electron-updater|\.\/launch|node:https)$/ }, (args) => ({ path: stubs[args.path] }))
          build.onResolve({ filter: /^\.\.?\/events$/ }, () => ({ path: eventsStub }))
        }
      }
    ],
    logLevel: 'error'
  })

  process.env.LG_BETA_URL = BETA
  process.env.LG_BETA_SESSIONSERVER = SESSION
  globalThis.__lgVersion = '1.0.24'
  globalThis.__lgFeeds = []
  globalThis.__lgChecks = []
  globalThis.__lgEmits = []
  globalThis.__lgNotes = []
  globalThis.__lgPanel = []
  globalThis.__lgOpened = []
  globalThis.__lgShown = []
  const { beta, updater, versions, store, reports, membership } = require(out)

  const account = (who, active, type = 'microsoft') => ({
    id: who.id, type, username: who.name, uuid: who.uuid, active,
    accessToken: who.access, accessSecure: false, expiresAt: Date.now() + 3600_000
  })
  const setAccounts = (list) => store.writeAccounts(list)
  const lastCheck = () => globalThis.__lgChecks[globalThis.__lgChecks.length - 1]
  const check1 = async () => {
    await updater.checkForUpdates(false)
    return lastCheck()
  }

  // --- 1. Versions --------------------------------------------------------
  const order = ['1.0.24', '1.0.25-beta.1', '1.0.25-beta.2', '1.0.25-beta.10', '1.0.25', '1.0.26', '1.1.0']
  for (let i = 0; i + 1 < order.length; i++) {
    check(versions.compareVersions(order[i], order[i + 1]) < 0, `${order[i]} kommt nicht vor ${order[i + 1]}`)
    check(versions.compareVersions(order[i + 1], order[i]) > 0, `${order[i + 1]} kommt nicht nach ${order[i]}`)
  }
  check(versions.compareVersions('1.0.25', '1.0.25') === 0, '1.0.25 ist nicht gleich 1.0.25')
  check(versions.isPrerelease('1.0.25-beta.1') && !versions.isPrerelease('1.0.25'), 'Beta wird nicht als Vorabversion erkannt')

  // --- 2. Outside the programme: the packaged feed stays ------------------
  setAccounts([account(ALICE, true)])
  let seen = await check1()
  check(seen.feed === 'packaged', `Ohne Beta wurde die Quelle umgestellt: ${JSON.stringify(seen.feed)}`)
  check(seen.headers === null && seen.channel === 'latest' && !seen.allowDowngrade, `Ohne Beta: ${JSON.stringify(seen)}`)
  check(beta.betaStatus().state === 'none', 'Ohne Key gilt man als dabei')
  check(!server.requests.some((r) => r.url.startsWith(BETA)), 'Ohne Key wurde der Beta-Server gefragt')

  // --- 3. Joining ---------------------------------------------------------
  addKey('LGB-AAAA-BBBB-CCCC-DDDD')
  let failure = ''
  try { await beta.joinBeta('hallo') } catch (err) { failure = err.message }
  check(/kein gültiger Beta-Key|not a valid beta key/.test(failure), `Kaputter Key: ${failure || 'angenommen'}`)

  setAccounts([account(ALICE, true, 'offline')])
  failure = ''
  try { await beta.joinBeta('LGB-AAAA-BBBB-CCCC-DDDD') } catch (err) { failure = err.message }
  check(/Microsoft/.test(failure), `Offline-Konto: ${failure || 'angenommen'}`)

  failure = ''
  setAccounts([account(ALICE, true)])
  try { await beta.joinBeta('LGB-ZZZZ-ZZZZ-ZZZZ-ZZZZ') } catch (err) { failure = err.message }
  check(/gibt es nicht|does not exist/.test(failure), `Unbekannter Key: ${failure || 'angenommen'}`)

  // Abgetippt, klein und mit Leerzeichen.
  const joined = await beta.joinBeta(' lgb-aaaa-bbbb- cccc-dddd ')
  check(joined.state === 'active' && joined.playerName === 'Alice', `Beitritt: ${JSON.stringify(joined)}`)
  check(server.keys.get('LGB-AAAA-BBBB-CCCC-DDDD').uuid === plain(ALICE.uuid), 'Der Key haengt nicht an Alice')
  const mojangCalls = server.requests.filter((r) => r.url.startsWith(SESSION))
  check(mojangCalls.length >= 1, 'Mojang wurde nicht gefragt')
  check(joined.build?.version === '1.0.25-beta.1', `Die aktuelle Beta fehlt im Status: ${JSON.stringify(joined.build)}`)

  const file = readFileSync(join(userData, 'beta.json'), 'utf8')
  const firstToken = [...server.keys.get('LGB-AAAA-BBBB-CCCC-DDDD').tokens.keys()][0]
  check(!file.includes(firstToken), 'Das Beta-Token steht im Klartext in beta.json')
  check(!file.includes('LGB-AAAA'), 'Der Key steht im Klartext in beta.json')
  notes.push(`Beigetreten als ${joined.playerName}, Beta ${joined.build?.version}`)

  // Bob mit Alices Key.
  setAccounts([account(ALICE, false), account(BOB, true)])
  failure = ''
  const before = readFileSync(join(userData, 'beta.json'), 'utf8')
  try { await beta.joinBeta('LGB-AAAA-BBBB-CCCC-DDDD') } catch (err) { failure = err.message }
  check(/anderen Minecraft-Konto|another Minecraft account/.test(failure), `Fremdes Konto: ${failure || 'angenommen'}`)
  check(readFileSync(join(userData, 'beta.json'), 'utf8') === before, 'Ein abgelehnter Beitritt hat beta.json veraendert')
  setAccounts([account(ALICE, true), account(BOB, false)])

  // --- 4. Beta ahead: beta feed, token only to the beta server -----------
  server.requests = []
  seen = await check1()
  check(seen.feed?.provider === 'generic' && seen.feed?.url === `${BETA}/feed`, `Beta vorne, Quelle: ${JSON.stringify(seen.feed)}`)
  check(seen.channel === 'beta' && seen.allowDowngrade === false && seen.allowPrerelease === true, `Beta vorne: ${JSON.stringify(seen)}`)
  check(seen.headers?.['x-beta-token'] === firstToken, 'Der Updater bekommt das Beta-Token nicht')
  check(seen.differential === false, 'Der kleine Differenz-Download ist fuer die Beta an')
  const leaked = server.requests.filter((r) => !r.url.startsWith(BETA) && r.headers['x-beta-token'])
  check(leaked.length === 0, `Das Token ging auch an: ${leaked.map((r) => r.url).join(', ')}`)

  // Der laufende Launcher ist schon die Beta: dann gibt es nichts Neueres.
  globalThis.__lgVersion = '1.0.25-beta.1'
  seen = await check1()
  check(seen.feed?.provider === 'github' && seen.headers === null && seen.channel === 'latest',
    `Schon auf der Beta: ${JSON.stringify(seen)}`)

  // Die naechste Beta ist da.
  server.betaVersion = '1.0.25-beta.2'
  seen = await check1()
  check(seen.feed?.provider === 'generic', `Neue Beta wird nicht angeboten: ${JSON.stringify(seen.feed)}`)

  // --- 5. The release is out: GitHub, without the token -----------------
  server.stableVersion = '1.0.25'
  server.requests = []
  seen = await check1()
  check(seen.feed?.provider === 'github' && seen.feed?.owner === 'Gabi12u', `Nach dem Release: ${JSON.stringify(seen.feed)}`)
  check(seen.headers === null && seen.channel === 'latest' && seen.allowPrerelease === false && seen.allowDowngrade === false,
    `GitHub nach dem Release: ${JSON.stringify(seen)}`)
  const toGithub = server.requests.filter((r) => r.url.includes('github.com'))
  check(toGithub.length > 0 && toGithub.every((r) => !r.headers['x-beta-token']), 'Das Beta-Token ging an GitHub')
  notes.push('Release 1.0.25 vor Beta 1.0.25-beta.2: Quelle GitHub, ohne Token')
  server.stableVersion = '1.0.24'
  globalThis.__lgVersion = '1.0.24'

  // --- 6. Close to running out: renewed through Mojang ------------------
  const stored = JSON.parse(readFileSync(join(userData, 'beta.json'), 'utf8'))
  stored.expiresAt = new Date(Date.now() + 2 * 86400000).toISOString()
  writeFileSync(join(userData, 'beta.json'), JSON.stringify(stored))
  const joinsBefore = server.joins.size
  seen = await check1()
  check(server.joins.size === joinsBefore + 1, 'Ein Token kurz vor Ablauf wurde nicht erneuert')
  check(seen.headers?.['x-beta-token'] && seen.headers['x-beta-token'] !== firstToken, 'Nach dem Erneuern wird das alte Token benutzt')
  const renewedExpiry = Date.parse(JSON.parse(readFileSync(join(userData, 'beta.json'), 'utf8')).expiresAt)
  check(renewedExpiry - Date.now() > 29 * 86400000, 'Das erneuerte Token laeuft nicht 30 Tage')

  // --- 7. Unbound in the panel: 401, redeemed again ----------------------
  server.keys.get('LGB-AAAA-BBBB-CCCC-DDDD').tokens.clear()
  server.keys.get('LGB-AAAA-BBBB-CCCC-DDDD').uuid = null
  seen = await check1()
  check(seen.feed?.provider === 'generic' && seen.headers?.['x-beta-token'], `Nach dem Zuruecksetzen: ${JSON.stringify(seen)}`)
  check(beta.betaStatus().state === 'active', 'Nach dem Zuruecksetzen gilt man nicht mehr als dabei')
  check(server.keys.get('LGB-AAAA-BBBB-CCCC-DDDD').uuid === plain(ALICE.uuid), 'Nach dem Zuruecksetzen haengt der Key nicht wieder an Alice')
  check(globalThis.__lgNotes.length === 0, `Unnoetige Meldung: ${JSON.stringify(globalThis.__lgNotes)}`)

  // --- 8. Revoked: told once, back to GitHub ------------------------------
  server.keys.get('LGB-AAAA-BBBB-CCCC-DDDD').revoked = true
  seen = await check1()
  check(seen.feed?.provider === 'github' && seen.headers === null, `Nach der Sperre: ${JSON.stringify(seen)}`)
  let status = beta.betaStatus()
  check(status.state === 'ended' && status.endedReason === 'revoked', `Status nach der Sperre: ${JSON.stringify(status)}`)
  check(globalThis.__lgNotes.length === 1 && /Beta-Programm|beta programme/.test(globalThis.__lgNotes[0].title),
    `Meldung nach der Sperre: ${JSON.stringify(globalThis.__lgNotes)}`)
  await check1()
  await beta.refreshBeta()
  check(globalThis.__lgNotes.length === 1, `Die Sperre wurde mehrfach gemeldet (${globalThis.__lgNotes.length})`)
  notes.push(`Gesperrt: "${globalThis.__lgNotes[0]?.message}"`)

  // Verstanden: weg, und derselbe Key geht wieder, sobald er entsperrt ist.
  check(beta.leaveBeta().state === 'none' && !existsSync(join(userData, 'beta.json')), 'Verstanden raeumt nicht auf')
  server.keys.get('LGB-AAAA-BBBB-CCCC-DDDD').revoked = false
  check((await beta.joinBeta('LGB-AAAA-BBBB-CCCC-DDDD')).state === 'active', 'Nach dem Entsperren laesst sich der Key nicht wieder einloesen')

  // --- 9. Deleted: told once, as no longer valid -------------------------
  server.keys.delete('LGB-AAAA-BBBB-CCCC-DDDD')
  globalThis.__lgNotes = []
  seen = await check1()
  status = beta.betaStatus()
  check(status.state === 'ended' && status.endedReason === 'removed', `Status nach dem Loeschen: ${JSON.stringify(status)}`)
  check(seen.feed?.provider === 'github' && seen.headers === null, `Nach dem Loeschen: ${JSON.stringify(seen)}`)
  check(globalThis.__lgNotes.length === 1 && /gilt nicht mehr|no longer valid/.test(globalThis.__lgNotes[0].message),
    `Meldung nach dem Loeschen: ${JSON.stringify(globalThis.__lgNotes)}`)

  // --- 10. In the programme, error reports are sent ---------------------
  store.saveSettings({ crashReports: 'off' })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
  check(!membership.inBetaProgramme(), 'Mit beendetem Beta-Programm gilt man noch als dabei')
  reports.reportError('test', new Error('Fehler nach dem Ende'))
  await settle()
  check(globalThis.__lgPanel.length === 0, 'Nach dem Ende ging ein Fehlerbericht raus, obwohl sie aus sind')

  beta.leaveBeta()
  addKey('LGB-EEEE-FFFF-GGGG-HHHH')
  await beta.joinBeta('LGB-EEEE-FFFF-GGGG-HHHH')
  check(membership.inBetaProgramme(), 'Nach dem Beitritt gilt man nicht als dabei')
  reports.reportError('test', new Error('Fehler in der Beta'))
  await settle()
  const sent = globalThis.__lgPanel.at(-1)
  check(globalThis.__lgPanel.length === 1 && sent?.headers?.['x-report-token'] === 'test-berichtswort',
    `Im Beta-Programm kam kein Fehlerbericht an: ${JSON.stringify(globalThis.__lgPanel)}`)
  check(sent && !sent.body.includes('Alice'), 'Der Fehlerbericht enthaelt den Spielernamen')

  beta.leaveBeta()
  reports.reportError('test', new Error('Fehler nach dem Verlassen'))
  await settle()
  check(globalThis.__lgPanel.length === 1, 'Nach dem Verlassen ging trotz ausgeschalteter Einstellung ein Bericht raus')
  store.saveSettings({ crashReports: 'on' })
  reports.reportError('test', new Error('Fehler mit eigener Zustimmung'))
  await settle()
  check(globalThis.__lgPanel.length === 2, 'Mit eingeschalteter Einstellung ging nach dem Verlassen nichts raus')
  notes.push(`Fehlerberichte: im Beta-Programm gesendet, danach wieder nach Einstellung (${globalThis.__lgPanel.length} gesendet)`)

  // --- 11. Mac: download, check, open ------------------------------------
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const realArch = Object.getOwnPropertyDescriptor(process, 'arch')
  try {
    failure = ''
    try { await beta.downloadBetaForMac() } catch (err) { failure = err.message }
    check(/nur auf dem Mac|only needed on a Mac/.test(failure), `Ausserhalb des Macs: ${failure || 'geladen'}`)

    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    failure = ''
    try { await beta.downloadBetaForMac() } catch (err) { failure = err.message }
    check(/nicht im Beta-Programm|not in the beta programme/.test(failure), `Ohne Beta-Programm: ${failure || 'geladen'}`)

    addKey('LGB-JJJJ-KKKK-LLLL-MMMM')
    const onMac = await beta.joinBeta('LGB-JJJJ-KKKK-LLLL-MMMM')
    check(onMac.manualInstall === true && onMac.buildIsNewer === true, `Status auf dem Mac: ${JSON.stringify(onMac)}`)

    globalThis.__lgEmits = []
    const saved = await beta.downloadBetaForMac()
    const expected = join(userData, macName('arm64'))
    check(saved === expected, `Gespeichert unter ${saved}`)
    check(existsSync(expected) && readFileSync(expected).equals(macImage('arm64')), 'Die Mac-Beta liegt nicht vollstaendig im Download-Ordner')
    check(server.macDownloads.join(',') === 'arm64', `Geladen fuer: ${server.macDownloads.join(',')}`)
    check(globalThis.__lgOpened.at(-1) === expected, 'Die Mac-Beta wurde nicht geoeffnet')
    check(!existsSync(`${expected}.part`), 'Eine .part-Datei ist liegen geblieben')
    const progress = globalThis.__lgEmits.map((e) => e.payload?.downloadPercent).filter((p) => p !== undefined)
    check(progress.length >= 2 && progress[0] === 0 && Math.max(...progress) <= 99, `Fortschritt: ${progress.join(',')}`)
    check(beta.betaStatus().downloadPercent === undefined, 'Nach dem Download steht noch ein Fortschritt im Status')
    notes.push(`Mac: ${macName('arm64')} geladen, geprueft und geoeffnet (${progress.length} Fortschrittsmeldungen)`)

    rmSync(expected, { force: true })
    server.damageMac = true
    globalThis.__lgOpened = []
    failure = ''
    try { await beta.downloadBetaForMac() } catch (err) { failure = err.message }
    check(/beschädigt|damaged/.test(failure), `Beschaedigte Datei: ${failure || 'angenommen'}`)
    check(!existsSync(expected) && !existsSync(`${expected}.part`), 'Eine beschaedigte Mac-Beta blieb liegen')
    check(globalThis.__lgOpened.length === 0, 'Eine beschaedigte Mac-Beta wurde geoeffnet')
    server.damageMac = false

    globalThis.__lgVersion = server.betaVersion
    failure = ''
    try { await beta.downloadBetaForMac() } catch (err) { failure = err.message }
    check(/schon|already/.test(failure), `Schon auf der Beta: ${failure || 'geladen'}`)
    globalThis.__lgVersion = '1.0.24'
  } finally {
    Object.defineProperty(process, 'platform', realPlatform)
    Object.defineProperty(process, 'arch', realArch)
  }
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // best effort cleanup
  }
}

console.log('\n=== Beobachtungen ===')
for (const note of notes) console.log(`  - ${note}`)
console.log('\n=== Probleme ===')
if (problems.length === 0) console.log('  keine')
else for (const problem of problems) console.log(`  X ${problem}`)

console.log(`\nERGEBNIS: ${problems.length === 0 ? 'BESTANDEN' : `FEHLGESCHLAGEN (${problems.length})`}`)
process.exitCode = problems.length === 0 ? 0 : 1
