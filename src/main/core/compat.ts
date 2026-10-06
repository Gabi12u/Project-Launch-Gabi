import type { CompatibilityIssue, CompatibilityReport, ContentItem, Instance, LoaderId } from '@shared/types'
import { join } from 'node:path'
import { getInstance, syncContentWithDisk } from './instances'
import { readJarMetadata } from './modMetadata'
import { gameVersionMatches } from './gameVersions'
import { paths } from '../paths'
import { modrinth, curseforge } from '../providers'
import { log } from '../logger'
import { tr } from '@shared/i18n'

const logger = log('compat')

/** Cheap in-memory cache so repeated checks do not hammer the APIs. */
const nameCache = new Map<string, { name: string; slug: string }>()
/** Bounded so a long session browsing many mods cannot grow it without end. */
const NAME_CACHE_MAX = 500

/** Strips punctuation and case so "Fabric API" and "fabric-api" compare equal. */
export function flattenName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

async function projectInfo(
  provider: 'modrinth' | 'curseforge',
  projectId: string
): Promise<{ name: string; slug: string }> {
  const key = `${provider}:${projectId}`
  const cached = nameCache.get(key)
  if (cached !== undefined) {
    // Re-inserting moves the key to the end of the Map's iteration order,
    // which is what turns the eviction below into a real least-recently-used
    // rule. Without it a dependency looked up all session long could still be
    // dropped in favour of a stale one-off entry.
    nameCache.delete(key)
    nameCache.set(key, cached)
    return cached
  }

  try {
    const project =
      provider === 'modrinth'
        ? await modrinth.getProject(projectId)
        : await curseforge.getProject(projectId)

    // Evicted only once there is something to put in its place. Trimming
    // before the request meant a run of provider failures shrank the cache
    // for no gain at all.
    if (nameCache.size >= NAME_CACHE_MAX) {
      const oldest = nameCache.keys().next().value
      if (oldest !== undefined) nameCache.delete(oldest)
    }
    const info = { name: project.name, slug: project.slug ?? '' }
    nameCache.set(key, info)
    return info
  } catch {
    return { name: projectId, slug: '' }
  }
}

/**
 * Whether a mod's declared loaders fit the instance. Quilt runs Fabric mods.
 * NeoForge began as a fork of Forge 1.20.1, and its 1.20.1 builds still load
 * most Forge mods for that version; those were blocked outright as not
 * fitting, while most of them run.
 */
function loaderFit(instance: Instance, loaders: string[]): 'fits' | 'forge-on-neoforge' | 'no' {
  if (loaders.length === 0) return 'fits'
  if (instance.loader === 'vanilla') return 'no'
  if (loaders.includes(instance.loader)) return 'fits'
  if (instance.loader === 'quilt' && loaders.includes('fabric')) return 'fits'
  if (instance.loader === 'neoforge' && instance.mcVersion === '1.20.1' && loaders.includes('forge')) {
    return 'forge-on-neoforge'
  }
  return 'no'
}

/**
 * Exact, or a hotfix of the same release (see gameVersions.ts). Any version
 * of the same line used to count, so a 1.20.6 build in a 1.20.1 instance
 * passed without a word.
 */
function versionCompatible(instance: Instance, item: ContentItem): boolean {
  if (item.gameVersions.length === 0) return true
  return item.gameVersions.some((v) => gameVersionMatches(instance.mcVersion, v))
}

/** Modrinth project ids for Iris and Oculus, the two shader loaders distributed there. */
const MODRINTH_SHADER_LOADER_IDS = new Set(['YL57xq9U', 'GchcoXML'].map((id) => id.toLowerCase()))

/** CurseForge project ids for the same two mods. */
const CURSEFORGE_SHADER_LOADER_IDS = new Set(['455508', '581495'])

/**
 * True for a mod known to load shader packs: Iris, Oculus or OptiFine.
 *
 * Matched by provider identity rather than a free text search. The previous
 * check looked for "iris", "optifine" or "oculus" as a substring of the
 * display name, so any unrelated mod whose name merely contained one of
 * those words silenced the warning below for good. OptiFine is not
 * distributed on either platform and has no project id, so it stays a
 * strict file name check.
 */
