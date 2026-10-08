import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { DEFAULT_INSTANCE_SETTINGS } from '@shared/defaults'
import { EVENTS } from '@shared/ipc'
import type {
  ContentItem,
  CreateInstanceOptions,
  Instance,
  InstancePatch,
  InstanceSummary,
  LaunchBehaviour,
  LoaderId
} from '@shared/types'
import {
  contentPath,
  copyDatapackIntoWorld,
  ensureInstanceLayout,
  worldExists,
  paths,
  removeDatapackFromWorld,
  RESERVED_WINDOWS_NAMES,
  safeJoin,
  sanitizeVersionId
} from '../paths'
import { getSettings, readJsonResult, readPreviousJson, writeJsonAtomic } from '../store'
import { guessGameOfFolder } from './instanceFolder'
import { sleptBetween } from './sleep'
import { emit, notify } from '../events'
import { log } from '../logger'
import { TaskCancelledError, withTask } from '../tasks'
import { sha1File } from './net'
import { installLoader, resolveLatestLoaderVersion } from '../loaders'
import { installVersion, loadVersionJson } from './mojang'
import { readJarMetadata, type JarMetadata } from './modMetadata'
import { isRunning, isStarting } from './running'
import { assertNotCopying, isContentBusy, isCopying, markCopying, unmarkCopying, withContentLock, withItemLock } from './contentLock'
import { isArchiving, isRestoring } from './restoreLock'
import { isRepairing } from './repairLock'
import { PACK_FILENAME as START_SCREEN_PACK } from './startScreen'
import { tr } from '@shared/i18n'

const logger = log('instances')

/** In-memory cache; the JSON files on disk stay the source of truth. */
const cache = new Map<string, Instance>()
let loaded = false

/**
 * Ids that were deleted while work was still running against them.
 *
 * Installs are started fire-and-forget, so a delete can land in the middle of
 * one. The id stays here for the rest of the session, which is cheap and keeps
 * a late write from recreating the instance.
 */
const deleted = new Set<string>()

/* ------------------------------------------------------------------ *
 * Loading & persistence
 * ------------------------------------------------------------------ */

function normalise(raw: Partial<Instance>, id: string): Instance {
  return {
    id,
    name: raw.name ?? tr('Unbenannt', 'Unnamed'),
    description: raw.description ?? '',
    group: raw.group ?? '',
    mcVersion: raw.mcVersion ?? '1.21.11',
    loader: (raw.loader ?? 'vanilla') as LoaderId,
    loaderVersion: raw.loaderVersion ?? '',
    appearance: {
      icon: raw.appearance?.icon ?? '🟩',
      accent: raw.appearance?.accent ?? '#7c5cff',
      background: raw.appearance?.background ?? null
    },
    settings: { ...DEFAULT_INSTANCE_SETTINGS, ...raw.settings },
    // `??` lets a non-array through (a hand edit, a damaged file), and every
    // content and session consumer iterates these without a further check.
    content: Array.isArray(raw.content) ? raw.content : [],
    source: raw.source ?? { type: 'manual' },
    createdAt: raw.createdAt ?? Date.now(),
    lastPlayed: raw.lastPlayed ?? null,
    totalPlayMs: raw.totalPlayMs ?? 0,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    favorite: raw.favorite ?? false,
    installing: false, // never restore a stale "installing" flag
    installed: raw.installed ?? false
  }
}

export function loadInstances(force = false): Instance[] {
  if (loaded && !force) return [...cache.values()]

  cache.clear()
  const dir = paths.instances()
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const file = paths.instanceFile(entry)
      if (!existsSync(file)) continue
      try {
        // A damaged file is set aside with a notice. A locked one (a scanner
        // holding it for a moment) is skipped for now instead: caching a blank
        // stand in would have let the next save overwrite the intact file.
        const result = readJsonResult<Partial<Instance>>(file, true)
        if (!result.ok && result.reason === 'unreadable') {
          notify(
            'warning',
            tr('Instanz nicht geladen', 'Instance not loaded'),
            tr(
              `Die Instanz „${entry}“ war beim Start gesperrt und fehlt deshalb in der Liste. Nach einem Neustart des Launchers ist sie wieder da.`,
              `The instance "${entry}" was locked at startup and is therefore missing from the list. It will be back after the launcher restarts.`
            )
          )
          continue
        }
        const raw: Partial<Instance> | null =
          result.ok && result.value && typeof result.value === 'object' ? result.value : null
        if (!raw && !result.ok && result.reason === 'corrupt') {
          const recovered = normalise(recoverDamagedInstance(entry, file), entry)
          // Written back at once. The damaged file was set aside by the read
          // above, so held only in memory the instance vanished from the list
          // on the next start, worlds and all still on disk.
          try {
            writeJsonAtomic(file, recovered)
          } catch (err) {
            logger.warn(`Wiederhergestellte Instanz ${entry} konnte nicht gespeichert werden:`, err)
          }
          cache.set(entry, recovered)
          continue
        }
        cache.set(entry, normalise(raw ?? {}, entry))
      } catch (err) {
        logger.error(`Instanz ${entry} konnte nicht geladen werden:`, err)
      }
    }
  }

  loaded = true
  logger.info(`${cache.size} Instanzen geladen`)
  return [...cache.values()]
}

/**
 * Drops the cached instances so the next read comes from disk again.
 *
 * `paths.*()` resolves against `getSettings().dataDirectory` on every call, so
 * the moment the user points the launcher at another folder every file
 * operation moves with it — while this cache would keep serving the instances
 * of the *old* directory, metadata and all. Called from the settings handler
 * alongside the other cache invalidations.
 */
/**
 * One-time companion to the settings migration in `store.ts`. Every instance
 * used to copy the global launch behaviour when it was created, so that value
 * sits in each instance.json as if chosen there, and the global setting could
 * never reach it again. Instances holding exactly the old global value go back
 * to following the global setting; any other value was picked for that
 * instance on purpose and stays. Returns false if any instance could not be
 * written, so the caller tries again on the next start.
 */
export function migrateInstanceLaunchBehaviour(previousGlobal: LaunchBehaviour): boolean {
  let moved = 0
  let complete = true
  for (const instance of loadInstances()) {
    if (instance.settings.launchBehaviour !== previousGlobal) continue
    try {
      persist({ ...instance, settings: { ...instance.settings, launchBehaviour: 'default' } })
      moved++
    } catch (err) {
      complete = false
      logger.warn(`Startverhalten von ${instance.id} konnte nicht umgestellt werden:`, err)
    }
  }
  if (moved > 0) logger.info(`Startverhalten bei ${moved} Instanz(en) auf die globale Einstellung umgestellt`)
  return complete
}

/**
 * What is left to go on once an instance.json turned out damaged.
 *
 * It used to become a blank stand in: "Unbenannt", vanilla, the newest
 * Minecraft version. "Spielen" then started that version on the old worlds,
 * which Minecraft may convert one way. The last good version comes first;
 * failing that, the worlds themselves say which Minecraft they were played
 * with, and the mods which loader.
 */
