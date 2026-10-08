import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { basename, isAbsolute, join } from 'node:path'
import { getMainWindow } from '../events'
import { log } from '../logger'
import { readJson, writeJsonAtomic } from '../store'
import { tr } from '@shared/i18n'

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
export type CommandKind = 'wrapper' | 'preLaunch' | 'javaPath' | 'jvmArgs' | 'envVars'

/**
 * JVM options that load or run code of their own. Ordinary tuning (memory,
 * garbage collector) never asks; these can start a program as surely as a
 * wrapper command can.
 */
//
// Arguments that point the JVM, its native libraries or the mod loader at
// other code count as well: given after the launcher's own, a classpath or
// module path replaces the real one, and a folder shipped with an imported
// instance could be loaded from there without a word.
const CODE_LOADING_JVM_ARG =
  /^(-javaagent|-agentpath|-agentlib|-Xbootclasspath|-XX:OnError|-XX:OnOutOfMemoryError|-XX:VMOptionsFile|-XX:Flags|-Djava\.system\.class\.loader|@|-cp$|-classpath$|--class-path|-p$|--module-path|--upgrade-module-path|--patch-module|-Xrun|-Xdebug|-Djava\.library\.path|-Dorg\.lwjgl\.librarypath|-Djna\.library\.path|-Djava\.ext\.dirs|-Djava\.endorsed\.dirs|-Dfabric\.addMods|-Dloader\.addMods|-Dlog4j2?\.configurationFile|-Dminecraft\.api\.|-Dhttps?\.proxy|-DsocksProxy|-Djava\.net\.useSystemProxies|-Djavax\.net\.ssl\.)/i

/**
 * Takes the arguments already split the way they reach Java. Checked on the
 * raw text, a quoted "-javaagent:..." slipped through: the quote stood where
 * the pattern expected a space, and the split removed it afterwards.
 */
export function jvmArgsLoadCode(args: string[]): boolean {
  return args.some((arg) => CODE_LOADING_JVM_ARG.test(arg.trim()))
}

/** Executables an explicit `javaPath` may point at, matched case-insensitively. */
const JAVA_EXECUTABLE_NAMES = ['java', 'javaw', 'java.exe', 'javaw.exe']

// A function, since this module loads before the language is set.
function kindText(kind: CommandKind): { title: string; detail: (name: string, value: string) => string } {
  const texts = {
    wrapper: {
      title: tr('Wrapper-Befehl erlauben', 'Allow wrapper command'),
      intro: (name: string) =>
        tr(`Die Instanz „${name}“ möchte beim Start diesen Befehl als Wrapper ausführen:`, `The instance "${name}" wants to run this command as a wrapper on launch:`)
    },
    preLaunch: {
      title: tr('Befehl vor dem Start erlauben', 'Allow pre-launch command'),
      intro: (name: string) =>
        tr(`Die Instanz „${name}“ möchte vor dem Start diesen Befehl ausführen:`, `The instance "${name}" wants to run this command before launch:`)
    },
    jvmArgs: {
      title: tr('Java-Argumente erlauben', 'Allow Java arguments'),
      intro: (name: string) =>
        tr(
          `Die Instanz „${name}“ möchte Java mit diesen Argumenten starten. Sie können zusätzlichen Programmcode laden oder die Verbindungen des Spiels umleiten, auch die mit deinem Anmeldeschlüssel:`,
          `The instance "${name}" wants to start Java with these arguments. They can load additional program code or redirect the game's connections, including the ones carrying your sign-in token:`
        )
    },
    envVars: {
      title: tr('Umgebungsvariablen erlauben', 'Allow environment variables'),
      intro: (name: string) =>
        tr(`Die Instanz „${name}“ möchte beim Start diese Umgebungsvariablen setzen:`, `The instance "${name}" wants to set these environment variables on launch:`)
    },
    javaPath: {
      title: tr('Java-Pfad erlauben', 'Allow Java path'),
      intro: (name: string) =>
        tr(`Die Instanz „${name}“ möchte diesen Pfad als Java verwenden:`, `The instance "${name}" wants to use this path as Java:`)
    }
  }[kind]
  return {
    title: texts.title,
    detail: (name, value) =>
      `${texts.intro(name)}\n\n${shownValue(value)}\n\n` +
      tr(
        'Erlaube das nur, wenn du diesen Befehl oder Pfad selbst eingerichtet hast.',
        'Only allow this if you set up this command or path yourself.'
      )
  }
}

/**
 * The value as the dialog shows it. Blank lines and runs of spaces are
 * squeezed out: as typed, padding could push the part that matters out of
 * the visible area of the message box.
 */
function shownValue(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
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
    throw new Error(tr('Der eingestellte Java-Pfad muss ein absoluter, lokaler Pfad sein (kein Netzwerkpfad).', 'The chosen Java path has to be an absolute, local path (no network path).'))
  }
  const name = basename(path).toLowerCase()
  if (!JAVA_EXECUTABLE_NAMES.includes(name)) {
    throw new Error(tr('Der eingestellte Java-Pfad muss auf java, javaw, java.exe oder javaw.exe zeigen.', 'The chosen Java path has to point to java, javaw, java.exe or javaw.exe.'))
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
  if (!cache) {
    // A file holding valid JSON of the wrong shape (null, a number) came back
    // as is, and the `in` checks below then threw on every launch of an
    // instance with a Java path, wrapper or pre-launch command.
    const raw = readJson<unknown>(approvalsFile(), {})
    cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, number>) : {}
  }
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

  const { title, detail } = kindText(kind)
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
    detail: detail(instanceName, value),
    buttons: [tr('Erlauben', 'Allow'), tr('Abbrechen', 'Cancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })

  if (result.response !== 0) {
    logger.warn(`Befehl für ${instanceId} (${kind}) abgelehnt`)
    throw new Error(tr('Start abgebrochen: der Befehl wurde nicht erlaubt.', 'Launch cancelled: the command was not allowed.'))
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
