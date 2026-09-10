import { getState, refreshInstances, setState, toast, toastError } from './store'
import { renderInstanceIcon } from './icon'
import { pluralise } from './format'
import { t } from './i18n'

/**
 * Runs a repair and drives the global overlay through it, so the same flow
 * works from the instance page's own button and from "Mods prüfen &
 * reparieren" on a crashed launch, without either one reaching into the
 * other's local component state.
 */
export async function repairInstanceWithOverlay(instanceId: string, instanceName: string): Promise<void> {
  if (getState().repairGate) return
  setState({ repairGate: { instanceId, instanceName, report: null } })
  try {
    const result = await window.gabi.instances.repair(instanceId)
    setState((current) =>
      current.repairGate?.instanceId === instanceId ? { repairGate: { ...current.repairGate, report: result } } : {}
    )
    const failed = result.steps.filter((s) => s.status === 'failed').length
    toast(
      failed > 0 ? 'warning' : 'success',
      t('lib', 'action.repairDoneTitle'),
      t('lib', 'action.repairSummary', {
        checked: result.checkedFiles,
        checkedLabel: pluralise(result.checkedFiles, t('lib', 'action.repairFile'), t('lib', 'action.repairFiles')),
        repaired: result.repairedFiles
      }) +
        (failed > 0
          ? t('lib', 'action.repairSummaryFailedSuffix', {
              failed,
              failedLabel: pluralise(failed, t('lib', 'action.repairStep'), t('lib', 'action.repairSteps'))
            })
          : '') +
        '.',
      9000
    )
    await refreshInstances()
  } catch (err) {
    setState((current) => (current.repairGate?.instanceId === instanceId ? { repairGate: null } : {}))
    toastError(err, t('lib', 'action.repairFailed'))
  }
}

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
      t('lib', 'action.noAccountTitle'),
      t('lib', 'action.noAccountMessage'),
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
          t('lib', 'action.cannotStartTitle', { name: instanceName }),
          t('lib', 'action.modsProblemMessage'),
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
          t('lib', 'action.cannotStartTitle', { name: instanceName }),
          t('lib', 'action.outdatedModsMessage'),
          8000
        )
        return
      }

      setState({ modUpdateGate: { instanceId, instanceName, count: summary.updateCount } })
      return
    }

    setState({ launchOverlay: { instanceId, instanceName } })
    await window.gabi.launch.start(instanceId, { ignoreIssues: true })
    await refreshInstances()
  } catch (err) {
    toastError(err, t('lib', 'action.startFailed', { name: instanceName }))
  } finally {
    setState((current) => ({ starting: current.starting.filter((id) => id !== instanceId) }))
  }
}

/** Starts without the compatibility gate, used by the "trotzdem starten" path. */
export async function startInstanceForced(instanceId: string, instanceName: string): Promise<void> {
  setState((current) => ({ starting: [...current.starting, instanceId] }))
  setState({ launchOverlay: { instanceId, instanceName } })
  try {
    await window.gabi.launch.start(instanceId, { ignoreIssues: true })
    await refreshInstances()
  } catch (err) {
    toastError(err, t('lib', 'action.startFailed', { name: instanceName }))
  } finally {
    setState((current) => ({ starting: current.starting.filter((id) => id !== instanceId) }))
  }
}

export async function stopInstance(instanceId: string): Promise<void> {
  try {
    await window.gabi.launch.stop(instanceId)
  } catch (err) {
    toastError(err, t('lib', 'action.stopFailed'))
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
    toastError(err, t('lib', 'action.shortcutFailed'))
  }
}

/**
 * Picks a modpack file or an instance folder and opens the import wizard on
 * what was found.
 *
 * Both used to import straight from the picker, so the first thing anyone saw
 * of a foreign folder was an instance that already existed. The analysis is
 * read-only, which is what makes showing it first worth the extra step.
 */
async function startImport(source: 'folder' | 'file'): Promise<void> {
  // Opened before the analysis runs so the window is up while the picker's
  // result is being read, rather than nothing happening for a few seconds.
  const open = (patch: Partial<NonNullable<ReturnType<typeof getState>['importGate']>>): void =>
    setState({
      importGate: {
        source,
        path: null,
        analysis: null,
        stage: 'analyzing',
        error: null,
        instanceId: null,
        check: null,
        ...patch
      }
    })

  try {
    const analysis =
      source === 'folder'
        ? await window.gabi.imports.analyzeFolder()
        : await window.gabi.imports.analyzeFile()

    // Cancelled picker: nothing was opened, so there is nothing to close.
    if (!analysis) return

    open({ path: analysis.path, analysis, stage: 'report' })
  } catch (err) {
    open({
      stage: 'failed',
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function importModpack(): Promise<void> {
  await startImport('file')
}

/** Takes over an existing instance folder from Prism, MultiMC or a .minecraft. */
export async function importInstanceFolder(): Promise<void> {
  await startImport('folder')
}

/**
 * Runs the import the wizard's report was built from, then checks the result.
 *
 * The importers themselves are unchanged and still do their copying in a
 * background task; what is new is that the wizard stays open afterwards to
 * show what `verifyImportedInstance` found instead of ending at a toast.
 */
export async function confirmImport(): Promise<void> {
  const gate = getState().importGate
  if (!gate?.analysis) return

  const { source, analysis } = gate
  setState({ importGate: { ...gate, stage: 'importing', error: null } })

  try {
    const instance =
      source === 'folder'
        ? await window.gabi.instances.importFolder(analysis.path)
        : await window.gabi.modpacks.import(analysis.path)

    if (!instance) {
      setState({ importGate: { ...gate, stage: 'report' } })
      return
    }

    await refreshInstances()

    // The copy runs as a background task, so a check fired the same instant
    // would look at a half-filled folder. The task dock shows the progress in
    // the meantime; this only decides when the check is worth running.
    const check = await window.gabi.imports.verify(instance.id).catch(() => null)

    setState({
      importGate: {
        ...gate,
        stage: 'done',
        instanceId: instance.id,
        analysis,
        check
      }
    })
  } catch (err) {
    setState({
      importGate: {
        ...gate,
        stage: 'failed',
        error: err instanceof Error ? err.message : String(err)
      }
    })
  }
}