function isShaderLoader(item: ContentItem): boolean {
  if (
    item.provider === 'modrinth' &&
    item.projectId &&
    MODRINTH_SHADER_LOADER_IDS.has(item.projectId.toLowerCase())
  ) {
    return true
  }
  if (item.provider === 'curseforge' && item.projectId && CURSEFORGE_SHADER_LOADER_IDS.has(item.projectId)) {
    return true
  }
  // Hand-placed jars carry no project id at all; a file clearly named after
  // one of the two mods is accepted so a manually installed Iris still counts.
  if (item.provider === 'local' && /^(iris|oculus)-/i.test(item.fileName)) return true
  if (/^optifine[_-]/i.test(item.fileName)) return true
  return false
}

/** The launch-blocking issue for one mod installed more than once, oldest first. */
function duplicateIssue(id: string, duplicates: ContentItem[]): CompatibilityIssue {
  return {
    id,
    severity: 'error',
    title: tr(`${duplicates[0].name} ist doppelt installiert`, `${duplicates[0].name} is installed twice`),
    detail:
      tr(
        `Es liegen ${duplicates.length} Dateien desselben Mods im Ordner: `,
        `There are ${duplicates.length} files of the same mod in the folder: `
      ) + duplicates.map((d) => d.fileName).join(', '),
    contentId: duplicates[0].id,
    fix: {
      kind: 'remove-content',
      label: tr('Ältere Datei entfernen', 'Remove older file'),
      contentId: duplicates[0].id
    }
  }
}

/**
 * Inspects the installed content of an instance and reports everything that
 * would break the launch or behave unexpectedly.
 */
