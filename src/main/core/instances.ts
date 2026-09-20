import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
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
  LoaderId
} from '@shared/types'
import { ensureInstanceLayout, paths, RESERVED_WINDOWS_NAMES, safeJoin } from '../paths'
import { getSettings, readJson, writeJsonAtomic } from '../store'
import { emit } from '../events'
import { log } from '../logger'
import { withTask } from '../tasks'
import { installLoader, resolveLatestLoaderVersion } from '../loaders'
import { installVersion, loadVersionJson } from './mojang'
import { readEntryJson } from './archive'
import { isRunning, isStarting } from './running'
import { isContentBusy, withContentLock } from './contentLock'
import { isRestoring } from './restoreLock'
import { isRepairing } from './repairLock'
import { PACK_FILENAME as START_SCREEN_PACK } from './startScreen'

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
    name: raw.name ?? 'Unbenannt',
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
    content: raw.content ?? [],
    source: raw.source ?? { type: 'manual' },
    createdAt: raw.createdAt ?? Date.now(),
    lastPlayed: raw.lastPlayed ?? null,
    totalPlayMs: raw.totalPlayMs ?? 0,
    sessions: raw.sessions ?? [],
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
        const raw = readJson<Partial<Instance>>(file, {})
        cache.set(entry, normalise(raw, entry))
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
  if (!instance) throw new Error(`Instanz ${id} existiert nicht`)
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
  writeJsonAtomic(paths.instanceFile(instance.id), instance)
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
export async function createInstance(options: CreateInstanceOptions): Promise<Instance> {
  const settings = getSettings()
  const id = uniqueId(options.name)

  ensureInstanceLayout(id)

  const instance: Instance = normalise(
    {
      name: options.name.trim() || 'Neue Instanz',
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
        jvmArgs: settings.defaultJvmArgs,
        launchBehaviour: settings.launchBehaviour
      },
      createdAt: Date.now(),
      installing: true,
      installed: false
    },
    id
  )

  persist(instance)
  logger.info(`Instanz ${id} (${instance.name}) angelegt`)

  // Fire and forget: progress is reported through the task system.
  void installInstance(id).catch((err) => {
    logger.error(`Installation von ${id} fehlgeschlagen:`, err)
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
    throw new Error('Die Instanz läuft gerade. Beende Minecraft, bevor du sie neu einrichtest.')
  }
  // A launch can still be downloading files or installing Java when
  // `isRunning` is false, the same reasoning `repairInstance` already applies
  // to this exact hazard.
  if (isStarting(id)) {
    throw new Error('Die Instanz wird gerade gestartet. Warte, bis das abgeschlossen ist.')
  }
  // The other half of the guard `repairInstance` has against `installing`:
  // a repair verifies and rewrites the very files an install downloads, and
  // both persist the instance record when they finish.
  if (isRepairing(id)) {
    throw new Error('Diese Instanz wird gerade repariert. Warte, bis das abgeschlossen ist.')
  }

  persist({ ...instance, installing: true })

  try {
    await withTask(
      `${instance.name} wird eingerichtet`,
      'Version wird ermittelt…',
      id,
      async (task) => {
        const current = getInstance(id)

        let loaderVersion = current.loaderVersion
        if (current.loader !== 'vanilla' && !loaderVersion) {
          task.update('Loader-Version wird ermittelt…', null)
          loaderVersion = await resolveLatestLoaderVersion(current.loader, current.mcVersion)
          persist({ ...getInstance(id), loaderVersion })
        }

        task.span(0, 0.25)
        const versionId = await installLoader(
          current.loader,
          current.mcVersion,
          loaderVersion,
          task
        )

        task.span(0.25, 1)
        const versionJson = await loadVersionJson(versionId)
        await installVersion(versionJson, current.mcVersion, task)
        task.span(0, 1)

        persist({ ...getInstance(id), installing: false, installed: true })
      }
    )
  } catch (err) {
    persist({ ...getInstance(id), installing: false })
    throw err
  }
}

