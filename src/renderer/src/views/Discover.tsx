import { useEffect, useState, type JSX } from 'react'
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
  const [type, setType] = useState<ContentType | 'modpack'>('modpack')
  const [installedIds, setInstalledIds] = useState<string[]>([])

  useEffect(() => {
    if (!target && instances.length > 0) setTarget(instances[0].id)
  }, [instances, target])

  // A deep link like launchgabi://install/modrinth/<id> preselects the type.
  useEffect(() => {
    const project = query.get('project')
    if (project) setType('mod')
  }, [query])

  const instance = instances.find((i) => i.id === target)

  const refreshInstalled = async (): Promise<void> => {
    if (!target) return
    try {
      const detail = await window.gabi.instances.get(target)
      setInstalledIds(detail.content.map((c) => c.projectId ?? '').filter(Boolean))
    } catch {
      setInstalledIds([])
    }
  }

  useEffect(() => {
    void refreshInstalled()
  }, [target])

  return (
    <div className="col gap-24">
      <header className="row-between wrap">
        <div>
          <h1 className="page-title">Entdecken</h1>
          <p className="page-sub">
            Modpacks, Mods, Shader und Resourcepacks von Modrinth und CurseForge — in einer Suche.
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
          message="Mods werden immer in eine bestimmte Instanz installiert. Lege zuerst eine an — Modpacks kannst du auch ohne Instanz installieren, sie bringen ihre eigene mit."
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
