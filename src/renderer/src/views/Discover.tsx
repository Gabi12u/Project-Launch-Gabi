import { useEffect, useState, type JSX, useRef, useCallback} from 'react'
import type { ContentType } from '@shared/types'
import { setState, useStore } from '../lib/store'
import { LOADER_LABELS } from '../lib/format'
import { ContentBrowser } from '../components/ContentBrowser'
import { EmptyState } from '../components/ui'
import { IconCompass, IconPlus } from '../components/Icons'

/**
 * Global content discovery. Because installing needs a target, the user picks
 * an instance here — the browser then filters by that instance's version and
 * loader automatically.
 */
export function DiscoverView({ query }: { query: URLSearchParams }): JSX.Element {
  const { instances } = useStore()

  const [target, setTarget] = useState<string>('')
  // Read during the very first render, not from an effect afterwards.
  // ContentBrowser takes this only as its initial value, so an effect setting
  // it later arrived after that component had already picked its default and
  // was quietly ignored: an install deep link opened on Modpacks instead of
  // Mods, the opposite of what it asked for.
  const [type, setType] = useState<ContentType | 'modpack'>(() =>
    query.get('project') ? 'mod' : 'modpack'
  )
  const [installedIds, setInstalledIds] = useState<string[]>([])

  useEffect(() => {
    if (!target && instances.length > 0) setTarget(instances[0].id)
  }, [instances, target])

  // Keeps up when the link changes while this view is already open.
  const requestedProject = query.get('project')
  useEffect(() => {
    if (requestedProject) setType('mod')
  }, [requestedProject])

  const instance = instances.find((i) => i.id === target)

  // Guarded against answers arriving out of order. Switching the target
  // instance twice in quick succession could let the slower first lookup land
  // last, so the browser marked the wrong instance's content as installed.
  const installedRequest = useRef(0)

  const refreshInstalled = useCallback(async (): Promise<void> => {
    if (!target) return
    const ticket = ++installedRequest.current
    try {
      const detail = await window.gabi.instances.get(target)
      if (ticket !== installedRequest.current) return
      setInstalledIds(detail.content.map((c) => c.projectId ?? '').filter(Boolean))
    } catch {
      if (ticket === installedRequest.current) setInstalledIds([])
    }
  }, [target])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  return (
    <div className="col gap-24">
      <header className="row-between wrap">
        <div>
          <h1 className="page-title">Entdecken</h1>
          <p className="page-sub">
            Modpacks, Mods, Shader und Resourcepacks von Modrinth und CurseForge, alles in einer Suche.
          </p>
        </div>

        {instances.length > 0 && (
          <div className="row gap-8">
            <span className="hint">Ziel-Instanz:</span>
            <select
              className="select"
              style={{ width: 240 }}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {instances.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.mcVersion} {LOADER_LABELS[entry.loader]}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {instances.length === 0 ? (
        <EmptyState
          icon={<IconCompass size={26} />}
          title="Erst eine Instanz, dann die Mods"
          message="Mods werden immer in eine bestimmte Instanz installiert. Lege zuerst eine an. Modpacks kannst du auch ohne Instanz installieren, sie bringen ihre eigene mit."
          action={
            <button className="btn primary" onClick={() => setState({ createOpen: true })}>
              <IconPlus size={16} />
              Instanz erstellen
            </button>
          }
        />
      ) : (
        <>
          {instance && (
            <div className="row gap-8 wrap">
              <span className="badge accent">
                Ziel: {instance.name} · Minecraft {instance.mcVersion} · {LOADER_LABELS[instance.loader]}
              </span>
              <span className="hint">
                Modpacks bringen ihre eigene Instanz mit und ignorieren die Auswahl.
              </span>
            </div>
          )}

          <ContentBrowser
            instanceId={target}
            mcVersion={instance?.mcVersion}
            loader={instance?.loader}
            types={['modpack', 'mod', 'resourcepack', 'shaderpack', 'datapack']}
            initialType={type}
            installedProjectIds={installedIds}
            onInstalled={refreshInstalled}
          />
        </>
      )}
    </div>
  )
}