function recoverDamagedInstance(id: string, file: string): Partial<Instance> {
  const previous = readPreviousJson<Partial<Instance>>(file)
  if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
    const name = typeof previous.name === 'string' ? previous.name : id
    notify(
      'warning',
      tr('Instanz wiederhergestellt', 'Instance restored'),
      tr(
        `Die Datei der Instanz „${name}“ war beschädigt. Der Stand vor ihrer letzten Änderung wurde wiederhergestellt.`,
        `The file of the instance "${name}" was damaged. The state before its last change has been restored.`
      )
    )
    return previous
  }

  const guessed = guessGameOfFolder(paths.gameDir(id))
  notify(
    'warning',
    tr('Instanz nur teilweise wiederhergestellt', 'Instance only partly restored'),
    tr(
      `Die Datei der Instanz „${id}“ war beschädigt. ` +
        (guessed ? `Aus den Welten wurde Minecraft ${guessed.mcVersion} erkannt. ` : '') +
        'Prüfe Version und Mod-Loader in den Einstellungen der Instanz, bevor du spielst.',
      `The file of the instance "${id}" was damaged. ` +
        (guessed ? `Minecraft ${guessed.mcVersion} was recognised from the worlds. ` : '') +
        'Check the version and mod loader in the instance settings before you play.'
    )
  )
  return {
    name: id,
    description: tr(
      'Aus einer beschädigten Datei wiederhergestellt. Prüfe Version und Mod-Loader, bevor du spielst.',
      'Restored from a damaged file. Check the version and mod loader before you play.'
    ),
    ...(guessed ?? {})
  }
}

export function invalidateInstanceCache(): void {
  cache.clear()
  loaded = false
  // Tombstones are keyed by id, and ids are only unique within one data
  // directory — keeping them would blackhole a same-named instance over there.
  deleted.clear()
  logger.info('Instanz-Cache verworfen')
}

export function getInstance(id: string): Instance {
  if (!loaded) loadInstances()
  const instance = cache.get(id)
  if (!instance) throw new Error(tr(`Instanz ${id} existiert nicht`, `Instance ${id} does not exist`))
  return instance
}

export function tryGetInstance(id: string): Instance | null {
  if (!loaded) loadInstances()
  return cache.get(id) ?? null
}

export function persist(instance: Instance): Instance {
  // A delete cannot wait for the fire-and-forget install that may still be
  // running against this id, and `writeJsonAtomic` recreates missing parent
  // directories — so without this check the install's next write would bring
  // the folder and the cache entry back, holding half-installed state.
  if (deleted.has(instance.id)) {
    logger.debug(`Schreibvorgang für gelöschte Instanz ${instance.id} verworfen`)
    return instance
  }

  // Written before the cache is updated: `writeJsonAtomic` is synchronous and
  // can throw (a virus scanner or indexer briefly holding instance.json, a
  // full disk), several of them documented as real, recurring cases exactly
  // in this file. Updating the cache first would have made every reader
  // (getInstance, tryGetInstance) see the new value for the rest of the
  // session while the file on disk still held the old one, silently
  // reverting on the next launcher start. `store.ts` had the same bug for
  // launcher settings, fixed the same way.
  writeJsonAtomic(paths.instanceFile(instance.id), instance, { keepPrevious: true })
  cache.set(instance.id, instance)
  emit(EVENTS.instanceChanged, toSummary(instance))
  return instance
}

export function toSummary(instance: Instance): InstanceSummary {
  // A hand-edited or half-written instance.json can carry an object where an
  // array belongs, and this runs for every instance in one pass: reading
  // `.filter` off a non-array threw, and the throw took the whole list down
  // with it, so one damaged instance emptied the library.
  const content = Array.isArray(instance.content) ? instance.content : []
  return {
    id: instance.id,
    name: instance.name,
    description: instance.description,
    group: instance.group,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    appearance: instance.appearance,
    modCount: content.filter((c) => c?.type === 'mod').length,
    memoryMb: instance.settings?.memoryMb,
    lastPlayed: instance.lastPlayed,
    totalPlayMs: instance.totalPlayMs,
    favorite: instance.favorite,
    installing: instance.installing,
    installed: instance.installed,
    running: isRunning(instance.id),
    starting: isStarting(instance.id),
    contentBusy: isContentBusy(instance.id),
    updateCount: content.filter((c) => c?.update).length
  }
}

export function listSummaries(): InstanceSummary[] {
  const summaries: InstanceSummary[] = []
  for (const instance of loadInstances()) {
    try {
      summaries.push(toSummary(instance))
    } catch (err) {
      // Belt and braces around the guards above: whatever else a broken file
      // holds, the other instances stay visible and reachable.
      logger.warn(`Instanz ${instance?.id ?? '?'} konnte nicht gelesen werden:`, err)
    }
  }
  return summaries.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
  })
}

/* ------------------------------------------------------------------ *
 * Creation
 * ------------------------------------------------------------------ */

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (!base) return 'instanz'
  return RESERVED_WINDOWS_NAMES.has(base) ? `${base}-instanz` : base
}