export async function checkCompatibility(instanceId: string): Promise<CompatibilityReport> {
  await syncContentWithDisk(instanceId)
  const instance = getInstance(instanceId)
  const issues: CompatibilityIssue[] = []

  const mods = instance.content.filter((c) => c.type === 'mod')
  const enabled = mods.filter((c) => c.enabled)

  // The ids each jar declares. The folder scan above records them once per
  // jar; read here only for a record it could not fill in yet.
  const idsByMod = new Map<string, string[]>()
  for (const mod of enabled) {
    const ids = mod.modIds ?? (await readJarMetadata(join(paths.mods(instanceId), mod.fileName)))?.ids ?? []
    idsByMod.set(mod.id, ids)
  }
  // Flattened like the names, so a declared "fabric-api" meets the slug
  // "fabric-api" and the name "Fabric API" alike.
  const installedModIds = new Set(enabled.flatMap((c) => (idsByMod.get(c.id) ?? []).map(flattenName)))

  // Project ids of everything currently installed and enabled.
  const installedProjects = new Set(
    enabled.filter((c) => c.projectId).map((c) => `${c.provider}:${c.projectId}`)
  )
  const installedNames = new Set(enabled.map((c) => flattenName(c.name)))

  // 1. Mods in a vanilla instance -----------------------------------
  if (instance.loader === 'vanilla' && enabled.length > 0) {
    issues.push({
      id: 'vanilla-with-mods',
      // A warning, not an error: without a loader nothing reads the mods
      // folder, so the jars just sit there and the game starts normally.
      // Blocking the launch made a harmless leftover file (a mod kept after
      // switching back to vanilla) render the instance unplayable.
      severity: 'warning',
      title: tr('Diese Instanz hat keinen Mod-Loader', 'This instance has no mod loader'),
      detail: tr(
        (enabled.length === 1 ? 'In der Instanz liegt 1 Mod, ' : `In der Instanz liegen ${enabled.length} Mods, `) +
          'aber es ist kein Mod-Loader installiert. Ohne Fabric, Forge, NeoForge oder Quilt werden die Mods beim Start einfach ignoriert.',
        (enabled.length === 1 ? 'The instance contains 1 mod, ' : `The instance contains ${enabled.length} mods, `) +
          'but no mod loader is installed. Without Fabric, Forge, NeoForge or Quilt the mods are simply ignored on start.'
      )
    })
  }

  // Everything below only matters when a loader is actually present. Without
  // one nothing reads the mods folder at all, which the vanilla warning above
  // says in so many words — yet a missing dependency or a duplicate jar still
  // pushed an `error`, and an error flips `launchable` to false. A vanilla
  // instance with a leftover mod was reported as unplayable while the game
  // starts perfectly.
  const loaderActive = instance.loader !== 'vanilla'

  for (const mod of loaderActive ? enabled : []) {
    // 2. Loader mismatch --------------------------------------------
    const fit = loaderFit(instance, mod.loaders)
    if (fit === 'no') {
      // A hand-dropped jar's loaders come from its own metadata files. They
      // say what it was built for, a strong hint, but not a promise that the
      // loader refuses it, so it does not block the start.
      const local = mod.provider === 'local'
      issues.push({
        id: `loader-${mod.id}`,
        severity: local ? 'warning' : 'error',
        title: tr(`${mod.name} passt nicht zum Mod-Loader`, `${mod.name} does not fit the mod loader`),
        detail: local
          ? tr(
              `${mod.name} ist laut seinen eigenen Angaben für ${mod.loaders.join(', ')} gebaut, diese Instanz nutzt aber ${instance.loader}. Wahrscheinlich wird er nicht geladen.`,
              `According to its own metadata ${mod.name} is built for ${mod.loaders.join(', ')}, but this instance uses ${instance.loader}. It will probably not be loaded.`
            )
          : tr(
              `${mod.name} ist für ${mod.loaders.join(', ')} gebaut, diese Instanz nutzt aber ${instance.loader}. Der Start würde fehlschlagen.`,
              `${mod.name} is built for ${mod.loaders.join(', ')}, but this instance uses ${instance.loader}. The launch would fail.`
            ),
        contentId: mod.id,
        fix: { kind: 'disable-content', label: tr('Mod deaktivieren', 'Disable mod'), contentId: mod.id }
      })
    } else if (fit === 'forge-on-neoforge') {
      issues.push({
        id: `loader-${mod.id}`,
        severity: 'warning',
        title: tr(`${mod.name} ist für Forge gebaut`, `${mod.name} is built for Forge`),
        detail: tr(
          `NeoForge für 1.20.1 lädt die meisten Forge-Mods dieser Version, aber nicht alle. Stürzt das Spiel beim Start ab, deaktiviere ${mod.name} als Erstes.`,
          `NeoForge for 1.20.1 loads most Forge mods of that version, but not all of them. If the game crashes on start, disable ${mod.name} first.`
        ),
        contentId: mod.id,
        fix: { kind: 'disable-content', label: tr('Mod deaktivieren', 'Disable mod'), contentId: mod.id }
      })
    }

    // 3. Game version mismatch --------------------------------------
    if (!versionCompatible(instance, mod)) {
      const severity = mod.provider === 'local' ? 'info' : 'warning'
      issues.push({
        id: `version-${mod.id}`,
        severity,
        title: tr(`${mod.name} ist nicht für ${instance.mcVersion} freigegeben`, `${mod.name} is not marked as compatible with ${instance.mcVersion}`),
        detail: tr(
          `Unterstützt laut Angaben: ${mod.gameVersions.slice(0, 6).join(', ') || 'unbekannt'}. Das kann funktionieren, kann aber auch zu Abstürzen führen.`,
          `Listed as supporting: ${mod.gameVersions.slice(0, 6).join(', ') || 'unknown'}. It may work, but it can also cause crashes.`
        ),
        contentId: mod.id,
        fix:
          mod.provider !== 'local' && mod.projectId
            ? {
                kind: 'update-content',
                label: tr('Passende Version suchen', 'Find matching version'),
                contentId: mod.id,
                projectId: mod.projectId,
                provider: mod.provider as 'modrinth' | 'curseforge'
              }
            : undefined
      })
    }

    // 4. Dependencies ------------------------------------------------
    for (const dependency of mod.dependencies) {
      // Unresolvable at the provider (withdrawn version); the install already
      // warned about it, and there is nothing a fix button could install.
      if (!dependency.projectId) continue
      if (dependency.type === 'required') {
        // Scoped to the requiring mod's own provider only. The unscoped
        // fallback that used to sit here compared bare ids across providers,
        // which the comment a few lines below calls out as unsound: a
        // CurseForge id that happens to equal a Modrinth one would silence a
        // genuinely missing requirement. The legitimate cross-provider case
        // is already covered by the name comparison further down.
        const key = `${mod.provider}:${dependency.projectId}`
        if (installedProjects.has(key)) continue

        const provider = mod.provider === 'curseforge' ? 'curseforge' : 'modrinth'
        const { name, slug } = await projectInfo(provider, dependency.projectId)

        // A dependency id always lives in the requiring mod's own namespace,
        // and CurseForge's numeric ids never coincide with Modrinth's base62
        // ones — so the same library installed from the *other* platform could
        // never match above. Comparing the resolved project name catches that,
        // which is exactly the Fabric-API-from-Modrinth-required-by-a-
        // CurseForge-mod case. It can only silence a false alarm, never raise
        // a new one.
        if (name && installedNames.has(flattenName(name))) continue
        // A hand-dropped jar carries no project id, and when it was recorded
        // before its metadata was read, not even the right name. The id it
        // declares usually is the project's slug: "fabric-api" for Fabric API.
        if (slug && installedModIds.has(flattenName(slug))) continue

        // Installed, but switched off. Downloading it again kept it switched
        // off, so the old fix reported success and the same error came back.
        const switchedOff = mods.find(
          (c) =>
            !c.enabled &&
            ((c.provider === mod.provider && c.projectId === dependency.projectId) ||
              (name !== '' && flattenName(c.name) === flattenName(name)))
        )
        if (switchedOff) {
          issues.push({
            id: `dep-${mod.id}-${dependency.projectId}`,
            severity: 'error',
            title: tr(`${mod.name} benötigt ${name}`, `${mod.name} requires ${name}`),
            detail: tr(
              `${name} ist installiert, aber ausgeschaltet. Ohne diese Abhängigkeit startet das Spiel nicht.`,
              `${name} is installed but switched off. The game does not start without this dependency.`
            ),
            contentId: mod.id,
            fix: {
              kind: 'enable-content',
              label: tr(`${name} einschalten`, `Switch on ${name}`),
              contentId: switchedOff.id
            }
          })
          continue
        }

        issues.push({
          id: `dep-${mod.id}-${dependency.projectId}`,
          severity: 'error',
          title: tr(`${mod.name} benötigt ${name}`, `${mod.name} requires ${name}`),
          detail: tr(
            `Die Abhängigkeit ${name} ist nicht installiert. Ohne sie startet das Spiel nicht.`,
            `The dependency ${name} is not installed. The game does not start without it.`
          ),
          contentId: mod.id,
          fix: {
            kind: 'install-dependency',
            label: tr(`${name} installieren`, `Install ${name}`),
            projectId: dependency.projectId,
            provider
          }
        })
      }

      if (dependency.type === 'incompatible') {
        // Scoped to the same provider, like the required-dependency path just
        // above. CurseForge's numeric ids and Modrinth's base62 ones live in
        // separate namespaces, so an unscoped match could pair two entirely
        // unrelated mods into a launch-blocking conflict.
        const conflicting = enabled.find(
          (c) =>
            c.projectId === dependency.projectId &&
            c.provider === mod.provider &&
            // Some mods are incompatible with one version of another mod only
            // and name that version. Ignoring it blocked the start with every
            // version of that mod, including the ones that work.
            (!dependency.versionId || c.versionId === dependency.versionId)
        )
        if (!conflicting) continue

        issues.push({
          id: `conflict-${mod.id}-${dependency.projectId}`,
          severity: 'error',
          title: tr(`${mod.name} verträgt sich nicht mit ${conflicting.name}`, `${mod.name} does not work with ${conflicting.name}`),
          detail: tr(
            `${mod.name} gibt ${conflicting.name} ausdrücklich als inkompatibel an. Deaktiviere einen der beiden Mods.`,
            `${mod.name} explicitly lists ${conflicting.name} as incompatible. Disable one of the two mods.`
          ),
          contentId: conflicting.id,
          fix: {
            kind: 'disable-content',
            label: tr(`${conflicting.name} deaktivieren`, `Disable ${conflicting.name}`),
            contentId: conflicting.id
          }
        })
      }
    }
  }

  // 5. Duplicates ----------------------------------------------------
  //
  // Grouped by flattened display name rather than by project id. The id alone
  // missed the two cases that actually happen: the same mod pulled once from
  // Modrinth and once from CurseForge (disjoint id namespaces, so the ids
  // never match), and two copies of a manually dropped-in jar, which carry no
  // project id at all and were skipped outright.
  //
  // The ids the jars themselves declare come first: they are exactly what the
  // loader refuses to start over. By name alone, a hand-dropped
  // "sodium-fabric-0.6.0.jar" next to Sodium from Modrinth was never seen,
  // since the file had been recorded under its file name.
  const reported = new Set<string>()
  const byModId = new Map<string, ContentItem[]>()
  for (const mod of loaderActive ? enabled : []) {
    // Only jars this loader reads. The Forge build of a mod lying next to its
    // Fabric build shares the id, but Fabric never loads it, and the fix
    // below would delete whichever of the two is older.
    if (loaderFit(instance, mod.loaders) === 'no') continue
    for (const modId of new Set(idsByMod.get(mod.id) ?? [])) {
      const list = byModId.get(modId) ?? []
      list.push(mod)
      byModId.set(modId, list)
    }
  }
  for (const [modId, list] of byModId) {
    if (list.length < 2 || list.every((mod) => reported.has(mod.id))) continue
    const duplicates = [...list].sort((a, b) => a.installedAt - b.installedAt)
    issues.push(duplicateIssue(`duplicate-id-${modId}`, duplicates))
    for (const mod of duplicates) reported.add(mod.id)
  }

  const byProject = new Map<string, ContentItem[]>()
  for (const mod of loaderActive ? enabled : []) {
    const key = flattenName(mod.name)
    if (!key) continue
    const list = byProject.get(key) ?? []
    list.push(mod)
    byProject.set(key, list)
  }
  // Sharing a display name is not enough on its own to delete something: two
  // different mods by different authors can happen to be called the same
  // thing, and a name-only match used to offer the exact same "remove it"
  // fix as a genuine duplicate, silently deleting an unrelated mod. Only a
  // shared provider+project id or a shared file hash proves it is actually
  // one mod installed twice.
  const sameMod = (a: ContentItem, b: ContentItem): boolean => {
    if (a.projectId && b.projectId) return a.provider === b.provider && a.projectId === b.projectId
    if (a.sha1 && b.sha1) return a.sha1 === b.sha1
    return false
  }
  for (const [key, unsorted] of byProject) {
    if (unsorted.length < 2) continue
    if (unsorted.every((mod) => reported.has(mod.id))) continue
    // Sorted once, up front: `contentId` (which entry the UI highlights) and
    // `fix.contentId` (which entry "Fix" actually deletes) used to be built
    // from the array in two different states, before and after an in-place
    // sort, and could end up pointing at two different duplicates. The oldest
    // is the one the fix removes, so it is also the one shown.
    const duplicates = [...unsorted].sort((a, b) => a.installedAt - b.installedAt)
    // A mixed group (three files, only two of them provably the same mod) is
    // treated as a name-only match throughout, rather than guessing which
    // pair the user meant.
    // The same mod from Modrinth and from CurseForge shares neither a project
    // id nor a file hash; the declared ids above already settled that case,
    // so what is left here is proven by id or hash, or stays a warning.
    const certain = duplicates.every((mod) => sameMod(mod, duplicates[0]))

    if (certain) {
      issues.push(duplicateIssue(`duplicate-${key}`, duplicates))
    } else {
      // Hand-placed jars carry neither a project id nor a hash, so two copies
      // of the same mod can never be proven identical. The fix is still
      // offered for them, but it names the exact file, so removing it is a
      // choice the user makes knowingly rather than a blind "fix".
      const allLocal = duplicates.every((d) => !d.projectId)
      issues.push({
        id: `duplicate-name-${key}`,
        severity: 'warning',
        title: tr(`${duplicates[0].name}: Name mehrfach vergeben`, `${duplicates[0].name}: name used more than once`),
        detail: tr(
          `${duplicates.length} Mods tragen den Namen „${duplicates[0].name}“: ${duplicates.map((d) => d.fileName).join(', ')}. Das können auch zwei unterschiedliche Mods sein, prüfe von Hand, ob einer davon ein Duplikat ist.`,
          `${duplicates.length} mods are named "${duplicates[0].name}": ${duplicates.map((d) => d.fileName).join(', ')}. They may also be two different mods, check by hand whether one of them is a duplicate.`
        ),
        contentId: duplicates[0].id,
        fix: allLocal
          ? {
              kind: 'remove-content',
              label: tr(`${duplicates[0].fileName} entfernen`, `Remove ${duplicates[0].fileName}`),
              contentId: duplicates[0].id
            }
          : undefined
      })
    }
  }

  // 6. Shaders without a shader loader -------------------------------
  const shaders = instance.content.filter((c) => c.type === 'shaderpack' && c.enabled)
  if (shaders.length > 0) {
    // Sodium is deliberately absent: it is a rendering optimiser, not a
    // shaderpack loader. Counting it meant a Sodium-only instance silently
    // suppressed this warning while the shaderpack never rendered, since Iris
    // is what actually loads them on top of Sodium.
    const hasShaderLoader = enabled.some((mod) => isShaderLoader(mod))
    if (!hasShaderLoader) {
      // Iris and Oculus are the same mod for different loaders, both hosted
      // on Modrinth under their own project id.
      const shaderModByLoader: Partial<Record<LoaderId, { name: string; projectId: string }>> = {
        fabric: { name: 'Iris', projectId: 'YL57xq9U' },
        quilt: { name: 'Iris', projectId: 'YL57xq9U' },
        neoforge: { name: 'Iris', projectId: 'YL57xq9U' },
        forge: { name: 'Oculus', projectId: 'GchcoXML' }
      }
      const shaderMod = shaderModByLoader[instance.loader]

      issues.push({
        id: 'shader-without-loader',
        severity: 'warning',
        title: tr('Shader ohne Shader-Mod', 'Shaders without a shader mod'),
        detail: shaderMod
          ? tr(
              `Du hast ${shaders.length} Shader installiert, aber keinen Mod, der ${shaders.length === 1 ? 'ihn' : 'sie'} laden kann. Installiere ${shaderMod.name}.`,
              `${shaders.length} ${shaders.length === 1 ? 'shader is' : 'shaders are'} installed, but no mod that can load ${shaders.length === 1 ? 'it' : 'them'}. Install ${shaderMod.name}.`
            )
          : tr(
              `Du hast ${shaders.length} Shader installiert, aber keinen Mod, der ${shaders.length === 1 ? 'ihn' : 'sie'} laden kann. Dafür braucht es einen Mod-Loader (zum Beispiel Fabric) und Iris.`,
              `${shaders.length} ${shaders.length === 1 ? 'shader is' : 'shaders are'} installed, but no mod that can load ${shaders.length === 1 ? 'it' : 'them'}. That needs a mod loader (for example Fabric) and Iris.`
            ),
        fix: shaderMod
          ? {
              kind: 'install-dependency',
              label: tr(`${shaderMod.name} installieren`, `Install ${shaderMod.name}`),
              projectId: shaderMod.projectId,
              provider: 'modrinth'
            }
          : undefined
      })
    }
  }

  const launchable = !issues.some((i) => i.severity === 'error')

  logger.debug(`Kompatibilität ${instanceId}: ${issues.length} Hinweise, startbar=${launchable}`)

  return { instanceId, checkedAt: Date.now(), issues, launchable }
}
