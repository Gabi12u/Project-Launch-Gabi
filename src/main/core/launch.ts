import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { totalmem } from 'node:os'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { app } from 'electron'
import { EVENTS } from '@shared/ipc'
import type { Account, Instance, LaunchPhase, LaunchPreflight, LaunchStatus, LogLine } from '@shared/types'
import { paths } from '../paths'
import { getSettings } from '../store'
import { emit, getMainWindow, navigate, notify } from '../events'
import { closeGameLogWindow, hasGameLogWindow, openGameLogWindow } from '../gameLogWindow'
import { createLog4jParser } from './log4jParse'
import { createBackup } from './backups'
import { log } from '../logger'
import { Task, TaskCancelledError } from '../tasks'
import {
  buildVirtualAssets,
  clientJarPath,
  installVersion,
  loadVersionJson,
  resolveLibraries,
  rulesAllow,
  type Argument,
  type ResolvedLibrary,
  type VersionJson
} from './mojang'
import { extractNatives } from './archive'
import { is32BitJava, requiredJavaMajor, resolveJava } from './java'
import { ensureApproved, ensureJavaPathApproved, isApproved, isValidJavaPath } from './commandApproval'
import {
  getInstance,
  markPlayed,
  persist,
  recordSession,
  resolveVersionId,
  syncContentWithDisk,
  tryGetInstance
} from './instances'
import { checkCompatibility } from './compat'
import { isContentBusy, withContentLock } from './contentLock'
import { getActiveAccount, getValidAccessToken, toPublicAccount } from '../auth/microsoft'
import { activeVersionIds, clearRunning, clearStarting, getAdopted, getRunning, isRunning, isStarting, listRunning, markStarting, setRunning, startingCount, ownRunningCount } from './running'
import { isRepairing } from './repairLock'
import { isRestoring } from './restoreLock'
import { applyCustomStartScreen, removeCustomStartScreen } from './startScreen'
import { dropLogBuffer, getLogBuffer, pushLog } from './instanceLog'
import { tr } from '@shared/i18n'

const logger = log('launch')

export { isRunning }

const SEPARATOR = process.platform === 'win32' ? ';' : ':'

// Re-exported so `ipc.ts` keeps importing these from `./core/launch` as
// before. The buffer itself moved to its own module so `repair.ts` can write
// into the same stream without a cycle back through this file.
export { getLogBuffer, dropLogBuffer }

function setStatus(instanceId: string, phase: LaunchPhase, detail: string, extra: Partial<LaunchStatus> = {}): void {
  const status: LaunchStatus = {
    instanceId,
    phase,
    detail,
    progress: extra.progress ?? null,
    ...extra
  }
  const game = getRunning(instanceId)
  if (game) game.status = status
  emit(EVENTS.launchStatus, status)
}

export function getStatus(instanceId: string): LaunchStatus {
  const game = getRunning(instanceId)
  if (game) return game.status
  return { instanceId, phase: 'idle', detail: '', progress: null }
}

/* ------------------------------------------------------------------ *
 * Argument building
 * ------------------------------------------------------------------ */

interface Placeholders {
  [key: string]: string
}

function substitute(value: string, placeholders: Placeholders): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => placeholders[key] ?? match)
}

/** Flattens Mojang's rule-guarded argument arrays into a plain string list. */
function flattenArguments(
  args: Argument[] | undefined,
  placeholders: Placeholders,
  features: Record<string, boolean>
): string[] {
  const out: string[] = []
  for (const arg of args ?? []) {
    if (typeof arg === 'string') {
      out.push(substitute(arg, placeholders))
      continue
    }
    if (!rulesAllow(arg.rules, features)) continue
    const values = Array.isArray(arg.value) ? arg.value : [arg.value]
    for (const value of values) out.push(substitute(value, placeholders))
  }
  return out
}

/** `javaw.exe` next to a `java.exe`, so Windows opens no console window. */
function windowlessJava(javaPath: string): string {
  if (process.platform !== 'win32') return javaPath
  const candidate = javaPath.replace(/java\.exe$/i, 'javaw.exe')
  return candidate !== javaPath && existsSync(candidate) ? candidate : javaPath
}

/**
 * Version id -> in-flight natives extraction.
 *
 * The natives folder is shared by every instance on a version, and a launch is
 * not registered as running until long after this step — so two launches
 * started within a second of each other would both see the version as unused,
 * both wipe the folder, and one would delete DLLs the other was still
 * extracting. Serialising per version closes the window `listRunning()` cannot.
 */
const nativesLocks = new Map<string, Promise<void>>()

/**
 * How many launches currently depend on a version's natives folder.
 *
 * `activeVersionIds()` is only filled by `setRunning`, which happens many
 * awaits after the natives are extracted — assets, arguments, the spawn
 * itself. A second launch of the same version dequeued inside that window saw
 * an apparently unused folder and wiped it while the first game's JVM already
 * had those DLLs open. This counter is claimed before extraction instead, so
 * it covers the whole gap.
 */
const nativesClaims = new Map<string, number>()

function claimNatives(versionId: string): void {
  nativesClaims.set(versionId, (nativesClaims.get(versionId) ?? 0) + 1)
}

function releaseNatives(versionId: string): void {
  const left = (nativesClaims.get(versionId) ?? 1) - 1
  if (left <= 0) nativesClaims.delete(versionId)
  else nativesClaims.set(versionId, left)
}

/**
 * True as soon as some launch has claimed this version's natives folder, well
 * before that launch is registered as running.
 *
 * `repair.ts` used to treat a version as unused whenever `activeVersionIds()`
 * (filled only by `setRunning`) did not list it, which left exactly the same
 * gap `prepareNatives` above already had to close for two launches of the
 * same version. A repair running in that gap wiped the shared natives folder
 * out from under a game that was still starting. The registry itself stays
 * internal; this only answers yes or no.
 */
export function isNativesClaimed(versionId: string): boolean {
  return (nativesClaims.get(versionId) ?? 0) > 0
}

async function prepareNatives(
  versionId: string,
  nativesDir: string,
  libraries: ResolvedLibrary[]
): Promise<void> {
  const previous = nativesLocks.get(versionId) ?? Promise.resolve()

  // A failed extraction must not block the next launch from trying again.
  const run = previous.catch(() => undefined).then(() => {
    // A stale natives folder from a crashed run can break the launch, but
    // wiping it while another game is running pulls its loaded DLLs away
    // (EPERM on Windows, a hard crash elsewhere), so then we only overwrite.
    // Anything above our own claim means another launch already depends on
    // this folder, whether or not its game has reached `setRunning` yet.
    const claimedByOthers = (nativesClaims.get(versionId) ?? 1) > 1
    const versionInUse = claimedByOthers || activeVersionIds().includes(versionId)
    if (!versionInUse) {
      rmSync(nativesDir, { recursive: true, force: true })
    }
    mkdirSync(nativesDir, { recursive: true })
    for (const library of libraries) {
      if (!library.native) continue
      extractNatives(library.path, nativesDir, library.excludes)
    }
  })

  nativesLocks.set(versionId, run)
  try {
    await run
  } finally {
    if (nativesLocks.get(versionId) === run) nativesLocks.delete(versionId)
  }
}

