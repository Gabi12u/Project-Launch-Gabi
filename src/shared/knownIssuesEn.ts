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
      'On some accounts, Microsoft sign-in broke off with error 400. The cause was that the launcher ' +
      'signed in with the official Minecraft launcher\u2019s application id: Microsoft is increasingly ' +
      'refusing that shared application for third-party programs, and the rejection landed the moment ' +
      'someone finished signing in in the browser. Since 1.0.17 the launcher at least shows this case in ' +
      'plain language, with a readable message alongside the technical code instead of the raw error ' +
      'line. A dedicated application has existed since September 8, 2026, and on September 11, 2026 the ' +
      'full sign-in path was measured through by hand: device code, sign-in, Xbox Live, Xbox ' +
      'authorisation and Minecraft itself all accept it without issue, with no approval form ever turning ' +
      'out to be needed. Anyone who already has the launcher installed is switched onto the dedicated ' +
      'application automatically on the next start. A session that is already signed in is unaffected and ' +
      'keeps running under the application it originally signed in with.'
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
  },
  'windows-ungesigniert': {
    title: 'Windows warns about the program on first launch',
    detail:
      'Launch Gabi has no code signing certificate for Windows. Such a certificate costs money on an ' +
      'ongoing basis, and for a private, free project the decision was made deliberately not to buy one. ' +
      'Without a signature, Windows SmartScreen treats every new version as unknown at first and shows ' +
      'the message "Windows protected your PC" with the note "Unknown publisher" on the very first ' +
      'launch. This is not a malfunction of the launcher but a permanent consequence of the missing ' +
      'signature, appearing again with every new version. Anyone who sees the message clicks "More info" ' +
      'and then "Run anyway", after which Launch Gabi starts normally. The same missing signature has a ' +
      'second, less visible consequence: the built-in updater normally also checks an Authenticode ' +
      'signature before installing an update. Without a certificate there is no such signature to check, ' +
      'so this second safeguard has nothing to do. What remains is comparing the checksum from the ' +
      'release manifest, which comes from the same release as the installer file itself and is therefore ' +
      'not an independent second source.'
  },
  'tokens-ohne-verschluesselung': {
    title: 'Missing encryption of login tokens was invisible',
    detail:
      'The launcher encrypts the Microsoft login token before saving it, using the operating system’s ' +
      'own encryption. When the system does not offer that, which can happen mainly on some Linux ' +
      'installations without a configured keyring, the launcher stores the token as plain text instead. ' +
      'Until now that only showed up in the internal log file, which no user normally opens. A ' +
      'notification now appears in that case, and the accounts section of Settings shows a persistent ' +
      'notice for as long as at least one saved account is affected. The underlying limit itself does not ' +
      'change: without encryption from the system, plain text remains the only alternative to refusing to ' +
      'save the sign in at all.'
  },
  'update-deaktivierte-mod-wird-aktiv': {
    title: 'Updating a disabled mod turns it back on',
    detail:
      'When a switched-off mod is updated, the freshly downloaded file lands on disk without the ' +
      '".disabled" suffix, even though the internal record still says switched off. The next scan of the ' +
      'folder goes by the real file and records the mod as enabled, with no message shown. A mod that was ' +
      'deliberately switched off because of a crash or an incompatibility can therefore quietly come back ' +
      'after an automatic update and cause the same fault again.'
  },
  'java-tausch-nicht-atomar': {
    title: 'A Java switch can destroy both the old and the newly downloaded version',
    detail:
      'When a downloaded Java version is put into place, the existing folder is deleted first and the ' +
      'freshly unpacked folder is then moved into its spot. If that second step fails, for example ' +
      'because a virus scanner or a backup program is holding a file inside the new folder open at that ' +
      'moment, the old, previously working installation is already gone, and the cleanup step afterwards ' +
      'removes the new folder as well. Both are then lost, and the Java version has to be downloaded ' +
      'again from scratch.'
  },
  'alte-assets-ohne-pruefung': {
    title: 'Very old Minecraft versions do not check copied files for completeness',
    detail:
      'For Minecraft versions before 1.6, assets are copied into an older folder layout. This only checks ' +
      'whether a file already exists at the destination, not whether it is complete. If the launcher ' +
      'breaks off during this copy, for instance from a crash or a power loss, an incomplete file is left ' +
      'behind and gets skipped as already done on every further launch. This only shows up on very old ' +
      'versions, as a missing sound or texture, with no error message.'
  },
  'loeschen-ohne-reparatur-sperre': {
    title: 'Deleting an instance does not check whether a repair is running',
    detail:
      'Before deleting an instance, the launcher checks whether it is running, starting, having its mods ' +
      'worked on, or having a backup restored. A repair in progress is not among these checks. Deleting ' +
      'an instance during its own repair leaves the repair writing into the folder that was just removed, ' +
      'partially recreating it. Because freed internal ids get reused later, a freshly created instance ' +
      'can end up with a non-empty folder made of these leftovers.'
  },
  'reparatur-wiederherstellung-ungesperrt': {
    title: 'Repair and restoring a backup can interfere with each other',
    detail:
      'A repair does not check whether a backup is currently being restored for the same instance, and a ' +
      'restore does not check the other way around whether a repair or mod work is in progress. Starting ' +
      'both at once for the same instance has them write into the same subfolders as worlds and settings. ' +
      'Depending on timing, this can leave half written world or configuration files.'
  },
  'reparatur-trifft-fremde-instanz': {
    title: 'Repairing one instance can disrupt the launch of another on the same Minecraft version',
    detail:
      'Native libraries are kept in one folder per Minecraft version, shared by every instance on that ' +
      'version. Repair only recognises an instance as in use once it is already running, not one that is ' +
      'in the middle of starting, for example while native libraries are being unpacked or a custom pre ' +
      'launch command is still running. Repairing a different instance on the same version during that ' +
      'window clears the shared folder, and the starting instance can crash without its native libraries, ' +
      'even though nothing about it was changed.'
  },
  'duplizieren-ohne-sperre': {
    title: 'Duplicating an instance checks no lock at all',
    detail:
      'Unlike deleting, duplicating an instance does not check whether it is running, starting, having ' +
      'its mods worked on, or having a backup restored before copying the folder. If one of these is ' +
      'happening at the same time, the resulting copy can contain missing, half written or inconsistent ' +
      'files, with no message shown. This only becomes noticeable once the copy is started later.'
  },
  'mod-umschalten-ohne-sperre': {
    title: 'Switching a mod on or off bypasses the lock for content changes',
    detail:
      'Installing, removing, updating and repairing content all hold the same lock while they run, so ' +
      'they cannot overwrite each other. Switching a mod on or off does not hold that lock and is not ' +
      'caught by the check in its own command either. If this happens right while an installation, ' +
      'update or repair is running in the background for the same instance, whichever saves last ' +
      'overwrites the other one’s change, without a warning.'
  },
  'versionspruefung-wirkungslos': {
    title: 'A check when locating installed loader versions has no effect',
    detail:
      'When locating an already installed loader folder, a check is meant to rule out mistakenly using a ' +
      'folder from another instance that shares the same loader version but a different Minecraft ' +
      'version. Because of how two conditions are combined, this check never actually applies in ' +
      'practice: the result always comes out positive regardless of the Minecraft version comparison. ' +
      'Rare in practice, since Forge and NeoForge version numbers are usually tied to one specific ' +
      'Minecraft version, but in an unlucky case an instance would start with the wrong version profile.'
  },
  'konten-falscher-typ-nach-login': {
    title: 'The account list could crash after signing in',
    detail:
      'After a successful Microsoft sign-in or creating an offline profile, the launcher internally sent ' +
      'just the new account instead of the full account list to the interface, even though that full ' +
      'list is exactly what is expected as the result. The sidebar, the header and the setup wizard all ' +
      'read from that list immediately for things like "find the active account" or "how many accounts ' +
      'are there," which can crash the entire interface when a single account arrives instead of a list. ' +
      'That would hit precisely the moment every new person goes through the first time they open the ' +
      'launcher.'
  },
  'forge-installer-pfad-traversal': {
    title: 'A tampered Forge or NeoForge installer could place files anywhere on disk',
    detail:
      'When setting up Forge or NeoForge, the launcher reads a list of data paths out of the installer ' +
      'itself and unpacks them into its own working folder. A path starting with a forward slash was ' +
      'taken over unchecked, while the launcher deliberately applies a safeguard against exactly this ' +
      'kind of path at comparable spots in the same code. An installer with a suitably crafted path ' +
      'could have placed a file outside the intended folder, for instance in Windows’ startup folder. ' +
      'The installer itself comes from the official Forge or NeoForge address, so the risk only exists ' +
      'if that source itself were compromised.'
  },
  'loader-versionid-pfad-traversal': {
    title: 'An unsanitised id from the network could escape a folder while setting up a loader',
    detail:
      'Fabric, Quilt, Forge and NeoForge all return a version id while setting up, which the launcher ' +
      'turns into both a folder name and a file name without sanitising that id first. If that id came ' +
      'from a compromised metadata server or a tampered installer with slashes built in, the file it ' +
      'produced could have landed outside the folder meant for version data.'
  },
  'ordner-oeffnen-ohne-instanzpruefung': {
    title: 'Opening a folder did not check the instance it was given, and could launch a program instead',
    detail:
      'The commands for opening a backup or instance folder built the target path directly from the id ' +
      'they were given, without checking that the id actually belonged to an existing instance. On ' +
      'Windows, the system tool used for this does not just reveal an executable file, it runs it. With ' +
      'a suitably built id, this could have started a file living anywhere in the data directory, such ' +
      'as one of the Java versions the launcher manages itself. This exact check already exists at a ' +
      'neighbouring spot in the same code, deliberately added there before; it was simply still missing ' +
      'here.'
  },
  'instanzlisten-ohne-existenzpruefung': {
    title: 'Worlds, screenshots and recordings were listed without checking the instance',
    detail:
      'Unlike almost every other instance-related command, the commands for listing worlds, screenshots ' +
      'and recordings did not first check whether the given id actually belonged to an existing ' +
      'instance. For a deleted instance whose folder happens to still sit on disk for some reason, this ' +
      'could read and display content that should no longer be reachable.'
  },
  'installation-ohne-sperre': {
    title: 'Setting up an instance again checked none of the usual locks',
    detail:
      'Repair and restore both check extensively before starting whether the instance is currently ' +
      'running, starting, or otherwise busy, with the explicit reasoning that shared files could ' +
      'otherwise be damaged. The comparable function for setting up an instance again has none of these ' +
      'checks, even though it touches the same files. Triggered while the same instance is already ' +
      'running, it could write libraries or native files out from under a running game.'
  },
  'curseforge-seitengroesse-falsch': {
    title: 'Querying versions on CurseForge often only saw the last fifty files',
    detail:
      'When querying every file of a project on CurseForge, the launcher incorrectly asked for two ' +
      'hundred entries per page. CurseForge never returns more than fifty at this endpoint, no matter ' +
      'how many are requested. This always broke the query off after the first page; for a project with ' +
      'many files, the launcher only ever saw the fifty most recently uploaded ones, mixed across every ' +
      'Minecraft version and loader. If the right file for the wanted version was not among those fifty, ' +
      'the launcher either installed the wrong one or wrongly reported that no matching version existed. ' +
      'A comment in the same code already describes this exact problem as fixed, just with the wrong ' +
      'number.'
  },
  'einstellungen-vor-speichern-uebernommen': {
    title: 'A changed setting took effect before it was actually saved',
    detail:
      'When saving a setting, the launcher adopted the new state in memory immediately, before the write ' +
      'to disk was confirmed. If that write failed, for instance because Windows briefly locked the file ' +
      'through a virus scanner or search indexing, the launcher believed for the rest of the session that ' +
      'the change was active, even though the old state still sat on disk. After a restart the change was ' +
      'then quietly gone again. Particularly awkward for the data directory: a failed write made the ' +
      'launcher immediately act as if everything lived at the new location, without the preparation that ' +
      'would actually require having happened.'
  },
  'forge-abbruch-stoppt-prozess-nicht': {
    title: 'Cancelling a Forge install did not stop the running Java process',
    detail:
      'During the last steps of a Forge or NeoForge install, short Java processes run that assemble ' +
      'files. Unlike downloads within the same operation, a cancellation was not passed on to these ' +
      'processes. Cancelling the install while one of them runs has the interface report the operation ' +
      'as finished, while the Java process keeps running in the background and keeps writing into ' +
      'folders shared by every instance.'
  },
  'beschaedigter-installer-blockiert-dauerhaft': {
    title: 'A corrupted Forge installer download blocked every further attempt',
    detail:
      'If the checksum of a Forge or NeoForge installer cannot be fetched, the launcher deliberately lets ' +
      'the install continue anyway, unchecked. If the downloaded file was actually corrupted but not ' +
      'empty, for instance because an error page of a matching size was served instead of the real file, ' +
      'that corrupted file stayed in the cache and was taken as already present on every further attempt ' +
      'from then on. Every retry then failed the same way, until someone cleared the cache by hand.'
  },
  'log-dateien-mit-benutzername': {
    title: 'Log files carry the Windows username, unlike crash reports',
    detail:
      'Crash reports deliberately and explicitly remove names, paths and other personal details before ' +
      'going anywhere. The ordinary log file, which writes while the game starts, while Java installs or ' +
      'while a shortcut gets created, does not: it carries full file paths, and on Windows those paths ' +
      'carry the username. Anyone sharing their log to get help unintentionally hands over their Windows ' +
      'name along with it. On top of that there is no size limit, so a very long session can let the file ' +
      'grow without bound.'
  },
  'geraetecode-anzeige-vertauscht': {
    title: 'A displayed sign-in code could belong to an already cancelled attempt',
    detail:
      'Cancelling a running Microsoft sign-in and immediately starting a new one, for instance for a ' +
      'second account, can in rare cases have the reply from the first, already cancelled attempt arrive ' +
      'late and overwrite the new code already on screen. The actual sign-in itself is unaffected and ' +
      'keeps running for the right account, no accounts or tokens ever get mixed up. But a code can ' +
      'briefly be shown that belongs to nothing anymore, and entering it in the browser would lead ' +
      'nowhere.'
  },
  'plattform-antwort-unzureichend-abgesichert': {
    title: 'Unexpected responses from Modrinth or CurseForge were not guarded everywhere',
    detail:
      'In several places when querying Modrinth and CurseForge, the launcher relied on certain fields in ' +
      'the response always being present and sortable, even though comparable spots in the same code ' +
      'already account for that not being guaranteed, especially for older entries. A missing field like ' +
      'that can break an entire project’s version list instead of just discarding the one affected entry. ' +
      'On top of that, a missing release date sorted the affected version to an unpredictable spot ' +
      'instead of reliably to the end, and a mapping table on the CurseForge side misclassified one kind ' +
      'of dependency, which currently has no visible effect yet.'
  },
  'oberflaeche-ohne-auffangnetz': {
    title: 'The interface has no safety net against unexpected data from the main process',
    detail:
      'The account bug listed above had a deeper cause that remains on its own: the interface never ' +
      'checks whether a reply arriving over IPC actually has the expected shape before adopting it into ' +
      'the shared state. There was also no catch-all layer anywhere in the program for unexpected errors ' +
      'while drawing the interface. If any spot threw because an assumption about the shape of some data ' +
      'did not hold, the entire screen went blank, with no way to recover short of a restart. That was ' +
      'the gap through which the now fixed account bug could turn into a crash in the first place. Since ' +
      '1.0.18 a catch-all layer intercepts any error while drawing: the affected view shows a notice with ' +
      'the technical message and a way back to Home, while the rest of the window (navigation, running ' +
      'tasks, open windows) keeps working. If something breaks outside the view itself, a second, outer ' +
      'layer catches the whole window instead. The other half of the original finding remains open: ' +
      'individual IPC replies still are not checked for shape before being adopted. An error like that no ' +
      'longer blanks the window, but it can still happen.'
  },
  'update-erneut-suchen-verdeckt-fertiges-update': {
    title: 'Checking for updates again could hide an update that was already ready',
    detail:
      'With an update already downloaded and waiting for a restart, the "Check now" button in Settings ' +
      'stayed clickable regardless. The automatic background check had an explicit safeguard against ' +
      'putting an already finished update back to "checking," the manual search through this button did ' +
      'not have the same safeguard. Searching again at that moment could make the notice about the ' +
      'waiting update and the restart button disappear, even though the downloaded update still sat there ' +
      'unchanged. The safeguard now applies to both paths alike, and clicking "Check now" in that state ' +
      'instead reports that an update is already waiting or already downloading.'
  },
  'lokaler-bau-mit-absturzprotokollen': {
    title: 'A hand-built installer can carry crash logs with your own username',
    detail:
      'Building the launcher by hand on your own machine instead of through the official release, while ' +
      'crash logs happen to sit in the same folder (for instance from the mod folder’s Java toolchain), ' +
      'the build settings did not reliably exclude them. Such logs can carry the Windows username and ' +
      'local paths. Measured, not assumed, using electron-builder’s own file filter rather than just ' +
      'reading the pattern: the exclusion rule added earlier reliably excludes a crash log in the project ' +
      'root, where it actually appears, and one that accidentally ends up inside the mod folder as well. ' +
      'The official, published version was never affected either way: it is built on a clean machine ' +
      'through the automated release and cannot contain files like that in the first place.'
  },
  'aufgabenanzeige-bleibt-stehen': {
    title: 'The task panel no longer goes away once any job has finished',
    detail:
      'The small panel at the bottom for running jobs (downloading, repairing, installing) is meant to ' +
      'keep a finished entry on screen for about three seconds and then fade it out. The timer for that is ' +
      'cleared again by its own state change before it can fire. A finished or cancelled job therefore ' +
      'stays in the panel for good, and the panel itself does not disappear for the rest of the session. ' +
      'Failed jobs also have no button to dismiss them, only running ones do. The main process does forget ' +
      'an old job after a short while, but does not tell the interface, so the list keeps growing in the ' +
      'background over a session.'
  },
  'rechtsklickmenue-beim-scrollen': {
    title: 'The right-click menu stays put while scrolling and can act on the wrong instance',
    detail:
      'Right-clicking an instance or a mod to open its menu and then scrolling the list moves the content ' +
      'underneath away while the menu stays where it is. It then sits over a different row than the one it ' +
      'was opened for. Choosing an entry such as "Repair" or "Favourite" at that point acts on the ' +
      'original instance, not the one the menu now appears over. The menu closes on a window resize, but ' +
      'not on scroll. Separately, the keyboard selection inside the menu jumps back to the first entry on ' +
      'every background refresh.'
  },
  'konto-entfernen-ohne-rueckfrage': {
    title: 'An account can be removed with a single click and no confirmation',
    detail:
      'The accounts window shows a bin icon next to every account. Clicking it removes the account right ' +
      'away, with no confirmation and no way to undo it. Hit the icon by accident and the account is gone ' +
      'and has to be added back through the full Microsoft sign-in. If the removal fails in the ' +
      'background, there is no feedback about it.'
  },
  'fehlerbericht-frage-wegklicken': {
    title: 'Dismissing the crash-report question turns it off for good',
    detail:
      'On the first start after setup the launcher asks once whether crash reports may be sent. Closing ' +
      'that window with Escape, a click outside it or the X, rather than using one of the two buttons, is ' +
      'treated exactly like an explicit "No thanks": crash reports are turned off and the question does ' +
      'not come back. Anyone who only meant to dismiss it and decide later has to turn the setting back on ' +
      'by hand under Settings, Crash reports.'
  },
  'einstellungen-schreiben-bei-jeder-aenderung': {
    title: 'Sliders and the JVM arguments field write to disk on every smallest change',
    detail:
      'The sliders in Settings (memory, concurrent downloads, number of automatic backups) and the text ' +
      'field for JVM arguments save every intermediate step immediately. Dragging a slider from one end to ' +
      'the other triggers dozens of separate writes, every character in the arguments field one more. Each ' +
      'of those is a full, atomic rewrite of the settings file in the main process. On a slow disk, or ' +
      'with antivirus scanning every file, the slider stutters noticeably and the interface hitches ' +
      'briefly. The file is not corrupted by this, the writes run one after another.'
  },
  'escape-schliesst-mehrere-fenster': {
    title: 'Escape closes two stacked windows at once',
    detail:
      'Every window in the launcher listens for the Escape key on its own, without checking whether it is ' +
      'the topmost one. With two windows open on top of each other, such as a mod detail view and above it ' +
      'the picker for a specific version, one press of Escape closes both at once instead of just the top ' +
      'one. You then do not land back in the detail view but all the way out of the flow.'
  },
  'entdecken-modpack-nicht-als-installiert': {
    title: 'In "Discover" an already installed modpack is not recognised as installed',
    detail:
      'On the "Discover" page the launcher compares the listed modpacks against the existing instances ' +
      'using two different spellings of the project id. The comparison therefore never matches. A modpack ' +
      'you have already installed as an instance keeps showing "Install" instead of "Installed", and the ' +
      'button stays clickable. A second click creates a second, complete instance of the same modpack.'
  },
  'loader-abfrage-ohne-fehlerhinweis': {
    title: 'If the mod-loader lookup fails, every loader shows as unavailable',
    detail:
      'When creating an instance the wizard looks up which mod loaders exist for the chosen Minecraft ' +
      'version (Fabric, NeoForge, Forge, Quilt). If one of those lookups fails, for instance during a ' +
      'brief network drop or when the metadata service is unreachable, the affected loader is silently ' +
      'listed as "no version available". If all four lookups fail, it looks as though this Minecraft ' +
      'version has no loader at all. There is no hint that the lookup merely failed and that trying again ' +
      'might help.'
  },
  'mod-update-entfernen-wettlauf': {
    title: 'Updating a mod while removing it at the same time could bring the removed mod back',
    detail:
      'The lock that coordinates changes to an instance’s mods is a counter, not a real mutual ' +
      'exclusion: it only tells outside code that something is happening, but does not keep two ' +
      'concurrent calls for the same mod apart. If an update for a mod was still running while the same ' +
      'mod was removed, the already-downloaded new file could survive with no record left pointing at ' +
      'it. The next folder reconciliation then found that file and treated it as a new, local mod, ' +
      'bringing back exactly the mod the user had just removed. This is a separate, previously unknown ' +
      'path to the same symptom as the already-fixed "A removed mod could reappear on its own" issue, ' +
      'through a different trigger. Updating and removing the same mod now necessarily run one after ' +
      'the other instead of at the same time.'
  },
  'inhalt-typ-uebergreifende-kollision': {
    title: 'A resource pack, shader pack and datapack with the same name could delete each other',
    detail:
      'The check for whether a newly installed file replaces an existing one compared only the bare ' +
      'file name, not the kind of content. Resource packs, shader packs, datapacks and mods live in ' +
      'separate folders but often carry generic names like "pack.zip". If such a name happened to match ' +
      'an existing item of a completely different type, that item’s file was deleted and its record ' +
      'removed from the list, even though it had nothing to do with what was just installed. The ' +
      'comparison now also takes the content type into account everywhere this happened.'
  },
  'abhaengigkeit-anbieter-uebergreifend': {
    title: 'A missing required dependency of a mod could go unnoticed',
    detail:
      'When automatically installing missing dependencies, only the project id was compared, not the ' +
      'provider as well. CurseForge assigns plain numeric ids, Modrinth short strings; a coincidental ' +
      'match between a CurseForge and a Modrinth id would have made a genuinely missing dependency read ' +
      'as already installed and skipped the install attempt, with no message at all. The same risk was ' +
      'already recognised and guarded against elsewhere, in the compatibility check, but was missed ' +
      'here. The comparison now checks the provider here too.'
  },
  'absturzerkennung-ignoriert-signal': {
    title: 'A real crash on macOS or Linux was not recognised as a crash',
    detail:
      'Whether an ended game counted as a crash depended only on its exit code. A process terminated by ' +
      'an operating system signal, for instance on a genuine memory access violation or when the ' +
      'operating system kills it for running out of memory, reports no code at all rather than a ' +
      'specific one. That exact value used to be read as an ordinary, clean exit. The result: no crash ' +
      'notice, no red badge, and the session history permanently read "no crash" even though one had ' +
      'happened. Only macOS and Linux are affected; Windows has no signal of this kind. The check now ' +
      'also takes the signal into account, confirmed with a dedicated test run against a process ' +
      'genuinely terminated by a signal.'
  },
  'start-meldet-erfolg-vor-fehler': {
    title: 'A failed launch could briefly read as successful',
    detail:
      'After the Java process started, several steps ran without waiting for anything: recording play ' +
      'time, the "running" status, and reporting success back to the caller. If the launch actually ' +
      'failed, for instance because a wrapper or Java file had been moved or deleted in the meantime, ' +
      'Node only reports that failure one step later than those steps could have known about. That ' +
      'briefly reported success, updated an instance’s last-played time even though the game never ' +
      'ran, before the status display corrected itself moments later. Confirmed with a dedicated test ' +
      'run against a genuinely failing launch: the launcher now waits until the process has actually ' +
      'come up before treating it as a success.'
  },
  'eingestellte-java-version-ungeprueft': {
    title: 'A fixed but wrong Java version led to an unclear crash with no hint why',
    detail:
      'If an instance has its own Java path set, that one is always used as long as the installation ' +
      'there runs at all, regardless of whether it is the Java version this Minecraft version actually ' +
      'needs. Automatic Java selection checks exactly that carefully and reports a mismatch clearly; the ' +
      'fixed path bypassed that check entirely. The result was an unclear technical error on launch, ' +
      'with no hint at the real cause. The fixed path is still used, that stays unchanged on purpose, ' +
      'but a mismatch is now logged and reported to the user.'
  },
  'instanz-aktualisieren-ungefiltert': {
    title: 'Instance edits from the interface were not limited to safe fields in the main process',
    detail:
      'The function that saves an instance’s name, description, appearance and settings accepted an ' +
      'arbitrary partial object for that and wrote it unchecked into the stored instance. Today’s ' +
      'interface only ever sends harmless fields here, but a future bug elsewhere could have used the ' +
      'same path to change the version, loader or install status too, in the middle of an active install ' +
      'or repair, leaving the stored record out of step with what is actually installed. The function ' +
      'now only accepts the fields it is actually meant for.'
  },
  'verknuepfung-ueberschreibt-fremde-datei': {
    title: 'A desktop shortcut could overwrite a different, same-named file',
    detail:
      'A created desktop shortcut’s file name was based purely on the instance’s name, with no check ' +
      'for whether something already sat at that location. Two instances with the same or a similar ' +
      'name, or an existing, unrelated file with the same name already on the desktop, were silently ' +
      'overwritten as a result. The shortcut now checks whether a file already at that location already ' +
      'belongs to the same instance; if not, a numbered name is used instead.'
  },
  'aufnahme-falsches-fenster': {
    title: 'With several instances running at once, recording could grab the wrong window',
    detail:
      'Recording picks its capture source by window title, the first window with "Minecraft" in it. ' +
      'With several instances running at the same time, that could be a different window than the one ' +
      'recording was started for, with no error at all. The selection now prefers a window whose title ' +
      'contains the started instance’s own Minecraft version. That considerably narrows the common ' +
      'case of different versions, but does not fully solve it: two instances on the exact same ' +
      'Minecraft version running at once still cannot be told apart reliably by window title.'
  },
  'curseforge-kategorien-verschluckt-fehler': {
    title: 'A missing CurseForge key made the category list simply look empty',
    detail:
      'Unlike search, which explicitly checks for and reports a missing CurseForge API key, the same ' +
      'failure while loading the category list was silently swallowed into an empty list. Without a key ' +
      'set, CurseForge’s category filter therefore just showed nothing, with no explanation why. A ' +
      'missing key is now reported the same way search already does.'
  },
  'netzwerk-fehler-unvollstaendig': {
    title: 'Modrinth error messages were needlessly unclear, and rate-limit wait times were ignored',
    detail:
      'Two related gaps in the same spot: first, error parsing read several known fields from an error ' +
      'response, but not the field Modrinth actually sends its error text in, so every Modrinth error ' +
      'showed up as a bare technical code. Second, on a rate limit (error 429) the launcher always ' +
      'waited a fixed, short amount of time instead of honouring the actual wait time Modrinth or ' +
      'CurseForge sent in the response headers, giving up after roughly three seconds even when the ' +
      'service would have been ready again moments later. Both are fixed now.'
  },
  'cache-verwirft-frische-daten': {
    title: 'A write failure while caching could discard freshly fetched data',
    detail:
      'If writing the cached copy of a version list to disk failed, for instance because there was no ' +
      'space left, that was treated the same as a failed network request: the old, stale cache was used ' +
      'instead, even though the actual request had just successfully delivered fresh data. A write ' +
      'failure while caching is now only logged, the freshly fetched data is used regardless.'
  },
  'datei-import-verwirft-erfolge': {
    title: 'Adding several files at once could lose every one of them over a single broken file',
    detail:
      'When several mod or pack files were selected at once and importing one of them failed, for ' +
      'instance because it was corrupted, the whole operation aborted with an error. Files from the same ' +
      'selection that had already been added successfully were lost from the response, even though they ' +
      'really had been added. Each file is now handled on its own: successful ones are kept, a failed ' +
      'one is reported without discarding the rest.'
  },
  'duplikat-fix-zeigt-falsches-element': {
    title: 'The notice about a duplicate mod could highlight a different item than the fix removed',
    detail:
      'For a mod installed twice, the compatibility check highlights one of the two copies, and the ' +
      'matching automatic fix removes one of them. Which copy was highlighted and which one the fix ' +
      'actually removed could end up different, purely because of the order in which the code computed ' +
      'the two values. No data loss, since a genuine duplicate was removed either way, but potentially ' +
      'confusing. Both now reliably point at the same, older copy.'
  },
  'vorstart-befehl-kein-sigkill': {
    title: 'A pre-launch command that ignores a graceful stop could keep running as an orphan',
    detail:
      'If a configured pre-launch command ran too long, or the launch was cancelled, it used to be ' +
      'stopped gently exactly once. A command that ignores or traps that signal stayed alive as an ' +
      'invisible background process, even though the launcher had already reported the launch as ' +
      'stopped or cancelled. The same two-stage approach (gentle first, forced after a short grace ' +
      'period) has long existed for stopping the game itself; it was missing here. A pre-launch command ' +
      'now gets the same forcing second stage.'
  },
  'download-ohne-pruefsumme-vertraut': {
    title: 'An incompletely downloaded file with no checksum was trusted as complete for good',
    detail:
      'A downloaded file that came with neither a checksum nor a known size counted as complete as soon ' +
      'as it was not empty. If a download broke off incomplete at that point, for instance through a hard ' +
      'interruption mid-transfer, the broken file was accepted as present on the next start and never ' +
      'downloaded again. This limit remains for loader libraries and stays noted in the code as such, ' +
      'there is no official checksum there to compare against. For downloading the Java runtime itself, ' +
      'where the same used to apply, the actual file size is now looked up from Adoptium beforehand and ' +
      'used for verification, both while downloading and when a file already on disk is checked.'
  },
  'java-installation-abbruch-nicht-verdrahtet': {
    title: 'A cancel could be ineffective for a shared Java installation',
    detail:
      'If two instances wait on the same Java installation at once, they share one download. If the ' +
      'second instance cancelled its own launch while the first kept going, its cancel signal was not ' +
      'connected to the download actually in progress: the second instance’s "Cancel" button looked like ' +
      'it worked while the download kept running in the background, and worse, the second instance simply ' +
      'kept waiting until the shared installation finished or failed on its own, regardless of what its ' +
      'own cancel button said. Every waiting instance now has its own, immediately effective cancel; the ' +
      'shared installation itself keeps running as long as at least one other instance is still waiting on ' +
      'it, and only actually stops once nobody is left waiting.'
  },
  'java-installation-verwirft-bei-umbenennen': {
    title: 'A single, transient file error could discard an entire, finished Java installation',
    detail:
      'At the end of a Java installation, the fully extracted and verified folder is moved into its final ' +
      'place. If exactly that last step failed once, for instance because antivirus software briefly held ' +
      'one of the freshly extracted files open, the entire already-downloaded and extracted installation ' +
      'was deleted and started completely over on the next attempt, instead of just retrying that one ' +
      'step. Such a rename attempt is now retried once after a short wait before giving up, proven with a ' +
      'genuinely, briefly locked file.'
  },
  'fehlende-bibliothek-ohne-download-feld': {
    title: 'The check for missing libraries could overlook some cases',
    detail:
      'The check for whether Java libraries needed at launch are actually present only looked at entries ' +
      'that carry a download address. Some version definitions, mainly known from Forge and NeoForge, ' +
      'list libraries with no address of their own because the installer places them itself. If such a ' +
      'file was genuinely missing, it was silently skipped instead of reported as missing, resulting in an ' +
      'unclear error in the middle of launching. Confirmed with a real example of this exact pattern: of ' +
      'two deliberately missing libraries, the old check reported only one, the corrected check both. It ' +
      'now checks every needed library regardless of whether a download address is known.'
  },
  'ordner-abgleich-typ-uebergreifend': {
    title: 'A resource pack, shader pack and datapack with the same name could get swapped during disk reconciliation',
    detail:
      'The ongoing reconciliation between the mod/pack list and what is actually in the folders (run ' +
      'before every launch, every repair, and every compatibility check, among others) compared files by ' +
      'their bare name only, not their type. Resource packs, shader packs and datapacks live in separate ' +
      'folders but often carry generic names like "pack.zip". If two of them happened to share a name, ' +
      'their records got swapped: one folder’s file ended up carrying the other’s metadata, with the ' +
      'wrong type and a shared id. Three related spots with exactly this pattern were already fixed; this ' +
      'fourth one, responsible for the ongoing reconciliation, was still open.'
  },
  'instanz-speichern-vor-bestaetigung-uebernommen': {
    title: 'An instance edit could take effect in memory even though it never reached disk',
    detail:
      'Saving an instance updated the in-memory copy before the actual write to disk was confirmed. If ' +
      'the write failed, for instance because antivirus or an indexer briefly held the file, the launcher ' +
      'kept running with the unsaved state for the rest of the session while the file on disk still held ' +
      'the old one. Only a restart exposed this, when the change had quietly vanished. The exact same ' +
      'pattern had already been found and fixed once for general settings, but was missed for instances. ' +
      'The write now happens first, the in-memory copy only afterwards.'
  },
  'loeschen-verliert-daten-trotz-fehlermeldung': {
    title: 'Deleting could irreversibly remove an instance’s game data and still report failure',
    detail:
      'Deleting an instance removed the actual instance folder (worlds, mods, screenshots) and its ' +
      'backups folder in one combined attempt. If only removing the backups folder failed, for instance ' +
      'because antivirus briefly held a backup file open, the launcher reported the deletion as failed, ' +
      'even though the actual game data was already irreversibly gone by that point. The instance stayed ' +
      'visible in the library, with an internal state no longer matching the files that actually existed. ' +
      'The two steps are now handled separately: if only the backups folder fails, the instance still ' +
      'counts as deleted, and a leftover backups folder is merely logged.'
  },
  'duplizieren-ohne-sperre-waehrend-kopie': {
    title: 'Deleting or repairing an instance while it was being duplicated could produce a broken copy',
    detail:
      'Before duplicating an instance, the launcher checks once whether it is currently running, ' +
      'starting, being repaired, or having its mods worked on. The actual copy afterwards, which can take ' +
      'several seconds for a large modpack or world, held no lock of its own. In that window, a delete or ' +
      'repair of the same source instance could begin while it was still being copied from, potentially ' +
      'producing an incomplete or inconsistent copy. The copy now marks itself busy for its entire ' +
      'duration.'
  },
  'inhalt-hinzufuegen-gross-kleinschreibung': {
    title: 'Re-adding a mod with different capitalisation in the file name could create a duplicate entry',
    detail:
      'Windows and macOS do not distinguish file names by case, but the comparison when adding a content ' +
      'item did. Re-importing an already tracked mod under a different capitalisation of its file name ' +
      '(such as "Mod.jar" instead of "mod.jar", the same physical file) failed to recognise the old ' +
      'record, leaving two lines for the same file until the next disk reconciliation merged them. The ' +
      'comparison is now case-insensitive, matching how the same flow already treats it elsewhere.'
  },
  'reparatur-uebergeht-beschaedigte-lokale-datei': {
    title: 'Repair detected a corrupted, hand-added file but did nothing about it and reported no error',
    detail:
      'For a hand-added mod file with no known source, repair checks its existing checksum. If the file ' +
      'was missing, its record was correctly removed. If it was present but simply corrupted (checksum no ' +
      'longer matches), nothing happened at all: no repair, since there is nothing to re-download for a ' +
      'file with no known source, but also no mention in the final report. The report could therefore ' +
      'read "fine" or "repaired" even though a demonstrably corrupted file sat untouched on disk. This ' +
      'case is now listed in the report as not automatically fixable.'
  },
  'reparatur-meldet-installiert-trotz-fehler': {
    title: 'Repair marked an instance as fully installed even when individual steps had failed',
    detail:
      'At the end of a repair, the instance was always saved as fully installed, regardless of whether ' +
      'any of the eight repair steps itself counted as failed. A network outage in the middle of the core ' +
      'steps (game files, assets, Java) left the instance genuinely incomplete while the saved state still ' +
      'said "fully installed", contradicting its own report right below it. The flag now depends on ' +
      'whether the repair actually completed without a failure; on a failure, the previous state is left ' +
      'unchanged rather than wrongly set to installed.'
  },
  'reparatur-java-pruefung-veralteter-stand': {
    title: 'A Java setting changed during an active repair was still checked against the old value',
    detail:
      'Repair read an instance’s settings once at the very start and worked from that one snapshot for ' +
      'its entire run, which can take several minutes for a larger instance. If someone changed that ' +
      'instance’s fixed Java path or Java version override while it was running, the repair’s Java step ' +
      'still checked against the old setting and could report "Java fine" even though the newly saved ' +
      'setting was never checked at all. This one step now re-reads the settings immediately before the ' +
      'actual check, exactly as the mod step of the same repair already did.'
  },
  'quilt-neueste-version-falsch-ausgewaehlt': {
    title: 'Setting up an instance with Quilt could pick an old prerelease instead of the latest stable version',
    detail:
      'Contrary to what the code assumed, Quilt’s own server for loader versions carries no field marking ' +
      'a version as stable, and the list does not come back in any meaningful order either. Measured ' +
      'live: for an ordinary Minecraft version, an old beta build sat first in the list, with genuinely ' +
      'newer, real releases further back. "Latest stable version" used to be read straight off that first ' +
      'entry, so setting up a new instance with Quilt effectively depended on luck rather than the actual ' +
      'newest version. The list is now sorted by version number itself, and a genuine prerelease is ' +
      'recognised by its name, not by a field Quilt never sends. Fabric is unaffected; its own ' +
      'designation of the recommended version remains authoritative.'
  },
  'forge-installer-url-fuer-alte-versionen-kaputt': {
    title: 'Forge installation failed for several older, commonly modded Minecraft versions',
    detail:
      'Some older Forge releases sit on the official server under a path carrying an extra name suffix. ' +
      'That suffix was stripped while building the version list, to match the version against Forge’s ' +
      'separately maintained list of "recommended" versions, but was never added back when actually ' +
      'downloading the installer. Measured live: the resulting address responded "not found", the ' +
      'correct one, with the suffix, succeeded. This hit exactly the version Forge itself recommends for ' +
      'several older, especially widely modded Minecraft versions (among them 1.7.10, 1.8.9, 1.9.4). ' +
      'Anyone setting up an instance with Forge for one of these versions could not download the ' +
      'installer.'
  },
  'loader-fehler-wird-verschluckt': {
    title: 'A failed mod-loader version lookup was already swallowed by Fabric, Quilt, Forge and NeoForge themselves',
    detail:
      'The instance wizard recently started telling "no loader available for this version" apart from ' +
      '"the lookup itself failed", with a hint and a retry button for the second case. That distinction ' +
      'could never actually trigger: the four functions that perform the real lookup for Fabric, Quilt, ' +
      'Forge and NeoForge each caught every error themselves and silently returned an empty list before ' +
      'the wizard ever got to see the difference. A genuine network problem therefore still looked like a ' +
      'plain absence for all four supported loaders, with none of the intended hint. A failure is now ' +
      'passed through to the wizard instead of being hidden at this point.'
  },
  'safejoin-laufwerkswurzel-bricht': {
    title: 'The central path safeguard could reject every path when the data directory sat directly on a drive root',
    detail:
      'The function that checks every path built from untrusted sources (archives, loader metadata) ' +
      'against escaping its allowed folder compared the result against that folder with a separator ' +
      'always appended. If the allowed folder itself sits directly on a drive or share root (a dedicated ' +
      'drive just for Minecraft data, say), its resolved path already carries a separator, doubling it in ' +
      'the comparison and, as a result, rejecting every path, even a completely harmless one. No known ' +
      'caller uses such a root folder today, so this had no effect so far, but a dedicated drive as a data ' +
      'directory is a real, plausible setup. The comparison now works regardless of whether the allowed ' +
      'folder already carries a trailing separator.'
  },
  'versions-id-reservierter-name': {
    title: 'A version id from a loader metadata server with a reserved Windows name could abort installation hard',
    detail:
      'Windows refuses certain names ("con", "aux", "nul", among others) as file or folder names, ' +
      'regardless of case or file extension. That is already guarded against for instance names, but the ' +
      'same guard was missing for the version id a Fabric/Quilt metadata server or a Forge installer ' +
      'profile supplies. Such an id is used directly as a folder and file name; if it happened to match, ' +
      'or a tampered source deliberately supplied, one of these reserved names, installation aborted on ' +
      'Windows with a raw, confusing filesystem error instead of one of the clear messages this install ' +
      'path otherwise gives. The same guard already used for instance names now applies here too.'
  },
  'schliessen-beendet-laufendes-spiel': {
    title: 'Closing the launcher window could end a running game along with it, even though it was meant to keep going',
    detail:
      'The window’s close button always fully quit the launcher. With an instance running at the ' +
      'time, Minecraft ended up quitting along with it in practice, even when Settings, Game Launch had ' +
      'the option set to keep a running game going. The button simply never checked that setting. It now ' +
      'does: with at least one instance running and nothing explicitly set to close it along with the ' +
      'launcher, the window is now only hidden instead of quitting the launcher, exactly the way it ' +
      'already works for the automatic hide while playing. It reappears on its own once the last running ' +
      'game has ended.'
  },
  'fabric-quilt-pruefsumme-verworfen': {
    title: 'A checksum Fabric or Quilt supplied was never read',
    detail:
      'For libraries that bring their own maven address instead of a ready-made download URL, the usual ' +
      'case for Fabric and Quilt, the launcher built the download with no checksum and no expected size, ' +
      'even though both sit right next to each other in the very same loader metadata. The internal data ' +
      'type for these libraries simply did not know the fields existed. Anyone able to reach or intercept ' +
      'the Fabric or Quilt maven server could have substituted a wrong file for either of the two most ' +
      'used loaders without the launcher noticing. The checksum is now carried through and checked ' +
      'whenever the source supplies one.'
  },
  'zip-entpacken-ohne-groessendeckel': {
    title: 'A modpack with one heavily compressed file could crash the launcher',
    detail:
      'When unpacking a modpack’s extra files (for instance custom configs from a .mrpack or a CurseForge ' +
      'package), every file was fully unpacked into memory without first checking how large it would ' +
      'actually become. A single, deliberately tiny but extremely heavily compressed file inside an ' +
      'otherwise ordinary-looking modpack could have demanded several gigabytes of memory during import ' +
      'and crashed the launcher. Every extraction point in the program now checks the declared size ' +
      'against a limit first.'
  },
  'instanzbild-pfad-nicht-abgesichert': {
    title: 'A custom instance icon or background could in theory escape its intended folder',
    detail:
      'The function that turns a stored icon or background reference into an actual file path used a ' +
      'plain path join at this one spot instead of the checked function used everywhere else in the ' +
      'program for exactly this purpose. A reference containing "../" segments could have pointed at a ' +
      'file outside the icon folder. Nothing in the launcher’s ordinary use could trigger this, only an ' +
      'unusual value forced in from outside. The spot now uses the same checked function as the rest of ' +
      'the program.'
  },
  'java-test-kanal-ohne-einschraenkung': {
    title: 'An internal channel never used by the interface could run any file at all',
    detail:
      'A technical channel meant to check a Java installation at a given path only checked that some ' +
      'file existed there, then ran it. There was no check that it was actually a Java installation. ' +
      'This channel was never called by the launcher’s own interface at any point. Since it still ' +
      'existed, it was removed entirely rather than merely restricted. The actual Java detection, which ' +
      'only ever checks paths it found itself, is unaffected.'
  },
  'sicherungs-pfad-ohne-instanzpruefung': {
    title: 'Three backup functions did not check whether the given instance actually exists',
    detail:
      'Listing backups, deleting a backup, and restoring a backup built the affected folder path ' +
      'directly from the given instance id, without first checking, the way a nearby function in the ' +
      'same area already did, that this id belongs to an instance that genuinely exists. Nothing in the ' +
      'launcher’s ordinary use could trigger this, since it always already works from an opened or ' +
      'listed, so genuine, instance there. All three now check that the instance exists first, exactly ' +
      'like the fourth, comparable spot already did.'
  },
  'download-umleitung-ohne-ziel-einschraenkung': {
    title: 'A download could be redirected to an address on the user’s own network',
    detail:
      'When a mod or modpack file is downloaded from an address that redirects to another one, the ' +
      'launcher followed that redirect without checking where it actually leads. A manipulated download ' +
      'address could have triggered a request to an address on the user’s own network (for instance the ' +
      'machine itself or another device on the same network), though nothing beyond a single, harmless ' +
      'request would have resulted. Redirects to such addresses are now refused.'
  },
  'einstellungsdatei-ohne-eingeschraenkte-rechte': {
    title: 'The settings and account files were saved without restricted file permissions',
    detail:
      'The files holding settings and account data were written with the operating system’s default ' +
      'permissions. On a machine shared between several user accounts, mainly on Linux or macOS, another ' +
      'account on the same machine could have read these files. On Windows this matters much less, due ' +
      'to the usual folder inheritance of one’s own user profile. Both files are now written readable ' +
      'only by the owning account.'
  },
  'curseforge-schluessel-unverschluesselt': {
    title: 'A custom CurseForge API key sits unencrypted in the settings file',
    detail:
      'Unlike the Microsoft sign-in data, a custom CurseForge API key that has been entered is not ' +
      'protected by the operating system’s encryption, only stored as plain text. The field only ' +
      'matters to anyone who entered their own key in the first place. A real fix would change the ' +
      'settings file’s storage format and need to carry over already-saved keys, which is still ' +
      'outstanding.'
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
