/**
 * Fabric's order of versions, and the version predicates a `fabric.mod.json`
 * writes (">=0.19.5", "~1.2", "1.20.x"). Apart from crash help, so updates
 * and installs can read them without importing all of it.
 */
import { tr } from '@shared/i18n'

export interface Semantic {
  core: number[]
  pre: string[] | null
}

/** Null for a version Fabric and Quilt would only compare as plain text. */
export function parseSemantic(version: string): Semantic | null {
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

/** One predicate part such as ">=0.19.5". Null for a form this does not read. */
function satisfiesPart(version: string, part: string): boolean | null {
  if (part === '*') return true
  const match = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(part)
  if (!match) return null
  const op = match[1] ?? ''
  const target = match[2]
  const own = parseSemantic(version)
  if (!own) return null

  // "1.20.x": the parts before the wildcard must match.
  const pieces = target.split('.')
  const wildcard = pieces.findIndex((piece) => /^[xX*]$/.test(piece))
  if (wildcard >= 0) {
    if (op !== '' && op !== '=') return null
    const fixed = pieces.slice(0, wildcard).map(Number)
    if (fixed.some((n) => !Number.isInteger(n))) return null
    return fixed.every((n, i) => (own.core[i] ?? 0) === n)
  }

  const wanted = parseSemantic(target)
  if (!wanted) return null
  const order = compareVersions(version, target)
  switch (op) {
    case '>=':
      return order >= 0
    case '<=':
      return order <= 0
    case '>':
      return order > 0
    case '<':
      return order < 0
    case '':
    case '=':
      return order === 0
    // Fabric: "~" keeps major and minor, "^" keeps the major version.
    case '~':
      return order >= 0 && own.core[0] === wanted.core[0] && (own.core[1] ?? 0) === (wanted.core[1] ?? 0)
    case '^':
      return order >= 0 && own.core[0] === wanted.core[0]
    default:
      return null
  }
}

/**
 * Whether `version` meets a dependency from a `fabric.mod.json`: one
 * predicate, its parts separated by spaces and all required, or a list of
 * predicates of which one is enough. Null when it is written in a form this
 * does not read, which a caller takes as unknown, never as unmet.
 */
export function satisfiesFabricDependency(version: string, predicate: string | string[]): boolean | null {
  const alternatives = Array.isArray(predicate) ? predicate : [predicate]
  let unknown = false
  for (const alternative of alternatives) {
    const parts = String(alternative).trim().split(/\s+/).filter(Boolean)
    let result: boolean | null = true
    for (const part of parts) {
      const one = satisfiesPart(version, part)
      if (one === null) {
        result = null
        break
      }
      if (!one) {
        result = false
        break
      }
    }
    if (result === true) return true
    if (result === null) unknown = true
  }
  return unknown ? null : false
}

/** A dependency in words: "0.19.5 oder neuer" for the usual ">=0.19.5". */
export function describeFabricDependency(predicate: string | string[]): string {
  const alternatives = (Array.isArray(predicate) ? predicate : [predicate]).map((p) => String(p).trim())
  if (alternatives.length === 1) {
    const atLeast = /^>=\s*(\S+)$/.exec(alternatives[0])
    if (atLeast) return tr(`${atLeast[1]} oder neuer`, `${atLeast[1]} or later`)
  }
  return alternatives.join(tr(' oder ', ' or '))
}
