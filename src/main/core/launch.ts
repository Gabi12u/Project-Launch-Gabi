import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { app } from 'electron'
import { EVENTS } from '@shared/ipc'
import type { Account, Instance, LaunchPhase, LaunchPreflight, LaunchStatus, LogLine } from '@shared/types'
import { paths } from '../paths'
import { getSettings } from '../store'
import { emit, getMainWindow, notify } from '../events'
import { log } from '../logger'
import { Task } from '../tasks'
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
import { requiredJavaMajor, resolveJava } from './java'
import {
  getInstance,
  markPlayed,
  persist,
  recordSession,
  resolveVersionId,
  syncContentWithDisk
} from './instances'
import { checkCompatibility } from './compat'
import { getActiveAccount, getValidAccessToken, toPublicAccount } from '../auth/microsoft'
import {
  activeVersionIds,
  clearRunning,
  getAdopted,
  getRunning,
  isRunning,
  listRunning,
  setRunning
} from './running'

const logger = log('launch')

export { isRunning }

const SEPARATOR = process.platform === 'win32' ? ';' : ':'

/** Ring buffer of recent output per instance so the UI can show a log tab. */
const logBuffers = new Map<string, LogLine[]>()
const LOG_BUFFER_SIZE = 800

function pushLog(line: LogLine): void {
  const buffer = logBuffers.get(line.instanceId) ?? []
  buffer.push(line)
  if (buffer.length > LOG_BUFFER_SIZE) buffer.splice(0, buffer.length - LOG_BUFFER_SIZE)
  logBuffers.set(line.instanceId, buffer)
  emit(EVENTS.logLine, line)
}

export function getLogBuffer(instanceId: string): LogLine[] {
  return logBuffers.get(instanceId) ?? []
}

/**
 * Drops an instance's log buffer.
 *
 * Nothing evicted these before, so every id ever launched kept up to 800 lines
 * for the life of the process — and a new instance that reused a freed slug
 * would open its "Log" tab on the previous one's output. Called from the IPC
 * layer rather than from `instances.ts`, which cannot import this module
 * without creating a cycle.
 */
export function dropLogBuffer(instanceId: string): void {
  logBuffers.delete(instanceId)
}

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

