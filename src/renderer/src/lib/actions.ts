import { getState, promptToast, refreshInstances, setState, toast, toastError } from './store'
import { renderInstanceIcon } from './icon'
import { tr } from '@shared/i18n'

/**
 * Starts an instance. The compatibility check runs first so blocking problems
 * can be shown with a "fix it for me" option instead of a raw error.
 */
export async function startInstance(instanceId: string, instanceName: string): Promise<void> {
  if (getState().starting.includes(instanceId)) return

  const accounts = getState().accounts
  if (accounts.length === 0) {
    promptToast(
      'warning',
      tr('Kein Account', 'No account'),
      tr('Melde dich zuerst mit Microsoft an oder lege ein Offline-Profil an.', 'Sign in with Microsoft first or create an offline profile.'),
      [
        {
          label: tr('Account hinzufügen', 'Add account'),
          primary: true,
          onClick: () => setState({ accountModalOpen: true })
        }
      ]
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
          tr(`${instanceName} kann nicht starten`, `${instanceName} cannot start`),
          tr('Es gibt Probleme mit den Mods. Schließe den offenen Hinweis, dann zeigen wir sie dir.', 'There are problems with the mods. Close the open notice, then we will show them to you.'),
          8000
        )
        return
      }

      setState({ compatGate: { instanceId, instanceName, report } })
      return
    }

    // Compatibility only looks at whether the mods work together, not at
    // whether a newer version of one of them exists. Checked from the list
    // already in the store rather than a fresh request, so this adds no
    // delay to an ordinary Play click; it is only as current as the last
    // update check, exactly like the badge next to this same instance.
    const summary = getState().instances.find((i) => i.id === instanceId)
    if (summary && summary.updateCount > 0) {
      const claimed = getState().modUpdateGate
      if (claimed && claimed.instanceId !== instanceId) {
        toast(
          'warning',
          tr(`${instanceName} kann nicht starten`, `${instanceName} cannot start`),
          tr('Es gibt veraltete Mods bei einer anderen Instanz. Schließe den offenen Hinweis, dann zeigen wir sie dir.', 'Another instance has outdated mods. Close the open notice, then we will show them to you.'),
          8000
        )
        return
      }

      setState({ modUpdateGate: { instanceId, instanceName, count: summary.updateCount } })
      return
    }

    await window.gabi.launch.start(instanceId, { ignoreIssues: true })
    await refreshInstances()
  } catch (err) {
    toastError(err, tr(`${instanceName} konnte nicht gestartet werden`, `${instanceName} could not be started`))
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
    toastError(err, tr(`${instanceName} konnte nicht gestartet werden`, `${instanceName} could not be started`))
  } finally {
    setState((current) => ({ starting: current.starting.filter((id) => id !== instanceId) }))
  }
}

export async function stopInstance(instanceId: string): Promise<void> {
  try {
    await window.gabi.launch.stop(instanceId)
  } catch (err) {
    toastError(err, tr('Minecraft konnte nicht beendet werden', 'Minecraft could not be stopped'))
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
    // The file lands on the desktop with nothing else to show for it.
    toast('success', tr('Verknüpfung erstellt', 'Shortcut created'), tr('Du findest sie auf deinem Desktop.', 'You will find it on your desktop.'))
  } catch (err) {
    toastError(err, tr('Verknüpfung konnte nicht erstellt werden', 'Shortcut could not be created'))
  }
}

export async function importModpack(): Promise<void> {
  try {
    const instance = await window.gabi.modpacks.import()
    if (!instance) return
    toast('success', tr('Import gestartet', 'Import started'), tr(`${instance.name} wird eingerichtet.`, `Setting up ${instance.name}.`))
    await refreshInstances()
  } catch (err) {
    toastError(err, tr('Modpack konnte nicht importiert werden', 'Modpack could not be imported'))
  }
}

/** Takes over an existing instance folder from Prism, MultiMC or a .minecraft. */
export async function importInstanceFolder(): Promise<void> {
  try {
    const instance = await window.gabi.instances.importFolder()
    if (!instance) return
    toast(
      'success',
      tr('Import gestartet', 'Import started'),
      tr(
        `${instance.name} wird übernommen. Welten, Mods und Einstellungen werden kopiert.`,
        `Taking over ${instance.name}. Worlds, mods and settings are being copied.`
      )
    )
    await refreshInstances()
  } catch (err) {
    toastError(err, tr('Ordner konnte nicht importiert werden', 'Folder could not be imported'))
  }
}
