import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type {
  CompatibilityIssue,
  ContentItem,
  ContentType,
  Instance,
  ProjectVersion
} from '@shared/types'
import { contentDir } from '../paths'
import { getSettings } from '../store'
import { log } from '../logger'
import { Task, withTask } from '../tasks'
import { downloadFile, sha1File } from './net'
import {
  addContent,
  getInstance,
  persist,
  removeContentRecord,
  syncContentWithDisk,
  toggleContent
} from './instances'
import { bestVersionFor, curseforge, getVersions, modrinth } from '../providers'
import { createBackup } from './backups'

const logger = log('content')

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function typeFromProjectType(type: ContentType | 'modpack'): ContentType {
  return type === 'modpack' ? 'mod' : type
}

function targetDir(instanceId: string, type: ContentType): string {
  const dir = contentDir(instanceId, type)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Strips any directory part from a provider-supplied file name.
 *
 * `fileName` comes straight from the Modrinth/CurseForge API, so a crafted
 * release could name its file `../../../autostart/evil.jar` and escape the
 * mods folder — on install, and just as badly later on update (overwrite) or
 * removal (delete). A content file only ever needs a bare name, so anything
 * else is dropped rather than trusted.
 */
function contentFileName(fileName: string): string {
  const safe = basename(fileName.replace(/\\/g, '/'))
  if (!safe || safe === '.' || safe === '..') {
    throw new Error(`Ungültiger Dateiname aus der Quelle: "${fileName}"`)
  }
  return safe
}

/** Joins a provider-supplied file name into a content folder, pinned to it. */
function contentPath(dir: string, fileName: string): string {
  return join(dir, contentFileName(fileName))
}

function toContentItem(
  version: ProjectVersion,
  type: ContentType,
  meta: { name: string; author?: string; iconUrl?: string; summary?: string; pageUrl?: string }
): ContentItem {
  return {
    id: randomUUID(),
    type,
    provider: version.provider,
    fileName: contentFileName(version.fileName),
    name: meta.name,
    version: version.versionNumber,
    versionId: version.versionId,
    projectId: version.projectId,
    author: meta.author,
    summary: meta.summary,
    iconUrl: meta.iconUrl,
    pageUrl: meta.pageUrl,
    sha1: version.sha1,
    size: version.size,
    enabled: true,
    gameVersions: version.gameVersions,
    loaders: version.loaders,
    dependencies: version.dependencies,
    installedAt: Date.now(),
    update: null
  }
}

/* ------------------------------------------------------------------ *
 * Installing
 * ------------------------------------------------------------------ */

export interface InstallContentOptions {
  instanceId: string
  provider: 'modrinth' | 'curseforge'
  projectId: string
  /** Install a specific version instead of the best match. */
  versionId?: string
  type?: ContentType
  /** Internal: prevents infinite recursion through dependency chains. */
  visited?: Set<string>
  task?: Task
  /** Skip dependency installation (used when the user picked "nur diese Datei"). */
  skipDependencies?: boolean
}

/**
 * Installs a project into an instance, pulling in required dependencies.
 * Returns every item that ended up being installed.
 */
export async function installContent(options: InstallContentOptions): Promise<ContentItem[]> {
  const { instanceId, provider, projectId } = options
  const visited = options.visited ?? new Set<string>()
  const key = `${provider}:${projectId}`

  if (visited.has(key)) return []
  visited.add(key)

  const instance = getInstance(instanceId)
  const installed: ContentItem[] = []

  const project =
    provider === 'modrinth' ? await modrinth.getProject(projectId) : await curseforge.getProject(projectId)

  const type = options.type ?? typeFromProjectType(project.type)

  // Pick the version -------------------------------------------------
  let version: ProjectVersion | null = null
  if (options.versionId) {
    const all = await getVersions(provider, projectId)
    version = all.find((v) => v.versionId === options.versionId) ?? null
  } else {
    version = await bestVersionFor(provider, projectId, instance.mcVersion, instance.loader)
  }

  if (!version) {
    throw new Error(
      `Für ${project.name} gibt es keine Version für Minecraft ${instance.mcVersion} (${instance.loader}).`
    )
  }

  // Download ---------------------------------------------------------
  const dir = targetDir(instanceId, type)
  const destination = contentPath(dir, version.fileName)

  options.task?.update(`${project.name} wird geladen…`, null)

  await downloadFile({
    url: version.downloadUrl,
    path: destination,
    sha1: version.sha1,
    size: version.size
  })

  // Replace an older file of the same project ------------------------
  const previous = getInstance(instanceId).content.find(
    (c) => c.projectId === projectId && c.provider === provider && c.fileName !== version.fileName
  )
  if (previous) {
    const oldPath = contentPath(contentDir(instanceId, previous.type), previous.fileName)
    rmSync(oldPath, { force: true })
    removeContentRecord(instanceId, previous.id)
  }

  const item = toContentItem(version, type, {
    name: project.name,
    author: project.author,
    iconUrl: project.iconUrl,
    summary: project.summary,
    pageUrl: project.pageUrl
  })

  addContent(instanceId, item)
  installed.push(item)
  logger.info(`${project.name} ${version.versionNumber} in ${instanceId} installiert`)

  // Dependencies -----------------------------------------------------
  if (!options.skipDependencies && getSettings().autoInstallDependencies) {
    const required = version.dependencies.filter((d) => d.type === 'required')

    for (const dependency of required) {
      const already = getInstance(instanceId).content.some((c) => c.projectId === dependency.projectId)
      if (already) continue

      try {
        options.task?.update(`Abhängigkeit wird installiert…`, null)
        const sub = await installContent({
          instanceId,
          provider,
          projectId: dependency.projectId,
          versionId: dependency.versionId,
          type,
          visited,
          task: options.task
        })
        installed.push(...sub)
      } catch (err) {
        logger.warn(`Abhängigkeit ${dependency.projectId} konnte nicht installiert werden:`, err)
      }
    }
  }

  return installed
}

/* ------------------------------------------------------------------ *
 * Removing
 * ------------------------------------------------------------------ */

export function removeContent(instanceId: string, contentId: string): Instance {
  const instance = getInstance(instanceId)
  const item = instance.content.find((c) => c.id === contentId)
  if (!item) return instance

  const file = contentPath(contentDir(instanceId, item.type), item.fileName)
  rmSync(file, { force: true })
  logger.info(`${item.name} aus ${instanceId} entfernt`)

  return removeContentRecord(instanceId, contentId)
}

/* ------------------------------------------------------------------ *
 * Importing local files
 * ------------------------------------------------------------------ */

/**
 * Copies a jar/zip into the instance and tries to identify it by hash so it
 * still participates in update checks.
 */
export async function importContentFile(
  instanceId: string,
  sourceFile: string,
  type: ContentType
): Promise<ContentItem> {
  const dir = targetDir(instanceId, type)
  const fileName = basename(sourceFile)
  const destination = join(dir, fileName)

  copyFileSync(sourceFile, destination)

  const hash = await sha1File(destination)
  const identified = await modrinth.lookupByHash(hash)

  let item: ContentItem
  if (identified) {
    const project = await modrinth.getProject(identified.projectId)
    item = toContentItem(identified, type, {
      name: project.name,
      author: project.author,
      iconUrl: project.iconUrl,
      summary: project.summary,
      pageUrl: project.pageUrl
    })
    item.fileName = fileName
  } else {
    item = {
      id: randomUUID(),
      type,
      provider: 'local',
      fileName,
      name: fileName.replace(/\.(jar|zip)$/i, '').replace(/[-_]/g, ' '),
      version: '',
      sha1: hash,
      size: statSync(destination).size,
      enabled: true,
      gameVersions: [],
      loaders: [],
      dependencies: [],
      installedAt: Date.now()
    }
  }

  addContent(instanceId, item)
  return item
}

/* ------------------------------------------------------------------ *
 * Updates
 * ------------------------------------------------------------------ */

/** Compares release dates because version strings are not sortable in practice. */
function isNewer(candidate: ProjectVersion, current: ContentItem): boolean {
  if (!current.versionId) return true
  if (candidate.versionId === current.versionId) return false
  if (candidate.fileName === current.fileName) return false
  return new Date(candidate.releasedAt).getTime() > current.installedAt - 24 * 60 * 60 * 1000
}

export async function checkUpdates(instanceId: string, task?: Task): Promise<Instance> {
  await syncContentWithDisk(instanceId)
  const instance = getInstance(instanceId)

  const managed = instance.content.filter(
    (c) => c.provider !== 'local' && c.projectId
  )

  const updated: ContentItem[] = []
  let index = 0

  for (const item of instance.content) {
    if (!managed.includes(item)) {
      updated.push(item)
      continue
    }

    index++
    task?.update(`Prüfe ${item.name}…`, index / Math.max(managed.length, 1))

    try {
      const candidate = await bestVersionFor(
        item.provider as 'modrinth' | 'curseforge',
        item.projectId as string,
        instance.mcVersion,
        instance.loader
      )

      if (candidate && isNewer(candidate, item)) {
        updated.push({
          ...item,
          update: {
            versionId: candidate.versionId,
            versionNumber: candidate.versionNumber,
            fileName: contentFileName(candidate.fileName),
            downloadUrl: candidate.downloadUrl,
            sha1: candidate.sha1,
            size: candidate.size,
            changelog: candidate.changelog,
            releasedAt: candidate.releasedAt
          }
        })
      } else {
        updated.push({ ...item, update: null })
      }
    } catch (err) {
      logger.warn(`Update-Prüfung für ${item.name} fehlgeschlagen:`, err)
      updated.push(item)
    }
  }

  // The loop above makes one network call per mod, so on a large pack it runs
  // for many seconds — long enough for the user to remove or toggle a mod, or
  // for an `applyUpdate` to finish. Writing `updated` wholesale would revert
  // whatever happened in the meantime, so the freshly read list decides which
  // items still exist and only the update marker is merged onto them.
  const scanned = new Map(updated.map((item) => [item.id, item]))
  const current = getInstance(instanceId)

  const merged = current.content.map((item) => {
    const seen = scanned.get(item.id)
    // A different version on disk means this item changed underneath us; a
    // marker computed against the old one must not be pinned to the new one.
    if (!seen || seen.versionId !== item.versionId) return item
    return { ...item, update: seen.update ?? null }
  })

  const result = persist({ ...current, content: merged })
  const count = merged.filter((c) => c.update).length
  logger.info(`${count} Updates für ${current.name} gefunden`)
  return result
}

export async function applyUpdate(instanceId: string, contentId: string): Promise<ContentItem | null> {
  const instance = getInstance(instanceId)
  const item = instance.content.find((c) => c.id === contentId)
  if (!item?.update) return null

  const dir = targetDir(instanceId, item.type)
  const destination = contentPath(dir, item.update.fileName)

  await downloadFile({
    url: item.update.downloadUrl,
    path: destination,
    sha1: item.update.sha1,
    size: item.update.size
  })

  // Remove the old file unless the name is unchanged.
  if (item.fileName !== item.update.fileName) {
    rmSync(contentPath(dir, item.fileName), { force: true })
  }

  const next: ContentItem = {
    ...item,
    fileName: contentFileName(item.update.fileName),
    version: item.update.versionNumber,
    versionId: item.update.versionId,
    sha1: item.update.sha1,
    size: item.update.size,
    installedAt: Date.now(),
    enabled: true,
    update: null
  }

  // Dependencies can change between versions.
  try {
    const versions = await getVersions(
      item.provider as 'modrinth' | 'curseforge',
      item.projectId as string
    )
    const fresh = versions.find((v) => v.versionId === next.versionId)
    if (fresh) {
      next.dependencies = fresh.dependencies
      next.gameVersions = fresh.gameVersions
      next.loaders = fresh.loaders
    }
  } catch {
    // keep the old metadata
  }

  const content = getInstance(instanceId).content.map((c) => (c.id === contentId ? next : c))
  persist({ ...getInstance(instanceId), content })

  logger.info(`${item.name} auf ${next.version} aktualisiert`)
  return next
}

export async function updateAll(instanceId: string): Promise<number> {
  const instance = getInstance(instanceId)

  return withTask(`Updates für ${instance.name}`, 'Vorbereitung…', instanceId, async (task) => {
    if (instance.settings.backupBeforeUpdates) {
      task.update('Sicherung wird erstellt…', null)
      await createBackup(instanceId, {
        name: `Vor Mod-Update ${new Date().toLocaleDateString('de-DE')}`,
        reason: 'pre-update',
        includes: ['saves']
      })
    }

    const pending = getInstance(instanceId).content.filter((c) => c.update)
    let done = 0

    for (const item of pending) {
      task.throwIfCancelled()
      task.update(`${item.name} wird aktualisiert…`, done / Math.max(pending.length, 1))
      try {
        await applyUpdate(instanceId, item.id)
        done++
      } catch (err) {
        logger.error(`Update für ${item.name} fehlgeschlagen:`, err)
      }
    }

    task.update(`${done} ${done === 1 ? 'Mod' : 'Mods'} aktualisiert`, 1)
    return done
  })
}

/* ------------------------------------------------------------------ *
 * Automatic fixes
 * ------------------------------------------------------------------ */

/** Applies the `fix` attached to a compatibility issue. */
export async function applyFix(instanceId: string, fix: NonNullable<CompatibilityIssue['fix']>): Promise<void> {
  switch (fix.kind) {
    case 'install-dependency': {
      if (!fix.projectId || !fix.provider) return
      await installContent({
        instanceId,
        provider: fix.provider,
        projectId: fix.projectId,
        type: 'mod'
      })
      return
    }

    case 'disable-content': {
      if (!fix.contentId) return
      toggleContent(instanceId, fix.contentId, false)
      return
    }

    case 'remove-content': {
      if (!fix.contentId) return
      removeContent(instanceId, fix.contentId)
      return
    }

    case 'update-content': {
      if (!fix.contentId || !fix.projectId || !fix.provider) return
      const instance = getInstance(instanceId)
      const item = instance.content.find((c) => c.id === fix.contentId)
      if (!item) return

      const candidate = await bestVersionFor(
        fix.provider,
        fix.projectId,
        instance.mcVersion,
        instance.loader
      )
      if (!candidate) {
        throw new Error(
          `Für ${item.name} gibt es keine Version für Minecraft ${instance.mcVersion} (${instance.loader}).`
        )
      }

      await installContent({
        instanceId,
        provider: fix.provider,
        projectId: fix.projectId,
        versionId: candidate.versionId,
        type: item.type
      })
      return
    }

    default:
      return
  }
}

/** Fixes every automatically resolvable issue in one go. */
export async function fixAll(instanceId: string, issues: CompatibilityIssue[]): Promise<number> {
  const fixable = issues.filter((i) => i.fix)
  let applied = 0

  for (const issue of fixable) {
    try {
      await applyFix(instanceId, issue.fix as NonNullable<CompatibilityIssue['fix']>)
      applied++
    } catch (err) {
      logger.warn(`Fix für "${issue.title}" fehlgeschlagen:`, err)
    }
  }
  return applied
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export function contentFilePath(instanceId: string, item: ContentItem): string {
  return contentPath(contentDir(instanceId, item.type), item.fileName)
}

export function contentTypeFromFile(fileName: string): ContentType {
  return extname(fileName).toLowerCase() === '.jar' ? 'mod' : 'resourcepack'
}

export function instanceContentSize(instanceId: string): number {
  const instance = getInstance(instanceId)
  let total = 0
  for (const item of instance.content) {
    const file = contentFilePath(instanceId, item)
    if (!existsSync(file)) continue
    try {
      total += statSync(file).size
    } catch {
      // ignore
    }
  }
  return total
}
