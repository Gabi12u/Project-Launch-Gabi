/**
 * Reads why Fabric refused to start and turns it into fixes.
 *
 * When mods do not fit together, Fabric Loader stops before the game window
 * opens and prints exactly what is wrong, down to the version another mod
 * needs ("requires version 1.12.56 or later of mod ..., but only the wrong
 * version is present: 1.13.1!"). The launcher only ever said "probably a
 * mod", and the player had to find that line in the log and pick the right
 * version by hand.
 *
 * After such a crash this reads those lines, finds the installed mod each one
 * names and the version that satisfies it, and hands the result to the
 * compatibility check. The next Play click then offers the fix like any other
 * problem, with "Automatisch beheben" swapping the version in.
 *
 * Only Fabric's English messages are read. Fabric translates them into a few
 * other languages (not German), chosen by the system language; a crash in one
 * of those keeps the general hint.
 */
import { join } from 'node:path'
import type { CompatibilityIssue, ContentItem, Instance, ProjectVersion } from '@shared/types'
import { tr } from '@shared/i18n'
import { getLogBuffer } from './instanceLog'
import { getInstance } from './instances'
import { readJarMetadata } from './modMetadata'
import { gameVersionMatches } from './gameVersions'
import { bestVersionFor, getVersions, modrinth } from '../providers'
import { paths } from '../paths'
import { log } from '../logger'

const logger = log('crashHelp')

/**
 * The rule of compat.ts's `flattenName`. Not imported from there: compat.ts
 * reads `crashIssues` from this module, and the two would form a cycle.
 */
const flattenName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/* ------------------------------------------------------------------ *
 * Reading Fabric's report
 * ------------------------------------------------------------------ */

export interface FabricMod {
  name: string
  id: string
  version?: string
}

/** One line under "More details:". */
export interface FabricRequirement {
  kind: 'mismatch' | 'missing' | 'breaks'
  /** The mod that has the requirement. */
  mod: FabricMod
  /** The mod it requires or refuses. */
  dep: FabricMod
  range: string
  /** Versions of `dep` that are present, for `mismatch` and `breaks`. */
  present: string[]
}

/** One line under "A potential solution has been determined". */
export type FabricSolution =
  | { kind: 'replace'; mod: FabricMod; range: string }
  | { kind: 'refit'; mod: FabricMod }
  | { kind: 'install'; mod: FabricMod; range: string }
  | { kind: 'remove'; mod: FabricMod }

export interface FabricReport {
  solutions: FabricSolution[]
  details: FabricRequirement[]
}

// "Mod 'Name' (id)" for a mod, "'Name' (id)" for Minecraft, Java and the
// loader itself. A name can hold an apostrophe ("Xaero's Minimap"), so the
// name runs up to the quote that is followed by the id in brackets.
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
export function parseFabricReport(text: string): FabricReport | null {
  if (!isFabricIncompatibility(text)) return null
  const solutions: FabricSolution[] = []
  const details: FabricRequirement[] = []

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
  return { solutions, details }
}

/* ------------------------------------------------------------------ *
 * Versions the way Fabric compares them
 * ------------------------------------------------------------------ */

interface Semantic {
  core: number[]
  pre: string[] | null
}

/** Null for a version Fabric would only compare as plain text. */
function parseSemantic(version: string): Semantic | null {
  const noBuild = version.split('+')[0]
  const dash = noBuild.indexOf('-')
  const core = dash >= 0 ? noBuild.slice(0, dash) : noBuild
  if (!/^\d+(\.\d+)*$/.test(core)) return null
  return { core: core.split('.').map(Number), pre: dash >= 0 ? noBuild.slice(dash + 1).split('.') : null }
}

/** Below zero when `a` is older. Build metadata after "+" does not count. */
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

export interface VersionRange {
  test: (version: string) => boolean
  /** The same range in words for the interface, in both languages. */
  de: string
  en: string
}

type Piece = [RegExp, (m: RegExpExecArray) => VersionRange]
const V = '([^\\s,]+)'

