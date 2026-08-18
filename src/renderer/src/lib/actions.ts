import { getState, refreshInstances, setState, toast, toastError } from './store'
import { renderInstanceIcon } from './icon'

/**
 * Starts an instance. The compatibility check runs first so blocking problems
 * can be shown with a "fix it for me" option instead of a raw error.
 */
export async function startInstance(instanceId: string, instanceName: string): Promise<void> {
  if (getState().starting.includes(instanceId)) return

  const accounts = getState().accounts
  if (accounts.length === 0) {
    toast(
      'warning',
      'Kein Account',
      'Melde dich zuerst mit Microsoft an oder lege ein Offline-Profil an.',
      7000
    )
    return
  }

  setState((current) => ({ starting: [...current.starting, instanceId] }))

  try {
    const report = await window.gabi.content.compatibility(instanceId)

    if (!report.launchable) {
      // Only one gate fits on screen, and it is a single slot in the store. If
      // another instance already claimed it, silently overwriting would drop
      // that one's result with no feedback at all — the user's Play click on
      // the first instance would just quietly do nothing. A toast keeps this
      // one visible instead, and the gate stays with whoever got there first.
      const claimed = getState().compatGate
      if (claimed && claimed.instanceId !== instanceId) {
        toast(
          'warning',
          `${instanceName} kann nicht starten`,
          'Es gibt Probleme mit den Mods. Schließe den offenen Hinweis, dann zeigen wir sie dir.',
          8000
        )
        return
      }

      setState({ compatGate: { instanceId, instanceName, report } })
      return
    }

    await window.gabi.launch.start(instanceId, { ignoreIssues: true })
    await refreshInstances()
  } catch (err) {
    toastError(err, `${instanceName} konnte nicht gestartet werden`)
  } finally {
    setState((current) => ({ starting: current.starting.filter((id) => id !== instanceId) }))
  }
}

/** Starts without the compatibility gate, used by the "trotzdem starten" path. */
export async function startInstanceForced(instanceId: string, instanceName: string): Promise<void> {
  setState((current) => ({ starting: [...current.starting, instanceId] }))
  try {
    await window.gabi.launch.start(instanceId, { ignoreIssues: true })
    await refreshInstances()
  } catch (err) {
    toastError(err, `${instanceName} konnte nicht gestartet werden`)
  } finally {
    setState((current) => ({ starting: current.starting.filter((id) => id !== instanceId) }))
  }
}

export async function stopInstance(instanceId: string): Promise<void> {
  try {
    await window.gabi.launch.stop(instanceId)
  } catch (err) {
    toastError(err, 'Minecraft konnte nicht beendet werden')
  }
}

export async function toggleFavorite(instanceId: string, favorite: boolean): Promise<void> {
  try {
    await window.gabi.instances.update(instanceId, { favorite })
    await refreshInstances()
  } catch (err) {
    toastError(err)
  }
}

export async function createShortcut(instanceId: string): Promise<void> {
  try {
    // The icon is drawn here because only the renderer can rasterise emoji.
    let iconImages: string[] = []
    try {
      const detail = await window.gabi.instances.get(instanceId)
      iconImages = await renderInstanceIcon({
        icon: detail.appearance.icon,
        accent: detail.appearance.accent,
        imagePath: detail.resolvedIcon
      })
    } catch {
      // Without an icon the shortcut still works, it just uses the app icon.
    }

    await window.gabi.instances.createShortcut(instanceId, iconImages)
  } catch (err) {
    toastError(err, 'Verknüpfung konnte nicht erstellt werden')
  }
}

export async function importModpack(): Promise<void> {
  try {
    const instance = await window.gabi.modpacks.import()
    if (!instance) return
    toast('success', 'Import gestartet', `${instance.name} wird eingerichtet.`)
    await refreshInstances()
  } catch (err) {
    toastError(err, 'Modpack konnte nicht importiert werden')
  }
}

/** Takes over an existing instance folder from Prism, MultiMC or a .minecraft. */
export async function importInstanceFolder(): Promise<void> {
  try {
    const instance = await window.gabi.instances.importFolder()
    if (!instance) return
    toast(
      'success',
      'Import gestartet',
      `${instance.name} wird übernommen. Welten, Mods und Einstellungen werden kopiert.`
    )
    await refreshInstances()
  } catch (err) {
    toastError(err, 'Ordner konnte nicht importiert werden')
  }
}
