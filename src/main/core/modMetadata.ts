/**
 * What a mod jar says about itself: the mod ids it declares, its name and
 * version, and which loaders it carries metadata for.
 *
 * Provider records only exist for mods installed through the launcher. A jar
 * dropped into mods/ by hand used to be recorded with nothing but a name made
 * from its file name, so the compatibility check could neither see it as a
 * duplicate of the same mod from Modrinth, nor as the dependency another mod
 * needed, nor as a Forge mod lying in a Fabric instance.
 */
import { stat } from 'node:fs/promises'
import type { LoaderId } from '@shared/types'
import { readSmallEntries } from './archive'

export interface JarMetadata {
  /** Mod ids the jar declares as its own, across all its metadata files. */
  ids: string[]
  name?: string
  version?: string
  /** Loaders the jar carries metadata for. Empty when it names none. */
  loaders: LoaderId[]
}

const METADATA_ENTRIES = [
  'fabric.mod.json',
  'quilt.mod.json',
  'META-INF/neoforge.mods.toml',
  'META-INF/mods.toml'
] as const

/**
 * Keyed by path and checked against size and modification time, so a jar
 * replaced under the same name is read again. Bounded like the other caches.
 */
const cache = new Map<string, { size: number; mtimeMs: number; meta: JarMetadata }>()
const CACHE_MAX = 4000

/**
 * Reads a jar's own metadata. Null when the file could not be read at all
 * (gone, locked), as opposed to a readable jar that declares nothing, so a
 * caller can try again later instead of recording "no ids" for good.
 */
export async function readJarMetadata(file: string): Promise<JarMetadata | null> {
  let info: { size: number; mtimeMs: number }
  try {
    info = await stat(file)
  } catch {
    return null
  }
  const hit = cache.get(file)
  if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) return hit.meta

  let texts: Map<string, string>
  try {
    texts = await readSmallEntries(file, METADATA_ENTRIES)
  } catch {
    return null
  }
  const meta = parseJarMetadata(texts)

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, meta })
  return meta
}

/** Builds the metadata from the entry texts, keyed by entry name. */
export function parseJarMetadata(texts: Map<string, string>): JarMetadata {
  const ids: string[] = []
  const loaders: LoaderId[] = []
  let name: string | undefined
  let version: string | undefined

  // Build tools leave placeholders like "${version}" in unprocessed files.
  const value = (raw: unknown): string | undefined =>
    typeof raw === 'string' && raw.trim() !== '' && !raw.includes('${') ? raw.trim() : undefined

  const fabricText = texts.get('fabric.mod.json')
  if (fabricText !== undefined) {
    loaders.push('fabric')
    const fabric = parseLenientJson(fabricText) as { id?: unknown; name?: unknown; version?: unknown } | null
    if (fabric && typeof fabric === 'object') {
      const id = value(fabric.id)
      if (id) ids.push(id)
      name ??= value(fabric.name)
      version ??= value(fabric.version)
    }
  }

  const quiltText = texts.get('quilt.mod.json')
  if (quiltText !== undefined) {
    loaders.push('quilt')
    const quilt = parseLenientJson(quiltText) as {
      quilt_loader?: { id?: unknown; version?: unknown; metadata?: { name?: unknown } | null } | null
    } | null
    const block = quilt?.quilt_loader
    if (block && typeof block === 'object') {
      const id = value(block.id)
      if (id) ids.push(id)
      name ??= value(block.metadata?.name)
      version ??= value(block.version)
    }
  }

  for (const entry of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const toml = texts.get(entry)
    if (toml === undefined) continue
    const parsed = parseModsToml(toml)
    for (const mod of parsed.mods) {
      // An unprocessed "${mod_id}" is no id; two jars carrying it are not
      // the same mod.
      const id = value(mod.modId)
      if (id) ids.push(id)
      name ??= value(mod.displayName)
      version ??= value(mod.version)
    }
    if (entry === 'META-INF/neoforge.mods.toml') {
      loaders.push('neoforge')
    } else {
      // NeoForge used plain mods.toml up to 1.20.4, so the file alone does
      // not say which of the two a jar is for. Its dependency on "forge" or
      // "neoforge" does; a jar naming neither is taken to fit both.
      const forge = parsed.dependencyIds.has('forge')
      const neoforge = parsed.dependencyIds.has('neoforge')
      if (forge || !neoforge) loaders.push('forge')
      if (neoforge || !forge) loaders.push('neoforge')
    }
  }

  return { ids: [...new Set(ids)], name, version, loaders: [...new Set(loaders)] }
}

/**
 * The `[[mods]]` entries of a mods.toml, plus the mod ids its
 * `[[dependencies.<mod>]]` tables name.
 *
 * Every dependency table carries a `modId` line as well, naming what the mod
 * needs ("minecraft", "forge", "neoforge"). Read along with the rest, those
 * made two unrelated mods of the same name share an id, so they counted as
 * one mod installed twice and the launch was blocked.
 */
export function parseModsToml(text: string): {
  mods: { modId: string; displayName?: string; version?: string }[]
  dependencyIds: Set<string>
} {
  const mods: { modId: string; displayName?: string; version?: string }[] = []
  const dependencyIds = new Set<string>()
  let section: 'mods' | 'dependencies' | 'other' = 'other'
  let current: { modId?: string; displayName?: string; version?: string } | null = null
  const flush = (): void => {
    if (current?.modId) mods.push({ modId: current.modId, displayName: current.displayName, version: current.version })
    current = null
  }
  // The delimiter that opened a multi-line string, if one is open. Only the
  // same one closes it: a """ inside a ''' string is just text.
  let open: string | null = null
  for (const line of text.split(/\r?\n/)) {
    // A description in ''' or """ can hold lines that look like a table
    // header; read as one, it ended the [[mods]] table early.
    const startedInString = open !== null
    for (const match of line.matchAll(/'''|"""/g)) {
      if (open === null) open = match[0]
      else if (match[0] === open) open = null
    }
    if (startedInString) continue
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line)
    if (header) {
      flush()
      if (header[1] === 'mods') {
        section = 'mods'
        current = {}
      } else {
        section = header[1].startsWith('dependencies') ? 'dependencies' : 'other'
      }
      continue
    }
    const pair = /^\s*(modId|displayName|version)\s*=\s*["']([^"']*)["']/.exec(line)
    if (!pair) continue
    if (section === 'mods' && current) {
      if (pair[1] === 'modId') current.modId = pair[2]
      else if (pair[1] === 'displayName') current.displayName = pair[2]
      else current.version = pair[2]
    } else if (section === 'dependencies' && pair[1] === 'modId') {
      dependencyIds.add(pair[2].toLowerCase())
    }
  }
  flush()
  return { mods, dependencyIds }
}

/**
 * JSON the way the loaders read it. Fabric accepts a byte order mark and
 * comments, so jars with either load fine in the game, while a strict
 * `JSON.parse` returned nothing and the jar looked like it declared no id.
 */
export function parseLenientJson(raw: string): unknown {
  const text = raw.replace(/^﻿/, '')
  try {
    return JSON.parse(text)
  } catch {
    // Second, forgiving pass below.
  }
  try {
    return JSON.parse(stripJsonComments(text))
  } catch {
    return null
  }
}

/** Removes comments and trailing commas outside of strings. */
function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') {
        out += text[i + 1] ?? ''
        i++
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
      continue
    }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}
