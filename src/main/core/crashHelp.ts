/**
 * Reads why the mod loader refused to start and turns it into fixes.
 *
 * When mods do not fit together, the loader stops before the game reaches
 * its menu and says exactly what is wrong, down to the version another mod
 * needs. The launcher only ever said "probably a mod", and the player had to
 * find that line in the log and pick the right version by hand.
 *
 * After the game ends this reads those lines, finds the installed mod each
 * one names and the version that satisfies it, and hands the result to the
 * compatibility check. The next Play click then offers the fix like any other
 * problem, with "Automatisch beheben" swapping the version in.
 *
 * Each loader words it its own way, all taken from real output or from the
 * loader's own source:
 * - Fabric: "Mod 'A' (a) 1.0 requires version 2.0 or later of mod 'B' (b),
 *   but only the wrong version is present: 1.5!", plus a suggested solution.
 *   Fabric translates this into a few languages (not German) by the system
 *   language; such a report is not read.
 * - Quilt: "A requires version [2.0, ?) of b, but only wrong versions are
 *   present:", in a report it writes to the log. Always English.
 * - Forge and NeoForge: "Mod ID: 'b', Requested by: 'a', Expected range:
 *   '[2.0,)', Actual version: '1.5'". Always English. Forge and older NeoForge
 *   show this on a screen inside the game and close normally from there, so
 *   the log is read after every exit, not only after a crash.
 */
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CompatibilityIssue, ContentItem, Instance, LoaderId, LoaderVersion, ProjectVersion } from '@shared/types'
import { tr } from '@shared/i18n'
import { getLogBuffer } from './instanceLog'
import { getInstance } from './instances'
import { readJarMetadata } from './modMetadata'
import { gameVersionMatches } from './gameVersions'
import { bestVersionFor, getVersions, modrinth } from '../providers'
import { listLoaderVersions } from '../loaders'
import { paths } from '../paths'
import { log } from '../logger'

const logger = log('crashHelp')

/**
 * The rule of compat.ts's `flattenName`. Not imported from there: compat.ts
 * reads `crashIssues` from this module, and the two would form a cycle.
 */
