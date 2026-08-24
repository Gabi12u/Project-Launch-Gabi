import type { CompatibilityIssue, CompatibilityReport, ContentItem, Instance } from '@shared/types'
import { getInstance, syncContentWithDisk } from './instances'
import { modrinth, curseforge } from '../providers'
import { log } from '../logger'

const logger = log('compat')

/** Cheap in-memory cache so repeated checks do not hammer the APIs. */
const nameCache = new Map<string, string>()
/** Bounded so a long session browsing many mods cannot grow it without end. */
const NAME_CACHE_MAX = 500

/** Strips punctuation and case so "Fabric API" and "fabric-api" compare equal. */
function flattenName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

async function projectName(provider: 'modrinth' | 'curseforge', projectId: string): Promise<string> {
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
    nameCache.set(key, project.name)
    return project.name
  } catch {
    return projectId
  }
}

/** Mods declaring one of these loaders are Fabric-compatible in a Quilt instance. */
function loaderCompatible(instance: Instance, item: ContentItem): boolean {
  if (item.loaders.length === 0) return true
  if (instance.loader === 'vanilla') return false
  if (item.loaders.includes(instance.loader)) return true
  // Quilt runs Fabric mods.
  if (instance.loader === 'quilt' && item.loaders.includes('fabric')) return true
  return false
}

function versionCompatible(instance: Instance, item: ContentItem): boolean {
  if (item.gameVersions.length === 0) return true
  if (item.gameVersions.includes(instance.mcVersion)) return true

  // Accept the same minor line: a 1.21 mod usually runs on 1.21.1.
  const line = instance.mcVersion.split('.').slice(0, 2).join('.')
  return item.gameVersions.some((v) => v === line || v.startsWith(`${line}.`))
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
      title: 'Diese Instanz hat keinen Mod Loader',
      detail:
        (enabled.length === 1
          ? 'In der Instanz liegt 1 Mod, '
          : `In der Instanz liegen ${enabled.length} Mods, `) +
        `aber es ist kein Mod Loader installiert. ` +
        `Ohne Fabric, Forge, NeoForge oder Quilt werden die Mods beim Start einfach ignoriert.`
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
    if (instance.loader !== 'vanilla' && !loaderCompatible(instance, mod)) {
      issues.push({
        id: `loader-${mod.id}`,
        severity: 'error',
        title: `${mod.name} passt nicht zum Mod Loader`,
        detail:
          `${mod.name} ist für ${mod.loaders.join(', ')} gebaut, diese Instanz nutzt aber ` +
          `${instance.loader}. Der Start würde fehlschlagen.`,
        contentId: mod.id,
        fix: { kind: 'disable-content', label: 'Mod deaktivieren', contentId: mod.id }
      })
    }

    // 3. Game version mismatch --------------------------------------
    if (!versionCompatible(instance, mod)) {
      const severity = mod.provider === 'local' ? 'info' : 'warning'
      issues.push({
        id: `version-${mod.id}`,
        severity,
        title: `${mod.name} ist nicht für ${instance.mcVersion} freigegeben`,
        detail:
          `Unterstützt laut Angaben: ${mod.gameVersions.slice(0, 6).join(', ') || 'unbekannt'}. ` +
          `Das kann funktionieren, kann aber auch zu Abstürzen führen.`,
        contentId: mod.id,
        fix:
          mod.provider !== 'local' && mod.projectId
            ? {
                kind: 'update-content',
                label: 'Passende Version suchen',
                contentId: mod.id,
                projectId: mod.projectId,
                provider: mod.provider as 'modrinth' | 'curseforge'
              }
            : undefined
      })
    }

    // 4. Dependencies ------------------------------------------------
    for (const dependency of mod.dependencies) {
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
        const name = await projectName(provider, dependency.projectId)

        // A dependency id always lives in the requiring mod's own namespace,
        // and CurseForge's numeric ids never coincide with Modrinth's base62
        // ones — so the same library installed from the *other* platform could
        // never match above. Comparing the resolved project name catches that,
        // which is exactly the Fabric-API-from-Modrinth-required-by-a-
        // CurseForge-mod case. It can only silence a false alarm, never raise
        // a new one.
        if (name && installedNames.has(flattenName(name))) continue

        issues.push({
          id: `dep-${mod.id}-${dependency.projectId}`,
          severity: 'error',
          title: `${mod.name} benötigt ${name}`,
          detail: `Die Abhängigkeit ${name} ist nicht installiert. Ohne sie startet das Spiel nicht.`,
          contentId: mod.id,
          fix: {
            kind: 'install-dependency',
            label: `${name} installieren`,
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
          (c) => c.projectId === dependency.projectId && c.provider === mod.provider
        )
        if (!conflicting) continue

        issues.push({
          id: `conflict-${mod.id}-${dependency.projectId}`,
          severity: 'error',
          title: `${mod.name} verträgt sich nicht mit ${conflicting.name}`,
          detail:
            `${mod.name} gibt ${conflicting.name} ausdrücklich als inkompatibel an. ` +
            `Deaktiviere einen der beiden Mods.`,
          contentId: conflicting.id,
          fix: {
            kind: 'disable-content',
            label: `${conflicting.name} deaktivieren`,
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
  const byProject = new Map<string, ContentItem[]>()
  for (const mod of loaderActive ? enabled : []) {
    const key = flattenName(mod.name)
    if (!key) continue
    const list = byProject.get(key) ?? []
    list.push(mod)
    byProject.set(key, list)
  }
  for (const [, duplicates] of byProject) {
    if (duplicates.length < 2) continue
    issues.push({
      id: `duplicate-${flattenName(duplicates[0].name)}`,
      severity: 'error',
      title: `${duplicates[0].name} ist doppelt installiert`,
      detail:
        `Es liegen ${duplicates.length} Dateien desselben Mods im Ordner: ` +
        duplicates.map((d) => d.fileName).join(', '),
      contentId: duplicates[1].id,
      fix: {
        kind: 'remove-content',
        label: 'Ältere Datei entfernen',
        contentId: duplicates.sort((a, b) => a.installedAt - b.installedAt)[0].id
      }
    })
  }

  // 6. Shaders without a shader loader -------------------------------
  const shaders = instance.content.filter((c) => c.type === 'shaderpack' && c.enabled)
  if (shaders.length > 0) {
    // Sodium is deliberately absent: it is a rendering optimiser, not a
    // shaderpack loader. Counting it meant a Sodium-only instance silently
    // suppressed this warning while the shaderpack never rendered — Iris is
    // what actually loads them on top of Sodium.
    const shaderLoaders = ['iris', 'optifine', 'oculus']
    const hasShaderLoader = enabled.some((mod) =>
      shaderLoaders.some((name) => mod.name.toLowerCase().includes(name))
    )
    if (!hasShaderLoader) {
      issues.push({
        id: 'shader-without-loader',
        severity: 'warning',
        title: 'Shader ohne Shader-Mod',
        detail:
          `Es sind ${shaders.length} Shaderpacks installiert, aber kein Mod, der sie laden kann. ` +
          `Installiere Iris (Fabric/NeoForge) oder Oculus (Forge).`
      })
    }
  }

  const launchable = !issues.some((i) => i.severity === 'error')

  logger.debug(`Kompatibilität ${instanceId}: ${issues.length} Hinweise, startbar=${launchable}`)

  return { instanceId, checkedAt: Date.now(), issues, launchable }
}
