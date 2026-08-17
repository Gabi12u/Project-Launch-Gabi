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
  if (cached) return cached

  if (nameCache.size >= NAME_CACHE_MAX) {
    // Insertion-ordered, so this drops the oldest entry.
    const oldest = nameCache.keys().next().value
    if (oldest !== undefined) nameCache.delete(oldest)
  }

  try {
    const project =
      provider === 'modrinth'
        ? await modrinth.getProject(projectId)
        : await curseforge.getProject(projectId)
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
  const installedProjectIds = new Set(enabled.filter((c) => c.projectId).map((c) => c.projectId as string))
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
        `In der Instanz liegen ${enabled.length} Mods, aber es ist kein Mod Loader installiert. ` +
        `Ohne Fabric, Forge, NeoForge oder Quilt werden die Mods beim Start einfach ignoriert.`
    })
  }

  for (const mod of enabled) {
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
        const key = `${mod.provider}:${dependency.projectId}`
        if (installedProjects.has(key) || installedProjectIds.has(dependency.projectId)) continue

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
        const conflicting = enabled.find((c) => c.projectId === dependency.projectId)
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
  const byProject = new Map<string, ContentItem[]>()
  for (const mod of enabled) {
    if (!mod.projectId) continue
    const list = byProject.get(mod.projectId) ?? []
    list.push(mod)
    byProject.set(mod.projectId, list)
  }
  for (const [, duplicates] of byProject) {
    if (duplicates.length < 2) continue
    issues.push({
      id: `duplicate-${duplicates[0].projectId}`,
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
