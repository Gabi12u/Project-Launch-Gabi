import { join } from 'node:path'
import type { LoaderVersion } from '@shared/types'
import { paths } from '../paths'
import { writeJsonAtomic } from '../store'
import { fetchJson, fetchJsonCached } from '../core/net'
import type { VersionJson } from '../core/mojang'
import { log } from '../logger'
import type { Task } from '../tasks'

const logger = log('fabric')

interface MetaLoaderEntry {
  loader: { version: string; stable: boolean; build: number; maven: string }
  intermediary: { version: string; maven: string; stable: boolean }
}

/** Fabric and Quilt expose the same meta API shape. */
const ENDPOINTS = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3'
} as const

export type FabricLikeLoader = keyof typeof ENDPOINTS

export async function listFabricLikeVersions(
  loader: FabricLikeLoader,
  mcVersion: string
): Promise<LoaderVersion[]> {
  const url = `${ENDPOINTS[loader]}/versions/loader/${encodeURIComponent(mcVersion)}`

  let entries: MetaLoaderEntry[]
  try {
    entries = await fetchJsonCached<MetaLoaderEntry[]>(
      url,
      `${loader}-loader-${mcVersion}`,
      30 * 60 * 1000
    )
  } catch (err) {
    logger.warn(`Keine ${loader}-Versionen für ${mcVersion}:`, err)
    return []
  }

  return entries.map((entry) => ({
    version: entry.loader.version,
    // Quilt marks beta builds through the version string rather than the flag.
    stable: entry.loader.stable && !entry.loader.version.includes('beta'),
    gameVersion: mcVersion
  }))
}

/** True when this loader has any build for the given Minecraft version. */
export async function supportsGameVersion(
  loader: FabricLikeLoader,
  mcVersion: string
): Promise<boolean> {
  return (await listFabricLikeVersions(loader, mcVersion)).length > 0
}

/**
 * Fetches the launch profile and stores it as a version JSON. The profile
 * inherits from the vanilla version, so the merge in `loadVersionJson` fills
 * in the rest.
 */
export async function installFabricLike(
  loader: FabricLikeLoader,
  mcVersion: string,
  loaderVersion: string,
  task?: Task
): Promise<string> {
  task?.update(`${loader === 'fabric' ? 'Fabric' : 'Quilt'} ${loaderVersion} wird eingerichtet…`, null)

  const url =
    `${ENDPOINTS[loader]}/versions/loader/${encodeURIComponent(mcVersion)}/` +
    `${encodeURIComponent(loaderVersion)}/profile/json`

  const profile = await fetchJson<VersionJson>(url)
  const versionId = profile.id ?? `${loader}-loader-${loaderVersion}-${mcVersion}`
  profile.id = versionId

  writeJsonAtomic(join(paths.version(versionId), `${versionId}.json`), profile)
  logger.info(`${loader} ${loaderVersion} für ${mcVersion} eingerichtet als ${versionId}`)

  return versionId
}

export async function resolveLatestFabricLike(
  loader: FabricLikeLoader,
  mcVersion: string
): Promise<string> {
  const versions = await listFabricLikeVersions(loader, mcVersion)
  const stable = versions.find((v) => v.stable) ?? versions[0]
  if (!stable) throw new Error(`Für Minecraft ${mcVersion} gibt es keine ${loader}-Version`)
  return stable.version
}