// Fabric's own wording (Messages.properties, "resolution.version.*"), the
// most specific first: "any version after" also starts with "any version".
const PIECES: Piece[] = [
  [
    new RegExp(`^any version between ${V} \\((inclusive|exclusive)\\) and ${V} \\((inclusive|exclusive)\\)`),
    (m) => {
      const lowIn = m[2] === 'inclusive'
      const highIn = m[4] === 'inclusive'
      return {
        test: (v) => {
          const low = compareVersions(v, m[1])
          const high = compareVersions(v, m[3])
          return (lowIn ? low >= 0 : low > 0) && (highIn ? high <= 0 : high < 0)
        },
        de: `eine Version ab ${m[1]}${lowIn ? '' : ' (ohne diese)'} und ${highIn ? 'bis' : 'unter'} ${m[3]}`,
        en: `a version from ${m[1]}${lowIn ? '' : ' (exclusive)'} and ${highIn ? 'up to' : 'below'} ${m[3]}`
      }
    }
  ],
  [
    new RegExp(`^any version after ${V}`),
    (m) => ({ test: (v) => compareVersions(v, m[1]) > 0, de: `eine Version nach ${m[1]}`, en: `a version after ${m[1]}` })
  ],
  [
    new RegExp(`^any version before ${V}`),
    (m) => ({ test: (v) => compareVersions(v, m[1]) < 0, de: `eine Version vor ${m[1]}`, en: `a version before ${m[1]}` })
  ],
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
  [/^any version/, () => ({ test: () => true, de: 'eine beliebige Version', en: 'any version' })],
  [/^an unsatisfiable version range/, () => ({ test: () => false, de: 'keine mögliche Version', en: 'no possible version' })],
  [
    new RegExp(`^version ${V} or later`),
    (m) => ({ test: (v) => compareVersions(v, m[1]) >= 0, de: `Version ${m[1]} oder neuer`, en: `version ${m[1]} or later` })
  ],
  [
    new RegExp(`^version ${V} or earlier`),
    (m) => ({ test: (v) => compareVersions(v, m[1]) <= 0, de: `Version ${m[1]} oder älter`, en: `version ${m[1]} or earlier` })
  ],
  [new RegExp(`^version ${V}`), (m) => ({ test: (v) => compareVersions(v, m[1]) === 0, de: `Version ${m[1]}`, en: `version ${m[1]}` })]
]

/**
 * Reads a range like "version 1.12.56 or later" or "any 1.12.x version or
 * version 2.0". Null for wording this does not know.
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
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return {
    test: (v) => parts.some((part) => part.test(v)),
    de: parts.map((part) => part.de).join(' oder '),
    en: parts.map((part) => part.en).join(' or ')
  }
}

/**
 * The mod's own version inside a release name from Modrinth or CurseForge.
 *
 * Mostly the two agree ("0.92.0+1.20.1"), but some put the game version in
 * front ("mc1.20.1-0.5.3") or a loader after it ("23.9.0_Fabric_1.20").
 * Only a pre-release word is kept after a dash, so "0.5.3-mc1.20" does not
 * read as a pre-release of 0.5.3.
 */
export function modVersionOf(versionNumber: string, mcVersion: string): string | null {
  let rest = versionNumber.trim()
  rest = rest.replace(/^(?:fabric|quilt)[-_ ]/i, '')
  rest = rest.replace(/^mc\d+(?:\.\d+)+[-_]/i, '')
  if (rest.startsWith(`${mcVersion}-`)) rest = rest.slice(mcVersion.length + 1)
  const m = /(\d+(?:\.\d+)+)(-(?:alpha|beta|rc|pre)[0-9A-Za-z.]*)?/i.exec(rest) ?? /(\d+)/.exec(rest)
  if (!m) return null
  return m[1] + (m[2] ?? '')
}

/* ------------------------------------------------------------------ *
 * Turning the report into fixes
 * ------------------------------------------------------------------ */