const flattenName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const LOADER_NAMES: Record<LoaderId, string> = {
  vanilla: 'Minecraft',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** The loader's name for the interface. */
export function loaderName(loader: LoaderId): string {
  return LOADER_NAMES[loader] ?? loader
}

/* ------------------------------------------------------------------ *
 * Reading the loader's report
 * ------------------------------------------------------------------ */

export interface LoaderMod {
  name: string
  /** Empty where the loader only gives the name (Quilt, for the asking mod). */
  id: string
  version?: string
  /** File name in the mods folder, where the loader says it (Quilt). */
  file?: string
}

/** One thing the loader found wrong. */
export interface Requirement {
  kind: 'mismatch' | 'missing' | 'breaks'
  /** The mod that has the requirement. */
  mod: LoaderMod
  /** The mod it requires or refuses. */
  dep: LoaderMod
  range: string
  /** Versions of `dep` that are present, for `mismatch` and `breaks`. */
  present: string[]
}

/** One step that would help. Only Fabric names these itself. */
export type Solution =
  | { kind: 'replace'; mod: LoaderMod; range: string }
  | { kind: 'refit'; mod: LoaderMod }
  | { kind: 'install'; mod: LoaderMod; range: string }
  | { kind: 'remove'; mod: LoaderMod }

/** Whose wording a report is in, which also decides how versions compare. */
export type ReportSource = 'fabric' | 'quilt' | 'forge'

export interface LoaderReport {
  source: ReportSource
  solutions: Solution[]
  details: Requirement[]
}

// Fabric: "Mod 'Name' (id)" for a mod, "'Name' (id)" for Minecraft, Java and
// the loader itself. A name can hold an apostrophe ("Xaero's Minimap"), so
// the name runs up to the quote that is followed by the id in brackets.
const REF = String.raw`(?:[Mm]od )?'(.+?)' \(([^)\s]+)\)`
const LEAD = String.raw`^\s*-\s*`

const MISMATCH = new RegExp(
  `${LEAD}${REF} (\\S+) requires (.+?) of ${REF}, but only the wrong versions? (?:is|are) present: (.+)!\\s*$`
)
// A missing mod has no name to show, so Fabric prints its bare id there.
const MISSING = new RegExp(`${LEAD}${REF} (\\S+) requires (.+?) of (?:${REF}|([^\\s,']+)), which is missing!\\s*$`)
const BREAKS = new RegExp(
  `${LEAD}${REF} (\\S+) is incompatible with (.+?) of ${REF}, yet (?:a )?conflicting versions? (?:is|are) present: (.+)!\\s*$`
)
const REPLACE = new RegExp(`${LEAD}Replace ${REF} (\\S+)(?: \\([^)]*\\))? with (.+?)\\.?\\s*$`)
const REFIT_TAIL = / that is compatible with:$/
const INSTALL = new RegExp(`${LEAD}Install (.+?), (.+?)\\.\\s*$`)
const REMOVE = new RegExp(`${LEAD}Remove ${REF} (\\S+)`)

/** True for output that holds Fabric's report on mods that do not fit. */
export function isFabricIncompatibility(text: string): boolean {
  return text.includes('Some of your mods are incompatible') || text.includes('Incompatible mods found!')
}

/**
 * Picks Fabric's report apart. Null when the text holds none, or one in a
 * language other than English.
 */
export function parseFabricReport(text: string): LoaderReport | null {
  if (!isFabricIncompatibility(text)) return null
  const solutions: Solution[] = []
  const details: Requirement[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    let m: RegExpExecArray | null

    if ((m = MISMATCH.exec(line))) {
      details.push({
        kind: 'mismatch',
        mod: { name: m[1], id: m[2], version: m[3] },
        range: m[4],
        dep: { name: m[5], id: m[6] },
        present: m[7].split('/')
      })
    } else if ((m = MISSING.exec(line))) {
      details.push({
        kind: 'missing',
        mod: { name: m[1], id: m[2], version: m[3] },
        range: m[4],
        dep: m[5] ? { name: m[5], id: m[6] } : { name: m[7], id: m[7] },
        present: []
      })
    } else if ((m = BREAKS.exec(line))) {
      details.push({
        kind: 'breaks',
        mod: { name: m[1], id: m[2], version: m[3] },
        range: m[4],
        dep: { name: m[5], id: m[6] },
        present: m[7].split('/')
      })
    } else if ((m = REPLACE.exec(line))) {
      const mod = { name: m[1], id: m[2], version: m[3] }
      const target = m[4]
      // Swapping for a different mod altogether is rare and has no version
      // to look up, so it stays a line in the log.
      if (/^(?:mod )?'/.test(target)) continue
      if (REFIT_TAIL.test(target)) solutions.push({ kind: 'refit', mod })
      else solutions.push({ kind: 'replace', mod, range: target })
    } else if ((m = INSTALL.exec(line))) {
      const named = new RegExp(REF).exec(m[1])
      const id = named ? named[2] : m[1].replace(/^mod /, '').replace(/'/g, '')
      solutions.push({ kind: 'install', mod: { name: named ? named[1] : id, id }, range: m[2] })
    } else if ((m = REMOVE.exec(line))) {
      solutions.push({ kind: 'remove', mod: { name: m[1], id: m[2], version: m[3] } })
    }
  }

  if (solutions.length === 0 && details.length === 0) return null
  return { source: 'fabric', solutions, details }
}

// Quilt names the asking mod by its name and the other one by its id, and
// lists the versions it found with the file each came from.
const QUILT_MARK = '---- Quilt Loader: Failed to load ----'
const QUILT_REQUIRES = /^(.+?) requires (any version|version (.+?)) of ([^\s,]+), (which is missing!|but only wrong versions are present:)$/
const QUILT_BREAKS = /^(.+?) breaks (all versions|version (.+?)) of ([^\s,]+), which is present!$/
const QUILT_PRESENT = /^- version (\S+)(?: provided by .+?)? from (.+)$/
const QUILT_LOADED = /^(.+?) is loaded from (.+)$/
const QUILT_PATH = /^- (<mods>\/.+)$/

/** The file a Quilt path names in the mods folder, if it lies there. */
function modsFile(path: string): string | undefined {
  const m = /^<mods>\/([^!]+)/.exec(path.trim())
  if (!m) return undefined
  return m[1].split('/').pop()
}

/** "org.example:mod" names the mod "mod". */
const bareId = (id: string): string => id.slice(id.lastIndexOf(':') + 1)

/** Picks Quilt's report apart. Null when the text holds none. */
export function parseQuiltReport(text: string): LoaderReport | null {
  if (!text.includes(QUILT_MARK)) return null
  const details: Requirement[] = []
  let current: Requirement | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    let m: RegExpExecArray | null
    if (line.startsWith('-- ')) {
      current = null
    } else if ((m = QUILT_REQUIRES.exec(line))) {
      const id = bareId(m[4])
      current = {
        kind: m[5].startsWith('which') ? 'missing' : 'mismatch',
        mod: { name: m[1], id: '' },
        dep: { name: id, id },
        range: m[3] ?? 'any version',
        present: []
      }
      details.push(current)
    } else if ((m = QUILT_BREAKS.exec(line))) {
      const id = bareId(m[4])
      current = { kind: 'breaks', mod: { name: m[1], id: '' }, dep: { name: id, id }, range: m[3] ?? 'any version', present: [] }
      details.push(current)
    } else if (current && (m = QUILT_PRESENT.exec(line))) {
      current.present.push(m[1])
      current.dep.file ??= modsFile(m[2])
    } else if (current && (m = QUILT_LOADED.exec(line))) {
      if (m[1] === current.mod.name) current.mod.file ??= modsFile(m[2])
    } else if (current?.kind === 'breaks' && (m = QUILT_PATH.exec(line))) {
      current.mod.file ??= modsFile(m[1])
    }
  }

  // Quilt suggests nothing itself; each detail stands for its own step.
  return details.length > 0 ? { source: 'quilt', solutions: [], details } : null
}

// Forge and NeoForge, the same lines since Forge 1.20.1 (ModSorter).
const FORGE_MARK = /Missing or unsupported mandatory dependencies:|Unsupported installed optional dependencies:|Incompatibilities between mods:/
const FORGE_DEP = /Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^']*)'/
const FORGE_BREAKS = /Mod '([^']+)' is incompatible with '([^']+)', versions: '([^']*)'; Version found: '([^']*)'/

/** Picks the report of Forge or NeoForge apart. Null when the text holds none. */
export function parseForgeReport(text: string): LoaderReport | null {
  if (!FORGE_MARK.test(text)) return null
  const details: Requirement[] = []
  for (const line of text.split(/\r?\n/)) {
    let m: RegExpExecArray | null
    if ((m = FORGE_DEP.exec(line))) {
      const missing = m[4] === '[MISSING]'
      details.push({
        kind: missing ? 'missing' : 'mismatch',
        mod: { name: m[2], id: m[2] },
        dep: { name: m[1], id: m[1] },
        range: m[3],
        present: missing ? [] : [m[4]]
      })
    } else if ((m = FORGE_BREAKS.exec(line))) {
      details.push({ kind: 'breaks', mod: { name: m[1], id: m[1] }, dep: { name: m[2], id: m[2] }, range: m[3], present: [m[4]] })
    }
  }
  return details.length > 0 ? { source: 'forge', solutions: [], details } : null
}

/** Whichever loader's report the text holds. */
export function parseLoaderReport(text: string): LoaderReport | null {
  return parseFabricReport(text) ?? parseQuiltReport(text) ?? parseForgeReport(text)
}

function mentionsReport(text: string): boolean {
  return isFabricIncompatibility(text) || text.includes(QUILT_MARK) || FORGE_MARK.test(text)
}

/* ------------------------------------------------------------------ *
 * Versions the way the loaders compare them
 * ------------------------------------------------------------------ */

interface Semantic {
  core: number[]
  pre: string[] | null
}

/** Null for a version Fabric and Quilt would only compare as plain text. */
function parseSemantic(version: string): Semantic | null {
  const noBuild = version.split('+')[0]
  const dash = noBuild.indexOf('-')
  const core = dash >= 0 ? noBuild.slice(0, dash) : noBuild
  if (!/^\d+(\.\d+)*$/.test(core)) return null
  return { core: core.split('.').map(Number), pre: dash >= 0 ? noBuild.slice(dash + 1).split('.') : null }
}

/**
 * Fabric's and Quilt's order. Below zero when `a` is older. Build metadata
 * after "+" does not count.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseSemantic(a)
  const right = parseSemantic(b)
  if (!left || !right) return a === b ? 0 : a < b ? -1 : 1
  const length = Math.max(left.core.length, right.core.length)
  for (let i = 0; i < length; i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (diff !== 0) return diff
  }
  // A pre-release comes before its release.
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y)
    if (nx !== ny) return nx ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

// Maven's order of known qualifiers; a plain release sits at "". Unknown
// words come after all of them, among themselves alphabetically.
const QUALIFIER_RANK: Record<string, number> = {
  alpha: 0, a: 0, beta: 1, b: 1, milestone: 2, m: 2, rc: 3, cr: 3, snapshot: 4,
  '': 5, ga: 5, final: 5, release: 5, sp: 6
}

function mavenItems(version: string): (number | string)[] {
  return version
    .toLowerCase()
    .split(/[.\-_+]|(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/)
    .filter((item) => item !== '')
    .map((item) => (/^\d+$/.test(item) ? Number(item) : item))
}

/**
 * Forge's and NeoForge's order (Maven's): "1.0-beta" before "1.0", and
 * "0.5.1.f" after "0.5.1". Below zero when `a` is older.
 */
export function compareMaven(a: string, b: string): number {
  const left = mavenItems(a)
  const right = mavenItems(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i]
    const y = right[i]
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
      continue
    }
    // A number against nothing counts as against 0, against a word it wins.
    if (typeof x === 'number') {
      if (y === undefined) {
        if (x !== 0) return 1
        continue
      }
      return 1
    }
    if (typeof y === 'number') {
      if (x === undefined) {
        if (y !== 0) return -1
        continue
      }
      return -1
    }
    const wx = x ?? ''
    const wy = y ?? ''
    const diff = (QUALIFIER_RANK[wx] ?? 7) - (QUALIFIER_RANK[wy] ?? 7)
    if (diff !== 0) return diff
    if (wx !== wy) return wx < wy ? -1 : 1
  }
  return 0
}

