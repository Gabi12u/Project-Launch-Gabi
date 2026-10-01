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
  '1.0.21': {
    headline: 'A logo intro at startup, a launcher that stays smooth even with large modpacks, and 60 bugs fixed.',
    changes: [
      'The Launch Gabi logo now plays briefly at startup before the launcher opens. Anyone who prefers not to see it can turn it off under Settings, Startup.',
      'With large modpacks the launcher could hang after a few minutes and reload itself when Minecraft wrote very many log lines. The log now stays smooth even at thousands of lines per second and shows the messages readably instead of as raw XML.',
      'Backups of 2 GB or more, for example of large worlds, could not be restored. That now works, including backups made earlier. "Back up automatically" also finally takes effect after every play session.',
      'With "Minimize the launcher", closing the launcher ended a running game at once, without a chance to save. Closing now only hides the launcher until the game ends.',
      'The same mod from Modrinth and from CurseForge is now caught before starting, instead of Minecraft simply not starting. CurseForge modpacks keep the origin of their mods when imported and put resource packs and shaders into the right folders, and exporting as a modpack now also takes folders such as kubejs and defaultconfigs along.',
      'Several installs at once no longer slow each other down: the setting for simultaneous downloads now applies to the whole launcher, and "Cancel" takes effect at once.',
      'Dozens of other bugs are fixed, such as missing play time after a launcher restart, the wrong Java version for Minecraft 26, cryptic messages without internet or behind a Wi-Fi sign-in page, and empty profile pictures. Each one is listed on the status page.'
    ]
  },
  '1.0.20': {
    headline: 'English as a second language, a launcher that steps aside while you play, and more than 130 bugs fixed.',
    changes: [
      'Launch Gabi is now also available in English. The language can be switched under Settings, ' +
        'Appearance, after which the launcher restarts once. A new installation follows the system ' +
        'language.',
      'The launcher now steps aside when a game starts: the main window hides and only the live log ' +
        'stays open. "Open launcher" in the log window, or closing the log window, brings it back. ' +
        'Anyone who prefers otherwise can change it under Settings, Startup, When a game starts.',
      'Data packs now take effect in worlds: when installing, the launcher asks which worlds they ' +
        'should go into, and they can be assigned later from the instance.',
      'Steps with lasting effects, such as removing, repairing or changing the data folder, now ask ' +
        'first. Also new: duplicating and a right-click menu on instance cards, sorting of installed ' +
        'content, and an estimated time left for long downloads.',
      'The setup on first start shows its steps and, after signing in, goes straight to creating the ' +
        'first instance.',
      'Backups are written file by file instead of entirely in memory, show their progress and can be ' +
        'cancelled. A restore interrupted by a crash is undone on the next start.',
      'More security: Java downloads are verified by checksum, modpacks only download from allowed ' +
        'servers, custom launch commands and Java paths need a confirmation the first time, and sign-in ' +
        'data is redacted in logs and error reports.',
      'The launch behavior in the settings used to affect only newly created instances. Instances now ' +
        'follow the global setting unless something else is chosen for them.',
      'Minecraft up to 1.12.2, including Forge modpacks for 1.7.10 and 1.12.2, did not start when the ' +
        'data folder path contained a space, for example with a Windows user name containing a space.',
      'Mod updates now also install newly required libraries, and a library such as Fabric API is no ' +
        'longer fetched twice when it is already installed from the other provider.',
      'More than 120 further bugs are fixed, from Cancel buttons without effect to error messages ' +
        'showing the full file path. All of them are listed individually on the status page.'
    ]
  },
  '1.0.19': {
    headline: 'Small bug fix.',
    changes: [
      'The "custom start screen" beta feature was unintentionally disabled and now lives under Settings, ' +
        'Appearance again.'
    ]
  },
  '1.0.18': {
    headline: 'Sign in now runs through its own application, no more error 400.',
    changes: [
      'For some accounts, Microsoft sign in aborted with error 400, because the launcher signed in with ' +
        'the official Minecraft launcher’s own application id, and Microsoft increasingly refuses that ' +
        'shared application for outside programs. Launch Gabi now has its own application, and the whole ' +
        'sign-in path was measured by hand against it.',
      'A dedicated live-log window now opens whenever an instance starts, in the style of a classic ' +
        'launcher console window. It closes on its own once the game ends, and the instance’s Log tab ' +
        'then opens automatically in the main window.',
      'Closing the launcher window could end a running game along with it, even with the setting saying ' +
        'to keep it going. The window now hides instead, and comes back once no game is running any more.',
      'A fault in the interface no longer leaves the whole window blank. It now shows a message with a ' +
        'way to try again or go back to the home page.',
      'A finished or failed task could get stuck in the task tray instead of disappearing after a moment.',
      'An account could be removed with no confirmation, and the crash-report privacy dialog answered ' +
        'itself with No for good if it was merely dismissed rather than answered with one of its two buttons.',
      'Sliders such as memory or concurrent downloads wrote to the settings file on every single step, ' +
        'which visibly stuttered on slower drives.',
      'A deliberately disabled mod could quietly turn itself back on after an automatic update.',
      'When the operating system cannot offer encryption for a sign-in token, which mostly happens on ' +
        'some Linux systems, the accounts section of Settings now shows a standing notice about it.',
      'A number of further, smaller fixes to repair, instance management, and Fabric, Quilt, Forge and ' +
        'Java installation, listed individually on the status page.'
    ]
  },
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
