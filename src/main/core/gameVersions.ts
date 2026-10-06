/**
 * Which Minecraft versions a mod built for one version can be expected to
 * run on.
 *
 * The rule used to be "same major.minor line": anything 1.20.x counted for
 * 1.20.1. Within a line, though, Mojang changes enough between most patch
 * releases that mods are rebuilt for each, and a 1.20.6 build simply does not
 * load on 1.20.1. The launcher installed it anyway, and the compatibility
 * check then called it compatible.
 *
 * What does hold is a hotfix release that kept the network protocol of the
 * release before it: those are the same game for mods, and authors often tag
 * only one of the two. Listed by hand, since nothing in the version names
 * says which patch releases are hotfixes.
 */
const SAME_RELEASE: string[][] = [
  ['1.16.4', '1.16.5'],
  ['1.18', '1.18.1'],
  ['1.19.1', '1.19.2'],
  ['1.20', '1.20.1'],
  ['1.20.3', '1.20.4'],
  ['1.20.5', '1.20.6'],
  ['1.21', '1.21.1'],
  ['1.21.2', '1.21.3'],
  ['1.21.7', '1.21.8'],
  ['1.21.9', '1.21.10']
]

/** True when a build tagged `candidate` belongs on Minecraft `target`. */
export function gameVersionMatches(target: string, candidate: string): boolean {
  if (candidate === target) return true
  return SAME_RELEASE.some((group) => group.includes(target) && group.includes(candidate))
}

/**
 * The looser rule, kept for resource packs and shaders: they rarely break
 * between patch releases, and a pack tagged 1.21.4 is usually fine on 1.21.5.
 */
export function sameVersionLine(target: string, candidate: string): boolean {
  const line = target.split('.').slice(0, 2).join('.')
  return candidate === line || candidate.startsWith(`${line}.`)
}