function comparerFor(source: ReportSource): (a: string, b: string) => number {
  return source === 'forge' ? compareMaven : compareVersions
}

export interface VersionRange {
  test: (version: string) => boolean
  /** The same range in words for the interface, in both languages. */
  de: string
  en: string
}

const ANY: VersionRange = { test: () => true, de: 'eine beliebige Version', en: 'any version' }
const NONE: VersionRange = { test: () => false, de: 'keine mögliche Version', en: 'no possible version' }

/** One interval, bounds left empty where open. */
function interval(
  low: string,
  high: string,
  lowIn: boolean,
  highIn: boolean,
  compare: (a: string, b: string) => number
): VersionRange {
  if (!low && !high) return ANY
  if (low && high && low === high) {
    return { test: (v) => compare(v, low) === 0, de: `Version ${low}`, en: `version ${low}` }
  }
  const test = (v: string): boolean =>
    (!low || (lowIn ? compare(v, low) >= 0 : compare(v, low) > 0)) && (!high || (highIn ? compare(v, high) <= 0 : compare(v, high) < 0))
  if (!high) {
    return lowIn
      ? { test, de: `Version ${low} oder neuer`, en: `version ${low} or later` }
      : { test, de: `eine Version nach ${low}`, en: `a version after ${low}` }
  }
  if (!low) {
    return highIn
      ? { test, de: `Version ${high} oder älter`, en: `version ${high} or earlier` }
      : { test, de: `eine Version vor ${high}`, en: `a version before ${high}` }
  }
  return {
    test,
    de: `eine Version ${lowIn ? 'ab' : 'nach'} ${low} und ${highIn ? 'bis' : 'unter'} ${high}`,
    en: `a version ${lowIn ? 'from' : 'after'} ${low} and ${highIn ? 'up to' : 'below'} ${high}`
  }
}

function anyOf(parts: VersionRange[]): VersionRange | null {
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return {
    test: (v) => parts.some((part) => part.test(v)),
    de: parts.map((part) => part.de).join(' oder '),
    en: parts.map((part) => part.en).join(' or ')
  }
}

type Piece = [RegExp, (m: RegExpExecArray) => VersionRange]
const V = '([^\\s,]+)'

// Fabric's own wording (Messages.properties, "resolution.version.*"), the
// most specific first: "any version after" also starts with "any version".
const PIECES: Piece[] = [
  [
    new RegExp(`^any version between ${V} \\((inclusive|exclusive)\\) and ${V} \\((inclusive|exclusive)\\)`),
    (m) => interval(m[1], m[3], m[2] === 'inclusive', m[4] === 'inclusive', compareVersions)
  ],
  [new RegExp(`^any version after ${V}`), (m) => interval(m[1], '', false, false, compareVersions)],
  [new RegExp(`^any version before ${V}`), (m) => interval('', m[1], false, false, compareVersions)],
  [
    /^any (\d+)\.(\d+)\.x version/,
    (m) => ({
      test: (v) => {
        const s = parseSemantic(v)
        return !!s && s.core[0] === Number(m[1]) && (s.core[1] ?? 0) === Number(m[2])
      },
      de: `eine Version ${m[1]}.${m[2]}.x`,
      en: `a ${m[1]}.${m[2]}.x version`
    })
  ],
  [
    /^any (\d+)\.x version/,
    (m) => ({
      test: (v) => parseSemantic(v)?.core[0] === Number(m[1]),
      de: `eine Version ${m[1]}.x`,
      en: `a ${m[1]}.x version`
    })
  ],
  [/^any version/, () => ANY],
  [/^an unsatisfiable version range/, () => NONE],
  [new RegExp(`^version ${V} or later`), (m) => interval(m[1], '', true, false, compareVersions)],
  [new RegExp(`^version ${V} or earlier`), (m) => interval('', m[1], false, true, compareVersions)],
  [new RegExp(`^version ${V}`), (m) => interval(m[1], m[1], true, true, compareVersions)]
]