function uniqueId(name: string): string {
  const base = slugify(name)

  // A deleted instance frees its slug again as soon as the folder is gone, so
  // handing that id out means lifting the tombstone `deleteInstance` left —
  // otherwise every write for the new instance would be silently dropped.
  const claim = (id: string): string => {
    deleted.delete(id)
    return id
  }

  if (!existsSync(paths.instance(base))) return claim(base)
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`
    if (!existsSync(paths.instance(candidate))) return claim(candidate)
  }
  return claim(`${base}-${randomUUID().slice(0, 6)}`)
}

/**
 * Creates the instance record immediately and installs the game files in the
 * background, so the UI can show the new card right away.
 */
export async function createInstance(
  options: CreateInstanceOptions,
  /** Set by the imports, which fill the instance after its base setup. */
  internal: { importing?: boolean } = {}
): Promise<Instance> {
  const settings = getSettings()
  const id = uniqueId(options.name)

  ensureInstanceLayout(id)

  const instance: Instance = normalise(
    {
      name: options.name.trim() || tr('Neue Instanz', 'New instance'),
      description: options.description ?? '',
      group: options.group ?? '',
      mcVersion: options.mcVersion,
      loader: options.loader,
      loaderVersion: options.loaderVersion ?? '',
      appearance: {
        icon: options.icon ?? '🟩',
        accent: options.accent ?? settings.accentColor,
        background: null
      },
      settings: {
        ...DEFAULT_INSTANCE_SETTINGS,
        memoryMb: options.memoryMb ?? settings.defaultMemoryMb,
        jvmArgs: settings.defaultJvmArgs
      },
      createdAt: Date.now(),
      installing: true,
      installed: false
    },
    id
  )

  persist(instance)
  logger.info(`Instanz ${id} (${instance.name}) angelegt`)

  // Taken before the setup starts, so it can never finish ahead of the hold.
  if (internal.importing) importing.set(id, false)

  // Fire and forget: progress is reported through the task system.
  void installInstance(id).catch((err) => {
    if (err instanceof TaskCancelledError) logger.info(`Installation von ${id} abgebrochen`)
    else logger.error(`Installation von ${id} fehlgeschlagen:`, err)
  })

  return instance
}

/** Downloads everything the instance needs to launch. */
/**
 * Setups currently running, so the same instance is never installed twice.
 *
 * `createInstance` already starts one in the background, and the IPC channel
 * can start another for the same instance at any time. Without this the two
 * ran side by side: two progress entries, two loader installs writing the same
 * files, and both racing to write `installing` and `installed` back into
 * instance.json, where whichever finished last decided the outcome.
 */
const settingUp = new Map<string, Promise<void>>()

/**
 * Instances an import is still filling, mapped to whether their base setup
 * has finished. The base setup used to mark such an instance installed the
 * moment Minecraft itself was in place, so "Spielen" showed up while the
 * pack's mods were still downloading, and a failed import could be flipped
 * back to installed by a setup finishing after it. The import marks the
 * instance installed itself once it is done.
 */
const importing = new Map<string, boolean>()

/** Releases an import's hold, see `importing`. */
export function finishImport(id: string): void {
  importing.delete(id)
}

/**
 * Waits for the background setup `createInstance`/`installInstance` started
 * for this id, without starting one itself.
 *
 * Pack imports (mrpack, CurseForge, folder imports) create the instance
 * record first and then add mods on top of the game folder that background
 * setup is still writing to; without a way to wait for it, an import could
 * write into a mods/ folder that install had not created yet, or read
 * `installed` as still false and wrongly report the import as failed.
 */
export async function waitForInstanceSetup(id: string, signal?: AbortSignal): Promise<boolean> {
  const running = settingUp.get(id)
  if (!running) {
    // Held by an import, the setup's outcome is not in `installed` yet.
    const held = importing.get(id)
    if (held !== undefined) return held
    return tryGetInstance(id)?.installed ?? false
  }

  if (!signal) {
    try {
      await running
      return true
    } catch {
      return false
    }
  }

  // A base setup can still take minutes (a slow download, installing a whole
  // loader), and an import that just got cancelled must not sit through all of
  // it just to learn whether it succeeded. Raced against the caller's own task
  // signal so the cancel takes effect right away; the setup itself keeps
  // running in the background either way, nothing here aborts it.
  return new Promise<boolean>((resolvePromise) => {
    let settled = false
    const onAbort = (): void => {
      if (settled) return
      settled = true
      resolvePromise(false)
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    running.then(
      () => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolvePromise(true)
      },
      () => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolvePromise(false)
      }
    )
  })
}

export async function installInstance(id: string, force = false): Promise<void> {
  const running = settingUp.get(id)
  if (running) return running

  const run = installInstanceOnce(id, force).finally(() => {
    settingUp.delete(id)
  })
  settingUp.set(id, run)
  return run
}

async function installInstanceOnce(id: string, force: boolean): Promise<void> {
  const instance = getInstance(id)
  if (instance.installed && !force) return

  // Install rewrites exactly the files `repairInstance` does: libraries,
  // natives and the mod loader for this instance's version. Without these
  // guards a "reinstall" button could run right through a launch that was
  // still downloading the same files, or race a repair rebuilding them at the
  // same time, and whichever finished last would decide what survived.
  if (isRunning(id)) {
    throw new Error(tr('Die Instanz läuft gerade. Beende Minecraft, bevor du sie neu einrichtest.', 'The instance is running. Close Minecraft before you set it up again.'))
  }
  // A launch can still be downloading files or installing Java when
  // `isRunning` is false, the same reasoning `repairInstance` already applies
  // to this exact hazard.
  if (isStarting(id)) {
    throw new Error(tr('Die Instanz wird gerade gestartet. Warte, bis das abgeschlossen ist.', 'The instance is starting right now. Wait until that is done.'))
  }
  // The other half of the guard `repairInstance` has against `installing`:
  // a repair verifies and rewrites the very files an install downloads, and
  // both persist the instance record when they finish.
  if (isRepairing(id)) {
    throw new Error(tr('Diese Instanz wird gerade repariert. Warte, bis das abgeschlossen ist.', 'This instance is being repaired right now. Wait until that is done.'))
  }

  persist({ ...instance, installing: true })

  try {
    await withTask(
      tr(`${instance.name} wird eingerichtet`, `Setting up ${instance.name}`),
      tr('Version wird ermittelt…', 'Determining version…'),
      id,
      async (task) => {
        const current = getInstance(id)

        let loaderVersion = current.loaderVersion
        if (current.loader !== 'vanilla' && !loaderVersion) {
          task.update(tr('Loader-Version wird ermittelt…', 'Determining loader version…'), null)
          loaderVersion = await resolveLatestLoaderVersion(current.loader, current.mcVersion)
          persist({ ...getInstance(id), loaderVersion })
        }

        task.span(0, 0.25)
        // A Forge or NeoForge build another instance already installed is
        // reused. The installer used to run again for every new instance,
        // minutes of work rewriting shared library jars, and on Windows it
        // failed outright while a running game held those jars open. A forced
        // setup still reinstalls.
        const reusable =
          !force && (current.loader === 'forge' || current.loader === 'neoforge')
            ? findInstalledLoaderVersionId(current, loaderVersion)
            : null
        const versionId =
          reusable ?? (await installLoader(current.loader, current.mcVersion, loaderVersion, task))

        task.span(0.25, 1)
        const versionJson = await loadVersionJson(versionId)
        await installVersion(versionJson, current.mcVersion, task)
        task.span(0, 1)

        if (importing.has(id)) {
          importing.set(id, true)
        } else {
          persist({ ...getInstance(id), installing: false, installed: true })
        }
      }
    )
  } catch (err) {
    // A delete racing this setup (the import-cancel path in modpack.ts and
    // instanceFolder.ts waits for setup first, but a plain user delete during
    // setup is still allowed, see `assertInstanceIdle`) removes the instance
    // from the cache, so every `getInstance(id)` call above starts throwing
    // "existiert nicht" the moment that happens. That is not this setup
    // failing, it is the setup finding out the instance is simply gone, and
    // there is nothing left to mark and nothing worth reporting as an error.
    if (deleted.has(id)) {
      logger.debug(`Einrichtung von ${id} endet still, die Instanz wurde inzwischen gelöscht`)
      return
    }
    persist({ ...getInstance(id), installing: false })
    throw err
  }
}

/** The version id the launcher should start (loader id, or the MC version). */
export async function resolveVersionId(instance: Instance, install = true): Promise<string> {
  if (instance.loader === 'vanilla') return instance.mcVersion

  const loaderVersion =
    instance.loaderVersion || (await resolveLatestLoaderVersion(instance.loader, instance.mcVersion))

  switch (instance.loader) {
    case 'fabric':
    case 'quilt': {
      // Sanitized the way the installer names the file it writes, or an id
      // with a stripped character never matched it.
      const id = sanitizeVersionId(`${instance.loader}-loader-${loaderVersion}-${instance.mcVersion}`)
      // A failed first setup or a cleaned versions folder left no profile,
      // and the start stopped at "Minecraft-Version ... ist unbekannt", while
      // Forge in the same spot simply installed again.
      if (install && !existsSync(join(paths.version(id), `${id}.json`))) {
        return installLoader(instance.loader, instance.mcVersion, loaderVersion)
      }
      return id
    }
    default: {
      // Forge/NeoForge ids vary between generations, so read what the
      // installer wrote instead of guessing.
      const found = findInstalledLoaderVersionId(instance, loaderVersion)
      if (found) return found
      // The pre-launch check only looks. It used to run the whole installer
      // in the background just from opening the instance page, with nothing
      // shown and nothing to cancel.
      if (!install) throw new Error(tr('Der Mod-Loader ist noch nicht installiert.', 'The mod loader is not installed yet.'))
      return installLoader(instance.loader, instance.mcVersion, loaderVersion)
    }
  }
}

function findInstalledLoaderVersionId(instance: Instance, loaderVersion: string): string | null {
  const dir = paths.versions()
  if (!existsSync(dir)) return null

  // The *resolved* version, not `instance.loaderVersion` — that one is still
  // empty for an instance created without pinning a build, and an empty needle
  // matched any installed directory for the loader, including one belonging to
  // a different instance on the same Minecraft version.
  //
  // NeoForge for 1.20.1 is a fork of Forge and kept its naming: its builds are
  // listed as "1.20.1-47.1.106", and its installer calls the version
  // "1.20.1-forge-47.1.106". Searched for "neoforge" and the full listing, it
  // was never found, and the whole installer ran again before every start.
  // Since then forge.ts names it "1.20.1-neoforge-47.1.106"; both spellings
  // are found here, told apart from a Forge build of the same number by its
  // own libraries.
  // The build may come with or without the "1.20.1-" in front: modpacks and
  // other launchers often give just "47.1.106".
  const legacyNeo = instance.loader === 'neoforge' && instance.mcVersion === '1.20.1'
  const needle =
    legacyNeo && loaderVersion.startsWith(`${instance.mcVersion}-`)
      ? loaderVersion.slice(instance.mcVersion.length + 1)
      : loaderVersion
  const nameMark = legacyNeo ? 'forge' : instance.loader
  const candidates = readdirSync(dir).filter((name) => {
    const lower = name.toLowerCase()
    if (!lower.includes(nameMark)) return false
    // As a whole build number, not a substring: "21.1.17" also sits inside
    // "neoforge-21.1.172", and the longer id won the sort below.
    if (needle && !containsBuild(lower, needle.toLowerCase())) return false
    // "forge" also sits inside every NeoForge id, and an older 1.20.1
    // NeoForge install is named like a Forge one.
    if (instance.loader === 'forge' && isNeoforgeVersion(dir, name)) return false
    if (legacyNeo && !isNeoforgeVersion(dir, name)) return false
    // Always required, needle or not. `|| Boolean(needle)` used to stand here,
    // which is true whenever a needle is given, so the mcVersion check was
    // skipped in exactly the case that matters: `resolveVersionId` always
    // resolves a needle before calling this, so the check never actually
    // applied. A resolved loader build number is not guaranteed unique across
    // Minecraft versions, which is what this line is meant to guard against.
    if (lower.includes(instance.mcVersion.toLowerCase())) return true
    // Modern NeoForge names its version "neoforge-21.1.172", with no Minecraft
    // version in it at all. Requiring one meant an installed NeoForge was
    // never found, and the whole installer ran again before every start,
    // repair and pre-launch check. The version file says which Minecraft
    // version it belongs to; it is only written once an install completed.
    return inheritsFrom(dir, name) === instance.mcVersion
  })

  return candidates.sort((a, b) => b.length - a.length)[0] ?? null
}

/** True when an installed version's own libraries come from NeoForge. */
function isNeoforgeVersion(versionsDir: string, versionId: string): boolean {
  try {
    return /"net\.neoforged[.:]/.test(readFileSync(join(versionsDir, versionId, `${versionId}.json`), 'utf8'))
  } catch {
    return false
  }
}

/** True when `build` appears in `name` with no digit or dot right before or after it. */
function containsBuild(name: string, build: string): boolean {
  let from = 0
  for (;;) {
    const at = name.indexOf(build, from)
    if (at === -1) return false
    const before = at === 0 ? '' : name[at - 1]
    const after = name[at + build.length] ?? ''
    if (!/[0-9.]/.test(before) && !/[0-9.]/.test(after)) return true
    from = at + 1
  }
}

/** The `inheritsFrom` of an installed version, or null if it cannot be read. */
function inheritsFrom(versionsDir: string, versionId: string): string | null {
  try {
    const json = JSON.parse(readFileSync(join(versionsDir, versionId, `${versionId}.json`), 'utf8')) as { inheritsFrom?: unknown }
    return typeof json.inheritsFrom === 'string' ? json.inheritsFrom : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Mutation
 * ------------------------------------------------------------------ */

export function updateInstance(id: string, patch: InstancePatch): Instance {
  const current = getInstance(id)

  // `InstancePatch`'s type only allows six fields, but that is a compile-time
  // promise: nothing enforced it once `patch` came off IPC as a plain object,
  // and `...patch` copied whatever the caller actually sent, including
  // fields like `content`, `installed` or `mcVersion` that this channel was
  // never meant to touch. Listed explicitly instead of spread, so a field
  // outside this list is silently ignored rather than silently accepted.
  const next: Instance = {
    ...current,
    id: current.id,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.group !== undefined ? { group: patch.group } : {}),
    ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
    appearance: { ...current.appearance, ...patch.appearance },
    settings: { ...current.settings, ...patch.settings }
  }

  const saved = persist(next)
  // "Remove background" and any other change that drops a picture.
  removeUnusedImage(id, current.appearance.icon, saved.appearance)
  removeUnusedImage(id, current.appearance.background, saved.appearance)
  return saved
}

/**
 * Guards a recursive delete. `paths.instance()` is a plain `join`, so an id
 * containing `..` resolves outside the data directory — and the id arrives
 * straight from IPC. Nothing recursive may run on an unverified path.
 */
function assertInside(root: string, candidate: string, label: string): string {
  const resolvedRoot = resolve(root)
  const resolved = resolve(candidate)
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new Error(tr(`Ungültiger Pfad für ${label}: ${candidate}`, `Invalid path for ${label}: ${candidate}`))
  }
  return resolved
}

/**
 * Throws if anything is currently working against the instance's files.
 *
 * Shared by `deleteInstance` and `duplicateInstance`, the two mutations that
 * touch the whole instance folder rather than one file within it, so both
 * need every guard the other content and lifecycle locks already provide.
 * `actionPastParticiple` fills the "kann nicht ... werden" wording so the two
 * running/starting messages still read naturally for each caller.
 */
function assertInstanceIdle(id: string, actionPastParticiple: string): void {
  if (isRunning(id)) {
    throw new Error(
      tr(
        `Die Instanz läuft gerade und kann nicht ${actionPastParticiple} werden.`,
        `The instance is running and cannot be ${actionPastParticiple}.`
      )
    )
  }

  // "Running" was the only state this asked about, and it is the last of the
  // three to be reached. A launch still gathering libraries, a mod download,
  // or a restore unpacking an archive all write into the very folders removed
  // below, and each of them survives the deletion as work against files that
  // are no longer there.
  if (isStarting(id)) {
    throw new Error(
      tr(
        `Die Instanz wird gerade gestartet und kann nicht ${actionPastParticiple} werden.`,
        `The instance is starting and cannot be ${actionPastParticiple}.`
      )
    )
  }
  // Checked first: a duplicate in progress also holds the content lock, and
  // a second click on Duplicate was told the mods were being worked on.
  if (isCopying(id)) {
    throw new Error(tr('Diese Instanz wird gerade kopiert. Warte, bis das fertig ist.', 'This instance is being copied right now. Wait until that is done.'))
  }
  if (isContentBusy(id)) {
    throw new Error(tr('An den Mods dieser Instanz wird gerade gearbeitet. Warte, bis das fertig ist.', 'The mods of this instance are being worked on right now. Wait until that is done.'))
  }
  if (isRestoring(id)) {
    throw new Error(tr('Für diese Instanz wird gerade eine Sicherung eingespielt. Warte, bis das fertig ist.', 'A backup is being restored for this instance right now. Wait until that is done.'))
  }
  // Mirrors the guard `launchInstance` has against `isRepairing`: a repair
  // rewrites the client jar, the natives folder, the loader and the mods, and
  // deleting or duplicating that folder while it is only half rebuilt is the
  // same kind of half written state the other four guards already prevent.
  if (isRepairing(id)) {
    throw new Error(tr('Für diese Instanz läuft gerade eine Reparatur. Warte, bis das fertig ist.', 'A repair is running for this instance right now. Wait until that is done.'))
  }
}

export function deleteInstance(id: string): void {
  assertInstanceIdle(id, tr('gelöscht', 'deleted'))
  // Only for deleting: a backup or an export only reads, so duplicating
  // alongside one is fine, but deleting the folder under it was not.
  if (isArchiving(id)) {
    throw new Error(tr('Diese Instanz wird gerade gesichert oder exportiert. Warte, bis das fertig ist.', 'This instance is being backed up or exported right now. Wait until that is done.'))
  }

  // Must be a known instance, not just any id the caller made up.
  if (!cache.has(id)) {
    if (!loaded) loadInstances()
    if (!cache.has(id)) throw new Error(tr(`Instanz ${id} existiert nicht`, `Instance ${id} does not exist`))
  }

  const dir = assertInside(paths.instances(), paths.instance(id), 'Instanz')
  const backupDir = assertInside(paths.backups(), paths.instanceBackups(id), 'Sicherungen')

  // Marked before the files go, so an install still writing against this id
  // cannot slip a `persist()` in between the delete and the cache eviction.
  deleted.add(id)

  // `force` swallows a missing path but not EBUSY/EPERM, which Windows hands
  // out freely while a virus scanner or the search indexer still holds a
  // folder. The two removals used to share one try block: if the instance
  // folder (worlds, mods, screenshots) was already gone but the separate
  // backups folder then threw, the catch lifted the tombstone and reported
  // the whole delete as failed, as if nothing had happened, while the actual
  // instance data was already irreversibly gone, the cache still held the
  // old record, and the next unrelated write to this id would recreate an
  // empty folder with a fresh instance.json under it. Split so the two
  // failures are told apart: the instance folder failing is a genuine
  // failure and lifts the tombstone as before; the backups folder failing
  // afterwards does not undo a deletion that has already happened.
  try {
    // `maxRetries`/`retryDelay` retry on EBUSY/ENOTEMPTY/EPERM, the transient
    // codes a virus scanner or the search indexer briefly holding a file
    // produce, without touching the ENOENT case `force` already covers.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    deleted.delete(id)
    // Retries exhausted: the folder may now be only half removed, so disk and
    // the in-memory cache have diverged. Rebuilt from disk instead of leaving
    // the cache showing an instance that is no longer what is actually there.
    loadInstances(true)
    throw new Error(
      tr(
        `Instanz ${id} konnte nicht vollständig gelöscht werden, eine Datei wird noch von einem anderen Programm verwendet. Versuche es erneut.`,
        `Instance ${id} could not be deleted completely, a file is still in use by another program. Try again.`
      ),
      { cause: err }
    )
  }

  try {
    rmSync(backupDir, { recursive: true, force: true })
  } catch (err) {
    logger.warn(`Sicherungsordner für ${id} konnte nicht entfernt werden:`, err)
  }

  cache.delete(id)
  logger.info(`Instanz ${id} gelöscht`)
  emit(EVENTS.instanceChanged, { id, deleted: true })
}

export async function duplicateInstance(id: string, newName?: string): Promise<Instance> {
  // Had none of the five checks `deleteInstance` has, so duplicating mid-launch,
  // mid-content-work, mid-restore or mid-repair copied a folder that was being
  // written to at that exact moment, baking the half finished state into the
  // new instance.
  assertInstanceIdle(id, tr('dupliziert', 'duplicated'))

  // `assertInstanceIdle` checks the running/starting/content/restore/repair
  // locks, but the background setup `createInstance` starts (~line 271) sets
  // none of those: it is still writing libraries, natives and the loader into
  // the very folder about to be copied.
  if (settingUp.has(id)) {
    throw new Error(tr('Die Instanz wird gerade eingerichtet und kann noch nicht dupliziert werden.', 'The instance is being set up and cannot be duplicated yet.'))
  }

  const source = getInstance(id)
  const name = newName?.trim() || tr(`${source.name} (Kopie)`, `${source.name} (Copy)`)
  const newId = uniqueId(name)

  ensureInstanceLayout(newId)

  // `assertInstanceIdle` above only checks the instant duplication starts.
  // The copy itself can run for seconds on a large modpack or world, and
  // held no lock of its own for that whole stretch: nothing stopped
  // `deleteInstance` or `repairInstance`, both synchronous and neither
  // waiting on this, from running against the very folder this is reading
  // from partway through the copy. Held on the source id, the same flag
  // `assertInstanceIdle` already checks.
  //
  // `withContentLock` alone marks this as busy but is a reentrant counter,
  // not a mutex, so it does not by itself stop a mod install or update from
  // running concurrently against the same folder. `markCopying` is the actual
  // mutex here: those mutations refuse outright while it is set.
  const { cp, lstat } = await import('node:fs/promises')
  // Folder links (a saves or shaderpacks folder moved to another drive and
  // linked back) are left out. Copying one tries to create a new link, which
  // Windows refuses without admin rights, and the whole duplicate failed with
  // a raw EPERM. Following it instead would copy, or later change, data that
  // lives outside this instance.
  const sourceDir = paths.gameDir(id)
  const skippedLinks: string[] = []
  const skipLinks = async (src: string): Promise<boolean> => {
    if (src === sourceDir) return true
    try {
      if ((await lstat(src)).isSymbolicLink()) {
        skippedLinks.push(src.slice(sourceDir.length + 1))
        return false
      }
    } catch {
      // Gone already; the copy reports that itself.
    }
    return true
  }
  markCopying(id)
  try {
    await withContentLock(id, () => cp(sourceDir, paths.gameDir(newId), { recursive: true, filter: skipLinks }))

    // The instance's custom icon/background lives in a sibling folder next to
    // the game dir (see paths.icons), so the copy above never touched it.
    const iconsDir = paths.icons(id)
    if (existsSync(iconsDir)) {
      await cp(iconsDir, paths.icons(newId), { recursive: true })
    }
  } catch (err) {
    // Nothing has an instance.json for the new id yet, so a half copied
    // folder left here would be invisible in the launcher and never cleaned
    // up, quietly taking disk space for good.
    try {
      rmSync(paths.instance(newId), { recursive: true, force: true })
    } catch (cleanupErr) {
      logger.warn(`Halbe Kopie ${newId} konnte nicht entfernt werden:`, cleanupErr)
    }
    throw err
  } finally {
    unmarkCopying(id)
  }

  const clone: Instance = {
    // Read again: the copy can take a while, and a settings change made
    // meanwhile was missing from the clone made from the record of before.
    ...structuredClone(tryGetInstance(id) ?? source),
    id: newId,
    name,
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlayMs: 0,
    sessions: [],
    favorite: false,
    // `structuredClone(source)` would otherwise carry `installing: true` /
    // `installed: false` straight over if the source was mid first-install up
    // until the instant the checks above ran; a clone never goes through
    // `normalise`, so nothing else would catch that.
    installing: false
  }

  try {
    persist(clone)
  } catch (err) {
    // The copy is complete but recorded nowhere: without its instance.json it
    // never showed up in the list and was never cleaned up either.
    try {
      rmSync(paths.instance(newId), { recursive: true, force: true })
    } catch (cleanupErr) {
      logger.warn(`Kopie ${newId} nach gescheitertem Speichern nicht entfernt:`, cleanupErr)
    }
    throw err
  }
  logger.info(`Instanz ${id} nach ${newId} dupliziert`)
  if (skippedLinks.length > 0) {
    logger.info(`Verknüpfungen beim Duplizieren ausgelassen: ${skippedLinks.join(', ')}`)
    const shown = skippedLinks.slice(0, 3).join(', ') + (skippedLinks.length > 3 ? tr(' und weitere', ' and more') : '')
    const one = skippedLinks.length === 1
    notify(
      'info',
      tr('Verknüpfte Ordner nicht kopiert', 'Linked folders not copied'),
      tr(
        `${shown} ${one ? 'zeigt' : 'zeigen'} auf einen Ort außerhalb der Instanz und ${one ? 'wurde' : 'wurden'} nicht in ${name} übernommen.`,
        `${shown} ${one ? 'points' : 'point'} to a place outside the instance and ${one ? 'was' : 'were'} not copied into ${name}.`
      )
    )
  }
  return clone
}

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

/** Copies a picture into the instance and returns the `img:` reference. */
export function setInstanceImage(id: string, sourceFile: string, kind: 'icon' | 'background'): string {
  const instance = getInstance(id)
  const ext = extname(sourceFile).toLowerCase() || '.png'
  const fileName = `${kind}-${Date.now()}${ext}`
  const target = join(paths.icons(id), fileName)

  copyFileSync(sourceFile, target)

  const reference = `img:${fileName}`
  const appearance = { ...instance.appearance }
  if (kind === 'icon') appearance.icon = reference
  else appearance.background = reference

  persist({ ...instance, appearance })
  // The picture this replaced is no longer referenced by anything; every new
  // pick used to leave another file behind for good, copied along by duplicate.
  removeUnusedImage(id, kind === 'icon' ? instance.appearance.icon : instance.appearance.background, appearance)
  return reference
}

/** Deletes an `img:` file once neither the icon nor the background points at it. */
function removeUnusedImage(id: string, reference: string | null | undefined, now: Instance['appearance']): void {
  if (!reference || !reference.startsWith('img:')) return
  if (now.icon === reference || now.background === reference) return
  try {
    rmSync(safeJoin(paths.icons(id), reference.slice(4)), { force: true })
  } catch (err) {
    logger.warn(`Altes Bild ${reference} von ${id} nicht entfernt:`, err)
  }
}

/** Resolves an `img:` reference to an absolute path for the renderer. */
export function resolveInstanceImage(id: string, reference: string | null): string | null {
  if (!reference || !reference.startsWith('img:')) return null
  // `appearance.icon`/`appearance.background` reach here straight from
  // `instance:update` with no validation beyond being a string. A plain
  // `join` let a reference with "../" segments resolve to any file the
  // launcher process can read, anywhere on disk, and hand its path back to
  // the renderer as an image. `safeJoin` throws on exactly that, which is
  // treated the same as a reference that never pointed at a real file.
  let file: string
  try {
    file = safeJoin(paths.icons(id), reference.slice(4))
  } catch {
    return null
  }
  return existsSync(file) ? file : null
}

/* ------------------------------------------------------------------ *
 * Worlds & screenshots
 * ------------------------------------------------------------------ */

export interface WorldInfo {
  name: string
  folder: string
  sizeBytes: number
  lastPlayed: number
}

/**
 * Adds up every file below a folder, without blocking the interface.
 *
 * A well-played world is thousands of region files, and a whole instance adds
 * mods, resource packs and recordings on top. Walking that synchronously froze
 * the entire window until it finished, which on a slow or network-backed home
 * directory is not a hitch but a hang.
 */
async function folderSize(dir: string): Promise<number> {
  let total = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    try {
      const entries = await readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else {
          try {
            total += (await stat(full)).size
          } catch {
            // file disappeared mid-walk
          }
        }
      }
    } catch {
      // unreadable or missing directory
    }
  }
  return total
}

export async function listWorlds(id: string): Promise<WorldInfo[]> {
  // The instance has to exist first: `paths.saves` is a plain `join`, so an id
  // carrying path segments would otherwise list a folder that was never this
  // instance's own. `deleteRecording` in recording.ts guards its folder the
  // same way and for the same reason.
  getInstance(id)
  const dir = paths.saves(id)
  if (!existsSync(dir)) return []

  // The same rule Minecraft's own world list uses: a folder, links followed,
  // with a level.dat or level.dat_old in it. Any folder used to count, so a
  // stray one showed up as a world, while a world linked into saves from
  // somewhere else was missing although the game lists it.
  const worlds: WorldInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const folder = join(dir, entry.name)
    let lastPlayed = 0
    try {
      if (!statSync(folder).isDirectory()) continue
      const data = [join(folder, 'level.dat'), join(folder, 'level.dat_old')].find((f) => existsSync(f))
      if (!data) continue
      lastPlayed = statSync(data).mtimeMs
    } catch {
      // A world that vanished between listing and stat, or a broken link, is
      // simply skipped rather than taking the whole list down with it.
      continue
    }
    worlds.push({ name: entry.name, folder, sizeBytes: await folderSize(folder), lastPlayed })
  }
  return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed)
}

export async function listScreenshots(id: string, limit = 40): Promise<{ file: string; takenAt: number }[]> {
  // Same existence check as `listWorlds`, for the same reason.
  getInstance(id)
  const dir = paths.screenshots(id)
  if (!existsSync(dir)) return []

  // Asynchronous, in small groups. Listing and stat-ing every file in one
  // synchronous go held the whole main process for most of a second with a
  // few thousand screenshots, downloads and the live log included, and the
  // Recordings tab reloads this after every finished recording.
  const names = (await readdir(dir)).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
  const shots: { file: string; takenAt: number }[] = []
  for (let i = 0; i < names.length; i += 64) {
    const group = await Promise.all(
      names.slice(i, i + 64).map(async (f) => {
        const full = join(dir, f)
        // Skipped per file like listWorlds and listRecordings: one screenshot
        // still being written or locked by a scanner used to empty the whole tab.
        try {
          return { file: full, takenAt: (await stat(full)).mtimeMs }
        } catch {
          return null
        }
      })
    )
    for (const shot of group) if (shot) shots.push(shot)
  }
  return shots.sort((a, b) => b.takenAt - a.takenAt).slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * Content bookkeeping
 * ------------------------------------------------------------------ */

export function setContent(id: string, content: ContentItem[]): Instance {
  return persist({ ...getInstance(id), content })
}

export function addContent(id: string, item: ContentItem): Instance {
  const instance = getInstance(id)
  // Case-insensitive, matching `syncContentWithDisk`'s own reasoning for
  // doing the same: Windows and macOS fold case in the filesystem, so
  // re-importing the same physical file under a different capitalisation
  // (`Mod.jar` written over `mod.jar`) did not match here and left two
  // records pointing at the one file, until the next disk scan folded them
  // back into one anyway.
  //
  // Scoped to the same content type: without it, a resource pack and a
  // datapack sharing a generic file name collided here, and adding one
  // silently dropped the other's record (the file itself stayed on disk,
  // untracked, until a scan rediscovered it).
  const content = instance.content.filter(
    (c) =>
      (c.fileName.toLowerCase() !== item.fileName.toLowerCase() || c.type !== item.type) &&
      c.id !== item.id
  )
  content.push(item)
  return persist({ ...instance, content })
}

export function removeContentRecord(id: string, contentId: string): Instance {
  const instance = getInstance(id)
  return persist({ ...instance, content: instance.content.filter((c) => c.id !== contentId) })
}

/** True when two content lists describe the same files in the same state. */
/** Size and modification time of a jar, to notice it was replaced under the same name. */
function jarStamp(file: string): string | null {
  try {
    const info = statSync(file)
    return `${info.size}:${Math.round(info.mtimeMs)}`
  } catch {
    return null
  }
}

/** The display name a file gets when nothing better is known about it. */
function nameFromFile(fileName: string): string {
  const bare = fileName.endsWith('.disabled') ? fileName.slice(0, -'.disabled'.length) : fileName
  return bare.replace(/\.(jar|zip)$/i, '').replace(/[-_]/g, ' ')
}

/**
 * Fills a mod record in from its jar's own metadata. Every record gets the
 * declared ids; a hand-dropped one also gets the loaders, and the real name
 * and version where it still only had the ones made from its file name.
 */
function withJarMetadata(item: ContentItem, meta: JarMetadata, stamp: string | null, replaced = false): ContentItem {
  const next: ContentItem = { ...item, modIds: meta.ids, modIdsFrom: stamp ?? undefined }
  if (item.provider !== 'local') return next
  // Only with something to put there: a jar naming no loader must not wipe
  // what was known before.
  if (meta.loaders.length > 0 && (item.loaders.length === 0 || replaced)) next.loaders = meta.loaders
  if (meta.name && item.name === nameFromFile(item.fileName)) next.name = meta.name
  if (meta.version && !item.version) next.version = meta.version
  return next
}

function sameContent(a: ContentItem[], b: ContentItem[]): boolean {
  if (a.length !== b.length) return false

  const key = (item: ContentItem): string =>
    `${item.id}|${item.fileName}|${item.enabled ? 1 : 0}|${item.type}`

  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.every((value, index) => value === right[index])
}

/**
 * Reconciles the recorded content with what is actually on disk. Files the
 * user dropped in manually get picked up, deleted files disappear from the
 * list, and enable/disable state follows the `.disabled` suffix.
 *
 * Writing only on a real change matters: this runs on every read of an
 * instance, and an unconditional write would emit a change event, which the
 * renderer answers with another read.
 */
export async function syncContentWithDisk(id: string, options: { force?: boolean } = {}): Promise<Instance> {
  const instance = getInstance(id)

  // Never while the folder is being rewritten. An update writes the new jar
  // first and records it a moment later, and a scan landing in between saw a
  // file it did not recognise and registered it as a second, separate mod —
  // the duplicate entries users reported. The scan is only ever a
  // reconciliation, so skipping one is free: the next one sees the finished
  // state. Ordinary actions reach this, not just unlucky ones: opening the
  // instance page, pressing the compatibility check, or clicking Play all
  // land here.
  //
  // A restore moves the content folders aside for a moment, and a scan landing
  // then took every mod for deleted, so it is skipped the same way, as is a
  // repair. `force` is for the one caller doing that work itself (a repair,
  // an import): it holds the lock, so without it its own scan never ran.
  if (!options.force && (isContentBusy(id) || isRestoring(id) || isRepairing(id))) {
    logger.debug(`Abgleich für ${id} übersprungen, es wird gerade geschrieben`)
    return instance
  }
  // Keyed by the name with any `.disabled` suffix stripped, so an item is
  // found regardless of which of the two states it was last recorded in.
  // Keying on the stored name alone broke re-enabling a mod outside the app:
  // the record said "mod.jar.disabled", the file on disk was suddenly
  // "mod.jar", nothing matched, and the mod was re-registered from scratch as
  // local content — losing its projectId, versionId and hash, and with them
  // update checks and its download link in an exported modpack.
  const bareExact = (name: string): string =>
    name.endsWith('.disabled') ? name.slice(0, -'.disabled'.length) : name
  const groupBy = (key: (c: ContentItem) => string): Map<string, ContentItem[]> => {
    const map = new Map<string, ContentItem[]>()
    for (const c of instance.content) {
      const list = map.get(key(c)) ?? []
      list.push(c)
      map.set(key(c), list)
    }
    return map
  }
  // Scoped by type as well as name: resource packs, shader packs and
  // datapacks all end in `.zip` and are scanned from separate folders below,
  // but shared one map keyed on the bare name alone. Two of them with the
  // same generic name, "pack.zip" for instance, collided on the same map
  // entry, and both files then came back tagged with whichever one's
  // metadata happened to still be in `known`: wrong type, wrong name, and an
  // id shared between two records that pointed at two different files.
  //
  // Two maps, not one: an exact, case-sensitive match is tried first, and
  // only falls back to folding case when nothing exact matched. Matching
  // case-insensitively from the start meant two files differing only in case
  // (a real possibility on macOS/Linux) both matched the one record that
  // happened to be in the map, producing two result entries that share an
  // id. `claimed` makes sure each record still only ever matches one file per
  // scan, even through the fallback.
  const knownExact = groupBy((c) => `${c.type}:${bareExact(c.fileName)}`)
  const knownFold = groupBy((c) => `${c.type}:${bareExact(c.fileName).toLowerCase()}`)
  const claimed = new Set<string>()
  const result: ContentItem[] = []

  const folders: { dir: string; type: ContentItem['type']; extensions: string[] }[] = [
    { dir: paths.mods(id), type: 'mod', extensions: ['.jar'] },
    { dir: paths.resourcePacks(id), type: 'resourcepack', extensions: ['.zip'] },
    { dir: paths.shaderPacks(id), type: 'shaderpack', extensions: ['.zip'] },
    { dir: join(paths.gameDir(id), 'datapacks'), type: 'datapack', extensions: ['.zip'] }
  ]

  for (const folder of folders) {
    if (!existsSync(folder.dir)) continue

    for (const fileName of readdirSync(folder.dir)) {
      const enabled = !fileName.endsWith('.disabled')
      const bare = enabled ? fileName : fileName.slice(0, -'.disabled'.length)
      if (!folder.extensions.includes(extname(bare).toLowerCase())) continue

      // Launch Gabi's own "eigene Startseite" pack (see startScreen.ts), not
      // something a user installed. It is rewritten by that module on every
      // launch; letting it become tracked content here meant it could be
      // "removed" or "disabled" through the ordinary Mods UI while
      // startScreen.ts kept silently reapplying it, and a disabled copy
      // sitting next to a freshly reapplied active one produced two
      // content-list entries sharing one id.
      if (folder.type === 'resourcepack' && bare.toLowerCase() === START_SCREEN_PACK.toLowerCase()) {
        continue
      }

      const exactMatches = knownExact.get(`${folder.type}:${bare}`) ?? []
      const foldMatches = knownFold.get(`${folder.type}:${bare.toLowerCase()}`) ?? []
      const existing =
        exactMatches.find((c) => !claimed.has(c.id)) ?? foldMatches.find((c) => !claimed.has(c.id))
      if (existing) {
        claimed.add(existing.id)
        result.push({ ...existing, fileName, enabled })
        continue
      }

      // Renamed by hand: a record of the same type whose own file is gone and
      // whose hash matches keeps its origin, update checks and worlds instead
      // of turning into anonymous local content.
      const renamedFrom = await findRenamedRecord(folder.dir, folder.type, fileName)
      if (renamedFrom) {
        claimed.add(renamedFrom.id)
        if (renamedFrom.type === 'datapack' && renamedFrom.enabled && renamedFrom.worlds?.length) {
          const source = join(folder.dir, fileName)
          for (const world of renamedFrom.worlds) {
            if (copyDatapackIntoWorld(id, world, source, bare)) removeDatapackFromWorld(id, world, bareExact(renamedFrom.fileName))
          }
        }
        result.push({ ...renamedFrom, fileName, enabled })
        continue
      }

      // Unknown file: register it as local content so it still shows up.
      // Skipped, not thrown, if it vanished between `readdirSync` and here:
      // deleting a file mid-scan otherwise took the whole reconciliation down
      // with it instead of just leaving that one file for the next scan.
      let stats: { size: number; mtimeMs: number }
      try {
        stats = statSync(join(folder.dir, fileName))
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue
        throw err
      }
      const registered: ContentItem = {
        id: randomUUID(),
        type: folder.type,
        provider: 'local',
        fileName,
        name: nameFromFile(fileName),
        version: '',
        enabled,
        gameVersions: [],
        loaders: [],
        dependencies: [],
        size: stats.size,
        installedAt: stats.mtimeMs
      }
      // A jar dropped in by hand used to be recorded with a name made from
      // its file name and nothing else, so the compatibility check could not
      // match it against anything. Its own metadata says what it is.
      const meta = folder.type === 'mod' ? await readJarMetadata(join(folder.dir, fileName)) : null
      result.push(meta ? withJarMetadata(registered, meta, jarStamp(join(folder.dir, fileName))) : registered)
    }
  }

  // Records from before the ids were kept, records whose jar an update
  // replaced, and jars swapped by hand under the same name are read here. A
  // jar that cannot be read right now stays as it is and is tried again on
  // the next scan.
  let filledIn = false
  for (let i = 0; i < result.length; i++) {
    const item = result[i]
    if (item.type !== 'mod') continue
    const file = join(paths.mods(id), item.fileName)
    const stamp = jarStamp(file)
    if (item.modIds !== undefined && item.modIdsFrom === stamp) continue
    // Ids read before the stamp existed: the jar is taken as the one they
    // came from and only stamped, instead of reading every jar again.
    if (item.modIds !== undefined && item.modIdsFrom === undefined && stamp !== null) {
      result[i] = { ...item, modIdsFrom: stamp }
      filledIn = true
      continue
    }
    const meta = await readJarMetadata(file)
    if (!meta) continue
    result[i] = withJarMetadata(item, meta, stamp, item.modIds !== undefined)
    filledIn = true
  }

  // The scan above awaits (hashing a renamed file), so an install, an update
  // or a restore can start and even finish while it runs. Saving `result`
  // regardless wrote this scan's older picture over theirs, and a mod
  // installed in that window lost its source and version. The newer state is
  // left alone; the next scan sees the folder as it is then.
  const fresh = tryGetInstance(id)
  if (!fresh) return instance
  if (
    fresh.content !== instance.content ||
    (!options.force && (isContentBusy(id) || isRestoring(id) || isRepairing(id)))
  ) {
    logger.debug(`Abgleich für ${id} verworfen, die Inhalte haben sich währenddessen geändert`)
    return fresh
  }

  // A datapack whose file was deleted outside the launcher leaves its copies
  // in the worlds behind; Minecraft kept loading them with no way to remove
  // them from the UI.
  for (const gone of instance.content) {
    if (claimed.has(gone.id) || gone.type !== 'datapack' || !gone.enabled || !gone.worlds?.length) continue
    for (const world of gone.worlds) removeDatapackFromWorld(id, world, bareExact(gone.fileName))
  }

  // `sameContent` only compares what decides the files; ids read just now
  // are a change worth keeping on their own.
  if (!filledIn && sameContent(instance.content, result)) return fresh
  return persist({ ...fresh, content: result })

  async function findRenamedRecord(
    dir: string,
    type: ContentItem['type'],
    fileName: string
  ): Promise<ContentItem | null> {
    const candidates = instance.content.filter(
      (c) =>
        c.type === type &&
        !claimed.has(c.id) &&
        typeof c.sha1 === 'string' &&
        c.sha1.length > 0 &&
        !existsSync(join(dir, bareExact(c.fileName))) &&
        !existsSync(join(dir, `${bareExact(c.fileName)}.disabled`))
    )
    if (candidates.length === 0) return null
    let hash: string
    try {
      hash = await sha1File(join(dir, fileName))
    } catch {
      return null
    }
    return candidates.find((c) => c.sha1?.toLowerCase() === hash.toLowerCase()) ?? null
  }
}

/**
 * Renames a content file to toggle Minecraft's `.disabled` convention.
 *
 * Held under `withContentLock`, the same marker every other content mutation
 * in `content.ts` takes. This was the one write to the content folder that
 * did not: `syncContentWithDisk` could scan mid-rename and see a file under
 * neither its old nor its new name for a moment, and `deleteInstance` or
 * `repairInstance` could start against the same folder while the rename was
 * still in flight, since `isContentBusy` looked idle the whole time.
 *
 * Also held under `withItemLock`, the same per-item mutex `content.ts` uses
 * for removal and updates, for the same reason: without it, a toggle racing
 * an update on the same item could rename the file `applyUpdate` had just
 * downloaded, and `applyUpdate` then persists from a snapshot taken before
 * the toggle, overwriting it and leaving an orphaned renamed file with
 * nothing tracking it.
 */
export function toggleContent(id: string, contentId: string, enabled: boolean): Promise<Instance> {
  return withContentLock(id, () =>
    withItemLock(contentId, async () => {
      assertNotCopying(id)
      const instance = getInstance(id)
      const item = instance.content.find((c) => c.id === contentId)
      if (!item) throw new Error(tr('Inhalt nicht gefunden', 'Content not found'))

      const dirMap: Record<ContentItem['type'], string> = {
        mod: paths.mods(id),
        resourcepack: paths.resourcePacks(id),
        shaderpack: paths.shaderPacks(id),
        datapack: join(paths.gameDir(id), 'datapacks')
      }

      const dir = dirMap[item.type]
      // The one content write path that never went through `core/content.ts`,
      // so it never picked up the `basename()` guard every install/update/
      // removal there already applies to `fileName`.
      const currentPath = contentPath(dir, item.fileName)
      const bare = item.fileName.endsWith('.disabled')
        ? item.fileName.slice(0, -'.disabled'.length)
        : item.fileName
      const nextName = enabled ? bare : `${bare}.disabled`

      if (existsSync(currentPath) && nextName !== item.fileName) {
        const target = contentPath(dir, nextName)
        // A second file under the target name (copied in by hand, or left by
        // an earlier failed update) was overwritten without a word on Windows.
        if (existsSync(target)) {
          throw new Error(
            tr(
              `Im Ordner liegt schon eine Datei namens ${nextName}. Entferne sie zuerst, dann klappt das ${enabled ? 'Einschalten' : 'Ausschalten'}.`,
              `There is already a file named ${nextName} in the folder. Remove it first, then turning it ${enabled ? 'on' : 'off'} works.`
            )
          )
        }
        renameSync(currentPath, target)
      }

      // Minecraft has no ".disabled" convention for a datapack sitting inside
      // a world, only for the staging copy renamed just above. Disabling one
      // removes its world copies outright; enabling restores them from the
      // staged file that now sits at `bare`.
      // A world deleted since it was assigned is dropped from the list rather
      // than recreated as an empty folder by the copy below.
      const liveWorlds = item.worlds?.filter((world) => worldExists(id, world))
      let keptWorlds = liveWorlds
      if (item.type === 'datapack' && liveWorlds && liveWorlds.length > 0) {
        if (enabled) {
          const source = contentPath(dir, bare)
          const failed = liveWorlds.filter((world) => !copyDatapackIntoWorld(id, world, source, bare))
          if (failed.length > 0) {
            // Not remembered for those worlds. The file found there is not
            // ours, and a later disable, removal or update would otherwise
            // delete it as if it were.
            keptWorlds = liveWorlds.filter((world) => !failed.includes(world))
            notify(
              'warning',
              tr(`${item.name}: nicht in alle Welten kopiert`, `${item.name}: not copied into all worlds`),
              tr(
                `In ${failed.map((w) => `„${w}“`).join(', ')} konnte das Data Pack nicht abgelegt werden. Entweder liegt dort schon eine andere Datei mit demselben Namen, oder die Datei ist gerade gesperrt.`,
                `The data pack could not be placed in ${failed.map((w) => `"${w}"`).join(', ')}. Either another file with the same name is already there, or the file is locked right now.`
              )
            )
          }
        } else {
          for (const world of liveWorlds) removeDatapackFromWorld(id, world, bare)
        }
      }

      const content = instance.content.map((c) =>
        c.id === contentId ? { ...c, fileName: nextName, enabled, ...(keptWorlds ? { worlds: keptWorlds } : {}) } : c
      )
      return persist({ ...instance, content })
    })
  )
}

/* ------------------------------------------------------------------ *
 * Play sessions
 * ------------------------------------------------------------------ */

export function recordSession(
  id: string,
  session: { startedAt: number; endedAt: number; crashed: boolean; exitCode: number | null }
): void {
  const instance = tryGetInstance(id)
  if (!instance) return

  // Without the time the computer slept: the game survives a standby, and a
  // night in it counted as eight hours played.
  const durationMs = Math.max(
    0,
    session.endedAt - session.startedAt - sleptBetween(session.startedAt, session.endedAt)
  )
  const sessions = [{ ...session, durationMs }, ...instance.sessions].slice(0, 50)

  persist({
    ...instance,
    sessions,
    lastPlayed: session.startedAt,
    totalPlayMs: instance.totalPlayMs + durationMs
  })
}

export function markPlayed(id: string): void {
  const instance = tryGetInstance(id)
  if (!instance) return
  persist({ ...instance, lastPlayed: Date.now() })
}

/* ------------------------------------------------------------------ *
 * Misc helpers
 * ------------------------------------------------------------------ */

export async function instanceDiskUsage(id: string): Promise<number> {
  return folderSize(paths.instance(id))
}

export async function readInstanceLog(id: string, lines = 400): Promise<string[]> {
  const file = join(paths.gameDir(id), 'logs', 'latest.log')
  if (!existsSync(file)) return []
  const content = await readFile(file, 'utf8')
  return content.split(/\r?\n/).slice(-lines)
}
