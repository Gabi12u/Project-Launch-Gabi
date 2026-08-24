import { useEffect, useState, type JSX } from 'react'
import type { ContentItem, LoaderId, ProjectVersion } from '@shared/types'
import { Modal } from './ui'
import { IconCheck, IconDownload } from './Icons'
import { formatBytes, formatRelative } from '../lib/format'
import { toast, toastError } from '../lib/store'

interface Props {
  item: ContentItem
  instanceId: string
  mcVersion: string
  loader: LoaderId
  onClose: () => void
  onChanged: () => Promise<void> | void
}

/**
 * Lets the user put a specific version of an already-installed mod in place.
 *
 * The provider decides which versions exist; installing one simply replaces the
 * file, which `installContent` already handles for a project that is present.
 */
export function VersionPicker({
  item,
  instanceId,
  mcVersion,
  loader,
  onClose,
  onChanged
}: Props): JSX.Element {
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null)
  const [onlyCompatible, setOnlyCompatible] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)

  useEffect(() => {
    if (!item.projectId || item.provider === 'local') {
      setVersions([])
      return
    }

    let current = true
    setVersions(null)
    void window.gabi.providers
      // Unfiltered on purpose: the filter below is applied in the renderer, so
      // switching it does not need another round trip, and an older version for
      // a different Minecraft release stays reachable.
      .versions(item.provider as 'modrinth' | 'curseforge', item.projectId)
      .then((list) => {
        if (current) setVersions(list)
      })
      .catch((err) => {
        if (!current) return
        toastError(err, 'Versionen konnten nicht geladen werden')
        setVersions([])
      })
    return () => {
      current = false
    }
  }, [item.projectId, item.provider])

  const fits = (version: ProjectVersion): boolean => {
    const versionOk = version.gameVersions.length === 0 || version.gameVersions.includes(mcVersion)
    const loaderOk =
      version.loaders.length === 0 ||
      loader === 'vanilla' ||
      version.loaders.includes(loader) ||
      // Quilt runs Fabric mods, the same rule the compatibility check uses.
      (loader === 'quilt' && version.loaders.includes('fabric'))
    return versionOk && loaderOk
  }

  const shown = (versions ?? []).filter((version) => !onlyCompatible || fits(version))
  const hiddenCount = (versions ?? []).length - shown.length

  const install = async (version: ProjectVersion): Promise<void> => {
    setInstalling(version.versionId)
    try {
      await window.gabi.content.install({
        instanceId,
        provider: version.provider,
        projectId: version.projectId,
        versionId: version.versionId,
        type: item.type
      })
      toast('success', `${item.name} ${version.versionNumber} installiert`)
      await onChanged()
      onClose()
    } catch (err) {
      toastError(err, 'Version konnte nicht gewechselt werden')
    } finally {
      setInstalling(null)
    }
  }

  return (
    <Modal
      open
      title={`Version wählen: ${item.name}`}
      subtitle={item.version ? `Aktuell installiert: ${item.version}` : undefined}
      onClose={onClose}
      width="wide"
      busy={installing !== null}
    >
      {versions === null ? (
        <div className="col gap-8">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 54 }} />
          ))}
        </div>
      ) : versions.length === 0 ? (
        <p className="hint">
          {item.provider === 'local'
            ? 'Diese Datei wurde von Hand hinzugefügt, es gibt daher keine Versionsliste.'
            : 'Für dieses Projekt wurden keine Versionen gefunden.'}
        </p>
      ) : (
        <div className="col gap-12">
          <label className="row gap-8" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyCompatible}
              onChange={(event) => setOnlyCompatible(event.target.checked)}
            />
            <span style={{ fontSize: 13 }}>
              Nur passende zu Minecraft {mcVersion}
              {loader !== 'vanilla' ? ` und ${loader}` : ''}
              {hiddenCount > 0 && onlyCompatible ? ` (${hiddenCount} ausgeblendet)` : ''}
            </span>
          </label>

          {shown.length === 0 ? (
            <p className="hint">
              Keine passende Version. Nimm den Haken heraus, um alle zu sehen, dann kann die
              Instanz aber abstürzen.
            </p>
          ) : (
            <div className="col gap-8">
              {shown.slice(0, 60).map((version) => {
                const active = version.fileName === item.fileName
                const compatible = fits(version)
                return (
                  <div key={version.versionId} className={`content-row${active ? ' is-you' : ''}`}>
                    <div className="grow" style={{ overflow: 'hidden' }}>
                      <div className="row gap-8">
                        <span className="content-name truncate">{version.versionNumber}</span>
                        {version.releaseType !== 'release' && (
                          <span className="badge warn">{version.releaseType}</span>
                        )}
                        {active && <span className="badge ok">Installiert</span>}
                        {!compatible && <span className="badge danger">Passt nicht</span>}
                      </div>
                      <div className="content-meta">
                        <span>{formatRelative(new Date(version.releasedAt).getTime())}</span>
                        {version.size ? <span>{formatBytes(version.size)}</span> : null}
                        <span className="truncate">{version.gameVersions.slice(0, 4).join(', ')}</span>
                      </div>
                    </div>

                    <div className="content-actions">
                      {active ? (
                        <span className="badge ok dot">Aktiv</span>
                      ) : (
                        <button
                          className="btn sm primary"
                          disabled={installing !== null}
                          onClick={() => void install(version)}
                        >
                          {installing === version.versionId ? (
                            <span className="spinner" />
                          ) : compatible ? (
                            <IconCheck size={13} />
                          ) : (
                            <IconDownload size={13} />
                          )}
                          Einsetzen
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
