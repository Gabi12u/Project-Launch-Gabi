import type { LoaderId, LoaderVersion } from '@shared/types'
import { installFabricLike, listFabricLikeVersions, resolveLatestFabricLike } from './fabric'
import { installForgeLike, listForgeLikeVersions, resolveLatestForgeLike } from './forge'
import type { Task } from '../tasks'

export async function listLoaderVersions(
  loader: LoaderId,
  mcVersion: string
): Promise<LoaderVersion[]> {
  switch (loader) {
    case 'vanilla':
      return []
    case 'fabric':
    case 'quilt':
      return listFabricLikeVersions(loader, mcVersion)
    case 'forge':
    case 'neoforge':
      return listForgeLikeVersions(loader, mcVersion)
    default:
      return []
  }
}

export async function resolveLatestLoaderVersion(
  loader: LoaderId,
  mcVersion: string
): Promise<string> {
  switch (loader) {
    case 'vanilla':
      return ''
    case 'fabric':
    case 'quilt':
      return resolveLatestFabricLike(loader, mcVersion)
    case 'forge':
    case 'neoforge':
      return resolveLatestForgeLike(loader, mcVersion)
    default:
      return ''
  }
}

/**
 * Installs the loader and returns the version id to launch. For vanilla that
 * is simply the Minecraft version.
 */
export async function installLoader(
  loader: LoaderId,
  mcVersion: string,
  loaderVersion: string,
  task?: Task
): Promise<string> {
  switch (loader) {
    case 'vanilla':
      return mcVersion
    case 'fabric':
    case 'quilt':
      return installFabricLike(loader, mcVersion, loaderVersion, task)
    case 'forge':
    case 'neoforge':
      return installForgeLike(loader, mcVersion, loaderVersion, task)
    default:
      return mcVersion
  }
}

/** Which loaders have at least one build for this Minecraft version. */
export async function availableLoaders(mcVersion: string): Promise<LoaderId[]> {
  const checks: LoaderId[] = ['fabric', 'neoforge', 'forge', 'quilt']
  const results = await Promise.all(
    checks.map(async (loader) => {
      try {
        const versions = await listLoaderVersions(loader, mcVersion)
        return versions.length > 0 ? loader : null
      } catch {
        return null
      }
    })
  )
  return ['vanilla', ...results.filter((l): l is LoaderId => l !== null)]
}
