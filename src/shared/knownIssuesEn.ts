/**
 * English text for the known-issues list, keyed by id.
 *
 * A companion, not a replacement: `knownIssues.ts` stays the German source
 * of truth, the one this project's own rules require every real problem to
 * land in first. This file only supplies the English wording for the same
 * entries, so translating never means retyping the facts.
 *
 * `knownIssuesLocalized()` falls back to the German text for any id missing
 * here, which should never happen once every entry carries a translation,
 * but a missing key must show something true rather than nothing at all.
 */

import type { LanguageId } from './types'
import { KNOWN_ISSUES, ISSUE_STATE_LABEL, type IssueState, type KnownIssue } from './knownIssues'

export const ISSUE_STATE_LABEL_EN: Record<IssueState, string> = {
  investigating: 'Being investigated',
  fixing: 'Being fixed',
  fixed: 'Fixed',
  limitation: 'Known limitation'
}

export const KNOWN_ISSUES_EN: Record<string, { title: string; detail: string }> = {
  'mod-entfernen-kommt-zurueck': {
    title: 'A removed mod could reappear on its own',
    detail:
      'Removing was the one change to an instance\u2019s mods that did not hold back a mod-list scan ' +
      'running at the same time. If a removal landed inside such a scan, triggered by something as ' +
      'ordinary as opening the instance page or an update check, the scan could write the just-removed ' +
      'mod straight back into the list from its not-yet-vanished state on disk. Since 1.0.16, removing ' +
      'holds the scan back until it is done, exactly as installing and updating always did. The repair ' +
      'function also cleans up any leftover duplicates from earlier occurrences while it is at it.'
  },
  'launcher-schwarz-bei-spielstart': {
    title: 'Launcher turns completely black and stops responding when the game starts',
    detail:
      'Starting Minecraft from the launcher could turn the launcher window completely black, after ' +
      'which it no longer responded to anything. The cause was a crash or hang in the interface layer ' +
      'itself, one it never recovered from: the window stayed on screen showing nothing but its empty ' +
      'background colour, unresponsive, without the launcher noticing or fixing it on its own. What ' +
      'exactly crashed the interface at that moment is not fully settled. Since 1.0.16 the launcher ' +
      'reloads itself the moment this is detected.'
  },
  'gamepass-keine-lizenz': {
    title: 'Game Pass accounts were turned away as "no licence"',
    detail:
      'Anyone with Minecraft through Xbox Game Pass could not sign in: the launcher reported "This ' +
      'account does not own a Minecraft Java Edition licence." The account was never the problem. The ' +
      'launcher asked Microsoft for a list of entitlements and treated an empty list as no ownership, ' +
      'but that list does not come back reliably filled for Game Pass, even when the account is fully ' +
      'entitled to play. The decision is now made from the player profile instead: if Microsoft returns ' +
      'a player name, the account can play. If the name is still missing, the message now names the ' +
      'right next step, and that step differs for Game Pass compared to a purchase.'
  },
  'login-http-400': {
    title: 'Sign-in ends with error 400',
    detail:
      'On some accounts, Microsoft sign-in breaks off with error 400. A crash report from 1.0.16 has ' +
      'since shown what is behind it: Microsoft answers the device-code check with "invalid_grant". ' +
      'Measured against the real sign-in service, that means either the code has expired or the ' +
      'sign-in in the browser was never completed. Both are final: the code is not accepted afterwards. ' +
      'Until now the launcher did not recognise this case and showed the raw technical line instead of ' +
      'saying what to do. That part is fixed: a plain-language message now appears alongside the ' +
      'technical code, and the report includes how long the attempt ran. That landed in 1.0.17. A ' +
      'strong suspicion about the underlying cause has also emerged since: the launcher signs in with ' +
      'the official Minecraft launcher\u2019s application id, because its own id first needs approval from ' +
      'Mojang. Microsoft is increasingly refusing that shared application for third-party programs, and ' +
      'the rejection lands the moment someone finishes signing in in the browser. As of September 8 a ' +
      'dedicated application exists, and the sign-in path has been measured through by hand once: device ' +
      'code, sign-in, Xbox Live and the Xbox authorisation all complete cleanly, only Minecraft itself ' +
      'turns away an application that is not yet approved. The approval has been requested and is still ' +
      'pending. Until it arrives, the shared application stays in use, and the error can keep occurring.'
  },
  'anmeldung-falsches-system': {
    title: 'A changed setting could break sign-in for good',
    detail:
      'When renewing a sign-in in the background, the launcher used the application id currently sitting ' +
      'in Settings, not the one the account had originally signed in with. If that setting was changed, ' +
      'or reset through "Reset settings," every further renewal went to the wrong system and failed from ' +
      'then on with error 400, only for that one account and with no visible reason.'
  },
  'vorstart-befehl-haengt': {
    title: 'A hanging pre-launch command blocked the instance for good',
    detail:
      'Anyone with a custom command set to run before the game starts had that instance stuck on ' +
      '"starting" indefinitely if the command itself hung, for example while waiting on a network ' +
      'reply. Neither a timeout nor the cancel button caught this, and the instance could then neither ' +
      'start, nor be repaired, nor have its mods changed until the launcher was restarted.'
  },
  'fehlerbericht-datenschutz-luecken': {
    title: 'A few pieces of data in crash reports were not reliably removed',
    detail:
      'Cleaning a crash report before sending was missing a rule against IP addresses, even though the ' +
      'consent dialog promises exactly that. On top of that, a Windows username with an umlaut or ' +
      'similar character at the edge went unrecognised, an email address could be left half-removed ' +
      'instead of gone entirely depending on rule order, and an upper-case path like C:\\USERS\\... slipped ' +
      'through.'
  },
  'wiederherstellung-riskant': {
    title: 'Restoring a backup can lose data',
    detail:
      'Before restoring, the launcher moves the existing state aside and brings it back if unpacking ' +
      'fails. If bringing it back failed in turn, for instance because Windows still had a folder open, ' +
      'the set-aside state was deleted anyway while the message claimed everything had been restored. On ' +
      'top of that, the game could be started during a restore, straight into a half-unpacked world ' +
      'folder, and the cancel button had no effect. A full backup of the prior state is still created ' +
      'automatically immediately before every restore.'
  },
  'instanz-startet-nie-wieder': {
    title: 'An instance suddenly refuses to start',
    detail:
      'If preparing a launch failed very early, the "starting" marker stayed in place. After that, the ' +
      'instance could neither start nor have its mods changed, with no visible reason and no error ' +
      'message, until the launcher was restarted. Because internal ids of deleted instances get reused ' +
      'later, a freshly created instance could inherit the problem.'
  },
  'reparatur-verwirft-mods': {
    title: 'Repair can discard a freshly installed mod',
    detail:
      'The repair function remembers the mod list at the start and writes it back in full at the end. If ' +
      'a mod was installed or updated in the meantime, which can easily take minutes for a large ' +
      'download, its entry disappeared again. The file itself stayed on disk and was later picked up ' +
      'again as an unknown local mod with no known source or version.'
  },
  'aufnahme-abgeschnitten': {
    title: 'Recordings can be cut short at the end',
    detail:
      'Closing the launcher while a recording was running could let it quit before the file finished ' +
      'writing. The last stretch was then missing, without any message, since the window was already ' +
      'gone. If the disk filled up during a recording, the recording could also hang instead of stopping ' +
      'cleanly.'
  },
  'instanz-loeschen-waehrend-arbeit': {
    title: 'Deleting during a launch or mod work was possible',
    detail:
      'Deleting an instance only checked whether the game was already running. A launch in progress, or ' +
      'a mod installation in progress, did not stop it, so the folder could vanish while something was ' +
      'still writing into it.'
  },
  'update-hinweis-einmalig': {
    title: 'The notice about a ready update was easy to miss',
    detail:
      'A downloaded update announced itself exactly once, with a banner that disappeared on its own ' +
      'after a few seconds and never came back. Anyone leaving the launcher open in the background only ' +
      'found out by checking Settings themselves.'
  },
  'mods-doppelt': {
    title: 'Mods appear twice in the list',
    detail:
      'During an update the same mod could show up twice in the list. The cause was a timing window: the ' +
      'new file was already on disk but not yet recorded, and a scan landing in that exact moment treated ' +
      'it as an unknown second mod. Perfectly ordinary actions, like opening the instance page, could ' +
      'trigger it.'
  },
  'einfrieren-linux': {
    title: 'The launcher freezes completely at times',
    detail:
      'Several tasks scanned folders in a blocking way and ran on their own, such as the disk-usage ' +
      'display after every session and the cleanup on every start. While one of these ran, the window ' +
      'did not respond at all. Every system is affected; it stands out more on Linux, where encrypted or ' +
      'network-mounted home folders come into play more often.'
  },
  'wrapper-exec': {
    title: 'A wrapper command can take the game out of tracking',
    detail:
      'If a custom wrapper command starts Java in the background instead of replacing itself with it via ' +
      'exec, the launcher considers the game finished as soon as the wrapper itself exits. Mod changes ' +
      'then stop being locked. This cannot be repaired: there is no reliable way to reach a detached ' +
      'process. As of 1.0.14 this case is detected and reported, and the field in Settings names the ' +
      'condition.'
  },
  'mac-linux-ungetestet': {
    title: 'macOS and Linux are barely tested',
    detail:
      'Installers exist for both systems and are built for every release. Whether sign-in and launching ' +
      'the game work reliably there has not yet been checked systematically by anyone. macOS also lacks ' +
      'a signature, so the system shows a warning on first launch there and automatic updates do not work.'
  }
}

/**
 * `KNOWN_ISSUES` with title and detail swapped to English where a
 * translation exists. German fills any gap, since a missing translation
 * must never turn into a missing problem.
 */
export function knownIssuesLocalized(lang: LanguageId): KnownIssue[] {
  if (lang === 'de') return KNOWN_ISSUES
  return KNOWN_ISSUES.map((issue) => {
    const en = KNOWN_ISSUES_EN[issue.id]
    return en ? { ...issue, title: en.title, detail: en.detail } : issue
  })
}

export function issueStateLabel(lang: LanguageId, state: IssueState): string {
  return lang === 'en' ? ISSUE_STATE_LABEL_EN[state] : ISSUE_STATE_LABEL[state]
}
