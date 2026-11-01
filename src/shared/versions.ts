/**
 * Orders launcher versions the way semver does, betas included.
 *
 * 1.0.25-beta.1 < 1.0.25-beta.2 < 1.0.25 < 1.0.26. A beta comes before the
 * release it leads up to, which a plain split on dots got wrong: it read
 * "1.0.25-beta.2" as 1.0.25.2 and ranked it above 1.0.25 itself.
 *
 * Returns a negative number when `a` is older, zero when both are the same
 * version and a positive number when `a` is newer.
 */
export function compareVersions(a: string, b: string): number {
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i]
  }
  // A release outranks every prerelease of the same number.
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) return Number(x) - Number(y)
    // Numbers sort before words, as semver has it.
    if (xNum !== yNum) return xNum ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

/** Whether this is a prerelease such as 1.0.25-beta.1. */
export function isPrerelease(version: string): boolean {
  return parse(version).pre.length > 0
}

function parse(version: string): { core: number[]; pre: string[] } {
  const clean = String(version).trim().replace(/^v/i, '').split('+')[0]
  const dash = clean.indexOf('-')
  const corePart = dash === -1 ? clean : clean.slice(0, dash)
  const prePart = dash === -1 ? '' : clean.slice(dash + 1)
  const core = corePart.split('.').map((piece) => {
    const num = Number.parseInt(piece, 10)
    return Number.isFinite(num) ? num : 0
  })
  while (core.length < 3) core.push(0)
  return { core: core.slice(0, 3), pre: prePart ? prePart.split('.') : [] }
}
