/**
 * Whether a mod file fits the Fabric Loader of an instance.
 *
 * Modrinth and CurseForge do not say which loader version a mod needs, only
 * its own `fabric.mod.json` does. Fabric Language Kotlin 1.14 asks for Fabric
 * Loader 0.19.5 or later; offered as an update on 0.19.3, or suggested by the
 * crash help, it went in, and the game no longer started.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Instance, ProjectVersion } from '@shared/types'
import { paths } from '../paths'
import { describeFabricDependency, satisfiesFabricDependency } from './fabricVersion'
import { readJarMetadata, type JarMetadata } from './modMetadata'
import { downloadFile } from './net'

type LoaderOf = Pick<Instance, 'loader' | 'loaderVersion'>

/**
 * Null when the file fits, or nothing says otherwise; else what it needs, in
 * words. Only Fabric instances are judged: Quilt numbers its own loader
 * apart from the Fabric Loader version it stands in for.
 */
export function loaderNeed(instance: LoaderOf, meta: JarMetadata | null): string | null {
  if (instance.loader !== 'fabric' || !instance.loaderVersion || !meta?.fabricLoader) return null
  return satisfiesFabricDependency(instance.loaderVersion, meta.fabricLoader) === false
    ? describeFabricDependency(meta.fabricLoader)
    : null
}

/** True when a mod of this type in this instance has a loader to check against. */
export function checksLoader(instance: LoaderOf, type: string): boolean {
  return type === 'mod' && instance.loader === 'fabric' && Boolean(instance.loaderVersion)
}

/**
 * Downloads `version` into the cache and reads what it needs. The file is
 * handed back only when it fits; otherwise it is deleted again.
 */
export async function downloadChecked(
  version: ProjectVersion,
  instance: LoaderOf,
  signal?: AbortSignal
): Promise<{ file: string } | { needs: string }> {
  mkdirSync(paths.cache(), { recursive: true })
  const safeName = (version.fileName.split(/[\\/]/).pop() ?? 'mod.jar').replace(/[^A-Za-z0-9._+-]/g, '_')
  const file = join(paths.cache(), `check-${randomUUID().slice(0, 8)}-${safeName}`)
  try {
    await downloadFile({ url: version.downloadUrl, path: file, sha1: version.sha1, size: version.size }, undefined, 3, signal)
  } catch (err) {
    rmSync(file, { force: true })
    throw err
  }
  const needs = loaderNeed(instance, await readJarMetadata(file))
  if (needs === null) return { file }
  rmSync(file, { force: true })
  return { needs }
}