/** Ids Fabric uses for things that are no mod in the folder. */
const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader'])

interface Finding {
  issue: CompatibilityIssue
  /** Items this finding is about and how they looked at the crash. */
  watch: Map<string, string>
}

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
 * Reads the output of the run that just crashed and keeps what it found.
 * True when there is something to fix.
 */
export async function rememberCrash(instanceId: string, startedAt: number): Promise<boolean> {
  findings.delete(instanceId)
  const text = getLogBuffer(instanceId)
    .filter((line) => line.time >= startedAt - 1000)
    .map((line) => line.text)
    .join('\n')
  const report = parseFabricReport(text)
  if (!report) {
    if (isFabricIncompatibility(text)) logger.info('Fabric meldet unpassende Mods, der Bericht ließ sich aber nicht lesen')
    return false
  }
  try {
    const found = await resolveReport(getInstance(instanceId), report)
    if (found.length > 0) findings.set(instanceId, found)
    logger.info(`Absturzhilfe für ${instanceId}: ${found.length} Vorschläge aus Fabrics Bericht`)
    return found.length > 0
  } catch (err) {
    logger.warn('Fabrics Bericht konnte nicht ausgewertet werden:', err)
    return false
  }
}

/** Builds the findings for one report. Exported for the tests. */
export async function resolveReport(instance: Instance, report: FabricReport): Promise<Finding[]> {
  const mods = instance.content.filter((c) => c.type === 'mod')
  const idsOf = new Map<string, string[]>()
  for (const mod of mods) {
    const ids = mod.modIds ?? (await readJarMetadata(join(paths.mods(instance.id), mod.fileName)))?.ids ?? []
    idsOf.set(mod.id, ids)
  }
  const find = (ref: FabricMod, enabled = true): ContentItem | undefined =>
    mods.find((m) => m.enabled === enabled && (idsOf.get(m.id) ?? []).includes(ref.id)) ??
    mods.find((m) => m.enabled === enabled && (flattenName(m.name) === flattenName(ref.name) || flattenName(m.name) === flattenName(ref.id)))

  // Fabric sometimes names no solution at all, only the details. Each detail
  // then stands for the step it implies.
  const named: FabricSolution[] =
    report.solutions.length > 0
      ? report.solutions
      : report.details.map((d): FabricSolution =>
          d.kind === 'mismatch'
            ? { kind: 'replace', mod: { ...d.dep, version: d.present[0] }, range: d.range }
            : d.kind === 'missing'
              ? { kind: 'install', mod: d.dep, range: d.range }
              : { kind: 'remove', mod: { ...d.dep, version: d.present[0] } }
        )
  // "Replace Minecraft with version 1.20.1" is Fabric's literal answer to a
  // mod built for another game version. Swapping the mod for its build for
  // this game is the step that helps.
  const solutions = named.flatMap((solution): FabricSolution[] => {
    if (solution.kind !== 'replace' || solution.mod.id !== 'minecraft') return [solution]
    const askers = report.details.filter((d) => d.kind === 'mismatch' && d.dep.id === 'minecraft')
    return askers.length > 0 ? askers.map((d) => ({ kind: 'refit', mod: d.mod })) : [solution]
  })

  const out: Finding[] = []
  const seen = new Set<string>()
  for (const solution of solutions) {
    const key = `${solution.kind}:${solution.mod.id}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const finding = await resolveSolution(instance, report, solution, find)
      if (finding) out.push(finding)
    } catch (err) {
      logger.warn(`Vorschlag für ${solution.mod.id} nicht ausgewertet:`, err)
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

async function resolveSolution(
  instance: Instance,
  report: FabricReport,
  solution: FabricSolution,
  find: (ref: FabricMod, enabled?: boolean) => ContentItem | undefined
): Promise<Finding | null> {
  const id = `crash-${solution.kind}-${solution.mod.id}`

  if (solution.kind === 'replace') {
    // Who asked for it, for the sentence. Fabric names it in the details.
    const reason = report.details.find((d) => d.kind === 'mismatch' && d.dep.id === solution.mod.id)
    const requirer = reason ? find(reason.mod) : undefined
    const range = parseRange(solution.range)
    const wanted = range ? tr(range.de, range.en) : solution.range
    const who = reason?.mod.name ?? tr('Ein anderer Mod', 'Another mod')
    const target = find(solution.mod)
    const installed = solution.mod.version ?? reason?.present[0] ?? '?'

    if (BUILTIN.has(solution.mod.id)) {
      return withWatch(builtinIssue(id, solution.mod, who, wanted, installed, requirer), [requirer])
    }

    const title = tr(`${who} braucht ${solution.mod.name}: ${wanted}`, `${who} needs ${solution.mod.name}: ${wanted}`)
    const told = tr(
      `Installiert ist ${installed}, deshalb hat Fabric den Start abgebrochen.`,
      `${installed} is installed, so Fabric stopped the launch.`
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
    const pick = range ? await versionInRange(instance, target, provider, installed, range) : null
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
      .filter((d) => d.mod.id === solution.mod.id && d.kind === 'mismatch')
      .map((d) => {
        const range = parseRange(d.range)
        return `${d.dep.name} ${range ? tr(range.de, range.en) : d.range}`
      })
    // Fabric answers a declared conflict the same way: a version of the mod
    // that no longer names the other one.
    const clash = report.details.find((d) => d.kind === 'breaks' && d.mod.id === solution.mod.id)
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
    const reason = report.details.find((d) => d.kind === 'missing' && d.dep.id === solution.mod.id)
    const requirer = reason ? find(reason.mod) : undefined
    const who = reason?.mod.name ?? tr('Ein Mod', 'A mod')
    // Fabric only knows the bare id of a mod that is not there.
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

    // A mod's id is very often its project slug on Modrinth ("fabric-api").
    // Offered only when that project really has a build for this instance.
    let project: { id: string; name: string } | null = null
    try {
      const found = await modrinth.getProject(solution.mod.id)
      const fits = await bestVersionFor('modrinth', found.projectId, instance.mcVersion, instance.loader, 'mod')
      if (fits) project = { id: found.projectId, name: found.name }
    } catch {
      project = null
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
  const clash = report.details.find((d) => d.kind === 'breaks' && (d.dep.id === solution.mod.id || d.mod.id === solution.mod.id))
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
        : tr(`Fabric empfiehlt, ${target.name} zu entfernen.`, `Fabric recommends removing ${target.name}.`),
      contentId: target.id,
      fix: { kind: 'disable-content', label: tr(`${target.name} ausschalten`, `Switch off ${target.name}`), contentId: target.id }
    },
    [target]
  )
}

/** Minecraft, Java or the loader is what does not fit. No file to swap. */
function builtinIssue(
  id: string,
  mod: FabricMod,
  who: string,
  wanted: string,
  installed: string,
  requirer: ContentItem | undefined
): CompatibilityIssue {
  const title = tr(`${who} braucht ${mod.name}: ${wanted}`, `${who} needs ${mod.name}: ${wanted}`)
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
            `Diese Instanz nutzt ${mod.name} ${installed}. Stelle sie per Rechtsklick auf die Instanz unter „Version ändern“ auf einen neueren Loader.`,
            `This instance uses ${mod.name} ${installed}. Move it to a newer loader by right-clicking the instance and choosing "Change version".`
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
 * not read as the version Fabric saw, no guess is made.
 */
async function versionInRange(
  instance: Instance,
  target: ContentItem,
  provider: 'modrinth' | 'curseforge',
  installed: string,
  range: VersionRange
): Promise<ProjectVersion | null> {
  const own = modVersionOf(target.version, instance.mcVersion)
  if (!own || compareVersions(own, installed) !== 0) {
    logger.info(`${target.name}: Versionsname "${target.version}" passt nicht zu Fabrics "${installed}", keine Auswahl`)
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
