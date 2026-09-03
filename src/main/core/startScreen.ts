/**
 * Paused as a shipped feature (2026-09-02): pulled from Settings and the
 * one-time prompt pending a real redesign of the whole approach, not because
 * anything here is broken. `applyCustomStartScreen` is unused now and no
 * longer reachable from `launch.ts`; `removeCustomStartScreen` stays wired
 * in so anyone who opted in before this got pulled still gets cleaned up.
 * Left in place, including the resource pack build script and its output,
 * for whatever the next version of this turns out to be.
 *
 * The "eigene Startseite" beta feature: swaps Minecraft's own title screen
 * panorama, and the standard button textures, for a Launch-Gabi-branded look
 * via a resource pack, no game code touched. Works on any instance, vanilla
 * or modded, because a resource pack is a core game feature rather than
 * something a mod loader has to provide, and any mod-added button drawn with
 * Minecraft's own Button widget picks up the same texture automatically. A
 * button a mod paints entirely itself is outside what a resource pack can
 * reach; only a real mod could theme that, which is its own, much larger
 * undertaking.
 *
 * One file ships for every Minecraft version (see resources/startscreen/ and
 * scripts/build_startscreen_pack.py), and `pack.mcmeta` inside it is rewritten
 * per instance at apply time, because the pack_format number that avoids
 * Minecraft's "made for a different version" prompt changes across versions.
 * The button textures only exist from Minecraft 1.20.2 onward (the version
 * that introduced this sprite system); older instances simply never look at
 * that path and keep vanilla buttons, with no error and no missing texture.
 */
import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { paths } from '../paths'
import { log } from '../logger'

const logger = log('startscreen')

/**
 * Exported so `instances.ts` can recognise and skip this exact file. It is
 * rewritten by this module on every launch, not something a user installed,
 * and once `syncContentWithDisk` picked it up as ordinary content it could be
 * "removed" or "disabled" through the normal Mods UI while this module kept
 * silently reapplying it, and a disabled copy sitting next to a freshly
 * reapplied active one produced two content-list entries sharing one id.
 */
export const PACK_FILENAME = 'LaunchGabi-Startbildschirm.zip'
/** How Minecraft's own resource-pack list refers to a file in resourcepacks/. */
const PACK_ID = `file/${PACK_FILENAME}`

/**
 * Where the bundled template ships, packaged or run from source.
 *
 * Same two-candidate shape as `appIconPath()` in shortcuts.ts: `resources/`
 * is unpacked from the asar (see `asarUnpack` in electron-builder.yml), which
 * packaged builds resolve under `app.asar.unpacked`; running from source has
 * no asar at all, so the plain project path is checked too.
 */
function bundledPackPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources', 'startscreen', PACK_FILENAME),
    join(app.getAppPath(), 'resources', 'startscreen', PACK_FILENAME)
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

/**
 * pack_format by the first version it applies to, oldest first.
 *
 * From the Minecraft Wiki's pack format table. Getting this exactly right
 * only avoids a dismissable "this pack was made for a different version"
 * prompt, since a wrong number here never breaks the pack. Minecraft still
 * loads it either way, so a small drift for a very new version is a cosmetic
 * shortcoming, not a functional one.
 */
const PACK_FORMATS: [minVersion: string, format: number][] = [
  ['1.6.1', 1],
  ['1.9', 2],
  ['1.11', 3],
  ['1.13', 4],
  ['1.15', 5],
  ['1.16.2', 6],
  ['1.17', 7],
  ['1.18', 8],
  ['1.19', 9],
  ['1.19.3', 12],
  ['1.19.4', 13],
  ['1.20', 15],
  ['1.20.2', 18],
  ['1.20.3', 22],
  ['1.20.5', 32],
  ['1.21', 34],
  ['1.21.2', 42],
  ['1.21.4', 46],
  ['1.21.5', 55],
  ['1.21.6', 63],
  ['1.21.7', 64],
  ['1.21.9', 69],
  ['1.21.11', 75],
  ['26.1', 84],
  ['26.2', 88]
]