/** The version id the launcher should start (loader id, or the MC version). */
export async function resolveVersionId(instance: Instance): Promise<string> {
  if (instance.loader === 'vanilla') return instance.mcVersion

  const loaderVersion =
    instance.loaderVersion || (await resolveLatestLoaderVersion(instance.loader, instance.mcVersion))

  switch (instance.loader) {
    case 'fabric':
      return `fabric-loader-${loaderVersion}-${instance.mcVersion}`
    case 'quilt':
      return `quilt-loader-${loaderVersion}-${instance.mcVersion}`
    default: {
      // Forge/NeoForge ids vary between generations, so read what the
      // installer wrote instead of guessing.
      const found = findInstalledLoaderVersionId(instance, loaderVersion)
      if (found) return found
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
  const needle = loaderVersion
  const candidates = readdirSync(dir).filter((name) => {
    const lower = name.toLowerCase()
    if (!lower.includes(instance.loader)) return false
    if (needle && !lower.includes(needle.toLowerCase())) return false
    // Always required, needle or not. `|| Boolean(needle)` used to stand here,
    // which is true whenever a needle is given, so the mcVersion check was
    // skipped in exactly the case that matters: `resolveVersionId` always
    // resolves a needle before calling this, so the check never actually
    // applied. A resolved loader build number is not guaranteed unique across
    // Minecraft versions, which is what this line is meant to guard against.
    return lower.includes(instance.mcVersion.toLowerCase())
  })

  return candidates.sort((a, b) => b.length - a.length)[0] ?? null
}

/* ------------------------------------------------------------------ *
 * Mutation
 * ------------------------------------------------------------------ */

export function updateInstance(id: string, patch: InstancePatch): Instance {
  const current = getInstance(id)

  const next: Instance = {
    ...current,
    ...patch,
    id: current.id,
    appearance: { ...current.appearance, ...patch.appearance },
    settings: { ...current.settings, ...patch.settings }
  }

  return persist(next)
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
    throw new Error(`Ungültiger Pfad für ${label}: ${candidate}`)
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
    throw new Error(`Die Instanz läuft gerade und kann nicht ${actionPastParticiple} werden.`)
  }

  // "Running" was the only state this asked about, and it is the last of the
  // three to be reached. A launch still gathering libraries, a mod download,
  // or a restore unpacking an archive all write into the very folders removed
  // below, and each of them survives the deletion as work against files that
  // are no longer there.
  if (isStarting(id)) {
    throw new Error(`Die Instanz wird gerade gestartet und kann nicht ${actionPastParticiple} werden.`)
  }
  if (isContentBusy(id)) {
    throw new Error('An den Mods dieser Instanz wird gerade gearbeitet. Warte, bis das fertig ist.')
  }
  if (isRestoring(id)) {
    throw new Error('Für diese Instanz wird gerade eine Sicherung eingespielt. Warte, bis das fertig ist.')
  }
  // Mirrors the guard `launchInstance` has against `isRepairing`: a repair
  // rewrites the client jar, the natives folder, the loader and the mods, and
  // deleting or duplicating that folder while it is only half rebuilt is the
  // same kind of half written state the other four guards already prevent.
  if (isRepairing(id)) {
    throw new Error('Für diese Instanz läuft gerade eine Reparatur. Warte, bis das fertig ist.')
  }
}

export function deleteInstance(id: string): void {
  assertInstanceIdle(id, 'gelöscht')

  // Must be a known instance, not just any id the caller made up.
  if (!cache.has(id)) {
    if (!loaded) loadInstances()
    if (!cache.has(id)) throw new Error(`Instanz ${id} existiert nicht`)
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
    rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    deleted.delete(id)
    throw err
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
  assertInstanceIdle(id, 'dupliziert')

  const source = getInstance(id)
  const name = newName?.trim() || `${source.name} (Kopie)`
  const newId = uniqueId(name)

  ensureInstanceLayout(newId)

  // `assertInstanceIdle` above only checks the instant duplication starts.
  // The copy itself can run for seconds on a large modpack or world, and
  // held no lock of its own for that whole stretch: nothing stopped
  // `deleteInstance` or `repairInstance`, both synchronous and neither
  // waiting on this, from running against the very folder this is reading
  // from partway through the copy. Held on the source id, the same flag
  // `assertInstanceIdle` already checks.
  const { cp } = await import('node:fs/promises')
  await withContentLock(id, () => cp(paths.gameDir(id), paths.gameDir(newId), { recursive: true }))

  const clone: Instance = {
    ...structuredClone(source),
    id: newId,
    name,
    createdAt: Date.now(),
    lastPlayed: null,
    totalPlayMs: 0,
    sessions: [],
    favorite: false
  }

  persist(clone)
  logger.info(`Instanz ${id} nach ${newId} dupliziert`)
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
  return reference
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

  const worlds: WorldInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = join(dir, entry.name)
    let lastPlayed = 0
    try {
      lastPlayed = statSync(join(folder, 'level.dat')).mtimeMs
    } catch {
      try {
        lastPlayed = statSync(folder).mtimeMs
      } catch {
        // A world that vanished between listing and stat is simply skipped
        // rather than taking the whole list down with it.
        continue
      }
    }
    worlds.push({ name: entry.name, folder, sizeBytes: await folderSize(folder), lastPlayed })
  }
  return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed)
}