/**
 * A hand-edited instance.json can put `null` into any of these string
 * settings: `normalise()` merges `raw.settings` shallowly over the defaults, so
 * an explicit null overrides the default instead of falling back to it. This
 * is the same class of bad input the `memoryMb` guard further down handles.
 */
function userText(value: string): string {
  return typeof value === 'string' ? value : ''
}

/** A window dimension the game will actually accept, or the vanilla default. */
function windowSize(value: number, fallback: number): number {
  const rounded = Math.round(Number(value))
  return Number.isFinite(rounded) && rounded >= 100 ? rounded : fallback
}

export function splitUserArgs(raw: string): string[] {
  // Respects quoted segments so paths with spaces survive.
  const matches = userText(raw).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  // Every quoted run inside a token is unwrapped, not just a quote sitting at
  // the token's own start/end, so `-Dfoo="C:\Program Files\x"` becomes
  // `-Dfoo=C:\Program Files\x` instead of keeping a stray leading quote.
  return matches
    .map((a) => a.replace(/"([^"]*)"|'([^']*)'/g, (_m, d, s) => d ?? s ?? ''))
    .filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * Preflight
 * ------------------------------------------------------------------ */

export async function preflight(instanceId: string): Promise<LaunchPreflight> {
  await syncContentWithDisk(instanceId)
  const instance = getInstance(instanceId)

  const versionId = await resolveVersionId(instance).catch(() => instance.mcVersion)
  let versionJson: VersionJson | null = null
  try {
    versionJson = await loadVersionJson(versionId)
  } catch {
    versionJson = null
  }

  const javaMajor = versionJson
    ? requiredJavaMajor(versionJson, instance.mcVersion)
    : requiredJavaMajor({ libraries: [] } as unknown as VersionJson, instance.mcVersion)

  let java: LaunchPreflight['java'] = null
  const explicitJavaPath = instance.settings.javaPath || undefined
  // This runs unprompted every time the instance page opens, so an explicit
  // path that has not been approved yet must never be probed here: that would
  // both run an unapproved program and pop a dialog nobody asked for. It is
  // treated as "not yet checked" instead, the same neutral result a Java that
  // cannot be found gets.
  const javaPathReady =
    !explicitJavaPath || (isValidJavaPath(explicitJavaPath) && isApproved(instance.id, 'javaPath', explicitJavaPath))
  if (javaPathReady) {
    try {
      const runtime = await resolveJava({
        explicitPath: explicitJavaPath,
        major: instance.settings.javaMajorOverride ?? javaMajor,
        // Never trigger a download from the preflight panel.
        autoManage: false,
        instanceId: instance.id,
        announce: false
      })
      java = { major: runtime.major, version: runtime.version, path: runtime.path, managed: runtime.managed }
    } catch {
      java = null
    }
  }

  // Rough estimate of what still has to be downloaded.
  let downloadSizeMb = 0
  if (versionJson && !instance.installed) {
    const client = versionJson.downloads?.client?.size ?? 0
    const libs = resolveLibraries(versionJson).reduce((sum, l) => sum + (l.download?.size ?? 0), 0)
    const assets = versionJson.assetIndex?.totalSize ?? 0
    downloadSizeMb = Math.round(((client + libs + assets) / 1024 / 1024) * 10) / 10
  }

  const account = getActiveAccount()
  const compatibility = await checkCompatibility(instanceId)

  return {
    instanceId,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    memoryMb: instance.settings.memoryMb,
    systemMemoryMb: Math.round(totalmem() / 1024 / 1024),
    java,
    modCount: instance.content.filter((c) => c.type === 'mod').length,
    enabledModCount: instance.content.filter((c) => c.type === 'mod' && c.enabled).length,
    resourcePackCount: instance.content.filter((c) => c.type === 'resourcepack').length,
    shaderCount: instance.content.filter((c) => c.type === 'shaderpack').length,
    datapackCount: instance.content.filter((c) => c.type === 'datapack').length,
    downloadSizeMb,
    compatibility,
    account: account ? toPublicAccount(account) : null
  }
}

/* ------------------------------------------------------------------ *
 * Launching
 * ------------------------------------------------------------------ */

export interface LaunchOptions {
  instanceId: string
  /** Skip the compatibility gate (the UI asks the user first). */
  ignoreIssues?: boolean
  quickPlay?: { type: 'singleplayer' | 'multiplayer'; id: string }
}

/**
 * Instances between the Play click and the spawn. The running registry only
 * fills in once the process exists, and everything before that (compatibility
 * check, downloads, Java install) is awaited — so without this a second click
 * sails past the guard and starts a second game in the same directory.
 */
/**
 * Instances whose exit was asked for rather than unexpected.
 *
 * Windows has no signals: `taskkill /f` ends the JVM with a non-zero exit code
 * and a null signal, which by exit code alone is indistinguishable from a real
 * crash. Without this marker every ordinary click on "Stopp" was recorded as a
 * crash, logged as one, and raised the red crash notification. On POSIX the
 * signal field already tells the two apart, so this only matters on Windows,
 * which happens to be the platform most people run this on.
 */
const stopRequested = new Set<string>()

/**
 * Instances with a stop already under way.
 *
 * `stopInstance` can be called again before the first attempt's taskkill or
 * signal has actually ended the process (a second click on the stop button,
 * the escalation path, a quit racing a manual stop), which used to send a
 * second taskkill at the same pid. Cleared once the process actually exits.
 */
const stopping = new Set<string>()

export { isStarting, startingCount }

export async function launchInstance(options: LaunchOptions): Promise<void> {
  const { instanceId } = options

  // The repair guards the other direction already, refusing to run while the
  // game is up. This is the missing half: mid-repair the client jar, the
  // natives folder and the mods are being replaced, and a launch into that
  // starts a JVM against files that are half written or briefly absent.
  if (isRepairing(instanceId)) {
    throw new Error(tr('Diese Instanz wird gerade repariert. Warte, bis das abgeschlossen ist.', 'This instance is being repaired right now. Wait until that is done.'))
  }

  // Any content work at all, not just the compatibility window's automatic
  // fix. Installing, updating, removing and importing all rewrite the same
  // folder over several seconds of downloading, and only the automatic fix was
  // ever guarded here. Pressing Play while an update was running walked
  // straight into a mods folder that did not match itself.
  if (isContentBusy(instanceId)) {
    throw new Error(
      tr('An den Mods dieser Instanz wird gerade gearbeitet. Warte, bis das abgeschlossen ist.', 'The mods of this instance are being worked on right now. Wait until that is done.')
    )
  }

  // A restore moves the worlds aside and unpacks an archive over the folder.
  // Launching into that reads half written saves, and the game holding those
  // files open is itself a good way to make the restore fail and trigger its
  // rollback. Only backup-against-backup was guarded before.
  if (isRestoring(instanceId)) {
    throw new Error(
      tr('Für diese Instanz wird gerade eine Sicherung eingespielt. Warte, bis das abgeschlossen ist.', 'A backup is being restored for this instance right now. Wait until that is done.')
    )
  }

  if (isRunning(instanceId) || isStarting(instanceId)) {
    // A game left over from a previous launcher session needs a different
    // message: the user cannot stop it from here, and starting a second JVM on
    // the same world is exactly what this guard exists to prevent.
    const orphan = getAdopted(instanceId)
    throw new Error(
      orphan
        ? tr(
            `Minecraft läuft für diese Instanz noch aus einer früheren Sitzung (PID ${orphan.pid}). Beende das Spiel, danach lässt sich die Instanz wieder starten.`,
            `Minecraft is still running for this instance from an earlier session (PID ${orphan.pid}). Close the game, then the instance can be started again.`
          )
        : tr('Diese Instanz läuft bereits.', 'This instance is already running.')
    )
  }
  const settings = getSettings()
  const instance = getInstance(instanceId)
  const task = new Task(tr(`${instance.name} wird gestartet`, `Starting ${instance.name}`), tr('Vorbereitung…', 'Preparing…'), instanceId)

  // Kept outside the try so the catch can still reach a process that was
  // already spawned when the launch fell over.
  let child: ReturnType<typeof spawn> | null = null
  let launchFailed = false
  // Released exactly once, whether the game exits normally or the launch
  // collapses before it ever starts.
  let claimedVersion: string | null = null
  const dropNativesClaim = (): void => {
    if (claimedVersion === null) return
    releaseNatives(claimedVersion)
    claimedVersion = null
  }
  /** Set once the OS confirms the process actually started. */
  let spawned = false

  // Set last, directly against the block whose `finally` clears it again.
  // It used to sit further up, with `getInstance` between it and the try.
  // That call throws for an id that disappeared between the click and here,
  // and the marker then stayed set for the rest of the session: the instance
  // could never be started or modded again, gave no reason for it, and a
  // later instance that inherited the recycled id was dead on arrival too.
  markStarting(instanceId)
  // A stop that never produced an exit (an orphaned record, a taskkill that
  // failed) would otherwise leave its marker behind and excuse the next
  // genuine crash of this instance as intentional.
  stopRequested.delete(instanceId)

  try {
    setStatus(instanceId, 'preparing', tr('Vorbereitung…', 'Preparing…'))
    openGameLogWindow(instanceId, instance.name)

    // 1. Account -----------------------------------------------------
    const stored = getActiveAccount()
    if (!stored) {
      throw new Error(tr('Kein Account ausgewählt. Melde dich zuerst an oder lege ein Offline-Profil an.', 'No account selected. Sign in first or create an offline profile.'))
    }

    let accessToken = '0'
    let xuid = ''
    let userType = 'legacy'
    if (stored.type === 'microsoft') {
      task.update(tr('Anmeldung wird geprüft…', 'Checking sign-in…'), null)
      accessToken = await getValidAccessToken(stored.id)
      userType = 'msa'
      xuid = stored.uuid.replace(/-/g, '')
    }

    const account: Account = toPublicAccount(stored)

    // 2. Compatibility ----------------------------------------------
    if (!options.ignoreIssues) {
      setStatus(instanceId, 'checking', tr('Mods werden geprüft…', 'Checking mods…'))
      task.update(tr('Mod-Kompatibilität wird geprüft…', 'Checking mod compatibility…'), null)
      const report = await checkCompatibility(instanceId)
      if (!report.launchable) {
        const blocking = report.issues.filter((i) => i.severity === 'error')
        throw new Error(
          tr(
            `Start blockiert: ${blocking[0]?.title ?? 'Es wurden Probleme gefunden.'} (${blocking.length} ${blocking.length === 1 ? 'Problem' : 'Probleme'})`,
            `Launch blocked: ${blocking[0]?.title ?? 'Problems were found.'} (${blocking.length} ${blocking.length === 1 ? 'problem' : 'problems'})`
          )
        )
      }
    }

    // 3. Game files --------------------------------------------------
    setStatus(instanceId, 'downloading', tr('Dateien werden geprüft…', 'Checking files…'))
    const versionId = await resolveVersionId(instance)
    const versionJson = await loadVersionJson(versionId)

    await task.within(0, 0.7, () => installVersion(versionJson, instance.mcVersion, task))

    if (!instance.installed) {
      persist({ ...getInstance(instanceId), installed: true })
    }

    // 4. Java --------------------------------------------------------
    setStatus(instanceId, 'installing-java', tr('Java wird vorbereitet…', 'Preparing Java…'))
    const javaMajor = instance.settings.javaMajorOverride ?? requiredJavaMajor(versionJson, instance.mcVersion)
    const explicitJavaPath = instance.settings.javaPath || undefined
    if (explicitJavaPath) {
      await ensureJavaPathApproved(instanceId, instance.name, explicitJavaPath)
    }
    const java = await resolveJava({
      explicitPath: explicitJavaPath,
      major: javaMajor,
      autoManage: settings.javaAutoManage,
      task,
      instanceId: instance.id
    })
    logger.info(`Starte ${instance.name} mit Java ${java.version} (${java.path})`)

    // 5. Natives -----------------------------------------------------
    setStatus(instanceId, 'launching', tr('Natives werden entpackt…', 'Unpacking natives…'))
    const nativesDir = paths.natives(versionId)
    const libraries = resolveLibraries(versionJson)

    claimNatives(versionId)
    claimedVersion = versionId
    await prepareNatives(versionId, nativesDir, libraries)

    // 6. Classpath ---------------------------------------------------
    //
    // A library that is missing here used to be dropped without a word, and
    // the game then died much later with a bare ClassNotFoundException naming
    // a class nobody can trace back to a file. installVersion ran a few lines
    // above and fetches everything that carries a download address, so
    // anything still absent at this point is a real fault worth naming.
    const wanted = libraries.filter((l) => !l.native)

    // Natives are checked too, even though they never join the classpath.
    // `extractNatives` quietly does nothing for a jar that is not there, so a
    // native left behind by a failed download slipped past both this check and
    // the extraction, and only announced itself as an unreadable JVM crash
    // about a missing system library — the exact failure this check exists to
    // replace with a sentence.
    //
    // Checked against every library `resolveLibraries` returned, not only
    // ones carrying a `download` field. Forge and NeoForge version JSONs list
    // some libraries with no download address of their own, since their own
    // installer places those files itself rather than fetching them here;
    // one of those genuinely missing (an interrupted or failed loader
    // install) used to slip past this check entirely and then vanish
    // silently at the classpath filter below, with no error until the JVM
    // itself failed to find the class.
    const missing = libraries.filter((l) => !existsSync(l.path))
    if (missing.length > 0) {
      const names = missing.slice(0, 3).map((l) => basename(l.path))
      throw new Error(
        tr(
          `${missing.length} ${missing.length === 1 ? 'Bibliothek fehlt' : 'Bibliotheken fehlen'} und konnten nicht geladen werden: ${names.join(', ')}` +
            (missing.length > 3 ? ' und weitere' : '') +
            '. Prüfe deine Internetverbindung und starte danach erneut, oder nutze "Reparieren".',
          `${missing.length} ${missing.length === 1 ? 'library is' : 'libraries are'} missing and could not be downloaded: ${names.join(', ')}` +
            (missing.length > 3 ? ' and more' : '') +
            '. Check your internet connection and start again, or use "Repair".'
        )
      )
    }

    const classpath = wanted.filter((l) => existsSync(l.path)).map((l) => l.path)

    // Every loader (Forge, NeoForge, Fabric...) patches or extends this same
    // vanilla jar rather than shipping its own, so it is unconditionally
    // required here too. A missing one used to be skipped in silence, and the
    // JVM then died with a cryptic error naming no file at all.
    const clientJar = clientJarPath(instance.mcVersion)
    if (!existsSync(clientJar)) {
      throw new Error(
        tr('Die Spieldatei client.jar fehlt und konnte nicht geladen werden. Prüfe deine Internetverbindung und starte danach erneut, oder nutze "Reparieren".', 'The game file client.jar is missing and could not be downloaded. Check your internet connection and start again, or use "Repair".')
      )
    }
    classpath.push(clientJar)

    // Deduplicate while keeping loader overrides in front.
    //
    // Case is only folded on Windows, where the filesystem itself folds it.
    // Doing it everywhere dropped two genuinely different jars as duplicates
    // on Linux and macOS, where paths differing only in case are distinct
    // files — and a silently missing library surfaces much later as a
    // NoClassDefFoundError.
    const foldCase = process.platform === 'win32'
    const seen = new Set<string>()
    const finalClasspath = classpath.filter((entry) => {
      const key = foldCase ? entry.toLowerCase() : entry
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // 7. Assets ------------------------------------------------------
    const gameDir = paths.gameDir(instanceId)
    mkdirSync(gameDir, { recursive: true })

    const assetsIndexName = versionJson.assets ?? versionJson.assetIndex?.id ?? 'legacy'
    let assetsRoot = paths.assets()
    if (assetsIndexName === 'legacy' || assetsIndexName === 'pre-1.6') {
      const virtualDir = join(paths.assets(), 'virtual', 'legacy')
      await buildVirtualAssets(versionJson, virtualDir)
      assetsRoot = virtualDir
    }

    // 8. Arguments ---------------------------------------------------
    // A non-numeric value from a hand-edited instance.json would otherwise
    // reach the JVM as `-XmxNaNM`, which it refuses to start with.
    const configuredMemory = Math.round(Number(instance.settings.memoryMb))
    const memory = Number.isFinite(configuredMemory) ? Math.max(512, configuredMemory) : 2048

    // The automatic Java choice skips 32-bit runtimes for exactly this reason,
    // but a Java path set by hand bypasses it, and the JVM then stopped at once
    // with "Could not reserve enough space for object heap" and no hint why.
    if (is32BitJava(java.arch) && memory > 1536) {
      logger.warn(`${instance.name}: 32-Bit-Java mit ${memory} MB Arbeitsspeicher`)
      notify(
        'warning',
        tr('32-Bit-Java mit zu viel Arbeitsspeicher', '32-bit Java with too much memory'),
        tr(
          `Das eingestellte Java ist eine 32-Bit-Version und kann nur etwa 1,5 GB nutzen, eingestellt sind ${memory} MB. Minecraft bricht dann meist sofort ab. Wähle ein 64-Bit-Java oder weniger Arbeitsspeicher.`,
          `The chosen Java is a 32-bit version and can only use about 1.5 GB, but ${memory} MB are set. Minecraft then usually stops right away. Pick a 64-bit Java or less memory.`
        ),
        { route: `/instances/${instanceId}?tab=settings` }
      )
    }

    const placeholders: Placeholders = {
      natives_directory: nativesDir,
      launcher_name: 'LaunchGabi',
      launcher_version: app.getVersion(),
      classpath: finalClasspath.join(SEPARATOR),
      classpath_separator: SEPARATOR,
      library_directory: paths.libraries(),
      version_name: versionId,
      game_directory: gameDir,
      assets_root: assetsRoot,
      game_assets: assetsRoot,
      assets_index_name: assetsIndexName,
      auth_player_name: account.username,
      auth_uuid: account.uuid.replace(/-/g, ''),
      auth_access_token: accessToken,
      auth_session: accessToken === '0' ? '-' : `token:${accessToken}:${account.uuid.replace(/-/g, '')}`,
      auth_xuid: xuid,
      clientid: '',
      user_type: userType,
      user_properties: '{}',
      version_type: versionJson.type ?? 'release',
      // Guarded like `memoryMb` above: a hand-edited instance.json, or one
      // saved by an older build before the settings form clamped these, can
      // carry 0 or a non-number, which the game receives as `--width 0`.
      resolution_width: String(windowSize(instance.settings.windowWidth, 854)),
      resolution_height: String(windowSize(instance.settings.windowHeight, 480)),
      quickPlayPath: '',
      quickPlaySingleplayer: options.quickPlay?.type === 'singleplayer' ? options.quickPlay.id : '',
      quickPlayMultiplayer: options.quickPlay?.type === 'multiplayer' ? options.quickPlay.id : '',
      quickPlayRealms: ''
    }

    const features: Record<string, boolean> = {
      is_demo_user: false,
      has_custom_resolution: !instance.settings.fullscreen,
      has_quick_plays_support: Boolean(options.quickPlay),
      is_quick_play_singleplayer: options.quickPlay?.type === 'singleplayer',
      is_quick_play_multiplayer: options.quickPlay?.type === 'multiplayer',
      is_quick_play_realms: false
    }

    const jvmArgs: string[] = []

    if (versionJson.arguments?.jvm) {
      jvmArgs.push(...flattenArguments(versionJson.arguments.jvm, placeholders, features))
    } else {
      // Pre-1.13 versions carry no JVM argument list at all.
      jvmArgs.push(`-Djava.library.path=${nativesDir}`, '-cp', finalClasspath.join(SEPARATOR))
    }

    jvmArgs.unshift(`-Xmx${memory}M`, `-Xms${Math.min(memory, 1024)}M`)

    if (process.platform === 'darwin') jvmArgs.push('-XstartOnFirstThread')

    jvmArgs.push(
      '-Dminecraft.launcher.brand=LaunchGabi',
      `-Dminecraft.launcher.version=${app.getVersion()}`,
      '-Dfile.encoding=UTF-8'
    )

    const logConfig = versionJson.logging?.client
    if (logConfig?.file) {
      const configFile = join(paths.assets(), 'log_configs', logConfig.file.id)
      if (existsSync(configFile)) {
        jvmArgs.push(substitute(logConfig.argument, { path: configFile }))
      }
    }

    jvmArgs.push(...splitUserArgs(instance.settings.jvmArgs))

    const gameArgs = versionJson.arguments?.game
      ? flattenArguments(versionJson.arguments.game, placeholders, features)
      : // Split the template first, then fill each token: a path with a space
        // (a Windows user name like "Jane Doe" puts one in the default data
        // folder) used to be torn into several arguments by the split.
        splitUserArgs(versionJson.minecraftArguments ?? '').map((token) => substitute(token, placeholders))

    if (instance.settings.fullscreen && !gameArgs.includes('--fullscreen')) {
      gameArgs.push('--fullscreen')
    } else if (
      !versionJson.arguments?.game &&
      !instance.settings.fullscreen &&
      !gameArgs.includes('--width')
    ) {
      // Pre-1.13 versions only carry `minecraftArguments`, a plain string with
      // no rule-guarded --width/--height like modern versions get from
      // `features.has_custom_resolution` above. Without this the window
      // always opened at the vanilla default size on those versions.
      gameArgs.push('--width', placeholders.resolution_width, '--height', placeholders.resolution_height)
    }

    const args = [...jvmArgs, versionJson.mainClass, ...gameArgs]

    // Read fresh on every launch rather than only when the setting changes,
    // the same as the wrapper and pre-launch command below: turning the beta
    // off takes effect on the next launch, with nothing extra to invalidate.
    // Taken under the same lock a real mod install or update holds while it
    // rewrites this instance's content folder, so the two can never run
    // against resourcepacks/ at the same moment.
    try {
      await withContentLock(instanceId, async () => {
        if (settings.customStartScreen === 'on') {
          applyCustomStartScreen(instanceId, instance.mcVersion)
        } else {
          removeCustomStartScreen(instanceId)
        }
      })
    } catch (err) {
      // A cosmetic beta feature must never be the reason a launch fails.
      logger.warn(`Eigene Startseite für ${instanceId} übersprungen:`, err)
    }

    // 9. Spawn -------------------------------------------------------
    if (userText(instance.settings.preLaunchCommand).trim()) {
      await ensureApproved(instanceId, instance.name, 'preLaunch', instance.settings.preLaunchCommand)
      task.update(tr('Pre-Launch-Befehl läuft…', 'Running pre-launch command…'), null)
      await runPreLaunch(instance, gameDir, task)
    }

    const env = { ...process.env, ...parseEnv(instance.settings.envVars) }

    // `java.exe` is a console binary, so Windows opens a console window next to
    // the game — and closing that window kills Minecraft. `javaw.exe` is the
    // same JVM without the console. Output is captured through pipes either way.
    const javaBinary = windowlessJava(java.path)

    let command = javaBinary
    let commandArgs = args
    if (userText(instance.settings.wrapperCommand).trim()) {
      await ensureApproved(instanceId, instance.name, 'wrapper', instance.settings.wrapperCommand)
      const wrapper = splitUserArgs(instance.settings.wrapperCommand)
      command = wrapper[0]
      commandArgs = [...wrapper.slice(1), javaBinary, ...args]
    }

    logger.info(`Kommando: ${command} (${commandArgs.length} Argumente)`)
    pushLog({
      instanceId,
      stream: 'launcher',
      level: 'info',
      text: tr(
        `Starte Minecraft ${instance.mcVersion} (${versionId}) mit ${memory} MB RAM · Java ${java.major}`,
        `Starting Minecraft ${instance.mcVersion} (${versionId}) with ${memory} MB RAM · Java ${java.major}`
      ),
      time: Date.now()
    })

    child = spawn(command, commandArgs, {
      cwd: gameDir,
      env,
      windowsHide: true,
      detached: false
    })

    const startedAt = Date.now()
    setRunning(instanceId, {
      instanceId,
      process: child,
      startedAt,
      versionId,
      status: { instanceId, phase: 'running', detail: tr('Läuft', 'Running'), progress: null, pid: child.pid, startedAt }
    })

    // The steps after this can still throw — `markPlayed` writes instance.json,
    // and a virus scanner holding that file briefly is enough. Registering the
    // handlers first means the process stays reachable and accounted for no
    // matter where the rest of the launch fails.
    attachOutput(instanceId, child)

    child.on('error', (err) => {
      logger.error(`Prozessfehler für ${instanceId}:`, err)
      pushLog({
        instanceId,
        stream: 'launcher',
        level: 'error',
        text: tr(`Prozessfehler: ${err.message}`, `Process error: ${err.message}`),
        time: Date.now()
      })

      // Node does not promise an 'exit' after a failed spawn — the classic
      // ENOENT case fires 'error' alone. Without this the instance would stay
      // in the running registry forever: unlaunchable ("läuft bereits"), and
      // blocking the launcher's own update, until the app is restarted.
      if (!spawned) {
        clearRunning(instanceId)
        setStatus(instanceId, 'idle', tr(`Java konnte nicht gestartet werden: ${err.message}`, `Java could not be started: ${err.message}`))
        // The exit handler below is the only other place this runs, and a
        // failed spawn never reaches it. Left uncalled, the claim on this
        // version's natives never clears, so the "wipe and re-extract if
        // nobody else needs them" self-heal silently stops working for that
        // version until the whole app restarts.
        dropNativesClaim()
      }
    })

    // 'spawn' only fires once the process is genuinely up, which is what tells
    // the two handlers apart: a later 'error' belongs to a live process that
    // 'exit' will clean up after.
    child.on('spawn', () => {
      spawned = true
    })

    child.on('exit', (code, signal) => {
      const endedAt = Date.now()
      // Consumed here, so a later unexpected exit of the same instance is not
      // excused by a stop the user asked for minutes earlier.
      dropNativesClaim()
      const requested = stopRequested.delete(instanceId)
      // The process is gone either way, so any stop attempt for it is over.
      stopping.delete(instanceId)
      // `code` alone is not enough: a process killed by a signal (a native
      // segfault, an OOM kill, anything POSIX) exits with `code === null`, the
      // exact same value Node reports for other null-code cases. The comment
      // on `stopRequested` above already says the signal field is what tells
      // a real POSIX crash apart, but until now nothing here actually read
      // it: a signal-terminated crash on macOS or Linux passed as an ordinary
      // exit, with no crash notification, no red badge, and `crashed: false`
      // recorded into the session history for good.
      const crashed = !requested && (signal !== null || (code !== 0 && code !== null))
      clearRunning(instanceId)

      // A wrapper that hands Minecraft off instead of becoming it.
      //
      // The launcher only ever sees the process it spawned. With a wrapper
      // command set, that is the wrapper — and if the wrapper starts Java in
      // the background rather than replacing itself with it (`exec`), it exits
      // within moments while the game is very much still on screen. Everything
      // downstream then believes nothing is running: the mods unlock, a second
      // Play click is allowed, and two JVMs end up on the same world.
      //
      // It cannot be fixed from here, because there is no reliable way to find
      // "the java process that wrapper started". Saying so plainly is worth
      // more than a silent wrong state.
      const wrapper = userText(instance.settings.wrapperCommand).trim()
      if (wrapper && !requested && !crashed && endedAt - startedAt < 5000) {
        logger.warn(
          `Wrapper-Befehl "${wrapper}" endete nach ${endedAt - startedAt} ms mit Code ${code}. ` +
            'Läuft Minecraft weiter, kann der Launcher es nicht mehr verfolgen.'
        )
        notify(
          'warning',
          tr('Wrapper-Befehl gibt das Spiel nicht weiter', 'Wrapper command does not hand the game over'),
          tr(
            `"${wrapper}" hat sich sofort beendet. Läuft Minecraft trotzdem, weiß der Launcher nichts davon, und Mod-Änderungen sind dann nicht mehr gesperrt. Der Befehl muss Java per exec übernehmen.`,
            `"${wrapper}" exited right away. If Minecraft is still running, the launcher does not know about it, and mod changes are no longer locked. The command has to take over Java via exec.`
          ),
          { route: `/instances/${instanceId}?tab=settings` }
        )
      }

      // Guarded like markPlayed below: a scanner locking instance.json for a
      // moment threw here and skipped the rest of this handler, the status
      // and bringing a hidden launcher back included.
      try {
        recordSession(instanceId, { startedAt, endedAt, crashed, exitCode: code })
      } catch (err) {
        logger.warn(`Spielsitzung von ${instanceId} konnte nicht gespeichert werden:`, err)
      }

      // "Back up automatically": the worlds just changed, so right after a
      // session is when a copy is worth having. The setting existed before
      // but nothing ever acted on it. Runs in the background and only logs a
      // failure; the keep count in the settings trims the old ones.
      if (getSettings().automaticBackups && existsSync(paths.saves(instanceId))) {
        void createBackup(instanceId, { reason: 'automatic', includes: ['saves'] }).catch((err: unknown) => {
          logger.warn(`Automatische Sicherung von ${instanceId} fehlgeschlagen:`, err)
        })
      }

      pushLog({
        instanceId,
        stream: 'launcher',
        level: crashed ? 'error' : 'info',
        text: crashed
          ? tr(
              `Minecraft wurde mit Code ${code} beendet${signal ? ` (Signal ${signal})` : ''}.`,
              `Minecraft exited with code ${code}${signal ? ` (signal ${signal})` : ''}.`
            )
          : tr('Minecraft wurde beendet.', 'Minecraft closed.'),
        time: endedAt
      })

      // A failed launch already reported why in the catch below, and the game
      // is only exiting because that failure killed it. Overwriting the reason
      // with "Beendet" would hide what actually went wrong.
      if (!launchFailed) {
        setStatus(instanceId, crashed ? 'crashed' : 'stopped', crashed ? tr(`Absturz (Code ${code})`, `Crash (code ${code})`) : tr('Beendet', 'Closed'), {
          exitCode: code
        })

        const minutes = Math.round((endedAt - startedAt) / 60000)
        if (crashed) {
          // A guess at the cause is only worth adding for modded instances; a
          // vanilla crash has no mod to blame. Fired without awaiting so a slow
          // compatibility check never delays the rest of this handler, in
          // particular handleWindowRestore() a few lines down.
          const hasMods = instance.loader !== 'vanilla' && instance.content.some((c) => c.type === 'mod' && c.enabled)
          void (async () => {
            let hint = ''
            if (hasMods) {
              try {
                const report = await checkCompatibility(instanceId)
                const blocking = report.issues.find((i) => i.severity === 'error')
                hint = blocking
                  ? tr(` Vermutlich liegt es an einem Mod: ${blocking.title}.`, ` It is probably caused by a mod: ${blocking.title}.`)
                  : ' ' + tr('Häufig liegt das an einem Mod, der nicht zu dieser Version passt.', 'This is often caused by a mod that does not fit this version.')
              } catch {
                hint = ' ' + tr('Häufig liegt das an einem Mod, der nicht zu dieser Version passt.', 'This is often caused by a mod that does not fit this version.')
              }
            }
            notify(
              'error',
              tr(`${instance.name} ist abgestürzt`, `${instance.name} crashed`),
              tr(
                `Minecraft wurde mit Code ${code} beendet.${hint} Das Log findest du im Instanz-Tab.`,
                `Minecraft exited with code ${code}.${hint} You can find the log in the instance's Log tab.`
              ),
              // Stays until clicked away: the launcher is often hidden while
              // the game runs, and the notice was gone by the time it showed.
              { route: `/instances/${instanceId}?tab=logs`, timeout: 0 }
            )
          })()
        } else if (getSettings().notifyOnGameExit) {
          // "1 Minuten" and "0 Minuten" read as broken, and two hours as
          // "120 Minuten" are hard to take in at a glance.
          const played =
            minutes < 1
              ? tr('unter einer Minute', 'less than a minute')
              : minutes < 60
                ? tr(`${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`, `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
                : tr(`${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`, `${Math.floor(minutes / 60)} h ${minutes % 60} min`)
          notify('info', tr(`${instance.name} beendet`, `${instance.name} closed`), tr(`Spielzeit: ${played}`, `Play time: ${played}`))
        }
      }

      handleWindowRestore(instanceId)
    })

    // Confirms the process genuinely came up before anything below treats the
    // launch as successful. Node only reports a failed spawn (a missing
    // wrapper executable, a Java binary that got moved or deleted) through
    // 'error', fired on a later tick than this whole function body runs on.
    // Without waiting for it here, markPlayed(), the "running" status and
    // task.done() below all ran and reported success before that failure was
    // ever seen: the instance's last-played timestamp was bumped for a game
    // that never started, and the launch resolved without error from the
    // caller's side. The permanent 'error' handler above still does its own
    // cleanup either way; this only delays declaring success until it is true.
    const spawnedProcess = child
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        spawnedProcess.off('error', onSpawnError)
        resolve()
      }
      const onSpawnError = (err: Error): void => {
        spawnedProcess.off('spawn', onSpawn)
        reject(err)
      }
      spawnedProcess.once('spawn', onSpawn)
      spawnedProcess.once('error', onSpawnError)
    })

    // Past this point the JVM is up and the user is in the game. Anything that
    // still goes wrong here is bookkeeping, and bookkeeping must not cost them
    // their session: the catch below kills a running child, so letting a
    // virus scanner briefly locking instance.json bubble up would shut down
    // Minecraft moments after it started.
    try {
      markPlayed(instanceId)
    } catch (err) {
      logger.warn(`Spielzeit für ${instanceId} nicht gespeichert:`, err)
    }

    setStatus(instanceId, 'running', tr('Minecraft läuft', 'Minecraft is running'), { pid: child.pid, startedAt })
    task.done(tr('Minecraft gestartet', 'Minecraft started'))

    try {
      handleWindowBehaviour(instance)
    } catch (err) {
      logger.warn('Fensterverhalten konnte nicht angewendet werden:', err)
    }
  } catch (err) {
    launchFailed = true
    dropNativesClaim()

    // A game that is already up must not outlive the launch that failed, or it
    // keeps running with the UI showing "idle" and no way to stop it.
    const stillUp = child !== null && child.exitCode === null && !child.killed
    if (stillUp && child) {
      try {
        child.kill()
      } catch {
        // already gone
      }
    }

    task.fail(err)
    setStatus(instanceId, 'idle', err instanceof Error ? err.message : String(err))

    // The log window opened before any of the pre-spawn checks (account,
    // compatibility, downloads, Java) that can throw here, and it is normally
    // closed by the process exit handler. A launch that never got that far
    // never spawned a process, so that handler never runs and the window
    // would otherwise stay open over an instance that is not starting.
    if (!spawned) {
      closeGameLogWindow(instanceId)
      // Closing the window during preparation only hides it; bring it back so
      // the error is actually seen.
      const win = getMainWindow()
      if (win && !win.isDestroyed() && ownRunningCount() === 0) {
        // Launch behaviour "minimize" leaves the window minimized, which
        // Windows still reports as visible, so the visibility check alone
        // never catches it.
        if (win.isMinimized()) win.restore()
        if (!win.isVisible()) win.show()
      }
    }

    if (stillUp) {
      // A process that was only just signalled is not dead yet. Clearing the
      // registry right now would advertise the instance as free while the JVM
      // is still shutting down — long enough for a second launch against the
      // same world. The exit handler clears it once the process is really gone.
      const doomed = child
      setTimeout(() => {
        // Identity check so a newer launch's entry is never removed.
        if (getRunning(instanceId)?.process === doomed) {
          logger.warn(`Prozess von ${instanceId} reagierte nicht auf kill, Eintrag wird verworfen`)
          clearRunning(instanceId)
        }
      }, 10_000).unref?.()
    } else {
      clearRunning(instanceId)
    }

    throw err
  } finally {
    clearStarting(instanceId)
  }
}

function classify(stream: 'stdout' | 'stderr', line: string): LogLine['level'] {
  if (/\bWARN\b/.test(line)) return 'warn'
  if (/\bERROR\b|\bFATAL\b|Exception|\bat [\w.$]+\(/.test(line)) return 'error'
  if (/\bDEBUG\b|\bTRACE\b/.test(line)) return 'debug'
  return stream === 'stderr' ? 'error' : 'info'
}

function attachOutput(instanceId: string, child: ReturnType<typeof spawn>): void {
  const handle = (stream: 'stdout' | 'stderr') => {
    // A chunk boundary lands wherever the pipe buffer happens to fill, so it
    // splits both multi-byte characters and log lines. `StringDecoder` holds
    // back a partial character, `carry` holds back a partial line.
    const decoder = new StringDecoder('utf8')
    let carry = ''
    // Mojang's log config writes the console as XML; this turns each event
    // back into one readable line and passes everything else through.
    const parser = createLog4jParser(
      (parsed) => pushLog({ instanceId, stream, level: parsed.level, text: parsed.text, time: parsed.time }),
      (line) => classify(stream, line)
    )

    const onData = (chunk: Buffer): void => {
      const parts = (carry + decoder.write(chunk)).split(/\r?\n/)
      // The last element is whatever came before the next newline arrives.
      carry = parts.pop() ?? ''
      for (const raw of parts) parser.push(raw)
    }

    const onEnd = (): void => {
      const rest = carry + decoder.end()
      carry = ''
      if (rest) parser.push(rest)
      parser.end()
    }

    return { onData, onEnd }
  }

  for (const name of ['stdout', 'stderr'] as const) {
    const source = child[name]
    if (!source) continue
    const { onData, onEnd } = handle(name)
    source.on('data', onData)
    source.on('end', onEnd)
  }
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  // Comes straight out of instance.json, so it is only a string by convention.
  // Calling `.split` on anything else threw right before spawn, turning a
  // cosmetic mistake in a settings file into an instance that cannot start.
  if (typeof raw !== 'string') return env
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return env
}

/**
 * How long a pre-launch command gets before it is killed outright.
 *
 * Every other slow step in this file is bounded (downloads via `net.ts`'s own
 * timeouts, Java installs via `resolveJava`'s `task.signal`) except this one:
 * a command that waits on the network, sits behind a swallowed prompt, or
 * simply loops, ran forever. `isStarting` only clears in this function's
 * caller's `finally`, so a hang here left the instance permanently unable to
 * start, repair, or have its mods touched, with no way out but restarting the
 * whole launcher.
 */
const PRE_LAUNCH_TIMEOUT_MS = 5 * 60_000

async function runPreLaunch(instance: Instance, cwd: string, task: Task): Promise<void> {
  const parts = splitUserArgs(instance.settings.preLaunchCommand)
  if (parts.length === 0) return

  await new Promise<void>((resolve, reject) => {
    const child = spawn(parts[0], parts.slice(1), { cwd, windowsHide: true })

    const settle = (fn: () => void): void => {
      clearTimeout(timeout)
      task.signal.removeEventListener('abort', onAbort)
      fn()
    }

    // A plain `child.kill()` is SIGTERM, and a command that ignores or traps
    // it stayed alive as an orphan even after this already gave up and moved
    // on. `stopInstance` escalates to SIGKILL for exactly this reason; this
    // spawn never did.
    const killHarder = (): void => {
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
      }, 5000).unref?.()
    }

    const timeout = setTimeout(() => {
      // Routed through `settle` like every other exit path, not called
      // directly: left out of it, the 'abort' listener below stayed
      // registered on `task.signal` for the rest of the launch, doing
      // nothing useful and never cleaned up.
      settle(() => {
        child.kill()
        killHarder()
        reject(
          new Error(
            tr(
              `Pre-Launch-Befehl lief länger als ${PRE_LAUNCH_TIMEOUT_MS / 60_000} Minuten und wurde beendet.`,
              `Pre-launch command ran longer than ${PRE_LAUNCH_TIMEOUT_MS / 60_000} minutes and was stopped.`
            )
          )
        )
      })
    }, PRE_LAUNCH_TIMEOUT_MS)

    // The cancel button reaches every other step in this file through
    // `task.signal`; this was the one spawn that never listened for it.
    const onAbort = (): void => {
      child.kill()
      killHarder()
    }
    task.signal.addEventListener('abort', onAbort)

    child.on('error', (err) => settle(() => reject(err)))
    child.on('exit', (code) =>
      settle(() => {
        if (task.cancelled) return reject(new TaskCancelledError())
        if (code === 0) return resolve()
        reject(new Error(tr(`Pre-Launch-Befehl endete mit Code ${code}`, `Pre-launch command exited with code ${code}`)))
      })
    )
  })
}

/* ------------------------------------------------------------------ *
 * Window behaviour & stopping
 * ------------------------------------------------------------------ */

function handleWindowBehaviour(instance: Instance): void {
  // Read fresh: the instance object was captured before the downloads, and a
  // change made in its settings meanwhile should count for this start.
  const own = tryGetInstance(instance.id)?.settings.launchBehaviour ?? instance.settings.launchBehaviour
  const behaviour = !own || own === 'default' ? getSettings().launchBehaviour : own
  const win = getMainWindow()
  if (!win) return

  // Hidden only while the live-log window is there to take its place. Closed
  // by hand before the game got this far, hiding would leave the launcher
  // with no window at all until the game ends.
  if (behaviour === 'hide') {
    if (hasGameLogWindow(instance.id)) win.hide()
  }
  else if (behaviour === 'close') win.minimize()
}

/**
 * Brings the main window back once nothing is running any more, and sends it
 * straight to the instance's own Log tab: the separate live-log window
 * (`gameLogWindow.ts`) that carried this while the game played closes at the
 * same moment, on the same "nothing is running" condition, so the log stays
 * reachable in the one or the other but never neither.
 */
function handleWindowRestore(instanceId: string): void {
  closeGameLogWindow(instanceId)

  // Called from every instance's own exit handler, so with more than one
  // game running at once this fires once per game. Showing the window back
  // up after the first one quits, while a second is still going, would undo
  // the very hide that game itself is still relying on, and would close that
  // other game's own still-needed live-log window early.
  // Only games this session started count: a game adopted from before a
  // restart never hid the window, and waiting for it left the launcher hidden
  // for good once this one ended.
  if (ownRunningCount() > 0) return
  navigate(`/instances/${instanceId}?tab=logs`)
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  // Same reasoning as the pre-spawn failure path above: a minimized window
  // still reports as visible on Windows, so restore it explicitly first.
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
}

/**
 * @param immediate Skip the graceful SIGTERM window and kill outright. Used
 *   while the launcher itself is quitting, where the timer that would escalate
 *   to SIGKILL five seconds later dies with the process that armed it — leaving
 *   a JVM that ignored SIGTERM running with nothing left to supervise it.
 */
export function stopInstance(instanceId: string, immediate = false): void {
  const game = getRunning(instanceId)
  if (!game) {
    // Deliberately not killed by pid: the id comes from a file written by an
    // earlier session, and the OS may have handed that number to something
    // else entirely since. Killing a stranger's process would be far worse
    // than the problem. Dropping our own record is safe though, and it is the
    // user's way out when a recycled pid makes us think a long-gone game is
    // still running — without it the instance stays locked indefinitely.
    const orphan = getAdopted(instanceId)
    if (orphan) {
      clearRunning(instanceId)
      logger.info(`Übernommener Eintrag für ${instanceId} (PID ${orphan.pid}) verworfen`)
      setStatus(instanceId, 'idle', tr('Eintrag entfernt, die Instanz lässt sich wieder starten.', 'Entry removed, the instance can be started again.'))
      notify(
        'info',
        tr('Eintrag entfernt', 'Entry removed'),
        tr('Falls Minecraft noch offen ist, schließe das Fenster selbst. Dieser Launcher kann es nicht beenden, weil es eine frühere Sitzung gestartet hat.', 'If Minecraft is still open, close the window yourself. This launcher cannot stop it because an earlier session started it.')
      )
      return
    }
    return
  }

  // Already being stopped: a second taskkill or signal at the same pid buys
  // nothing and can only race the first one.
  // An immediate stop (launcher quitting) still goes through, it escalates.
  if (stopping.has(instanceId) && !immediate) return
  stopping.add(instanceId)
  // A game that survives every attempt must not lock the stop button forever.
  setTimeout(() => {
    if (getRunning(instanceId)?.process === game.process) stopping.delete(instanceId)
  }, 10_000).unref()

  logger.info(`Beende Instanz ${instanceId} (PID ${game.process.pid})`)
  pushLog({
    instanceId,
    stream: 'launcher',
    level: 'warn',
    text: tr('Minecraft wird beendet…', 'Stopping Minecraft…'),
    time: Date.now()
  })

  stopRequested.add(instanceId)

  if (process.platform === 'win32' && game.process.pid) {
    // Minecraft spawns child processes; /T takes the whole tree down.
    const killer = spawn('taskkill', ['/pid', String(game.process.pid), '/f', '/t'], {
      windowsHide: true
    })
    // An 'error' with no listener is a hard throw in Node, and there is no
    // uncaughtException handler — so a taskkill.exe that cannot be spawned (a
    // stripped PATH, an AppLocker policy) would take the whole launcher down
    // instead of failing this one stop request.
    let killerFailed = false
    killer.on('error', (err) => {
      killerFailed = true
      logger.error(`taskkill für ${instanceId} fehlgeschlagen:`, err)
      // Fall back to the signal path so the request still does something.
      game.process.kill('SIGKILL')
    })
    // taskkill can exit non-zero without firing 'error' (access denied, or the
    // pid already gone). The marker stays while the fallback kill gets its
    // chance, since a successful fallback is still a requested stop; only a
    // game that survives both loses it, so its next real crash is reported.
    killer.on('exit', (code) => {
      if (killerFailed || code === 0) return

      // The process can already be gone by the time taskkill runs (it exited
      // on its own right after the request), which also exits non-zero. That
      // is the expected outcome, not a failure, so it only gets a plain log.
      if (getRunning(instanceId)?.process !== game.process) {
        logger.info(`taskkill für ${instanceId} fand den Prozess nicht mehr (Code ${code})`)
        return
      }

      logger.error(`taskkill für ${instanceId} beendete sich mit Code ${code}`)
      game.process.kill('SIGKILL')
      setTimeout(() => {
        // Compared by process, not id: a relaunch within these seconds is a
        // different game and must not be reported as the one that would not die.
        if (getRunning(instanceId)?.process !== game.process) return
        stopRequested.delete(instanceId)
        pushLog({
          instanceId,
          stream: 'launcher',
          level: 'error',
          text: tr('Minecraft ließ sich nicht beenden. Schließe das Spiel selbst oder beende es über den Task-Manager.', 'Minecraft could not be stopped. Close the game yourself or end it in the Task Manager.'),
          time: Date.now()
        })
      }, 5000)
    })
  } else if (immediate) {
    game.process.kill('SIGKILL')
  } else {
    game.process.kill('SIGTERM')
    setTimeout(() => {
      if (isRunning(instanceId)) game.process.kill('SIGKILL')
    }, 5000)
  }
}

export function stopAll(immediate = false): void {
  for (const game of listRunning()) {
    try {
      stopInstance(game.instanceId, immediate)
    } catch (err) {
      // One instance refusing to stop must not skip the rest, and this runs
      // from `before-quit` where a throw would be unhandled.
      logger.error(`Beenden von ${game.instanceId} fehlgeschlagen:`, err)
    }
  }
}
