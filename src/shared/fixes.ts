import type { CompatibilityIssue } from './types'

/**
 * Whether "fix all" may apply an issue's fix without the user looking first.
 *
 * A removal offered for a mere warning is the exception: two hand-placed
 * mods that only share a name may well be two different mods, which is
 * exactly what that warning tells the user to check. Run along with the
 * rest, "Alle automatisch beheben" deleted one of them.
 */
export function isSafeAutoFix(issue: CompatibilityIssue): boolean {
  if (!issue.fix) return false
  if (issue.fix.kind === 'remove-content' && issue.severity !== 'error') return false
  return true
}