export function listScreenshots(id: string, limit = 40): { file: string; takenAt: number }[] {
  // Same existence check as `listWorlds`, for the same reason.
  getInstance(id)
  const dir = paths.screenshots(id)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    .map((f) => {
      const full = join(dir, f)
      return { file: full, takenAt: statSync(full).mtimeMs }
    })
    .sort((a, b) => b.takenAt - a.takenAt)
    .slice(0, limit)
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
export async function syncContentWithDisk(id: string): Promise<Instance> {
  const instance = getInstance(id)

  // Never while the folder is being rewritten. An update writes the new jar
  // first and records it a moment later, and a scan landing in between saw a
  // file it did not recognise and registered it as a second, separate mod —
  // the duplicate entries users reported. The scan is only ever a
  // reconciliation, so skipping one is free: the next one sees the finished
  // state. Ordinary actions reach this, not just unlucky ones: opening the
  // instance page, pressing the compatibility check, or clicking Play all
  // land here.
  if (isContentBusy(id)) {
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
  const bareKey = (name: string): string =>
    (name.endsWith('.disabled') ? name.slice(0, -'.disabled'.length) : name).toLowerCase()
  // Scoped by type as well as name: resource packs, shader packs and
  // datapacks all end in `.zip` and are scanned from separate folders below,
  // but shared one map keyed on the bare name alone. Two of them with the
  // same generic name, "pack.zip" for instance, collided on the same map
  // entry, and both files then came back tagged with whichever one's
  // metadata happened to still be in `known`: wrong type, wrong name, and an
  // id shared between two records that pointed at two different files.
  const known = new Map(instance.content.map((c) => [`${c.type}:${bareKey(c.fileName)}`, c]))
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

      const existing = known.get(`${folder.type}:${bare.toLowerCase()}`)
      if (existing) {
        result.push({ ...existing, fileName, enabled })
        continue
      }

      // Unknown file: register it as local content so it still shows up.
      const stats = statSync(join(folder.dir, fileName))
      result.push({
        id: randomUUID(),
        type: folder.type,
        provider: 'local',
        fileName,
        name: bare.replace(/\.(jar|zip)$/i, '').replace(/[-_]/g, ' '),
        version: '',
        enabled,
        gameVersions: [],
        loaders: [],
        dependencies: [],
        size: stats.size,
        installedAt: stats.mtimeMs
      })
    }
  }

  if (sameContent(instance.content, result)) return instance
  return persist({ ...instance, content: result })
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
 */
export function toggleContent(id: string, contentId: string, enabled: boolean): Promise<Instance> {
  return withContentLock(id, async () => {
    const instance = getInstance(id)
    const item = instance.content.find((c) => c.id === contentId)
    if (!item) throw new Error('Inhalt nicht gefunden')

    const dirMap: Record<ContentItem['type'], string> = {
      mod: paths.mods(id),
      resourcepack: paths.resourcePacks(id),
      shaderpack: paths.shaderPacks(id),
      datapack: join(paths.gameDir(id), 'datapacks')
    }

    const dir = dirMap[item.type]
    const currentPath = join(dir, item.fileName)
    const bare = item.fileName.endsWith('.disabled')
      ? item.fileName.slice(0, -'.disabled'.length)
      : item.fileName
    const nextName = enabled ? bare : `${bare}.disabled`

    if (existsSync(currentPath) && nextName !== item.fileName) {
      renameSync(currentPath, join(dir, nextName))
    }

    const content = instance.content.map((c) =>
      c.id === contentId ? { ...c, fileName: nextName, enabled } : c
    )
    return persist({ ...instance, content })
  })
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

  const durationMs = Math.max(0, session.endedAt - session.startedAt)
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

export async function readModMetadata(jarFile: string): Promise<{ name?: string; version?: string } | null> {
  try {
    const fabric = await readEntryJson<{ name?: string; version?: string; id?: string }>(
      jarFile,
      'fabric.mod.json'
    )
    if (fabric) return { name: fabric.name ?? fabric.id, version: fabric.version }

    const quilt = await readEntryJson<{ quilt_loader?: { metadata?: { name?: string }; version?: string } }>(
      jarFile,
      'quilt.mod.json'
    )
    if (quilt?.quilt_loader) {
      return { name: quilt.quilt_loader.metadata?.name, version: quilt.quilt_loader.version }
    }
  } catch {
    // not a mod we can read
  }
  return null
}

export async function readInstanceLog(id: string, lines = 400): Promise<string[]> {
  const file = join(paths.gameDir(id), 'logs', 'latest.log')
  if (!existsSync(file)) return []
  const content = await readFile(file, 'utf8')
  return content.split(/\r?\n/).slice(-lines)
}
