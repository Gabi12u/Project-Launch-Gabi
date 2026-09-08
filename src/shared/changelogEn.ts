/**
 * English text for the changelog, keyed by version.
 *
 * A companion, not a replacement: `changelog.ts` stays the German source of
 * truth, written the moment a release goes out. This file only supplies the
 * English wording for the same entries. Each `changes` array must keep the
 * same length and order as the German one for that version, since entries
 * are matched by position.
 *
 * `changelogLocalized()` falls back to German for any version or change
 * missing here, so an incomplete translation degrades gracefully instead of
 * breaking.
 */

import type { LanguageId } from './types'
import { CHANGELOG, CHANGE_KIND_LABEL, type ChangeKind, type ChangelogRelease } from './changelog'

export const CHANGE_KIND_LABEL_EN: Record<ChangeKind, string> = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed'
}

export const CHANGELOG_EN: Record<string, { headline: string; changes: string[] }> = {
  '1.0.17': {
    headline: 'Minecraft through Xbox Game Pass now works.',
    changes: [
      'Anyone with Minecraft through Xbox Game Pass could not sign in: the launcher reported that the ' +
        'account did not own a Java Edition licence. That was not true. The launcher asked Microsoft for a ' +
        'list of entitlements and treated an empty list as no ownership, and that list does not come back ' +
        'reliably filled for Game Pass. The decision is now made from the player profile instead.',
      'If an account is still missing its Java Edition player name, the message now names the right next ' +
        'step. That step differs for Game Pass compared to a purchase, and everyone used to get the same, ' +
        'wrong instructions for Game Pass.',
      'If Microsoft sign-in breaks off, the message now says in plain language what happened and what to ' +
        'do, instead of a raw technical line. The technical code still follows, since it helps in a ' +
        'screenshot.',
      'The launcher kept waiting after a permanently rejected sign-in code instead of recognising that and ' +
        'stopping.',
      'The installer is smaller: the website, the tools and the Fabric mod used to end up inside it by ' +
        'accident, even though the launcher never reads them.'
    ]
  },
  '1.0.16': {
    headline: 'A removed mod now actually stays removed.',
    changes: [
      'The launcher could turn completely black while Minecraft was starting and stop responding after ' +
        'that. The cause was a crash or hang in the interface itself, one the launcher did not recover ' +
        'from before. It now reloads itself as soon as this is detected.',
      'A removed mod could reappear on its own in the list if the removal landed at the same time as a ' +
        'mod-list scan, for example from opening the instance page right after.',
      'The repair function now removes mods left installed twice by the bug above, and reports how many ' +
        'mods it found to be outdated while doing so.',
      'Before an instance with outdated mods starts, the launcher now asks first: update immediately, or ' +
        'keep playing with the current versions.',
      'Updating a single mod now asks first, instead of starting right away.'
    ]
  },
  '1.0.15': {
    headline: 'A custom Minecraft main-menu background, as a beta feature.',
    changes: [
      'Custom start screen (beta): swaps the background in Minecraft’s main menu for one from Launch ' +
        'Gabi, through a resource pack, without changing the game itself. Works with any Minecraft ' +
        'version, vanilla or modded. Switch it on under Settings, Appearance, or directly from the notice ' +
        'shown on first launch after this update.'
    ]
  },
  '1.0.14': {
    headline: 'Duplicate mods, freezing and several restore risks fixed.',
    changes: [
      'A public status page at status.launchgabi.com shows the current version, download numbers, and ' +
        'known problems that are still open.',
      'Mods could appear twice in the list while updating, because a short timing window mistook the new ' +
        'file for an unknown second mod.',
      'The launcher could freeze completely, because several tasks scanned folders in a blocking way, such ' +
        'as the disk-usage display after every session and the cleanup on every start.',
      'Restoring a backup could, in the worst case, permanently lose data while still reporting success. A ' +
        'full backup of the prior state is still created automatically immediately beforehand.',
      'An instance could stay permanently blocked after a very early failure while starting: no longer ' +
        'startable, not repairable, mods no longer changeable, until the launcher was restarted.',
      'Deleting, starting, repairing and restoring the same instance could get in each other’s way if two ' +
        'of them ran at the same time.',
      'The repair function could discard a mod that had just been freshly installed while it ran.',
      'A running recording could be cut off or left hanging at the end if the launcher was closed, or if ' +
        'the disk filled up.',
      'The notice about a finished update was easy to miss, because it only appeared once for a few ' +
        'seconds. A dot in the sidebar now stays until the next restart.',
      'A sign-in could keep failing for good with error 400 after the application id was changed or reset ' +
        'in Settings, because the renewal went to the wrong Microsoft system.',
      'A custom command set to run before the game starts could block the instance forever if the command ' +
        'itself hung.',
      'Shortcuts were taken over without checking during a folder import, even when they pointed outside ' +
        'the folder.',
      'Sign-in error messages now more often name the actual reason from Microsoft, instead of only an ' +
        'error number.',
      'Crash reports now more reliably remove personal data, including IP addresses and names with ' +
        'accented characters.'
    ]
  },
  '1.0.13': {
    headline: 'Errors now report themselves, and recordings stutter less.',
    changes: [
      'Crash reports: if something goes wrong, the error is recorded and, if you choose, sent to the ' +
        'developer. You are asked once, you decide, and it can be turned off under Settings, Error Reports.',
      'Every report also stays on your own disk. You can read what it contains, copy it, or delete ' +
        'everything.',
      'Name, UUID, credentials and your Windows username are removed beforehand, including from file ' +
        'paths. An IP address is not stored.',
      'Recordings stuttered. The launcher window was throttled by the system while sitting behind the ' +
        'game, which is exactly the situation during every recording.',
      'Recordings now run at 30 frames instead of 60, using a lighter-weight method. Anyone with the ' +
        'performance to spare can switch to Sharp in Settings.'
    ]
  },
  '1.0.12': {
    headline: 'In-game recording, and this very page.',
    changes: [
      'Recordings: one key in-game starts and stops a recording. The finished videos land on the instance ' +
        'under the Recordings tab, alongside your screenshots.',
      'This page. After every update it shows what changed, and it stays here. Old entries are never ' +
        'deleted.',
      'After an update, the launcher announces the new version number in the bottom right. Clicking it ' +
        'leads straight here.',
      'Settings for recording: key, quality, sound and a maximum duration, so a forgotten recording does ' +
        'not fill up the disk.',
      'The Screenshots tab is now called Recordings and shows images and videos side by side.'
    ]
  },
  '1.0.11': {
    headline: 'Twenty-four bugs from two review passes fixed.',
    changes: [
      'An invalid value in Settings could delete every automatic backup of an instance at once.',
      'A single damaged instance file made the entire instance list disappear instead of just itself.',
      'Anyone who had turned off automatic update installs got them anyway, invisibly, on quitting. ' +
        'Installing now only ever happens visibly.',
      'The quit button could get stuck after the launcher restarted, even though the game had long since ' +
        'closed.',
      'Switching accounts right after removing one could leave no account selected at all.',
      'Starting through a shortcut could lose the window if the launcher was still starting up.',
      'Automatic mod repair and a launch happening at the same time could get in each other’s way.',
      'Failed sign-ins are now recorded in the log; before, they vanished without a trace.',
      'A missing library at launch is now named instead of just counted.',
      'The cubes in the background move again, without the processing cost they used to have.'
    ]
  },
  '1.0.10': {
    headline: 'Seventeen findings around mod management.',
    changes: [
      'Several bugs in installing, updating and removing mods, found during a dedicated review pass.'
    ]
  },
  '1.0.9': {
    headline: 'Startup crash fixed, right-click for mods.',
    changes: [
      'Some instances crashed on startup because a library was wrongly dropped from the classpath. This ' +
        'mostly affected newer Minecraft versions.',
      'Mods can now be managed with a right click: switch version, update, enable and disable, open the ' +
        'project page.',
      'While the game is running, changes to mods are now blocked instead of silently doing nothing.'
    ]
  },
  '1.0.8': {
    headline: 'Skin is shown again.',
    changes: [
      'Some accounts kept showing no skin at all, because the address was blocked by the security policy.',
      'Finished tasks were briefly shown as failed even though they had actually succeeded.'
    ]
  }
}

/**
 * `CHANGELOG` with headline and change text swapped to English where a
 * translation exists. German fills any gap, matched by position within the
 * `changes` array.
 */
export function changelogLocalized(lang: LanguageId): ChangelogRelease[] {
  if (lang === 'de') return CHANGELOG
  return CHANGELOG.map((release) => {
    const en = CHANGELOG_EN[release.version]
    if (!en) return release
    return {
      ...release,
      headline: en.headline,
      changes: release.changes.map((change, index) => ({
        ...change,
        text: en.changes[index] ?? change.text
      }))
    }
  })
}

export function changeKindLabel(lang: LanguageId, kind: ChangeKind): string {
  return lang === 'en' ? CHANGE_KIND_LABEL_EN[kind] : CHANGE_KIND_LABEL[kind]
}