/**
 * Reads a range in Fabric's words, like "version 1.12.56 or later" or "any
 * 1.12.x version or version 2.0". Null for wording this does not know.
 */
export function parseRange(text: string): VersionRange | null {
  const parts: VersionRange[] = []
  let rest = text.trim()
  while (rest) {
    let matched = false
    for (const [pattern, build] of PIECES) {
      const m = pattern.exec(rest)
      if (!m) continue
      parts.push(build(m))
      rest = rest.slice(m[0].length)
      matched = true
      break
    }
    if (!matched) return null
    const separator = /^(?:, | or )/.exec(rest)
    if (separator) rest = rest.slice(separator[0].length)
    else if (rest) return null
  }
  return anyOf(parts)
}

/**
 * Reads bracket intervals, "[2.0,3.0)" or "(-?, 1.12.56]", with `open`
 * standing for a bound that is left open.
 */
function parseIntervals(text: string, compare: (a: string, b: string) => number, open: string[]): VersionRange | null {
  const parts: VersionRange[] = []
  const pattern = /([[(])\s*([^,[\]()]*?)\s*(?:,\s*([^,[\]()]*?)\s*)?([\])])/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text))) {
    const bound = (raw: string): string => (open.includes(raw) ? '' : raw)
    const low = bound(m[2])
    // "[1.0]" is exactly that version.
    const high = m[3] === undefined ? low : bound(m[3])
    parts.push(interval(low, high, m[1] === '[', m[4] === ']', compare))
  }
  return anyOf(parts)
}

/**
 * Reads a Maven range as Forge and NeoForge print it. A bare version without
 * brackets is only a recommendation and accepts any version.
 */
export function parseMavenRange(text: string): VersionRange | null {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '*' || !/[[(]/.test(trimmed)) return ANY
  return parseIntervals(trimmed, compareMaven, [''])
}

/** Reads a range in Quilt's notation, "[0.20.0, ?)" or "{ [1, 2) U [3, ?) }". */
export function parseQuiltRange(text: string): VersionRange | null {
  const trimmed = text.trim()
  if (trimmed === 'any version') return ANY
  if (trimmed.includes('<empty set>')) return NONE
  return parseIntervals(trimmed, compareVersions, ['', '-?', '?'])
}

export function rangeFor(source: ReportSource, text: string): VersionRange | null {
  if (source === 'fabric') return parseRange(text)
  if (source === 'quilt') return parseQuiltRange(text)
  return parseMavenRange(text)
}

/**
 * The mod's own version inside a release name from Modrinth or CurseForge.
 *
 * Mostly the two agree ("0.92.0+1.20.1"), but some put the game version in
 * front ("mc1.20.1-0.5.3") or in the middle ("jei-1.20.1-forge-15.20.0.106"),
 * or a loader after it ("23.9.0_Fabric_1.20"). Only a pre-release word or a
 * single letter is kept after the numbers, so "0.5.3-mc1.20" does not read
 * as a pre-release of 0.5.3, while Create's "0.5.1.f" stays whole.
 */
export function modVersionOf(versionNumber: string, mcVersion: string): string | null {
  let rest = versionNumber.trim()
  rest = rest.replace(/^(?:fabric|quilt|forge|neoforge)[-_ ]/i, '')
  rest = rest.replace(/^mc\d+(?:\.\d+)+[-_]/i, '')
  const game = mcVersion.replace(/\./g, '\\.')
  rest = rest.replace(new RegExp(`(?<![\\d.])(?:mc)?${game}(?!\\d|\\.\\d)`, 'gi'), ' ')
  const m = /(\d+(?:\.\d+)+)(-(?:alpha|beta|rc|pre)[0-9A-Za-z.]*|\.[a-z](?![a-z]))?/i.exec(rest) ?? /(\d+)/.exec(rest)
  if (!m) return null
  return m[1] + (m[2] ?? '')
}

/* ------------------------------------------------------------------ *
 * Turning the report into fixes
 * ------------------------------------------------------------------ */

/** Ids the loaders use for things that are no mod in the folder. */
const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'forge', 'neoforge', 'fml', 'javafml', 'lowcodefml'])

const BUILTIN_NAMES: Record<string, string> = {
  fabricloader: 'Fabric Loader',
  'fabric-loader': 'Fabric Loader',
  quilt_loader: 'Quilt Loader',
  forge: 'Forge',
  neoforge: 'NeoForge',
  fml: 'FML',
  javafml: 'FML',
  lowcodefml: 'FML',
  minecraft: 'Minecraft',
  java: 'Java'
}

interface Finding {
  issue: CompatibilityIssue
  /** Items this finding is about and how they looked at the crash. */
  watch: Map<string, string>
  /** Minecraft version and loader at the crash; another game, other mods. */
  game?: string
  /** The loader build at the crash, for a finding that offers another one. */
  loaderVersion?: string
}

const gameOf = (instance: Instance): string => `${instance.mcVersion}|${instance.loader}`

/** Findings from the last crash, per instance, until the next start. */
const findings = new Map<string, Finding[]>()

function signature(item: ContentItem): string {
  return `${item.versionId ?? ''}|${item.fileName}|${item.enabled}`
}

/**
 * The stored findings that still apply. One goes away as soon as a mod it is
 * about was swapped, switched or removed, so a fix that worked never shows
 * the same problem again.
 */