/** `true` when `a` is older than `b`; equal versions compare as not-older. */
function isOlder(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

function packFormatFor(mcVersion: string): number {
  let format = PACK_FORMATS[0][1]
  for (const [minVersion, value] of PACK_FORMATS) {
    if (isOlder(mcVersion, minVersion)) break
    format = value
  }
  return format
}

/* ------------------------------------------------------------------ *
 * options.txt
 * ------------------------------------------------------------------ */

function optionsFile(instanceId: string): string {
  return join(paths.gameDir(instanceId), 'options.txt')
}

/**
 * Adds or removes one pack id from the `resourcePacks` line, touching nothing
 * else in the file. A hand-tuned resource pack order, or any other setting,
 * survives this untouched.
 */
function setPackActive(instanceId: string, packId: string, active: boolean): void {
  const file = optionsFile(instanceId)
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  // Kept rather than normalised: Minecraft on Windows writes `\r\n`, and
  // rewriting every line to `\n` the first time this ever touched the file
  // made the whole file look changed against a game-written one, not just
  // the one line this is actually meant to change.
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : []
  // `split` turns a trailing newline into one synthetic empty element at the
  // end; dropped so it is not written back doubled. Any *other* blank line
  // in the file is left alone, unlike the previous version of this function.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const lineIndex = lines.findIndex((line) => line.startsWith('resourcePacks:'))
  let packs: string[] = []
  if (lineIndex !== -1) {
    try {
      const parsed: unknown = JSON.parse(lines[lineIndex].slice('resourcePacks:'.length))
      if (Array.isArray(parsed)) packs = parsed.filter((p): p is string => typeof p === 'string')
    } catch {
      // A hand-edited or corrupted line is treated as empty rather than
      // aborting: writing a fresh, valid one is strictly an improvement.
      logger.warn(`resourcePacks-Zeile in ${file} nicht lesbar, wird neu geschrieben`)
    }
  }

  let next: string[]
  if (!active) {
    next = packs.filter((p) => p !== packId)
  } else if (packs.includes(packId)) {
    // Left exactly where it already is. Moving it to the end unconditionally
    // used to discard a reorder the user made inside Minecraft's own
    // resource pack screen on every single later launch, restore or not.
    next = packs
  } else {
    // Appended at the end only the first time it is turned on, since a pack
    // later in the list wins over one earlier in it, and the user's own
    // packs could otherwise silently cover a newly added one back up.
    next = [...packs, packId]
  }

  // Nothing to do: already in the wanted state, and never having launched
  // this instance with the feature off must not create an empty options.txt.
  if (next.length === packs.length && next.every((p, i) => p === packs[i])) return

  const line = `resourcePacks:${JSON.stringify(next)}`
  if (lineIndex === -1) {
    if (!active) return
    lines.push(line)
  } else {
    lines[lineIndex] = line
  }

  mkdirSync(paths.gameDir(instanceId), { recursive: true })
  writeFileSync(file, lines.join(eol) + eol, 'utf8')
}

/* ------------------------------------------------------------------ *
 * Apply / remove
 * ------------------------------------------------------------------ */

/**
 * Installs the pack for this instance's Minecraft version and activates it.
 * Safe to call on every launch: re-copies and re-activates each time, which
 * costs nothing (the file is under 40 KB) and means a version change or a
 * repaired instance always gets a correctly formatted copy.
 */
export function applyCustomStartScreen(instanceId: string, mcVersion: string): void {
  const bundled = bundledPackPath()
  if (!bundled) {
    logger.warn('Gebündeltes Startbildschirm-Paket fehlt, wird übersprungen')
    return
  }

  const dir = paths.resourcePacks(instanceId)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, PACK_FILENAME)

  try {
    const zip = new AdmZip(bundled)
    const format = packFormatFor(mcVersion)
    const mcmetaJson = JSON.stringify(
      {
        pack: {
          pack_format: format,
          // Since 25w31a resource packs also carry a min/max range rather
          // than a single number; both fields are written, since the plain
          // `pack_format` is documented as staying supported for backward
          // compatibility, and a version-current client is only guaranteed
          // to look at whichever pair it actually understands. Both are set
          // to the same value because this is rewritten per instance for its
          // exact version, not built to span several versions.
          min_format: format,
          max_format: format,
          description: 'Launch Gabi, eigene Startseite (Beta)'
        }
      },
      null,
      2
    )
    zip.updateFile('pack.mcmeta', Buffer.from(mcmetaJson, 'utf8'))

    // adm-zip's updateFile() no-ops without warning if the entry name ever
    // stops matching (a future regeneration of the template, for instance).
    // Checked here rather than trusted, since that failure mode ships the
    // template's placeholder format for every instance on every version,
    // forever, with nothing anywhere to notice it.
    const rewritten = zip.getEntry('pack.mcmeta')?.getData().toString('utf8')
    if (rewritten !== mcmetaJson) {
      throw new Error('pack.mcmeta wurde nicht wie erwartet aktualisiert')
    }

    zip.writeZip(target)
  } catch (err) {
    logger.warn(`Startbildschirm-Paket für ${instanceId} konnte nicht geschrieben werden:`, err)
    return
  }

  setPackActive(instanceId, PACK_ID, true)
}

/** Deactivates and deletes the pack, leaving no trace once the beta is off. */
export function removeCustomStartScreen(instanceId: string): void {
  setPackActive(instanceId, PACK_ID, false)
  const target = join(paths.resourcePacks(instanceId), PACK_FILENAME)
  try {
    if (existsSync(target)) {
      // Only our own file, by its exact name, never a wider cleanup of the
      // resourcepacks folder.
      rmSync(target, { force: true })
    }
  } catch (err) {
    logger.warn(`Startbildschirm-Paket für ${instanceId} konnte nicht entfernt werden:`, err)
  }
}
