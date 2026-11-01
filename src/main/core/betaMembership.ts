/**
 * Whether this launcher is in the beta programme, readable without the rest
 * of beta.ts.
 *
 * The error reports need this answer: whoever is in the programme sends them
 * automatically, that is part of joining. beta.ts reaches reports.ts through
 * the Microsoft sign-in, so importing it from there would close a cycle.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { readJson } from '../store'

export function betaFile(): string {
  return join(app.getPath('userData'), 'beta.json')
}

/** True from joining until leaving, false once the key was revoked or removed. */
export function inBetaProgramme(): boolean {
  const stored = readJson<{ key?: unknown; uuid?: unknown; ended?: unknown } | null>(betaFile(), null)
  return !!stored && typeof stored === 'object' && typeof stored.key === 'string' && typeof stored.uuid === 'string' && !stored.ended
}