export function crashIssues(instance: Instance): CompatibilityIssue[] {
  const stored = findings.get(instance.id)
  if (!stored) return []
  const byId = new Map(instance.content.map((item) => [item.id, item]))
  const current = stored.filter((finding) => {
    if (finding.game !== undefined && finding.game !== gameOf(instance)) return false
    if (finding.loaderVersion !== undefined && finding.loaderVersion !== instance.loaderVersion) return false
    for (const [id, seen] of finding.watch) {
      const item = byId.get(id)
      if (!item || signature(item) !== seen) return false
    }
    const fix = finding.issue.fix
    if (fix?.kind === 'install-dependency') {
      return !instance.content.some((c) => c.enabled && c.provider === fix.provider && c.projectId === fix.projectId)
    }
    return true
  })
  if (current.length !== stored.length) findings.set(instance.id, current)
  return current.map((finding) => finding.issue)
}

/** A new start makes its own report, so the last one is dropped. */
export function forgetCrash(instanceId: string): void {
  findings.delete(instanceId)
}

/**
 * The start of the game's own log file, for a report that already scrolled
 * out of the launcher's buffer. Only the head: the report comes while
 * loading, and a long session can leave a large file.
 */
async function latestLogHead(instanceId: string, startedAt: number): Promise<string> {
  const file = join(paths.gameDir(instanceId), 'logs', 'latest.log')
  try {
    const info = await stat(file)
    // Written by an earlier start, so it says nothing about this one.
    if (info.mtimeMs < startedAt - 1000) return ''
    const size = Math.min(info.size, 2 * 1024 * 1024)
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(size)
      await handle.read(buffer, 0, size, 0)
      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/**
 * Reads the output of the run that just ended and keeps what it found.
 * True when there is something to fix.
 */
export async function rememberCrash(instanceId: string, startedAt: number): Promise<boolean> {
  findings.delete(instanceId)
  let text = getLogBuffer(instanceId)
    .filter((line) => line.time >= startedAt - 1000)
    .map((line) => line.text)
    .join('\n')
  let report = parseLoaderReport(text)
  if (!report) {
    const head = await latestLogHead(instanceId, startedAt)
    const fromFile = head ? parseLoaderReport(head) : null
    if (fromFile) {
      report = fromFile
      text = head
    }
  }
  if (!report) {
    if (mentionsReport(text)) logger.info('Der Mod-Loader meldet unpassende Mods, der Bericht ließ sich aber nicht lesen')
    return false
  }
  try {
    const found = await resolveReport(getInstance(instanceId), report)
    if (found.length > 0) findings.set(instanceId, found)
    logger.info(`Absturzhilfe für ${instanceId}: ${found.length} Vorschläge aus dem Bericht (${report.source})`)
    return found.length > 0
  } catch (err) {
    logger.warn('Der Bericht des Mod-Loaders konnte nicht ausgewertet werden:', err)
    return false
  }
}

/** Whether two references from a report mean the same mod. */
function same(a: LoaderMod, b: LoaderMod): boolean {
  if (a.id && b.id) return a.id === b.id
  if (a.file && b.file) return a.file === b.file
  return flattenName(a.name) === flattenName(b.name)
}

type Finder = (ref: LoaderMod, enabled?: boolean) => ContentItem | undefined

/** Builds the findings for one report. Exported for the tests. */
export async function resolveReport(instance: Instance, given: LoaderReport): Promise<Finding[]> {
  const mods = instance.content.filter((c) => c.type === 'mod')
  const idsOf = new Map<string, string[]>()
  for (const mod of mods) {
    const ids = mod.modIds ?? (await readJarMetadata(join(paths.mods(instance.id), mod.fileName)))?.ids ?? []
    idsOf.set(mod.id, ids)
  }
  const bare = (fileName: string): string => fileName.replace(/\.disabled$/, '').toLowerCase()
  const find: Finder = (ref, enabled = true) =>
    mods.find((m) => m.enabled === enabled && ref.file !== undefined && bare(m.fileName) === ref.file.toLowerCase()) ??
    mods.find((m) => m.enabled === enabled && ref.id !== '' && (idsOf.get(m.id) ?? []).includes(ref.id)) ??
    mods.find(
      (m) =>
        m.enabled === enabled &&
        (flattenName(m.name) === flattenName(ref.name) || (ref.id !== '' && flattenName(m.name) === flattenName(ref.id)))
    )

  // Forge and Quilt name some mods by id only. The mod list's name reads
  // better in the sentence, so it takes over wherever the mod is installed.
  const label = (ref: LoaderMod): LoaderMod => {
    if (BUILTIN.has(ref.id)) return { ...ref, name: BUILTIN_NAMES[ref.id] ?? ref.name }
    if (ref.id === '' || ref.name !== ref.id) return ref
    const item = find(ref) ?? find(ref, false)
    return item ? { ...ref, name: item.name } : ref
  }
  const report: LoaderReport = {
    source: given.source,
    details: given.details.map((d) => ({ ...d, mod: label(d.mod), dep: label(d.dep) })),
    solutions: given.solutions.map((s) => ({ ...s, mod: label(s.mod) }))
  }

  // Only Fabric names solutions. Otherwise each detail stands for the step
  // it implies; a declared conflict asks for another version of the mod that
  // declares it, as Fabric itself answers it.
  const named: Solution[] =
    report.solutions.length > 0
      ? report.solutions
      : report.details.map((d): Solution =>
          d.kind === 'mismatch'
            ? { kind: 'replace', mod: { ...d.dep, version: d.present[0] }, range: d.range }
            : d.kind === 'missing'
              ? { kind: 'install', mod: d.dep, range: d.range }
              : { kind: 'refit', mod: d.mod }
        )
  // "Replace Minecraft with version 1.20.1" is the literal answer to a mod
  // built for another game version. Swapping the mod for its build for this
  // game is the step that helps.
  const solutions = named.flatMap((solution): Solution[] => {
    if (solution.kind !== 'replace' || solution.mod.id !== 'minecraft') return [solution]
    const askers = report.details.filter((d) => d.kind === 'mismatch' && d.dep.id === 'minecraft')
    return askers.length > 0 ? askers.map((d) => ({ kind: 'refit', mod: d.mod })) : [solution]
  })

  const out: Finding[] = []
  const seen = new Set<string>()
  for (const solution of solutions) {
    const key = `${solution.kind}:${solution.mod.id || solution.mod.file || flattenName(solution.mod.name)}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const finding = await resolveSolution(instance, report, solution, find)
      if (finding) out.push({ ...finding, game: gameOf(instance) })
    } catch (err) {
      logger.warn(`Vorschlag für ${solution.mod.id || solution.mod.name} nicht ausgewertet:`, err)
    }
  }
  return out
}

function withWatch(issue: CompatibilityIssue, items: (ContentItem | undefined)[]): Finding {
  const watch = new Map<string, string>()
  for (const item of items) if (item) watch.set(item.id, signature(item))
  return { issue, watch }
}

/** Fits the instance's game and loader, by the rule the install uses. */
function fitsInstance(instance: Instance, version: ProjectVersion): boolean {
  const gameOk = version.gameVersions.length === 0 || version.gameVersions.some((g) => gameVersionMatches(instance.mcVersion, g))
  const loaderOk =
    version.loaders.length === 0 ||
    version.loaders.includes(instance.loader) ||
    (instance.loader === 'quilt' && version.loaders.includes('fabric'))
  return gameOk && loaderOk
}

/** Stable per step, so the same problem keeps its row between checks. */
function issueId(solution: Solution): string {
  return `crash-${solution.kind}-${solution.mod.id || solution.mod.file || flattenName(solution.mod.name)}`
}

async function resolveSolution(
  instance: Instance,
  report: LoaderReport,
  solution: Solution,
  find: Finder
): Promise<Finding | null> {
  const id = issueId(solution)

  if (solution.kind === 'replace') {
    // Who asked for it, for the sentence. The details name it.
    const reason = report.details.find((d) => d.kind === 'mismatch' && same(d.dep, solution.mod))
    const requirer = reason ? find(reason.mod) : undefined
    const range = rangeFor(report.source, solution.range)
    const wanted = range ? tr(range.de, range.en) : solution.range
    const who = reason?.mod.name ?? tr('Ein anderer Mod', 'Another mod')
    const target = find(solution.mod)
    const installed = solution.mod.version ?? reason?.present[0] ?? '?'

    if (BUILTIN.has(solution.mod.id)) {
      const fix = range ? await loaderFix(instance, solution.mod.id, range, comparerFor(report.source)) : undefined
      const finding = withWatch(builtinIssue(id, solution.mod, who, wanted, installed, requirer, fix), [requirer])
      // Gone once the instance is on another build, whichever way it got there.
      if (fix) finding.loaderVersion = instance.loaderVersion
      return finding
    }

    const title = tr(`${who} braucht ${solution.mod.name}: ${wanted}`, `${who} needs ${solution.mod.name}: ${wanted}`)
    const told = tr(
      `Installiert ist ${installed}, deshalb hat ${loaderName(instance.loader)} den Start abgebrochen.`,
      `${installed} is installed, so ${loaderName(instance.loader)} stopped the launch.`
    )

    if (!target || target.provider === 'local' || !target.projectId) {
      return withWatch(
        {
          id,
          severity: 'error',
          title,
          detail: `${told} ${tr(
            `${solution.mod.name} wurde von Hand hinzugefügt. Lade die passende Version selbst herunter und ersetze die Datei.`,
            `${solution.mod.name} was added by hand. Download the fitting version yourself and replace the file.`
          )}`,
          contentId: target?.id
        },
        [target, requirer]
      )
    }

    const provider = target.provider as 'modrinth' | 'curseforge'
    const pick = range ? await versionInRange(instance, target, provider, installed, range, comparerFor(report.source)) : null
    if (pick) {
      return withWatch(
        {
          id,
          severity: 'error',
          title,
          detail: `${told} ${tr(
            `${target.name} ${pick.versionNumber} passt und bleibt danach auf dieser Version, bis du Updates wieder zulässt.`,
            `${target.name} ${pick.versionNumber} fits and stays on that version until you allow updates again.`
          )}`,
          contentId: target.id,
          fix: {
            kind: 'install-version',
            label: tr(`Auf ${pick.versionNumber} wechseln`, `Switch to ${pick.versionNumber}`),
            provider,
            projectId: target.projectId,
            contentId: target.id,
            versionId: pick.versionId
          }
        },
        [target, requirer]
      )
    }

    return withWatch(
      {
        id,
        severity: 'error',
        title,
        detail: `${told} ${tr(
          `Eine passende Version von ${target.name} für Minecraft ${instance.mcVersion} ließ sich nicht sicher bestimmen. Wähle sie per Rechtsklick auf ${target.name} unter „Version wählen…“.`,
          `A fitting version of ${target.name} for Minecraft ${instance.mcVersion} could not be determined for sure. Pick it by right-clicking ${target.name} and choosing "Choose version…".`
        )}`,
        contentId: target.id,
        fix:
          requirer && requirer.id !== target.id
            ? { kind: 'disable-content', label: tr(`${requirer.name} ausschalten`, `Switch off ${requirer.name}`), contentId: requirer.id }
            : undefined
      },
      [target, requirer]
    )
  }

  if (solution.kind === 'refit') {
    const target = find(solution.mod)
    if (!target) return null
    const needs = report.details
      .filter((d) => d.kind === 'mismatch' && same(d.mod, solution.mod))
      .map((d) => {
        const range = rangeFor(report.source, d.range)
        return `${d.dep.name} ${range ? tr(range.de, range.en) : d.range}`
      })
    // A declared conflict is answered the same way: a version of the mod
    // that no longer names the other one.
    const clash = report.details.find((d) => d.kind === 'breaks' && same(d.mod, solution.mod))
    const why = clash
      ? tr(
          `Laut seinen Entwicklern verträgt sich ${target.name} nicht mit ${clash.dep.name}.`,
          `According to its developers ${target.name} does not work with ${clash.dep.name}.`
        )
      : needs.length
        ? tr(`${target.name} verlangt ${needs.join(', ')}.`, `${target.name} asks for ${needs.join(', ')}.`)
        : tr(`${target.name} passt nicht zu dieser Instanz.`, `${target.name} does not fit this instance.`)
    const title = clash
      ? tr(`${target.name} verträgt sich nicht mit ${clash.dep.name}`, `${target.name} does not work with ${clash.dep.name}`)
      : tr(`${target.name} passt nicht zu Minecraft ${instance.mcVersion}`, `${target.name} does not fit Minecraft ${instance.mcVersion}`)

    if (target.provider !== 'local' && target.projectId) {
      const provider = target.provider as 'modrinth' | 'curseforge'
      const best = await bestVersionFor(provider, target.projectId, instance.mcVersion, instance.loader, 'mod')
      if (best && best.versionId !== target.versionId) {
        return withWatch(
          {
            id,
            severity: 'error',
            title,
            detail: `${why} ${
              clash
                ? tr(`Version ${best.versionNumber} ist neuer und kann das beheben.`, `Version ${best.versionNumber} is newer and may fix this.`)
                : tr(`Version ${best.versionNumber} ist für diese Instanz gebaut.`, `Version ${best.versionNumber} is built for this instance.`)
            }`,
            contentId: target.id,
            fix: {
              kind: 'install-version',
              label: tr(`Auf ${best.versionNumber} wechseln`, `Switch to ${best.versionNumber}`),
              provider,
              projectId: target.projectId,
              contentId: target.id,
              versionId: best.versionId
            }
          },
          [target]
        )
      }
    }
    return withWatch(
      {
        id,
        severity: 'error',
        title,
        detail: `${why} ${
          clash
            ? tr(`Ohne ${target.name} startet das Spiel.`, `The game starts without ${target.name}.`)
            : tr(
                `Für Minecraft ${instance.mcVersion} gibt es keine passende Version, ohne ${target.name} startet das Spiel.`,
                `There is no fitting version for Minecraft ${instance.mcVersion}, the game starts without ${target.name}.`
              )
        }`,
        contentId: target.id,
        fix: { kind: 'disable-content', label: tr(`${target.name} ausschalten`, `Switch off ${target.name}`), contentId: target.id }
      },
      [target]
    )
  }

  if (solution.kind === 'install') {
    if (BUILTIN.has(solution.mod.id)) return null
    const reason = report.details.find((d) => d.kind === 'missing' && same(d.dep, solution.mod))
    const requirer = reason ? find(reason.mod) : undefined
    const who = reason?.mod.name ?? tr('Ein Mod', 'A mod')
    // Fabric and Forge only know the bare id of a mod that is not there.
    const titleFor = (name: string): string => tr(`${who} braucht ${name}`, `${who} needs ${name}`)

    const switchedOff = find(solution.mod, false)
    if (switchedOff) {
      return withWatch(
        {
          id,
          severity: 'error',
          title: titleFor(switchedOff.name),
          detail: tr(`${switchedOff.name} ist installiert, aber ausgeschaltet.`, `${switchedOff.name} is installed but switched off.`),
          contentId: switchedOff.id,
          fix: { kind: 'enable-content', label: tr(`${switchedOff.name} einschalten`, `Switch on ${switchedOff.name}`), contentId: switchedOff.id }
        },
        [switchedOff, requirer]
      )
    }

    // A mod's id is very often its project slug on Modrinth ("fabric-api"),
    // with Forge's underscores as dashes ("cloth_config", "cloth-config").
    // Offered only when that project really has a build for this instance.
    let project: { id: string; name: string } | null = null
    for (const slug of new Set([solution.mod.id, solution.mod.id.replace(/_/g, '-')])) {
      try {
        const found = await modrinth.getProject(slug)
        const fits = await bestVersionFor('modrinth', found.projectId, instance.mcVersion, instance.loader, 'mod')
        if (fits) {
          project = { id: found.projectId, name: found.name }
          break
        }
      } catch {
        // not a slug there
      }
    }
    return withWatch(
      {
        id,
        severity: 'error',
        title: titleFor(project?.name ?? solution.mod.name),
        detail: project
          ? tr(`${project.name} fehlt in dieser Instanz.`, `${project.name} is missing from this instance.`)
          : tr(
              `${solution.mod.name} fehlt in dieser Instanz. Suche es unter „Inhalte finden“ und installiere es.`,
              `${solution.mod.name} is missing from this instance. Look for it under "Find content" and install it.`
            ),
        contentId: requirer?.id,
        fix: project
          ? { kind: 'install-dependency', label: tr(`${project.name} installieren`, `Install ${project.name}`), provider: 'modrinth', projectId: project.id }
          : undefined
      },
      [requirer]
    )
  }

  // remove
  const target = find(solution.mod)
  if (!target) return null
  const clash = report.details.find((d) => d.kind === 'breaks' && (same(d.dep, solution.mod) || same(d.mod, solution.mod)))
  return withWatch(
    {
      id,
      severity: 'error',
      title: tr(`${target.name} verhindert den Start`, `${target.name} prevents the launch`),
      detail: clash
        ? tr(
            `${clash.mod.name} verträgt sich laut seinen Entwicklern nicht mit ${clash.dep.name}. Ohne ${target.name} startet das Spiel.`,
            `According to its developers ${clash.mod.name} does not work with ${clash.dep.name}. The game starts without ${target.name}.`
          )
        : tr(
            `${loaderName(instance.loader)} empfiehlt, ${target.name} zu entfernen.`,
            `${loaderName(instance.loader)} recommends removing ${target.name}.`
          ),
      contentId: target.id,
      fix: { kind: 'disable-content', label: tr(`${target.name} ausschalten`, `Switch off ${target.name}`), contentId: target.id }
    },
    [target]
  )
}

const LOADER_FULL_NAMES: Partial<Record<LoaderId, string>> = {
  fabric: 'Fabric Loader',
  quilt: 'Quilt Loader',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** Whether `id` from a report names the instance's own loader. */
function namesOwnLoader(loader: LoaderId, id: string): boolean {
  switch (loader) {
    case 'fabric':
      return id === 'fabricloader' || id === 'fabric-loader'
    case 'quilt':
      return id === 'quilt_loader' || id === 'fabricloader' || id === 'fabric-loader'
    case 'forge':
      // Forge's language provider carries Forge's own major version.
      return id === 'forge' || id === 'javafml'
    case 'neoforge':
      return id === 'neoforge'
    default:
      return false
  }
}

/**
 * A build of the instance's own loader for its Minecraft version that the
 * mod accepts: the newest stable one, else the newest at all. Undefined when
 * the report is about something else, nothing fits, or the instance already
 * uses the build found.
 */
async function loaderFix(
  instance: Instance,
  id: string,
  range: VersionRange,
  compare: (a: string, b: string) => number
): Promise<CompatibilityIssue['fix']> {
  if (!namesOwnLoader(instance.loader, id)) return undefined
  let builds: LoaderVersion[]
  try {
    builds = await listLoaderVersions(instance.loader, instance.mcVersion)
  } catch (err) {
    logger.warn(`Versionen von ${instance.loader} für ${instance.mcVersion} nicht geladen:`, err)
    return undefined
  }
  // Forge lists builds as "1.20.1-47.2.0", the mod asks for "47.2.0".
  const own = (version: string): string => modVersionOf(version, instance.mcVersion) ?? version
  // Quilt reports the Fabric Loader version it stands in for, which is not
  // its own number. Its newest build is the best answer there.
  const standIn = instance.loader === 'quilt' && id !== 'quilt_loader'
  const fitting = builds
    .filter((build) => standIn || range.test(own(build.version)))
    .sort((a, b) => compare(own(b.version), own(a.version)))
  const pick = fitting.find((build) => build.stable) ?? fitting[0]
  if (!pick) return undefined
  const current = instance.loaderVersion
  const diff = current ? compare(own(pick.version), own(current)) : 1
  if (diff === 0 || (standIn && diff < 0)) return undefined
  const name = LOADER_FULL_NAMES[instance.loader] ?? instance.loader
  return {
    kind: 'change-loader',
    label:
      diff > 0
        ? tr(`${name} auf ${pick.version} aktualisieren`, `Update ${name} to ${pick.version}`)
        : tr(`${name} auf ${pick.version} wechseln`, `Switch ${name} to ${pick.version}`),
    loaderVersion: pick.version
  }
}

/** Minecraft, Java or the loader is what does not fit. No file to swap. */
function builtinIssue(
  id: string,
  mod: LoaderMod,
  who: string,
  wanted: string,
  installed: string,
  requirer: ContentItem | undefined,
  loaderChange?: CompatibilityIssue['fix']
): CompatibilityIssue {
  const title = tr(`${who} braucht ${mod.name}: ${wanted}`, `${who} needs ${mod.name}: ${wanted}`)
  if (loaderChange) {
    return {
      id,
      severity: 'error',
      title,
      detail: tr(
        `Installiert ist ${installed}. Version ${loaderChange.loaderVersion} passt, deine Mods bleiben dabei, wie sie sind. Der neue Loader wird beim nächsten Start geladen.`,
        `${installed} is installed. Version ${loaderChange.loaderVersion} fits, your mods stay as they are. The new loader is downloaded on the next start.`
      ),
      contentId: requirer?.id,
      fix: loaderChange
    }
  }
  const detail =
    mod.id === 'java'
      ? tr(
          `Gestartet wurde mit Java ${installed}. Wähle in den Einstellungen der Instanz unter Java eine passende Version.`,
          `The game started with Java ${installed}. Pick a fitting version under Java in the instance settings.`
        )
      : mod.id === 'minecraft'
        ? tr(
            `Diese Instanz nutzt Minecraft ${installed}. Wähle per Rechtsklick auf ${who} unter „Version wählen…“ eine Version für ${installed}.`,
            `This instance uses Minecraft ${installed}. Right-click ${who} and pick a version for ${installed} under "Choose version…".`
          )
        : tr(
            `Installiert ist ${installed}. Stelle die Instanz per Rechtsklick unter „Version ändern“ auf eine neuere Version des Mod-Loaders.`,
            `${installed} is installed. Move the instance to a newer version of the mod loader by right-clicking it and choosing "Change version".`
          )
  return {
    id,
    severity: 'error',
    title,
    detail,
    contentId: requirer?.id,
    fix:
      mod.id === 'minecraft' && requirer && requirer.provider !== 'local' && requirer.projectId
        ? {
            kind: 'update-content',
            label: tr('Passende Version suchen', 'Find matching version'),
            contentId: requirer.id,
            projectId: requirer.projectId,
            provider: requirer.provider
          }
        : undefined
  }
}

/**
 * The newest release of `target` for this instance whose own version lies in
 * `range`. Null when the release names do not reliably carry the mod's own
 * version: the installed one is checked first, and if its release name does
 * not read as the version the loader saw, no guess is made.
 */
async function versionInRange(
  instance: Instance,
  target: ContentItem,
  provider: 'modrinth' | 'curseforge',
  installed: string,
  range: VersionRange,
  compare: (a: string, b: string) => number
): Promise<ProjectVersion | null> {
  const own = modVersionOf(target.version, instance.mcVersion)
  if (!own || compare(own, installed) !== 0) {
    logger.info(`${target.name}: Versionsname "${target.version}" passt nicht zu "${installed}" laut Mod-Loader, keine Auswahl`)
    return null
  }
  const all = await getVersions(provider, target.projectId as string)
  const fitting = all
    .filter((v) => fitsInstance(instance, v))
    .filter((v) => {
      const version = modVersionOf(v.versionNumber, instance.mcVersion)
      return version !== null && range.test(version)
    })
    .sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime())
  return fitting.find((v) => v.releaseType === 'release') ?? fitting[0] ?? null
}
