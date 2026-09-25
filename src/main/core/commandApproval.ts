import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { basename, isAbsolute, join } from 'node:path'
import { getMainWindow } from '../events'
import { log } from '../logger'
import { readJson, writeJsonAtomic } from '../store'

const logger = log('commandApproval')

/**
 * Guards the three instance settings that end up executed by the main
 * process: a wrapper command and a pre-launch command both run arbitrary
 * programs outright, and an explicit Java path is handed straight to
 * `spawn`. All three are stored through the ordinary `instance:update` IPC
 * channel with no check of their own, so a compromised renderer could set
 * and silently run any of them. This module is the check: nothing here runs
 * without either already being approved, or the user clicking "Erlauben" on
 * a dialog naming the instance and showing the exact value.
 */
export type CommandKind = 'wrapper' | 'preLaunch' | 'javaPath'

/** Executables an explicit `javaPath` may point at, matched case-insensitively. */
const JAVA_EXECUTABLE_NAMES = ['java', 'javaw', 'java.exe', 'javaw.exe']

const KIND_TEXT: Record<CommandKind, { title: string; verb: string }> = {
  wrapper: { title: 'Wrapper-Befehl erlauben', verb: 'beim Start als Wrapper-Befehl ausführen' },
  preLaunch: { title: 'Pre-Launch-Befehl erlauben', verb: 'vor dem Start ausführen' },
  javaPath: { title: 'Java-Pfad erlauben', verb: 'zum Starten als Java verwenden' }
}

function isUncPath(value: string): boolean {
  // Both slash directions: Windows accepts either as a network path.
  return /^\\\\/.test(value) || /^\/\//.test(value)
}

/**
 * Rejects anything that is not a plain, local path to a real Java launcher.
 *
 * Approval alone is not enough here: even a value the user clicked "Erlauben"
 * on must still be recognisable as Java, not some other program renamed to
 * look harmless in the dialog and then swapped afterwards, or a share the
 * launcher has no business reading from.
 */
export function validateJavaPath(path: string): void {
  if (!isAbsolute(path) || isUncPath(path)) {
    throw new Error('Der eingestellte Java-Pfad muss ein absoluter, lokaler Pfad sein (kein Netzwerkpfad).')
  }
  const name = basename(path).toLowerCase()
  if (!JAVA_EXECUTABLE_NAMES.includes(name)) {
    throw new Error('Der eingestellte Java-Pfad muss auf java, javaw, java.exe oder javaw.exe zeigen.')
  }
}

/** Same check as `validateJavaPath`, without throwing. */
export function isValidJavaPath(path: string): boolean {
  try {
    validateJavaPath(path)
    return true
  } catch {
    return false
  }
}

function approvalsFile(): string {
  return join(app.getPath('userData'), 'approved-commands.json')
}

// Loaded once and kept in memory, the same pattern `store.ts` uses for
// settings: this file is only ever touched by this module, never by any IPC
// channel, so nothing else can invalidate it out from under the cache.
let cache: Record<string, number> | null = null

function loadApprovals(): Record<string, number> {
  if (!cache) cache = readJson<Record<string, number>>(approvalsFile(), {})
  return cache
}

function hashValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * instanceId + kind + a hash of the exact value, so approving one instance's
 * wrapper command never approves another's, and changing so much as one
 * character asks again instead of silently reusing the old approval.
 */
export function approvalKey(instanceId: string, kind: CommandKind, value: string): string {
  return `${instanceId}:${kind}:${hashValue(value.trim())}`
}

/** Whether a value is already approved. Never shows a dialog. */
export function isApproved(instanceId: string, kind: CommandKind, value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  return approvalKey(instanceId, kind, trimmed) in loadApprovals()
}

/**
 * Asks once per instance/kind/value before a wrapper command, a pre-launch
 * command or an explicit Java path is ever executed, and remembers the
 * answer for next time.
 *
 * Never call this from the automatic preflight check: a page opening on its
 * own must never pop a dialog, `isApproved` above is what that path uses
 * instead.
 */
export async function ensureApproved(
  instanceId: string,
  instanceName: string,
  kind: CommandKind,
  rawValue: string
): Promise<void> {
  const value = rawValue.trim()
  if (!value) return

  const key = approvalKey(instanceId, kind, value)
  if (key in loadApprovals()) return

  const { title, verb } = KIND_TEXT[kind]
  const win = getMainWindow()
  // A dialog parented to a hidden or minimised window can end up out of
  // sight on Windows, leaving the launch waiting on a box nobody sees.
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }
  const result = await dialog.showMessageBox(win as BrowserWindow, {
    type: 'warning',
    title,
    message: title,
    detail:
      `Die Instanz „${instanceName}“ möchte folgenden Befehl ${verb}:\n\n${value}\n\n` +
      'Erlaube das nur, wenn du diesen Befehl oder Pfad selbst eingerichtet hast.',
    buttons: ['Erlauben', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })

  if (result.response !== 0) {
    logger.warn(`Befehl für ${instanceId} (${kind}) abgelehnt`)
    throw new Error('Start abgebrochen: der Befehl wurde nicht erlaubt.')
  }

  const approvals = { ...loadApprovals(), [key]: Date.now() }
  writeJsonAtomic(approvalsFile(), approvals)
  cache = approvals
  logger.info(`Befehl für ${instanceId} (${kind}) erlaubt und gemerkt`)
}

/** Validates, then asks for approval: the one call needed before using an explicit javaPath. */
export async function ensureJavaPathApproved(
  instanceId: string,
  instanceName: string,
  path: string
): Promise<void> {
  validateJavaPath(path)
  await ensureApproved(instanceId, instanceName, 'javaPath', path)
}
