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
  },
  'sicherung-ordner-liste-ohne-pruefung': {
    title: 'The folder list for backing up and restoring was not limited to the real backup folders',
    detail:
      'Which subfolders of an instance a backup covers (worlds, config, mods and so on) is stored as ' +
      'a short list of folder names and read back both when creating and when restoring a backup. ' +
      'This list was inserted into file paths unchecked. A list with "../" segments could therefore ' +
      'have packed a folder outside the instance when creating a backup, and moved a folder outside ' +
      'the instance when restoring one. Nothing in the launcher’s ordinary use could trigger this, ' +
      'since only the six intended folder names are ever offered there. Both spots now accept only ' +
      'those six known names, anything else is dropped.'
  },
  'instanz-aktualisieren-ohne-feldbeschraenkung': {
    title: 'Editing an instance was not limited to the fields meant for it',
    detail:
      'An instance’s name, description, group, appearance, settings and favourite status can be ' +
      'changed through a dedicated edit call. The function behind it, however, actually accepted any ' +
      'field handed to it, not only those six, because the restriction only existed as a type ' +
      'declaration, never enforced at runtime. Nothing in the launcher’s ordinary use could trigger ' +
      'this, since the interface never sends more than those six fields. The function now accepts ' +
      'only those six fields, regardless of whatever else is sent along with them.'
  },
  'inhalt-umbenennen-ohne-pruefung': {
    title: 'Enabling and disabling a mod or a pack did not check the file name',
    detail:
      'Every other spot that touches a mod, resource pack, shader pack or data pack file first reduces ' +
      'its name to a bare file name with no folder parts. Enabling and disabling one (adding or ' +
      'removing the extension Minecraft recognises as disabled) did not do that and built the path ' +
      'straight from the stored name. Nothing in the launcher’s ordinary use could trigger this, since ' +
      'a file name only ever arrives there already cleaned up. This spot now uses the same check as ' +
      'the rest of the program.'
  },
  'reparatur-abbrechen-wirkungslos': {
    title: 'A repair could not really be cancelled',
    detail:
      'Clicking Cancel only stopped the first steps of a repair. Re-downloading mods and cleaning up kept ' +
      'running in the background, and the task list even said "Done" at the end. From 1.0.20 every step ' +
      'stops on cancel, and the task list says plainly that it was cancelled.'
  },
  'reparatur-kaputte-versionsdatei': {
    title: 'The repair could not replace a damaged version file',
    detail:
      'If an instance’s version description was present but damaged, the repair noticed it but left the ' +
      'file in place, so every later attempt failed at the same spot. From 1.0.20 an unreadable version ' +
      'file is removed and downloaded again.'
  },
  'reparatur-bericht-verloren': {
    title: 'The repair stopped entirely on single errors instead of listing them in its report',
    detail:
      'Some repair steps, such as recreating the natives folder, did not catch errors. A file briefly locked ' +
      'by a virus scanner was enough to replace the step-by-step report with a bare "Repair failed". From ' +
      '1.0.20 every error shows up as its own step and the remaining steps carry on.'
  },
  'reparatur-ohne-pruefsumme': {
    title: 'The repair missed damaged files that came without a checksum',
    detail:
      'Some CurseForge mods and some libraries come without a checksum. The repair only checked that such ' +
      'files exist, not that they are intact. From 1.0.20 it compares the file size in that case and checks ' +
      'that a jar archive can actually be opened.'
  },
  'client-jar-fehlt-unklarer-absturz': {
    title: 'A missing game file led to an incomprehensible crash',
    detail:
      'If Minecraft’s own main file was missing, for example after an interrupted download, the launcher ' +
      'started the game anyway and Java stopped with a cryptic message. From 1.0.20 this is caught before ' +
      'launch and reported with a hint to repair the instance.'
  },
  'fenstergroesse-alte-versionen': {
    title: 'The configured window size had no effect before Minecraft 1.13',
    detail:
      'Width and height from the instance settings were only passed to newer Minecraft versions. Older ' +
      'versions always started at their default size. From 1.0.20 the setting applies to every version.'
  },
  'stoppen-fehlgeschlagen-absturz-verschluckt': {
    title: 'A failed stop could hide a later crash',
    detail:
      'If "Stop" could not end a game, for example because security software prevented it, the launcher ' +
      'still remembered that a stop was requested. If the same game then really crashed, that counted as ' +
      'an intended stop and no crash message appeared. From 1.0.20 a failed stop is reported and no longer ' +
      'counted as a stop.'
  },
  'java-ersatz-falsche-version': {
    title: 'With Java management switched off, an unsuitable Java could be picked',
    detail:
      'If an instance needed Java 8 and only a newer Java up to version 12 was installed, the launcher used ' +
      'that instead. That exact jump reliably crashes old Forge versions. From 1.0.20 there is no stand-in ' +
      'for Java 8 any more, just a clear message.'
  },
  'forge-versionsliste-unsortiert': {
    title: 'The list of Forge versions was not sorted properly',
    detail:
      'Forge does not deliver its version list in one consistent order. The launcher relied on it, so new ' +
      'and old builds were mixed up in the Forge build picker. From 1.0.20 the launcher sorts the list ' +
      'itself, newest first.'
  },
  'forge-installer-ohne-pruefung': {
    title: 'The Forge installer could run without a checksum',
    detail:
      'If fetching the checksum for the Forge or NeoForge installer failed, the launcher downloaded and ran ' +
      'the installer anyway. From 1.0.20 the checksum is retried several times, and without it the ' +
      'installation stops with a clear message.'
  },
  'mod-schalten-waehrend-update': {
    title: 'Toggling a mod during its update could leave an orphaned file',
    detail:
      'While a mod was updating it could still be switched on and off. When both happened together, the ' +
      'update could overwrite the change and leave a file behind that the launcher then listed as an ' +
      'unknown mod. From 1.0.20 toggling and updating wait for each other.'
  },
  'duplikat-erkennung-nach-namen': {
    title: 'The compatibility check could suggest removing an unrelated mod with the same name',
    detail:
      'Duplicate mods were detected by name alone. Two different mods sharing a name counted as a duplicate, ' +
      'and the offered fix would have deleted one of them. From 1.0.20 removal is only offered when it is ' +
      'certainly the same mod. A mere name match gets a note without a delete button.'
  },
  'instanz-kopie-ohne-bild': {
    title: 'A duplicated instance lost its custom icon and background',
    detail:
      'Duplicating copied the game files but not the instance’s own images, so the copy showed the ' +
      'default icon. From 1.0.20 icon and background are copied along.'
  },
  'instanz-kopie-waehrend-modaenderung': {
    title: 'Duplicating could collide with mod changes happening at the same time',
    detail:
      'While a large instance was being copied, mods could still be installed or updated on it. Copying ' +
      'could then fail or produce a copy with half-changed mods. From 1.0.20 mod changes wait until copying ' +
      'is done.'
  },
  'instanz-loeschen-halb': {
    title: 'Deleting an instance could leave it half deleted',
    detail:
      'If a virus scanner briefly held a file during deletion, deleting stopped halfway. The launcher kept ' +
      'showing the instance as complete even though part of its files were already gone. From 1.0.20 ' +
      'deletion is retried, and after a failure the list shows the real state.'
  },
  'mod-abgleich-bricht-ab': {
    title: 'The mod list scan stopped when a file vanished during it',
    detail:
      'If a file in the mods folder was deleted or moved right during the scan, for example by cloud sync, ' +
      'the whole scan failed. From 1.0.20 that one file is skipped.'
  },
  'gross-kleinschreibung-doppelte-mods': {
    title: 'Two mod files differing only in upper and lower case were mixed up',
    detail:
      'When two such files sat in the same folder, both got the same entry. Removing or toggling one then ' +
      'hit both entries although only one file changed. From 1.0.20 each file gets its own entry.'
  },
  'update-nach-rueckstufung': {
    title: 'After a deliberate downgrade, no updates were shown any more',
    detail:
      'Installing an older version of a mod through "Choose version" often meant no update was ever shown ' +
      'for that mod again. The comparison used the install time instead of the release date of the ' +
      'installed version. From 1.0.20 the release date counts.'
  },
  'versionswechsel-alte-datei-bleibt': {
    title: 'Switching a mod’s version could leave the old file behind',
    detail:
      'If the old file was briefly locked while switching to another version, it stayed next to the new ' +
      'one. Two files of the same mod make Minecraft crash on the next start. From 1.0.20 the deletion is ' +
      'retried, and if it still fails the new file is not left half registered.'
  },
  'modrinth-abhaengigkeit-verschwindet': {
    title: 'A required dependency could drop out without a warning',
    detail:
      'If a Modrinth mod pointed to a dependency whose version had since been withdrawn, that dependency ' +
      'silently fell off the list. The warning that the game may not start without it therefore never ' +
      'appeared. From 1.0.20 it does.'
  },
  'curseforge-modpack-fehlende-dateien-still': {
    title: 'A CurseForge modpack import kept quiet about missing mods',
    detail:
      'If single files of a modpack were no longer available on CurseForge, that only showed briefly in the ' +
      'task list and was gone before the import finished. From 1.0.20 a message naming the missing mods ' +
      'stays visible.'
  },
  'import-version-ungeprueft': {
    title: 'The Minecraft version from imported modpacks and folders was not checked',
    detail:
      'On import, the stated Minecraft version was taken over unchecked and later used as a folder name. A ' +
      'crafted modpack could have used that to reach paths outside the launcher folder. From 1.0.20 such ' +
      'values are rejected.'
  },
  'import-installiert-ohne-spieldateien': {
    title: 'An imported instance could count as installed although game files were missing',
    detail:
      'An import ran two setups side by side, one for Minecraft itself and one for the mods. If the first ' +
      'failed, the second could still mark the instance as ready, and the first launch failed for no ' +
      'visible reason. From 1.0.20 an instance only counts as installed once both succeeded.'
  },
  'kopie-haengt-bei-einrichtung': {
    title: 'A copy made during setup stayed stuck',
    detail:
      'Duplicating an instance while it was still being set up produced a copy that showed "setting up" ' +
      'forever. From 1.0.20 duplicating is only possible once setup is finished.'
  },
  'wiederherstellung-rueckabwicklung-unvollstaendig': {
    title: 'A failed restore could leave leftovers behind',
    detail:
      'When a restore failed, the launcher sometimes reported that the previous state was back although ' +
      'half-extracted folders remained. From 1.0.20 the message says exactly what could not be cleaned up.'
  },
  'sicherung-folgt-verknuepfungen': {
    title: 'Backups containing linked folders could not be restored',
    detail:
      'If a backed-up folder contained a link pointing outside the instance, the backup was still created ' +
      'as successful but could never be restored. From 1.0.20 such links are skipped and reported while ' +
      'backing up.'
  },
  'wiederherstellung-entpackt-alles': {
    title: 'A restore could write more than had been protected beforehand',
    detail:
      'Restoring always extracted the whole archive, while only the folders listed in the backup’s index ' +
      'were protected and rolled back. With older backups the two could differ. From 1.0.20 only what is ' +
      'protected gets extracted.'
  },
  'sicherungen-behalten-nicht-rueckwirkend': {
    title: 'Lowering the number of kept backups only took effect later',
    detail:
      'When the number of automatic backups to keep was lowered, older backups stayed until the same ' +
      'instance got its next one. From 1.0.20 they are cleaned up right away.'
  },
  'aufnahme-falsche-instanz': {
    title: 'With two games running, the recording key recorded the wrong one',
    detail:
      'With two instances running, the key always recorded the one started first, not the one started last ' +
      'that is usually being played. The message did not name the instance. From 1.0.20 the most recently ' +
      'started one is recorded and named in the message.'
  },
  'verknuepfungen-zwei-links-verloren': {
    title: 'Two Launch Gabi links opened in quick succession: the first one got lost',
    detail:
      'If two links or shortcuts arrived almost at once while the program was starting, the second ' +
      'overwrote the first. From 1.0.20 both are carried out in order.'
  },
  'datenverzeichnis-ungueltig-gespeichert': {
    title: 'A data folder the launcher could not write to was accepted anyway',
    detail:
      'Choosing a data folder in the settings that the launcher is not allowed to write to still saved the ' +
      'choice, after which all instances seemed to have vanished. From 1.0.20 the folder is checked first ' +
      'and the old one stays if there is a problem.'
  },
  'anmeldung-verschluesselung-wechsel': {
    title: 'An unnecessary sign-in when the system’s encryption changed',
    detail:
      'Whether sign-in data is stored encrypted was noted only once for two separate keys. If the system’s ' +
      'encryption, such as the keyring on Linux, was available one time and not the next, the note no ' +
      'longer matched and a new sign-in was needed. From 1.0.20 it is noted for each key separately.'
  },
  'startseite-wieder-aktiviert': {
    title: 'The custom start screen switched itself back on after being deselected in Minecraft',
    detail:
      'Deactivating the start screen pack inside Minecraft had it silently reactivated on the next launch. ' +
      'From 1.0.20 the launcher respects that choice.'
  },
  'escape-schliesst-zwei-fenster': {
    title: 'Escape in quick search also closed the window underneath',
    detail:
      'With a window open, such as the Microsoft sign-in, and quick search (Ctrl+K) on top of it, Escape ' +
      'closed both at once and cancelled the sign-in. From 1.0.20 Escape only closes quick search.'
  },
  'zahlen-mit-punkt': {
    title: 'In the German interface, sizes showed a point instead of a comma',
    detail:
      'File and memory sizes appeared as "1.5 GB" instead of the German "1,5 GB". From 1.0.20 they use German ' +
      'notation.'
  },
  'assistent-ungueltige-kombination': {
    title: 'The wizard could create an instance with a loader version that does not exist',
    detail:
      'While the wizard was still checking which loaders exist for a Minecraft version, the instance could ' +
      'already be created, even with a combination that does not exist. From 1.0.20 it only continues once ' +
      'the check is done and the choice is valid.'
  },
  'assistent-snapshot-bleibt': {
    title: 'The wizard kept a snapshot selected after snapshots were hidden',
    detail:
      'If a snapshot was selected and snapshots were then hidden, it stayed selected out of sight and was ' +
      'created that way. From 1.0.20 the choice jumps to the newest regular version instead.'
  },
  'arbeitsspeicher-regler-ohne-grenze': {
    title: 'The memory slider allowed more than the computer has',
    detail:
      'The memory sliders went up to 16 or 32 GB depending on where they were, regardless of installed ' +
      'memory. From 1.0.20 every slider ends at the memory actually present.'
  },
  'datapacks-ohne-wirkung': {
    title: 'Installed datapacks had no effect in any world',
    detail:
      'Datapacks went into a collection folder of the instance and showed as installed. Minecraft only ' +
      'reads datapacks from a world\u2019s own folder, though, and they were never copied there. From 1.0.20 ' +
      'the launcher asks which world a datapack should go into, and already installed datapacks can be ' +
      'assigned to a world afterwards.'
  },
  'sicherung-grosse-welten-speicher': {
    title: 'Backing up large worlds could freeze or crash the launcher',
    detail:
      'Creating a backup loaded the entire content into memory at once and only wrote it at the end. With ' +
      'worlds of several gigabytes there was not enough memory for that. From 1.0.20 it is written file by ' +
      'file, whatever the size.'
  },
  'wiederherstellung-absturz-daten-versteckt': {
    title: 'After a crash during a restore, the worlds sat hidden in the backup folder',
    detail:
      'A restore first moves the existing folders aside. If the launcher or the computer crashed right then, ' +
      'those folders stayed in a hidden holding folder and nothing brought them back, which looked like lost ' +
      'worlds. From 1.0.20 the launcher notices this on the next start and restores the previous state.'
  },
  'sicherung-ohne-fortschritt': {
    title: 'Backups and restores showed no progress',
    detail:
      'While a backup was created or restored, only a spinner turned. With large worlds that looked like a ' +
      'frozen window. From 1.0.20 the task list shows the progress.'
  },
  'jvm-argumente-anfuehrungszeichen': {
    title: 'Java arguments with quotes in the middle of a value arrived broken',
    detail:
      'An argument like -Dpath="C:\\Program Files\\x" was passed to Java with a leftover quote, and the launch ' +
      'failed for no visible reason. From 1.0.20 quotes are removed properly anywhere in the argument.'
  },
  'datenordner-wechsel-waehrend-spiel': {
    title: 'The data folder could be changed while a game was running',
    detail:
      'Changing the data folder in the settings while Minecraft was running made the launcher lose track of ' +
      'the running game: stopping it and the live log no longer worked. From 1.0.20 the change is only ' +
      'possible once no game is running.'
  },
  'ordner-oeffnen-laufwerkswurzel': {
    title: '"Open folder" failed when the data folder sat directly on a drive',
    detail:
      'With the data folder directly on a drive such as D:\\, every button that opens a folder claimed the ' +
      'path was outside the launcher folders. From 1.0.20 they work there too.'
  },
  'curseforge-download-gesperrt-rohe-meldung': {
    title: 'A CurseForge mod that cannot be downloaded showed only a technical error',
    detail:
      'Some authors do not allow downloads through other programs on CurseForge. Installing such a mod only ' +
      'showed a raw HTTP message. From 1.0.20 the launcher explains that the mod is only available from its ' +
      'CurseForge page.'
  },
  'kompatibilitaet-einzeln-waehrend-alle': {
    title: 'Fixes in the compatibility window could be started twice',
    detail:
      'While "Fix all automatically" was running, the individual fix buttons stayed clickable. Both runs ' +
      'then got in each other\u2019s way and the window could show the wrong state. From 1.0.20 the buttons ' +
      'are locked while a fix runs.'
  },
  'startseite-spielen-tastatur': {
    title: 'The play button on the home page tiles could not be reached by keyboard',
    detail:
      'On the "Recently played" tiles an instance could only be started or stopped directly with the mouse. ' +
      'From 1.0.20 the keyboard works too.'
  },
  'log-datei-tageswechsel': {
    title: 'The launcher log did not move to a new day and stopped after errors',
    detail:
      'If the launcher stayed open past midnight, it kept writing to the previous day\u2019s log file. After a ' +
      'brief write error, such as a full disk, it logged nothing at all until restarted. From 1.0.20 each day ' +
      'starts a new file, and writing is retried after an error.'
  },
  'versionsauswahl-hervorhebung-fehlt': {
    title: 'The version picker did not highlight the installed version',
    detail:
      'The currently installed version was meant to be highlighted in the list, but the highlight was ' +
      'missing. From 1.0.20 it shows.'
  },
  'einstellungen-ungespeichert-blitzt': {
    title: 'After saving instance settings, "unsaved changes" flashed up briefly',
    detail:
      'If saving corrected a value, such as an empty window width, the unsaved changes bar appeared briefly ' +
      'although everything was saved. Not any more from 1.0.20.'
  },
  'startseite-snapshot-paketformat': {
    title: 'The custom start screen said "made for another version" on snapshots',
    detail:
      'On Minecraft snapshot versions the start screen pack was built with too old a pack format, and ' +
      'Minecraft showed a note about it. From 1.0.20 snapshots get the right format as well.'
  },
  'java-download-ohne-pruefsumme': {
    title: 'Downloaded Java was accepted without a checksum',
    detail:
      'When the launcher installed Java itself, it only compared the file with its size, not with the ' +
      'checksum Adoptium provides. A Java version altered on the way would have been run unnoticed on ' +
      'every game start. From 1.0.20 the checksum is verified, and nothing is installed without a ' +
      'matching one.'
  },
  'modpack-vorschau-speicher': {
    title: 'A crafted modpack file could take up a lot of memory',
    detail:
      'Opening a .mrpack or CurseForge file unpacked its description file without a size limit. A ' +
      'small crafted file could take up hundreds of megabytes already in the preview, and archives ' +
      'with a huge number of files were unpacked without a cap. From 1.0.20 fixed limits apply there ' +
      'too.'
  },
  'startbefehle-ohne-bestaetigung': {
    title: 'Custom launch commands and Java paths ran without a confirmation of their own',
    detail:
      'A wrapper command, a pre-launch command or a custom Java path ran as soon as it was in the ' +
      'instance settings, the Java path already when opening the instance page. They could not be set ' +
      'from outside, but a future flaw in the interface could have used them directly. From 1.0.20 the ' +
      'launcher asks in a window of its own before a new or changed command runs for the first time.'
  },
  'dateinamen-versteckte-datenstroeme': {
    title: 'File names with a colon could attach hidden data to mods',
    detail:
      'A file name like "mod.jar:something", from a mod provider or a modpack, was not rejected. ' +
      'Windows creates a hidden data stream on the file for that, invisible in Explorer. From 1.0.20 ' +
      'such names are rejected.'
  },
  'mrpack-downloads-beliebige-server': {
    title: 'Modrinth modpacks could download files from any server',
    detail:
      'A .mrpack file can bring download addresses for its mods. The launcher did not check that they ' +
      'point to the servers Modrinth allows and also accepted unencrypted addresses. From 1.0.20 the ' +
      'allowed server list from the Modrinth specification applies, and only encrypted connections.'
  },
  'anmeldung-fehler-im-protokoll': {
    title: 'Error responses from the Microsoft sign-in were written to the log unredacted',
    detail:
      'When signing in failed, the launcher wrote the server’s response to its log file, and it can ' +
      'contain the account’s email address. Error reports also kept part of sign-in tokens. From ' +
      '1.0.20 both are redacted.'
  },
  'link-startet-ohne-rueckfrage': {
    title: 'A Launch Gabi link from a website started an instance without asking',
    detail:
      'A link of the form launchgabi://launch/... started the named instance directly as soon as the ' +
      'browser passed it on. From 1.0.20 the launcher asks first whether the instance should really ' +
      'start. Your own desktop shortcuts still start without asking.'
  },
  'verknuepfung-reservierter-name': {
    title: 'A desktop shortcut for an instance named "CON" or similar could not be created',
    detail:
      'Windows reserves names such as CON, NUL or COM1. If an instance had such a name, creating its ' +
      'shortcut failed with an unclear message. From 1.0.20 the shortcut gets an adjusted name ' +
      'instead.'
  },
  'anmeldung-erneuern-verliert-token': {
    title: 'A brief connection drop while renewing the sign-in could sign an account out for good',
    detail:
      'Renewing the sign-in makes requests to Microsoft, Xbox and Minecraft one after another. If one ' +
      'of the later requests failed, the freshly issued Microsoft key was lost while the old one was ' +
      'already invalid. The next attempt then required a full new sign-in for no visible reason.'
  },
  'quilt-findet-fabric-mods-nicht': {
    title: 'Quilt instances did not find or install mods tagged only for Fabric',
    detail:
      'Quilt can load Fabric mods, and the launcher also shows such versions as compatible. Search ' +
      'still filtered them out, "Install latest" reported no matching version, and updates for such ' +
      'mods were never shown.'
  },
  'fenster-schliessen-bricht-start-ab': {
    title: 'Closing the window while a game was still being prepared silently aborted the launch',
    detail:
      'While a game is still downloading files or Java, no game process exists yet. Closing the window ' +
      'in that phase quit the whole launcher, and the launch vanished without a message.'
  },
  'live-log-bleibt-nach-fehler-offen': {
    title: 'The live log window stayed open when the launch failed before the game started',
    detail:
      'If a launch failed before Minecraft ran, for example without a selected account or because of a ' +
      'compatibility block, the live log window stayed open showing "No output yet" and had to be ' +
      'closed by hand every time.'
  },
  'live-log-springt-nach-unten': {
    title: 'The live log kept jumping to the bottom while scrolling up',
    detail:
      'While the game was writing output, every new line pulled the view back to the end. Older lines, ' +
      'such as an error while loading mods, were hard to read.'
  },
  'instanz-einstellungen-gehen-verloren': {
    title: 'Unsaved instance settings were lost when switching tabs',
    detail:
      'Changing something in an instance’s settings and then switching to another tab lost the changes ' +
      'without any warning.'
  },
  'eigenes-bild-wird-zurueckgesetzt': {
    title: 'A custom instance image was reset on the next save',
    detail:
      'After choosing "Custom image", the next save of the instance settings or "Remove background" ' +
      'replaced the new image with the previous icon again.'
  },
  'arbeitsspeicher-ueber-ram': {
    title: 'PCs with little memory got more assigned than they have',
    detail:
      'On a computer with less than 4 GB, the slider during setup and when creating an instance showed ' +
      'a fitting value, but 4 GB were saved, which can make the game fail to start.'
  },
  'mod-update-doppelt-startbar': {
    title: 'In the mods overview a running update could be started a second time',
    detail:
      'Clicking "Update" on two mods in quick succession removed the spinner from the first one. Its ' +
      'button became clickable again while the update was still running, and a second click started it ' +
      'again in parallel.'
  },
  'mod-update-gleicher-dateiname': {
    title: 'Mods that keep the same file name never showed an update',
    detail:
      'Some mods publish new versions under the same file name. The launcher took such a version for ' +
      'the one already installed and never offered the update.'
  },
  'lokale-datei-nicht-entfernbar': {
    title: 'An added file with certain names could no longer be removed',
    detail:
      'On macOS and Linux, "Add files" accepted files such as "con.jar" or names with a trailing ' +
      'space. Afterwards they could neither be disabled nor removed, and the size display of the whole ' +
      'instance stopped working.'
  },
  'shader-warnung-fehlt': {
    title: 'The "shaders without a shader mod" warning was missing for some mod files',
    detail:
      'If any mod’s name happened to contain "iris", "oculus" or "optifine", the launcher assumed a ' +
      'shader mod was present. Shader packs then did nothing, without the compatibility check pointing ' +
      'it out.'
  },
  'jetzt-updaten-ohne-pruefung': {
    title: '"Update now" before launching skipped the compatibility check afterwards',
    detail:
      'After updating outdated mods from the prompt before launching, the game started without ' +
      'checking again. If an update made two mods incompatible, there was no warning anymore.'
  },
  'verknuepfung-doppelklick-fehler': {
    title: 'Double-clicking a desktop shortcut reported a launch error',
    detail:
      'When a second launch request arrived while the first was still running, the launcher tried to ' +
      'start the instance twice and showed "could not be started" although the game started normally.'
  },
  'konten-still-verloren': {
    title: 'A damaged accounts file silently deleted all saved accounts',
    detail:
      'If the file with the accounts or settings could not be read, for example after a power cut, the ' +
      'launcher started empty without notice and overwrote the file on the next save. Recovering it ' +
      'was no longer possible afterwards.'
  },
  'mrpack-export-ohne-sha512': {
    title: 'Exported .mrpack files were missing a required checksum',
    detail:
      'The Modrinth format requires a SHA-512 checksum next to SHA-1 for every file. The export only ' +
      'wrote SHA-1, so other launchers or Modrinth itself could reject the pack or warn about it.'
  },
  'java-auswahl-zeigt-automatisch': {
    title: 'A pinned Java version that no longer exists was shown as "Automatic"',
    detail:
      'If the Java installation pinned for an instance was removed or moved, the selection showed ' +
      '"Manage automatically" while the old path still applied and the launch failed on it.'
  },
  'einstellung-nicht-gespeichert-angezeigt': {
    title: 'A setting that was not saved stayed visible in the interface',
    detail:
      'If saving a slider setting failed, for example because the file was locked, the error message ' +
      'disappeared again while the slider kept showing the new value.'
  },
  'installieren-link-oeffnet-mod-nicht': {
    title: '"Install with Launch Gabi" did not open the chosen mod',
    detail:
      'An install link from a mod page only led to the general search. Which mod was meant got lost, ' +
      'and you had to search for it yourself.'
  },
  'sortierung-nach-mehr-laden': {
    title: 'Search sorting was wrong after "Load more"',
    detail:
      'With Modrinth and CurseForge together, newly loaded results were only sorted among themselves ' +
      'and appended at the bottom. A newer or more popular entry could end up below older ones.'
  },
  'update-installiert-beta': {
    title: 'An automatic update could choose a beta over a stable version',
    detail:
      'If there was no mod version for the exact Minecraft version, the launcher took the newest one ' +
      'from the same version line, even when that was a beta or alpha and a stable version was ' +
      'available.'
  },
  'forge-gleichzeitig-pruefsummenfehler': {
    title: 'Two Forge instances created at the same time could report a false checksum error',
    detail:
      'If two instances with the same Forge or NeoForge build were created shortly after each other, ' +
      'both installations wrote to the same files at once. One could report "written incorrectly" or ' +
      'leave a damaged file behind.'
  },
  'quilt-aeltere-beta': {
    title: 'For new Minecraft versions Quilt could suggest an older beta',
    detail:
      'While only beta builds of Quilt or Fabric existed for a Minecraft version, they were not sorted ' +
      'by their number. An older beta instead of the newest one could be suggested.'
  },
  'aufnahme-stoppt-nicht': {
    title: 'A recording kept running after the game ended if the launcher was restarted in between',
    detail:
      'If a game kept running across a launcher restart and was recorded in fullscreen, the launcher ' +
      'did not notice the game ending. The recording kept filming the empty desktop until the ' +
      'configured maximum length.'
  },
  'aufnahme-beim-beenden-unvollstaendig': {
    title: 'A just finished recording could stay incomplete when closing the launcher',
    detail:
      'Quitting the launcher right after stopping a recording could lose the last seconds or the ' +
      'length information, without any hint that the file was incomplete.'
  },
  'aufnahme-fremdes-fenster': {
    title: 'Recording could capture another window with "Minecraft" in its title',
    detail:
      'The launcher simply looked for a window whose title contains "Minecraft". A browser tab or ' +
      'video with that word could be recorded instead of the game.'
  },
  'abbrechen-haengt-bei-assets': {
    title: 'Cancelling could hang for minutes while loading the asset list',
    detail:
      'The list of game resources was the only file loaded without a way to cancel. On a slow ' +
      'connection "Cancel" only reacted there after several minutes.'
  },
  'downloads-ignorieren-wartezeit': {
    title: 'Large installs could fail needlessly when servers were overloaded',
    detail:
      'When a server asked to wait for a certain time, the launcher ignored it for file downloads and ' +
      'retried too quickly. All attempts could then fail with "Download failed".'
  },
  'update-neustart-ohne-hinweis': {
    title: 'An already downloaded update could restart the launcher without a visible notice',
    detail:
      'If an update was already downloaded, it could be installed right after start before the ' +
      'interface was ready. The "restarting shortly" notice was lost, and the window briefly ' +
      'disappeared without explanation.'
  },
  'sicherung-waehrend-reparatur': {
    title: 'A backup could contain half-written mods',
    detail:
      'A backup could be created while a repair or a mod update was writing files. It could then ' +
      'contain an incomplete mod file that causes problems when restored.'
  },
  'verknuepfung-langer-name': {
    title: 'Shortcuts for instances with a very long name could not be created',
    detail:
      'A very long instance name, for example from a modpack, was used as the file name without ' +
      'shortening it. Windows rejected that, and the message did not say why.'
  },
  'ordnerimport-abgebrochen-unvollstaendig': {
    title: 'A cancelled folder import left an instance that looked complete',
    detail:
      'When importing an instance folder was cancelled, the instance stayed with the files copied so ' +
      'far and looked like a normal instance. Worlds or mods in it could be incomplete.'
  },
  'meldung-hinzufuegen-ohne-umlaut': {
    title: 'In the German interface, an error message spelled a word without its umlaut',
    detail:
      'Trying to add files to an instance while the game was running showed a message with a ' +
      'misspelled German word.'
  },
  'changelog-farben-fehlen': {
    title: 'Dates and short descriptions in the changelog were not set apart',
    detail:
      'In the changelog, for screenshots without a preview and in expanded error reports, dates and ' +
      'secondary text were meant to appear dimmed. The colors for that were never defined, so the ' +
      'text appeared in the normal color.'
  },
  'suche-tooltip-fehlt': {
    title: 'The "Ctrl K" hint on the title bar search button never appeared',
    detail:
      'The search button at the top of the window was meant to show its keyboard shortcut on hover. ' +
      'The hint was set but never displayed.'
  },
  'mod-entfernen-ohne-rueckfrage': {
    title: 'A mod could be deleted by a misclick without confirmation',
    detail:
      'The trash button next to a mod’s on/off switch deleted the file immediately and permanently, ' +
      'without asking. In long lists a misclick lost the mod.'
  },
  'datenordner-wechsel-ohne-warnung': {
    title: 'Changing the data folder made it look as if all instances had disappeared',
    detail:
      'After changing the data folder the launcher immediately showed the new, empty folder. That ' +
      'existing instances are not moved was only mentioned afterwards in a briefly visible message.'
  },
  'fehlermeldung-technischer-vorspann': {
    title: 'Error messages started with a technical prefix',
    detail:
      'Many error messages of the launcher began with "Error invoking remote method ..." before the ' +
      'actual text. Also, cancelling a Microsoft sign-in showed an error message although it was ' +
      'only cancelled.'
  },
  'versionswahl-schaltet-mod-ein': {
    title: 'Choosing another version turned a disabled mod back on',
    detail:
      'Choosing a different version of a disabled mod via "Choose version..." turned it back on, and ' +
      'it was loaded on the next start without any notice.'
  },
  'sicherung-abbrechen-wirkungslos': {
    title: '"Cancel" had no effect while creating a backup',
    detail:
      'A running backup could not be cancelled. It ran to the end and then reported itself as ' +
      'finished.'
  },
  'import-abbrechen-spaet-wirkungslos': {
    title: 'An import could no longer be cancelled after downloading',
    detail:
      'When importing a modpack or folder, "Cancel" only worked while files were still being ' +
      'downloaded or copied. After that the import kept going and ended as finished.'
  },
  'sicherung-gesperrte-datei': {
    title: 'A world file locked during a backup aborted it with a system message',
    detail:
      'If Minecraft saved a world right during a backup, the backup could abort with an English system ' +
      'message containing the full file path including the Windows user name.'
  },
  'instanz-einstellungen-verlust-navigation': {
    title: 'Unsaved instance settings were lost without asking when leaving the page',
    detail:
      'Changing an instance\'s settings and then going elsewhere via "All instances" or the sidebar ' +
      'lost the changes without warning.'
  },
  'fenster-bleibt-minimiert': {
    title: 'The launcher stayed minimized after the game ended',
    detail:
      'With the launch behavior set to "Minimize the launcher", the window did not come back after the ' +
      'game ended but stayed in the taskbar.'
  },
  'assistent-loader-version-zurueckgesetzt': {
    title: 'The create wizard reset a hand-picked loader version',
    detail:
      'After "Try again" for the loaders, the loader version selection silently jumped back to the ' +
      'recommended one. The instance was then created with a different version than chosen.'
  },
  'export-ohne-datapacks': {
    title: 'The .mrpack export silently left out data packs',
    detail:
      'Exporting an instance as a modpack did not include installed data packs, and there was no ' +
      'notice about it.'
  },
  'schalter-ohne-fehlermeldung': {
    title: 'A mod\'s on/off switch and "Search Java again" showed no errors',
    detail:
      'If turning a mod on or off with the switch in the list failed, or the Java search in the ' +
      'instance settings, visibly nothing happened.'
  },
  'account-teilweise-beschaedigt': {
    title: 'A partly damaged account disappeared without notice',
    detail:
      'If single fields of an entry were missing from the accounts file, that account was silently ' +
      'dropped on start.'
  },
  'abbrechen-in-wartezeit': {
    title: 'Cancelling did not react for up to 30 seconds between two download attempts',
    detail:
      'While the launcher waited for the next attempt after a failed download, "Cancel" only took ' +
      'effect after that wait was over.'
  },
  'reparatur-waehrend-start': {
    title: 'A repair could replace files while another instance with the same version was starting',
    detail:
      'If a second instance with the same Minecraft version started while a repair was already ' +
      'running, the repair could replace shared game files and disturb that start.'
  },
  'snapshots-2021-java': {
    title: 'Snapshots from autumn 2021 got Java 16 instead of 17',
    detail:
      'For snapshots leading up to Minecraft 1.18, the launcher chose Java 16 when Mojang gave no Java ' +
      'version. These versions need Java 17.'
  },
  'gruppen-gross-klein': {
    title: 'Groups differing only in upper and lower case were shown separately',
    detail:
      'If two instances were grouped as "Modded" and "modded", they appeared in two separate groups ' +
      'instead of one.'
  },
  'alte-versionen-leerzeichen-pfad': {
    title: 'Minecraft up to 1.12.2 did not start when the data folder contained a space',
    detail:
      'For old versions, including Forge modpacks for 1.7.10 or 1.12.2, a folder path with a space was ' +
      'split into several launch arguments. This already affects the default folder when the Windows ' +
      'user name contains a space.'
  },
  'startverhalten-global-wirkungslos': {
    title: 'The global launch behavior had no effect on existing instances',
    detail:
      'Every instance copied the setting when it was created. A later change in the settings therefore ' +
      'only reached newly created instances. Instances now follow the global setting until something ' +
      'else is chosen for them.'
  },
  'duplizieren-halbe-kopie': {
    title: 'A failed duplicate left an invisible half copy behind',
    detail:
      'If duplicating an instance failed, for example because the disk was full, the started folder ' +
      'stayed behind. It was not visible in the launcher but still took up disk space.'
  },
  'export-abbrechen-wirkungslos': {
    title: '"Cancel" had no effect when exporting as a modpack',
    detail:
      'A running export could not be cancelled. It ran to the end.'
  },
  'sicherung-fehlertext-pfad': {
    title: 'Some backup error messages showed the full file path',
    detail:
      'If recording a backup or a restore failed because of a locked file, the message contained an ' +
      'English system message including the full path and Windows user name.'
  },
  'instanzdatei-beschaedigt': {
    title: 'A damaged instance file made the instance unusable or was silently overwritten',
    detail:
      'If an instance\'s instance.json was damaged, depending on the damage its page could no longer be ' +
      'opened, the end of the game was not detected, or the file was replaced by an empty one without ' +
      'notice. An unreadable file is now set aside with a notice.'
  },
  'knoepfe-ohne-fehlermeldung-2': {
    title: 'Some buttons showed no message on an error',
    detail:
      'Custom icon, background image, remove background, reset settings, change data folder and ' +
      'selecting an account visibly did nothing when they failed.'
  },
  'dialog-tab-taste': {
    title: 'The Tab key could leave open dialogs',
    detail:
      'In every dialog, the Tab key moved past the last element onto the page behind it, where buttons ' +
      'could then be used although the dialog covered them.'
  },
  'mod-entfernen-waehrend-versionswechsel': {
    title: 'A mod removed during a version change could come back',
    detail:
      'If a mod was removed or toggled while "Choose version" was running for it and the old file was ' +
      'briefly locked, it came back afterwards or left an untracked file behind.'
  },
  'abhaengigkeit-doppelt-anderer-anbieter': {
    title: 'A dependency was installed twice when it came from the other provider',
    detail:
      'If a required library such as Fabric API was already installed from Modrinth, a CurseForge mod ' +
      'fetched it again from CurseForge. With two copies the game usually does not start.'
  },
  'update-ohne-neue-abhaengigkeit': {
    title: 'A mod update did not install newly required dependencies',
    detail:
      'If the new version of a mod needed an additional library, only the mod file was replaced. The ' +
      'game might then not start, without any visible reason.'
  },
  'client-id-alte-ersetzt': {
    title: 'A manually entered old Microsoft client ID was silently replaced',
    detail:
      'Entering the official Minecraft Launcher\'s client ID under Settings, Accounts made the launcher ' +
      'save its own instead, without notice.'
  },
  'java-rest-abgebrochene-installation': {
    title: 'Leftovers of a cancelled Java install stayed behind and could be offered as Java',
    detail:
      'If a Java download was interrupted, a half extracted folder stayed behind until Java was ' +
      'installed again at some point. Until then the Java search tried it every time, and a nearly ' +
      'complete leftover could show up in the selection and later disappear from under an instance.'
  },
  'seitensprache-englisch-deutsch': {
    title: 'In English, the launcher still reported German as its language to the system',
    detail:
      'After switching to English, the interface kept German as its language setting. Screen readers ' +
      'therefore read the English text with German pronunciation.'
  },
  'neustart-startet-instanz-erneut': {
    title: 'A restart from the settings started an instance again',
    detail:
      'If the launcher had been opened through an instance\'s desktop shortcut, the restart after a ' +
      'language switch took over that call and started the instance again, without asking.'
  },
  'datapack-geloeschte-welt': {
    title: 'A deleted world came back as an empty world through a data pack',
    detail:
      'If a data pack was assigned to a world and the world was deleted in Explorer, the launcher ' +
      'recreated its folder when the data pack was switched on or off, updated or changed version. The ' +
      'empty world then appeared in the list and could not be removed in the launcher.'
  },
  'sicherung-zeitstempel': {
    title: 'After restoring a backup, "Last played" and the screenshot order were wrong',
    detail:
      'Backups stored the time of the backup for every file instead of its real modification date, and ' +
      'restoring gave every file the current time. Worlds then all looked just played, and screenshots ' +
      'were in random order.'
  },
  'anmeldung-abgelaufen-rohtext': {
    title: 'An expired Microsoft sign-in showed an English error text from Microsoft',
    detail:
      'When an account\'s sign-in expired, for example after 90 days without use or after a password ' +
      'change, starting a game showed a long English text from Microsoft instead of the notice to sign ' +
      'in again.'
  },
  'anmeldung-netzwerk-abbruch': {
    title: 'A brief network drop aborted the Microsoft sign-in',
    detail:
      'If the connection dropped for a moment during sign-in, for example when switching Wi-Fi, the ' +
      'whole process aborted with a technical message although the sign-in code was still valid.'
  },
  'account-sitzung-abgelaufen-falsch': {
    title: '"Session expired" was shown on accounts that worked fine',
    detail:
      'The account list showed this notice on every Microsoft account that had not started a game for ' +
      'about a day. The sign-in renews itself on the next start in that case, though.'
  },
  'screenshots-tab-leer': {
    title: 'The screenshots section sometimes stayed empty',
    detail:
      'If a screenshot was being written or briefly locked by a virus scanner while the section was ' +
      'opened, it showed no screenshots at all although they were there.'
  },
  'java-32bit-gewaehlt': {
    title: 'An existing 32-bit Java was used instead of installing a suitable one',
    detail:
      'If the only matching Java installation was a 32-bit version, the launcher used it even with ' +
      'automatic Java management. With more than about 1.5 GB of memory the game then did not start.'
  },
  'java-pfad-fehlt-ohne-hinweis': {
    title: 'A pinned Java path that no longer existed was replaced without notice',
    detail:
      'If the Java pinned in an instance was uninstalled or moved, the launcher silently started with ' +
      'a different Java. A resulting error could hardly be traced back to the cause.'
  },
  'update-waehrend-aufgabe': {
    title: 'A launcher update could cancel running downloads and tasks',
    detail:
      'Installing an update only waited for running games, not for downloads, imports or backups. ' +
      'Those then aborted without notice and had to be started again.'
  },
  'update-fehler-rohtext': {
    title: 'A failed update check showed a technical message',
    detail:
      'Under Settings, Updates, a failed check showed the raw, mostly English error text, for example ' +
      'about a missing internet connection.'
  },
  'neoforge-neue-versionen': {
    title: 'NeoForge could not be chosen for Minecraft 26.1 and newer',
    detail:
      'Since Minecraft names its versions by year, the launcher found no NeoForge versions for 26.1, ' +
      '26.2 and 26.3 and showed NeoForge as unavailable, although they exist. NeoForge pre-releases ' +
      'also counted as stable.'
  },
  'curseforge-shader-nach-loader': {
    title: 'Shaders, resource packs and data packs from CurseForge were filtered by mod loader',
    detail:
      'When searching with the version filter on, the launcher also restricted CurseForge shaders, ' +
      'resource packs and data packs to the instance\'s loader. These have no loader, so the CurseForge ' +
      'results were largely missing.'
  },
  'update-1020-instanz-startverhalten': {
    title: 'The update to 1.0.20 reset a deliberately chosen "Keep the launcher open" on instances',
    detail:
      'On the first start of 1.0.20, every instance set to "Keep the launcher open" was switched to ' +
      '"As in the settings", even where that was set on purpose. Anyone affected sets it again in the ' +
      'instance settings. From the next version on, such deliberate settings are kept when upgrading.'
  },
  'zahlen-punkt-statt-komma': {
    title: 'Download progress showed numbers with a point instead of a comma in German',
    detail:
      'When downloading game files, Java and modpacks, and in the notice after a recording, German ' +
      'showed sizes as 150.3 MB instead of 150,3 MB.'
  },
  'vorab-pruefung-haengt': {
    title: 'The pre-launch check stayed on "Loading" for good after an error',
    detail:
      'If the check on the instance page failed once, for example through a brief network drop, the ' +
      '"Before launch" section then showed "Loading" forever, and the mod compatibility section ' +
      'disappeared entirely. Nothing showed that a new check was needed.'
  },
  'zuletzt-gespielt-neue-instanz': {
    title: 'An instance never played was labelled "Last played" on the home page',
    detail:
      'After creating the first instance, the home page showed "Last played" above it and "Last ' +
      'played: never" right below.'
  },
  'log-leeren-kommt-zurueck': {
    title: '"Clear" in an instance log did not stick',
    detail:
      'After "Clear" in the Log tab, all old lines came back as soon as another tab was opened and the ' +
      'log was switched back to.'
  },
  'loeschen-reparieren-erst-nach-bestaetigung-abgelehnt': {
    title: 'Deleting and repairing a busy instance only failed after the confirmation',
    detail:
      'While an instance was starting, being set up or getting mods, "Delete" and "Repair" could still ' +
      'be clicked and confirmed. Only then came the message that it was not possible right now. ' +
      '"Duplicate" was already greyed out in the same situation.'
  },
  'duplizieren-falsche-meldung': {
    title: 'A second click on "Duplicate" said the mods were being worked on',
    detail:
      'While an instance was still being duplicated, another attempt replied that the mods were being ' +
      'worked on, instead of saying that the instance is being copied right now.'
  },
  'datei-gesperrt-beiseite': {
    title: 'A briefly locked instance, settings or account file was set aside as damaged',
    detail:
      'If a virus scanner or cloud service briefly held one of these files at startup, the launcher ' +
      'set it aside as if it were broken. An instance then showed up as an empty "Unnamed" instance ' +
      'without mods and play time, or settings and accounts were missing.'
  },
  'spielende-gesperrte-datei': {
    title: 'The launcher sometimes did not come back after the game ended',
    detail:
      'If the play time could not be saved when Minecraft closed because the instance file was locked ' +
      'at that moment, the rest was skipped: the state stayed on "running", and a hidden launcher did ' +
      'not come back.'
  },
  'spielzeit-nach-neustart': {
    title: 'Play time across a launcher restart was not counted',
    detail:
      'If Minecraft kept running while the launcher restarted, for example for an update, that session ' +
      'was never added to the play time and "Last played".'
  },
  'bilder-bleiben-liegen': {
    title: 'Old instance images stayed on disk',
    detail:
      'Every new custom icon or background image of an instance added another file, old ones were ' +
      'never deleted, not even when removing the background. Duplicating copied all of them along.'
  },
  'datenordner-waehrend-einrichtung': {
    title: 'The data folder could be changed while a new instance was still being set up',
    detail:
      'If the data folder was changed while a freshly created instance was still downloading, that ' +
      'instance disappeared without notice, and its half downloaded files stayed in the old folder.'
  },
  'abhaengigkeit-falscher-ordner': {
    title: 'Dependencies of resource packs and shaders landed in the wrong folder',
    detail:
      'If a resource pack or shader needed a mod, that mod was installed as a resource pack or shader ' +
      'too. It then sat in the wrong folder, had no effect, and no check noticed.'
  },
  'umbenannte-datei-verliert-infos': {
    title: 'A mod file renamed in Explorer lost its origin',
    detail:
      'If a mod or pack file was renamed by hand, the launcher only saw it as a local file without ' +
      'origin, and updates were no longer found. For data packs, old copies stayed in the worlds.'
  },
  'launcher-versteckt-altes-spiel': {
    title: 'The launcher stayed hidden while a game from an earlier session was running',
    detail:
      'If a game from before a launcher restart was still running, the hidden launcher did not come ' +
      'back after another game ended, not even when the old game ended later.'
  },
  'log-beenden-vor-start': {
    title: '"Stop" in the log window had no effect before the game started',
    detail:
      'During preparation, meaning while downloading, installing Java or unpacking, the log window ' +
      'showed the "Stop" button, but clicking it did nothing.'
  },
  'log-zustand-leer': {
    title: 'The state badge in the log window sometimes stayed empty',
    detail:
      'If an instance started faster than the log window opened, the state such as "Running" was ' +
      'missing at the top for the whole session.'
  },
  'absturz-code-null': {
    title: 'The session history showed "Crash (code null)"',
    detail:
      'If Minecraft was ended by the system on macOS or Linux, the history showed "code null" instead ' +
      'of an understandable note.'
  },
  'curseforge-import-ohne-herkunft': {
    title: 'Mods from imported CurseForge modpacks counted as local files',
    detail:
      'After importing a CurseForge modpack, none of its mods were linked to CurseForge. Updates and ' +
      'the compatibility check never applied to them.'
  },
  'export-fehlende-ordner': {
    title: 'Exporting as a modpack left out folders such as kubejs or defaultconfigs',
    detail:
      'When exporting an instance as a modpack, only config and the content folders were included. ' +
      'Scripts, default configs and similar folders many modpacks need were missing from the exported ' +
      'pack.'
  },
  'aufnahme-erscheint-nicht': {
    title: 'A finished recording did not show up in the open recordings tab',
    detail:
      'If a recording was already running when the tab was opened, it did not show up there after it ' +
      'ended until the tab was opened again.'
  },
  'bestaetigung-bleibt-offen': {
    title: 'Confirmation dialogs stayed open after an error',
    detail:
      'If deleting an instance or restoring or deleting a backup failed, the confirmation dialog ' +
      'stayed open and had to be closed by hand.'
  },
  'automatisch-sichern-wirkungslos': {
    title: '"Back up automatically" did not create any backups',
    detail:
      'The switch in the settings promised regular backups of the worlds, but none was ever created. ' +
      'Anyone relying on it had no backup.'
  },
  'sicherungsliste-ueberschrieben': {
    title: 'A damaged backup list was silently overwritten',
    detail:
      'If an instance\'s backup list was damaged, the next backup overwrote it without notice. All ' +
      'older backups were no longer reachable in the launcher afterwards.'
  },
  'update-sicherungen-unbegrenzt': {
    title: 'Backups before mod updates were never cleaned up',
    detail:
      'Every "Update all" created a backup of the worlds that was never deleted. Over time they took ' +
      'up disk space without limit.'
  },
  'dateien-oeffnen-haertung': {
    title: 'The block against opening foreign programs depended on the changeable data folder',
    detail:
      'The launcher only opens files from its own folders. That boundary could be moved through the ' +
      'data folder setting. This was only exploitable if foreign code was already running in the ' +
      'interface. Programs and scripts are now never opened at all.'
  },
  'java-unter-spiel-geloescht': {
    title: 'A Java reinstall could crash a running game',
    detail:
      'If a Java managed by the launcher was reinstalled while a game was running with it, the ' +
      'launcher deleted the old folder right away. Minecraft could then crash in the middle of the ' +
      'session.'
  },
  'arbeitsspeicher-ueber-maximum': {
    title: 'Instance settings could save more memory than available',
    detail:
      'If an instance had more memory set than the computer has, for example after an import, the ' +
      'slider showed the maximum, but the old too high value was saved. The game then did not start.'
  },
  'java-kein-paket-meldung': {
    title: 'If no Java package existed for the computer, it said "Try again later"',
    detail:
      'If a Java version does not exist for a system at all, the launcher still reported a temporary ' +
      'error that never went away.'
  },
  'vorabpruefung-java-26': {
    title: 'The pre-launch check showed Java 8 instead of Java 25 for Minecraft 26',
    detail:
      'If the version file could not be loaded yet, the pre-launch display guessed a too old Java ' +
      'version for the new Minecraft versions. The actual launch was not affected.'
  },
  'anmeldung-offline-rohtext': {
    title: 'Signing in without internet showed an English error',
    detail:
      'Anyone trying to sign in with Microsoft without a connection only saw "fetch failed" instead of ' +
      'a note about the missing connection.'
  },
  'schluessel-ungeschuetzt-kein-hinweis': {
    title: 'The notice about unprotected sign-in data could be missing',
    detail:
      'If the system\'s encryption only became available later, the long-lived sign-in key stayed ' +
      'unencrypted while the notice in the settings already disappeared.'
  },
  'skin-leer': {
    title: 'If a skin did not load, the profile picture stayed empty',
    detail:
      'If an account\'s skin was unreachable, for example without internet, the profile picture in the ' +
      'sidebar and the account list stayed empty instead of showing the initials.'
  },
  'viele-installationen-traege': {
    title: 'With many simultaneous installs the interface became sluggish',
    detail:
      'With many installs running at the same time, the downloads slowed each other down, and the ' +
      'interface responded with a noticeable delay.'
  },
  'launcher-haengt-bei-log-flut': {
    title: 'With large modpacks the launcher hung after a few minutes or restarted its interface',
    detail:
      'If Minecraft wrote very many log lines at once, for example warnings while loading the textures ' +
      'of many mods, the launcher sent every line to its windows one by one. The log window and the ' +
      'launcher could not keep up, stopped responding and were reloaded after a while. The log also ' +
      'showed the messages as raw XML.'
  },
  'minimieren-beendet-spiel': {
    title: 'With "Minimize the launcher", closing the launcher could kill the running game',
    detail:
      'If "Minimize the launcher" was set for game starts and the launcher was closed while Minecraft ' +
      'ran, it ended the game along with it, without a chance to save. Only with the log window open ' +
      'did the game survive, but then the launcher could not be opened again until the game ended.'
  },
  'doppelter-mod-zwei-quellen': {
    title: 'The same mod from Modrinth and CurseForge stopped the game from starting without a hint',
    detail:
      'If a mod was installed once from Modrinth and once from CurseForge, that only counted as a ' +
      'warning, which was not shown when playing. Minecraft then did not start because the mod loader ' +
      'found the same mod ID twice.'
  },
  'curseforge-pakete-im-modordner': {
    title: 'CurseForge modpacks put resource packs and shaders into the mods folder',
    detail:
      'If a CurseForge modpack contained resource packs or shaders, the import put them into the mods ' +
      'folder. They had no effect there and did not show up in the content list either.'
  },
  'java-32bit-eigener-pfad': {
    title: 'A pinned 32-bit Java with a lot of memory did not start the game, with no hint',
    detail:
      'If a 32-bit Java was picked by hand for an instance with more than about 1.5 GB of memory, ' +
      'Minecraft stopped right away. The launcher gave no warning, although it respects the same limit ' +
      'when it picks Java itself.'
  },
  'anmeldeseite-im-netz': {
    title: 'Behind a Wi-Fi sign-in page the launcher showed cryptic errors',
    detail:
      'If a network, for example in a hotel, at school or on a train, redirected requests to its own ' +
      'sign-in page, an English error like "Unexpected token" appeared. The Forge version list then ' +
      'also claimed there was no version.'
  },
  'abbrechen-wartet-auf-andere-installation': {
    title: 'Cancelling could hang when two installs needed the same file',
    detail:
      'If two installs loaded the same file at once, such as a shared library, the second one only ' +
      'reacted to "Cancel" once the first was done with that file. That could take minutes.'
  },
  'entdecken-unpassende-version-ohne-hinweis': {
    title: 'The Discover project window gave no hint about versions that do not fit',
    detail:
      'With "Compatible only" turned off there, all versions looked the same. A version for another ' +
      'loader or Minecraft version could be picked and installed without any warning.'
  },
  'sicherung-ab-2gb-nicht-einspielbar': {
    title: 'Backups of 2 GB or more could not be restored',
    detail:
      'A backup of 2 GB or more, for example of a large world, could be created, but when restoring it ' +
      'the launcher said it was damaged. The backup itself is intact and can be restored with the fix. ' +
      'Large backups below that size also made the launcher hang noticeably while restoring.'
  },
  'screenshots-frieren-launcher-ein': {
    title: 'Many screenshots briefly froze the launcher when opening the recordings',
    detail:
      'If an instance held thousands of screenshots, the whole launcher stood still for a moment when ' +
      'opening the Recordings tab and after every finished recording, almost a second with 5000 ' +
      'pictures. Downloads and the live log paused along with it.'
  },
  'duplizieren-mit-verknuepfung': {
    title: 'Duplicating failed when the instance contained a folder link',
    detail:
      'If someone had redirected for example the saves or shaderpacks folder to another drive with a ' +
      'link, duplicating stopped with a raw error and created no copy.'
  },
  'launcher-verschwindet-bei-altem-spiel': {
    title: 'With a game from an earlier session still running, the launcher could not be closed',
    detail:
      'If a Minecraft started before a launcher restart was still running, closing the launcher only ' +
      'hid it. It did not come back after that game ended either and kept running invisibly until it ' +
      'was opened again.'
  },
  'entdecken-namen-abgeschnitten': {
    title: 'Project names in Discover were cut off after a few letters',
    detail:
      'At the normal window size the Install button sat next to the text of the result cards and left ' +
      'the name hardly any room. Names and authors ended after a few letters, and the date wrapped ' +
      'over several lines.'
  },
  'neoforge-installer-bei-jedem-start': {
    title: 'NeoForge instances set up NeoForge again before every start',
    detail:
      'For NeoForge on Minecraft 1.20.2 and newer the launcher did not recognise the NeoForge version ' +
      'that was already installed and ran the installer again before every start, every repair and ' +
      'every pre-launch check. Starting took much longer, did not work at all without internet and ' +
      'could disturb a second NeoForge game that was running.'
  },
  'forge-mods-gleicher-name-doppelt': {
    title: 'Two different Forge mods with the same name counted as installed twice',
    detail:
      'Since 1.0.21 the pre-launch check reads the mod ID from the files. For Forge and NeoForge it ' +
      'also read the dependency entries. Two different mods with the same name therefore counted as ' +
      'the same mod, the game could not be started, and "Remove older file" would have deleted one of ' +
      'them.'
  },
  'update-sicherungen-mitgeloescht': {
    title: 'Backups before mod updates were deleted along with the automatic backups',
    detail:
      'Since 1.0.21 backups taken before mod updates count towards the same limit as the automatic ' +
      'backups after every play session. The first new backup therefore deleted older backups taken ' +
      'before mod updates, and after a few play sessions the newest one as well.'
  },
  'alte-anmeldung-abgemeldet': {
    title: 'Accounts from very old versions could be signed out after an update',
    detail:
      'Anyone signed in with version 1.0.13 or older who updated straight to a newer version could be ' +
      'signed out at the next game start. The sign-in was renewed with the new Launch Gabi ' +
      'application, although it still belonged to the old one.'
  },
  'texte-unuebersetzt-falsch': {
    title: 'In the German interface, some labels showed in English or were worded wrongly',
    detail:
      'Version types such as "snapshot", "release" or "beta" were shown untranslated, after a game it ' +
      'said "Play time: 1 minutes", and with a filter but no search term it said "There is no matching ' +
      'instance for """.'
  },
  'bedienung-kleine-fehler': {
    title: 'Minor usability faults: notices vanished too fast, deleting without asking, misleading hints',
    detail:
      'Important error notices, for example after the game crashed, vanished after a few seconds. ' +
      '"Delete all" for error reports did not ask first. A search without results among installed ' +
      'content said "Nothing installed", copying the log gave no feedback, a new backup went to the ' +
      'first instance despite a filter, Enter did not confirm a question, and a single mod update made ' +
      'the mod overview jump back to the top.'
  },
  'modrinth-pakete-ohne-version': {
    title: 'Resource packs, shaders and data packs from Modrinth could not be installed in instances with a mod loader',
    detail:
      'In an instance with Fabric, Forge, NeoForge or Quilt, "Install" found no fitting version for ' +
      'resource packs, shaders and data packs from Modrinth, because the launcher filtered them by mod ' +
      'loader. Only picking a specific version in the project window worked. Updates were never shown ' +
      'for such content.'
  },
  'update-pack-abgewaehlt': {
    title: 'After updating a resource pack or shader it was no longer selected in the game',
    detail:
      'An update replaces the file, and the new file name usually contains the new version number. ' +
      'Minecraft and Iris no longer found the selected pack afterwards and turned it off without a ' +
      'hint.'
  },
  'alle-aktualisieren-fehler-verschwiegen': {
    title: '"Update all" kept failed updates quiet',
    detail:
      'If single updates failed, for example because of a locked file or a network error, the launcher ' +
      'only reported the number of successful ones. Which ones failed and why was shown nowhere.'
  },
  'sicherheitskopie-vor-wiederherstellung-geloescht': {
    title: 'The safety copy before a restore was deleted after a few play sessions',
    detail:
      'Before restoring a backup the launcher saves a copy of the current state. It counted as an ' +
      'automatic backup and was cleaned up after a few play sessions. After that the restore could no ' +
      'longer be undone.'
  },
  'screenshots-volle-groesse': {
    title: 'The Recordings tab loaded screenshots at full size',
    detail:
      'For the preview the launcher sent up to 40 screenshots at full resolution to the interface. ' +
      'With large pictures the tab took a long time and used hundreds of megabytes of memory.'
  },
  'speichern-gesperrt-rohfehler': {
    title: 'A briefly locked folder could stop saving with a raw error',
    detail:
      'If a virus scanner or OneDrive held one of the launcher\'s files for a moment, saving an ' +
      'instance or the settings stopped at once with a technical message such as "EPERM" instead of ' +
      'retrying briefly.'
  },
  'welten-liste-abweichend': {
    title: 'The Worlds tab showed folders without a world and left out linked worlds',
    detail:
      'Every folder in "saves" appeared as a world, even one with no save in it. A world placed in ' +
      '"saves" as a link was missing instead, although Minecraft shows it. The same applied to ' +
      'choosing worlds for data packs.'
  },
  'aufnahme-loeschen-rohfehler': {
    title: 'An open recording could not be deleted and only reported a technical error',
    detail:
      'If a recording was open in another program, such as a video player, "Delete" failed with a ' +
      'message like "EBUSY" without saying why.'
  },
  'texte-mehrzahl-englisch': {
    title: 'Counts with the wrong plural and clumsy English texts',
    detail:
      'With exactly one item it said, for example, "1 files OK" or "1 compatibility notes". In the ' +
      'English interface some texts read like literal translations, such as "taken over" instead of ' +
      '"imported", and the question before using a custom Java path called it a command.'
  },
  'screenreader-seite-reiter-fortschritt': {
    title: 'Screen readers were not told which page and tab are selected',
    detail:
      'The current page in the sidebar, the selected tab of an instance and the progress of downloads ' +
      'were only shown by color. Some selection and search fields had no name, and the focus ring in ' +
      'input fields was hard to see on dark backgrounds.'
  },
  'accounts-datei-gesperrt': {
    title: 'A briefly locked accounts file could delete all saved accounts',
    detail:
      'If a virus scanner or OneDrive was holding the file with the accounts, the launcher read it as ' +
      'empty. If something was saved at that moment, such as a new offline profile, switching accounts ' +
      'or a renewed sign-in, all other accounts were gone and had to be signed in again.'
  },
  'start-ohne-internet-abgelaufen': {
    title: 'Without internet the game would not start at all once the sign-in had expired',
    detail:
      'The Minecraft sign-in is valid for about a day. Once it had expired and Microsoft could not be ' +
      'reached, the launch stopped, although singleplayer works without internet.'
  },
  'anmeldung-serverfehler-abbruch': {
    title: 'A single server error at Microsoft aborted the sign-in',
    detail:
      'If Microsoft answered with a server error just once during the sign-in with the code, the whole ' +
      'sign-in was lost and only a technical message such as "HTTP 503" appeared.'
  },
  'anwendungs-id-feld': {
    title: 'A cleared application ID field made signing in impossible',
    detail:
      'Clearing the field for a custom Microsoft application ID, as a hint suggested, made signing in ' +
      'impossible afterwards. A space at the end of a pasted ID led to a confusing error, and the text ' +
      'in the settings still described the old default.'
  },
  'xbox-sperre-hinweis': {
    title: 'Banned or restricted Xbox accounts got a wrong hint',
    detail:
      'If an account was banned by Xbox, restricted from online play by parental controls, or had not ' +
      'yet accepted the Xbox terms of use, the hint only said to sign in on xbox.com. That helped in ' +
      'none of these cases.'
  },
  'skin-anzeige-verzoegert': {
    title: 'A new skin only showed in the launcher after a restart',
    detail:
      'When renewing the sign-in, the launcher also fetches the current skin. The display in the ' +
      'launcher only learned about it at the next start of the program.'
  },
  'natives-zweite-instanz': {
    title: 'A second instance of the same version up to 1.16 would not start while the first was running',
    detail:
      'With two instances on the same Minecraft version up to and including 1.16, starting the second ' +
      'one tried to overwrite files the running game was using. Windows refuses that, and the launch ' +
      'stopped with a technical message.'
  },
  'reparatur-tmp-in-welten': {
    title: 'Repair also deleted .tmp and .part files in worlds and settings',
    detail:
      'When cleaning up old download leftovers, the repair searched the whole game folder of an ' +
      'instance, worlds and mod settings included, and deleted every older file ending in .tmp or ' +
      '.part there, even if it belonged to a world or a mod.'
  },
  'sicherung-ueber-1gb-datei': {
    title: 'Backups containing a single file over 1 GB could not be restored',
    detail:
      'If a world contained a single very large file, such as the Distant Horizons database, the ' +
      'backup could be created but not restored. This only showed when it was needed.'
  },
  'export-fehlende-dateien': {
    title: 'Exporting as a modpack left out locked files without a hint',
    detail:
      'If another program held a file during the export, or a link was in the folder, it was missing ' +
      'from the finished modpack. The launcher still reported a successful export.'
  },
  'datapack-fremde-datei': {
    title: 'A data pack could delete your own file with the same name in a world',
    detail:
      'If a world already held a different file with the same name as a data pack from the launcher, ' +
      'the launcher still remembered the world. Turning the data pack off, removing or updating it ' +
      'later then deleted that other file.'
  },
  'ausschalten-ueberschreibt': {
    title: 'Turning a mod off could overwrite a disabled file with the same name',
    detail:
      'If a mod and a disabled file with the same name (ending in .disabled) were in the folder, ' +
      'turning the mod off overwrote the existing file without asking.'
  },
  'stopp-ohne-speichern': {
    title: '"Stop" ended Minecraft on Windows at once, without saving the world',
    detail:
      'On Windows, "Stop" forced the game to end immediately. Minecraft got no chance to save the ' +
      'world, and progress since the last automatic save could be lost.'
  },
  'versionsdatei-beschaedigt': {
    title: 'A damaged version file only gave a confusing message at launch',
    detail:
      'If the description file of a Minecraft version was damaged, for example after a crash or with a ' +
      'full disk, the launch only showed "Unexpected end of JSON input". The launcher did not download ' +
      'the file again and did not say that "Repair" helps.'
  },
  'vorschau-installiert-loader': {
    title: 'Opening a Forge or NeoForge instance could install the loader without notice',
    detail:
      'If the installed loader of a Forge or NeoForge instance was missing, just opening its page ' +
      'started the installation in the background, with nothing shown and no way to cancel.'
  },
  'sicherungen-vor-reparatur': {
    title: 'Backups made before a repair were never cleaned up',
    detail:
      'Before every repair the launcher creates a backup. Unlike the automatic backups, these were ' +
      'never cleaned up and took more and more disk space over time.'
  },
  'fremde-instanz-argumente': {
    title: 'Java arguments and environment variables of a foreign instance ran without asking',
    detail:
      'Commands before launch, wrappers and custom Java paths ask before they first run. Java ' +
      'arguments that load extra program code, and environment variables, did not. An instance taken ' +
      'over from someone else could thereby run its own code at launch.'
  },
  'umleitung-schluessel': {
    title: 'On a redirect, access keys could go to a different server',
    detail:
      'If a server redirected a request to a different address, the launcher sent the CurseForge key ' +
      'or the Minecraft sign-in along, and a redirect to an unencrypted address was followed as well.'
  },
  'fehlerbericht-pfad-doppelt': {
    title: 'Error reports could contain the name of the Windows user folder',
    detail:
      'Error reports hide the name of the user folder. If a path appeared in the report in a ' +
      'particular technical notation with doubled backslashes, the name stayed visible.'
  },
  'einstellungen-gesperrt-zurueckgesetzt': {
    title: 'A briefly locked settings file could reset all settings',
    detail:
      'If a virus scanner or OneDrive held the settings file at startup, the launcher ran on the ' +
      'defaults and wrote them into the file shortly after. A custom data folder, the CurseForge key ' +
      'and all other settings were then gone, and the instances seemed to have vanished.'
  },
  'zuruecksetzen-ersteinrichtung': {
    title: '"Reset settings" restarted the first-run setup and deleted the CurseForge key',
    detail:
      'After a reset, the first-run setup appeared again, the questions about error reports and the ' +
      'custom start screen came back, and an entered CurseForge key was deleted. The dialog had only ' +
      'said that the settings return to their defaults.'
  },
  'wichtige-hinweise-verdraengt': {
    title: 'Notices meant to stay could be pushed out by newer ones',
    detail:
      'Some notices are meant to stay, for example after the game crashed or when an update is ready. ' +
      'When several notices arrived at once, they still disappeared.'
  },
  'launcher-update-hinweise': {
    title: 'Notices about launcher updates were missing or misleading',
    detail:
      'Without automatic download, a found update was announced nowhere. Turning on automatic updates ' +
      'only took effect after a restart. The notice "installed on the next start" also appeared when ' +
      'automatic installation was off, and every error said "update server not reachable".'
  },
  'minimiert-unsichtbar': {
    title: '"Start minimized" made the launcher invisible',
    detail:
      'With this setting the launcher started without any window and without a taskbar entry. The only ' +
      'way back was starting it a second time.'
  },
  'datenordner-nicht-erreichbar': {
    title: 'An unreachable data folder looked like an empty launcher',
    detail:
      'If the data folder was on an unplugged drive or a disconnected network share, the launcher ' +
      'simply showed no instances, without any hint at the reason.'
  },
  'einrichtung-anzeige-haengt': {
    title: 'After creating an instance, "Setting up" stayed on screen',
    detail:
      'The page of a new instance kept showing "Setting up" after setup had finished, and Play, ' +
      'Duplicate, Delete and Repair stayed locked until the page was left and opened again.'
  },
  'log-reiter-springt': {
    title: 'The Log tab kept jumping to the bottom while reading',
    detail:
      'Anyone scrolling up in the log to read something was put back at the end with every new line. ' +
      'Also, two identical lines in quick succession were merged into one.'
  },
  'aufgaben-fertig-wiederholt': {
    title: 'Finished tasks kept reappearing in the task area',
    detail:
      'While one task was still running after another had finished, the finished task flashed up again ' +
      'every few seconds, for up to 20 seconds.'
  },
  'mods-uebersicht-veraltet': {
    title: 'The mod overview showed outdated locks and emptied on a single error',
    detail:
      'The update buttons followed the state from when the overview was opened, not whether a game is ' +
      'running right now. With duplicated instances the spinner showed in both rows, and a single ' +
      'instance that could not be loaded made the whole list look empty.'
  },
  'kleinere-anzeigefehler-oktober': {
    title: 'Smaller display errors in search, updates and the settings',
    detail:
      '"Load more" skipped results after an error. The project window showed the old version after an ' +
      'install. With two updates at once, one spinner disappeared too early. On Home the background ' +
      'picture of another instance could stay. An unsaved CurseForge key was lost when saving the ' +
      'application ID. "Back up" and "Export" could be triggered twice.'
  },
  'suche-fehler-wie-leer': {
    title: 'A failed search looked like "Nothing found"',
    detail:
      'If Modrinth or CurseForge did not answer, the search showed "Nothing found", and a project that ' +
      'could not be loaded said "No matching version". Both sounded as if the content did not exist.'
  },
  'netzwerkfehler-englisch': {
    title: 'Without a connection, technical English messages such as "fetch failed" appeared',
    detail:
      'Without an internet connection, or with a server answering too slowly, search, installation and ' +
      'the update check only showed "fetch failed" or "This operation was aborted".'
  },
  'updatepruefung-offline': {
    title: 'Without internet the update check took very long and then reported no updates',
    detail:
      'The check tried every mod several times on its own. With many mods this took minutes, and in ' +
      'the end it said there were no updates, instead of that they could not be checked.'
  },
  'curseforge-schluessel-abgelehnt': {
    title: 'A wrong CurseForge key only showed "HTTP 403" with an address',
    detail:
      'If CurseForge rejected the entered key, a technical message with a long address appeared, ' +
      'without a hint that the key is the problem.'
  },
  'modpack-vorabversion': {
    title: 'A modpack straight from the search could install a pre-release and could not be cancelled',
    detail:
      'Without a chosen version the launcher took the newest file, even if it was an alpha or beta. ' +
      '"Cancel" did not stop the modpack download.'
  },
  'deutsche-texte-uneinheitlich': {
    title: 'Inconsistent terms and small language errors in German texts',
    detail:
      'In the German interface, the same thing had different names in different places, and some ' +
      'messages referred to buttons or tabs that are named differently. With exactly one line, second ' +
      'or file, the plural was used.'
  },
  'automatische-sicherung-still': {
    title: 'A failed automatic backup after playing went unnoticed',
    detail:
      'After every play session the launcher backs up the worlds when this is turned on. If that ' +
      'failed, for example because the game still held the files for a moment, it was only written to ' +
      'the log. You assumed you were backed up.'
  },
  'sicherungsliste-beschaedigt': {
    title: 'If the list of backups was damaged, all earlier backups disappeared from view',
    detail:
      'The backups themselves stay in the instance\'s folder, but no longer show up in the launcher and ' +
      'cannot be restored there. This only happens when the list itself gets damaged, for example by a ' +
      'disk fault.'
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
