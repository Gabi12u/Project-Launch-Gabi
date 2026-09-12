import { join } from 'node:path'
import type { LoaderVersion } from '@shared/types'
import { paths, sanitizeVersionId } from '../paths'
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

/**
 * Compares two loader version strings, newest first, by their dot-separated
 * numeric prefix (a `-beta.9` or similar suffix is ignored for the
 * comparison itself, since two builds only differing in that suffix still
 * need to sort by their shared numeric part).
 */
function compareVersionsNewestFirst(a: string, b: string): number {
  const numbers = (v: string): number[] => v.split(/[-+]/)[0].split('.').map((n) => Number(n) || 0)
  const pa = numbers(a)
  const pb = numbers(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export async function listFabricLikeVersions(
  loader: FabricLikeLoader,
  mcVersion: string
): Promise<LoaderVersion[]> {
  const url = `${ENDPOINTS[loader]}/versions/loader/${encodeURIComponent(mcVersion)}`

  // A failed lookup used to return an empty list, exactly like "this loader
  // genuinely has no build for this version". The two are told apart
  // upstream (CreateInstanceWizard.tsx's "checkFailed" hint and retry
  // button), but only if this actually throws instead of swallowing the
  // failure here. Left as a bare empty list, that distinction had nothing to
  // work with: every network drop looked identical to a real absence.
  const entries = await fetchJsonCached<MetaLoaderEntry[]>(url, `${loader}-loader-${mcVersion}`, 30 * 60 * 1000)

  // `fetchJsonCached` casts without checking, so a 200 carrying anything other
  // than the expected array (a maintenance page, a CDN error body, a future
  // API change) used to reach `.map` outside the try above and throw a raw
  // TypeError, and the bad body stayed in the disk cache for half an hour,
  // repeating the crash long after the API recovered. Now caught explicitly
  // and treated the same as any other failed lookup, not a silent empty list.
  if (!Array.isArray(entries)) {
    throw new Error(`Unerwartete Antwort der ${loader}-API für ${mcVersion}`)
  }

  // Neither API documents the array's order, and Quilt's in particular is
  // not sorted at all: querying it live for an ordinary Minecraft version
  // returned "0.20.0-beta.9" first, followed by "0.20.0-beta.7", with a
  // genuinely newer release further back in the list. `resolveLatestFabricLike`
  // and the version picker's own default both used to trust the array's
  // first entry as "the newest", which for Quilt could just as easily be an
  // old beta. Sorted explicitly here so every caller gets a meaningful order
  // regardless of what either server actually sends.
  return entries
    .filter((entry) => typeof entry?.loader?.version === 'string')
    .map((entry) => ({
      version: entry.loader.version,
      // Fabric's `stable` flag is a curated "this is the one we recommend"
      // marker, not a mechanical "not a prerelease" check, so it stays
      // authoritative there. Quilt's documentation comment above once
      // claimed the same API shape, but live checking it shows the `loader`
      // object simply carries no `stable` field at all: `entry.loader.stable`
      // is `undefined`, which read as falsy here regardless of whether the
      // build actually was one, so the "stable" pick for Quilt never matched
      // anything and silently fell back to whatever the array's unsorted
      // first entry happened to be. The version string itself is the only
      // signal Quilt actually gives; not just "beta" is checked because a
      // "-rc"/"-pre" build should be excluded the same way.
      stable:
        loader === 'fabric' ? entry.loader.stable : !/-?(beta|alpha|rc|pre)/i.test(entry.loader.version),
      gameVersion: mcVersion
    }))
    .sort((a, b) => compareVersionsNewestFirst(a.version, b.version))
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
  // The id comes straight from the meta server's response, so it is not
  // trusted as a path/file name component before sanitizing it.
  const versionId = sanitizeVersionId(profile.id ?? `${loader}-loader-${loaderVersion}-${mcVersion}`)
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