function splitUserArgs(raw: string): string[] {
  // Respects quoted segments so paths with spaces survive.
  const matches = userText(raw).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return matches.map((a) => a.replace(/^["']|["']$/g, '')).filter(Boolean)
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
  try {
    const runtime = await resolveJava({
      explicitPath: instance.settings.javaPath || undefined,
      major: instance.settings.javaMajorOverride ?? javaMajor,
      // Never trigger a download from the preflight panel.
      autoManage: false
    })
    java = { major: runtime.major, version: runtime.version, path: runtime.path, managed: runtime.managed }
  } catch {
    java = null
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

const starting = new Set<string>()

/**
 * How many launches are underway but have not spawned a process yet.
 *
 * The updater needs this on top of `runningCount()`: everything before the
 * spawn — the compatibility check, file downloads, a Java install — can take
 * minutes, during which the running registry is still empty. Restarting for an
 * update in that window throws the user's Play click away with nothing to show
 * for it.
 */
export function startingCount(): number {
  return starting.size
}

export async function launchInstance(options: LaunchOptions): Promise<void> {
  const { instanceId } = options

  if (isRunning(instanceId) || starting.has(instanceId)) {
    // A game left over from a previous launcher session needs a different
    // message: the user cannot stop it from here, and starting a second JVM on
    // the same world is exactly what this guard exists to prevent.
    const orphan = getAdopted(instanceId)
    throw new Error(
      orphan
        ? `Minecraft läuft für diese Instanz noch aus einer früheren Sitzung (PID ${orphan.pid}). ` +
          `Beende das Spiel, danach lässt sich die Instanz wieder starten.`
        : 'Diese Instanz läuft bereits.'
    )
  }
  starting.add(instanceId)
  // A stop that never produced an exit (an orphaned record, a taskkill that
  // failed) would otherwise leave its marker behind and excuse the next
  // genuine crash of this instance as intentional.
  stopRequested.delete(instanceId)

  const settings = getSettings()
  const instance = getInstance(instanceId)
  const task = new Task(`${instance.name} wird gestartet`, 'Vorbereitung…', instanceId)

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

  try {
    setStatus(instanceId, 'preparing', 'Vorbereitung…')

    // 1. Account -----------------------------------------------------
    const stored = getActiveAccount()
    if (!stored) {
      throw new Error('Kein Account ausgewählt. Melde dich zuerst an oder lege ein Offline-Profil an.')
    }

    let accessToken = '0'
    let xuid = ''
    let userType = 'legacy'
    if (stored.type === 'microsoft') {
      task.update('Anmeldung wird geprüft…', null)
      accessToken = await getValidAccessToken(stored.id)
      userType = 'msa'
      xuid = stored.uuid.replace(/-/g, '')
    }

    const account: Account = toPublicAccount(stored)

    // 2. Compatibility ----------------------------------------------
    if (!options.ignoreIssues) {
      setStatus(instanceId, 'checking', 'Mods werden geprüft…')
      task.update('Mod-Kompatibilität wird geprüft…', null)
      const report = await checkCompatibility(instanceId)
      if (!report.launchable) {
        const blocking = report.issues.filter((i) => i.severity === 'error')
        throw new Error(
          `Start blockiert: ${blocking[0]?.title ?? 'Es wurden Probleme gefunden.'} ` +
            `(${blocking.length} ${blocking.length === 1 ? 'Problem' : 'Probleme'})`
        )
      }
    }

    // 3. Game files --------------------------------------------------
    setStatus(instanceId, 'downloading', 'Dateien werden geprüft…')
    const versionId = await resolveVersionId(instance)
    const versionJson = await loadVersionJson(versionId)

    await task.within(0, 0.7, () => installVersion(versionJson, instance.mcVersion, task))

    if (!instance.installed) {
      persist({ ...getInstance(instanceId), installed: true })
    }

    // 4. Java --------------------------------------------------------
    setStatus(instanceId, 'installing-java', 'Java wird vorbereitet…')
    const javaMajor = instance.settings.javaMajorOverride ?? requiredJavaMajor(versionJson, instance.mcVersion)
    const java = await resolveJava({
      explicitPath: instance.settings.javaPath || undefined,
      major: javaMajor,
      autoManage: settings.javaAutoManage,
      task
    })
    logger.info(`Starte ${instance.name} mit Java ${java.version} (${java.path})`)

    // 5. Natives -----------------------------------------------------
    setStatus(instanceId, 'launching', 'Natives werden entpackt…')
    const nativesDir = paths.natives(versionId)
    const libraries = resolveLibraries(versionJson)

    claimNatives(versionId)
    claimedVersion = versionId
    await prepareNatives(versionId, nativesDir, libraries)

    // 6. Classpath ---------------------------------------------------
    const classpath = libraries
      .filter((l) => !l.native && existsSync(l.path))
      .map((l) => l.path)

    const clientJar = clientJarPath(instance.mcVersion)
    if (existsSync(clientJar)) classpath.push(clientJar)

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
      : splitUserArgs(substitute(versionJson.minecraftArguments ?? '', placeholders))

    if (instance.settings.fullscreen && !gameArgs.includes('--fullscreen')) {
      gameArgs.push('--fullscreen')
    }

    const args = [...jvmArgs, versionJson.mainClass, ...gameArgs]

    // 9. Spawn -------------------------------------------------------
    if (userText(instance.settings.preLaunchCommand).trim()) {
      task.update('Pre-Launch-Befehl läuft…', null)
      await runPreLaunch(instance, gameDir)
    }

    const env = { ...process.env, ...parseEnv(instance.settings.envVars) }

    // `java.exe` is a console binary, so Windows opens a console window next to
    // the game — and closing that window kills Minecraft. `javaw.exe` is the
    // same JVM without the console. Output is captured through pipes either way.
    const javaBinary = windowlessJava(java.path)

    let command = javaBinary
    let commandArgs = args
    if (userText(instance.settings.wrapperCommand).trim()) {
      const wrapper = splitUserArgs(instance.settings.wrapperCommand)
      command = wrapper[0]
      commandArgs = [...wrapper.slice(1), javaBinary, ...args]
    }

    logger.info(`Kommando: ${command} (${commandArgs.length} Argumente)`)
    pushLog({
      instanceId,
      stream: 'launcher',
      level: 'info',
      text: `Starte Minecraft ${instance.mcVersion} (${versionId}) mit ${memory} MB RAM · Java ${java.major}`,
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
      status: { instanceId, phase: 'running', detail: 'Läuft', progress: null, pid: child.pid, startedAt }
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
        text: `Prozessfehler: ${err.message}`,
        time: Date.now()
      })

      // Node does not promise an 'exit' after a failed spawn — the classic
      // ENOENT case fires 'error' alone. Without this the instance would stay
      // in the running registry forever: unlaunchable ("läuft bereits"), and
      // blocking the launcher's own update, until the app is restarted.
      if (!spawned) {
        clearRunning(instanceId)
        setStatus(instanceId, 'idle', `Java konnte nicht gestartet werden: ${err.message}`)
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
      const crashed = !requested && code !== 0 && code !== null
      clearRunning(instanceId)

      recordSession(instanceId, { startedAt, endedAt, crashed, exitCode: code })

      pushLog({
        instanceId,
        stream: 'launcher',
        level: crashed ? 'error' : 'info',
        text: crashed
          ? `Minecraft wurde mit Code ${code} beendet${signal ? ` (Signal ${signal})` : ''}.`
          : 'Minecraft wurde beendet.',
        time: endedAt
      })

      // A failed launch already reported why in the catch below, and the game
      // is only exiting because that failure killed it. Overwriting the reason
      // with "Beendet" would hide what actually went wrong.
      if (!launchFailed) {
        setStatus(instanceId, crashed ? 'crashed' : 'stopped', crashed ? `Absturz (Code ${code})` : 'Beendet', {
          exitCode: code
        })

        const minutes = Math.round((endedAt - startedAt) / 60000)
        if (crashed) {
          notify(
            'error',
            `${instance.name} ist abgestürzt`,
            `Minecraft wurde mit Code ${code} beendet. Das Log findest du im Instanz-Tab.`,
            { route: `/instances/${instanceId}?tab=logs` }
          )
        } else if (getSettings().notifyOnGameExit) {
          notify('info', `${instance.name} beendet`, `Spielzeit: ${minutes} Minuten`)
        }
      }

      handleWindowRestore()
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

    setStatus(instanceId, 'running', 'Minecraft läuft', { pid: child.pid, startedAt })
    task.done('Minecraft gestartet')

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
    starting.delete(instanceId)
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

    const onData = (chunk: Buffer): void => {
      const parts = (carry + decoder.write(chunk)).split(/\r?\n/)
      // The last element is whatever came before the next newline arrives.
      carry = parts.pop() ?? ''
      for (const raw of parts) {
        const line = raw.trimEnd()
        if (!line) continue
        pushLog({ instanceId, stream, level: classify(stream, line), text: line, time: Date.now() })
      }
    }

    const onEnd = (): void => {
      const line = (carry + decoder.end()).trimEnd()
      carry = ''
      if (line) {
        pushLog({ instanceId, stream, level: classify(stream, line), text: line, time: Date.now() })
      }
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
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return env
}

async function runPreLaunch(instance: Instance, cwd: string): Promise<void> {
  const parts = splitUserArgs(instance.settings.preLaunchCommand)
  if (parts.length === 0) return

  await new Promise<void>((resolve, reject) => {
    const child = spawn(parts[0], parts.slice(1), { cwd, windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Pre-Launch-Befehl endete mit Code ${code}`))
    )
  })
}

/* ------------------------------------------------------------------ *
 * Window behaviour & stopping
 * ------------------------------------------------------------------ */

function handleWindowBehaviour(instance: Instance): void {
  const behaviour = instance.settings.launchBehaviour || getSettings().launchBehaviour
  const win = getMainWindow()
  if (!win) return

  if (behaviour === 'hide') win.hide()
  else if (behaviour === 'close') win.minimize()
}

function handleWindowRestore(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
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
      setStatus(instanceId, 'idle', 'Eintrag entfernt, die Instanz lässt sich wieder starten.')
      notify(
        'info',
        'Eintrag entfernt',
        `Falls Minecraft noch offen ist, schließe das Fenster selbst — dieser Launcher kann es ` +
          `nicht beenden, weil es eine frühere Sitzung gestartet hat.`
      )
      return
    }
    return
  }

  logger.info(`Beende Instanz ${instanceId} (PID ${game.process.pid})`)
  pushLog({
    instanceId,
    stream: 'launcher',
    level: 'warn',
    text: 'Minecraft wird beendet…',
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
    killer.on('error', (err) => {
      logger.error(`taskkill für ${instanceId} fehlgeschlagen:`, err)
      // Fall back to the signal path so the request still does something.
      game.process.kill('SIGKILL')
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
