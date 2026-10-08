import { useEffect, useState, type JSX } from 'react'
import type { ContentItem, LoaderId, ProjectVersion } from '@shared/types'
import { Modal } from './ui'
import { IconCheck, IconDownload } from './Icons'
import { LOADER_LABELS, formatBytes, formatRelative, releaseTypeLabel } from '../lib/format'
import { toast, toastError } from '../lib/store'
import { tr } from '@shared/i18n'
import { gameVersionMatches, sameVersionLine } from '@shared/gameVersions'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

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
        toastError(err, tr('Versionen konnten nicht geladen werden', 'Versions could not be loaded'))
        // Kept apart from an empty list: once the toast had gone, a failed
        // load read as "no versions found".
        setLoadError(err instanceof Error ? err.message : String(err))
        setVersions([])
      })
    return () => {
      current = false
    }
  }, [item.projectId, item.provider, reloadKey])

  // The rule the install uses (shared/gameVersions.ts). Demanding the exact
  // version marked the "1.21" build the install had picked for a 1.21.1
  // instance as unsuitable.
  const fits = (version: ProjectVersion): boolean => {
    const looseLine = item.type === 'resourcepack' || item.type === 'shaderpack'
    const versionOk =
      version.gameVersions.length === 0 ||
      version.gameVersions.some((v) => (looseLine ? sameVersionLine(mcVersion, v) : gameVersionMatches(mcVersion, v)))
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
      toast('success', tr(`${item.name} ${version.versionNumber} installiert`, `${item.name} ${version.versionNumber} installed`))
      await onChanged()
      onClose()
    } catch (err) {
      toastError(err, tr('Version konnte nicht gewechselt werden', 'Version could not be changed'))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <Modal
      open
      title={tr(`Version wählen: ${item.name}`, `Choose version: ${item.name}`)}
      subtitle={item.version ? tr(`Aktuell installiert: ${item.version}`, `Currently installed: ${item.version}`) : undefined}
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
      ) : loadError ? (
        <div className="col gap-8">
          <p className="hint">{tr(`Die Versionen konnten nicht geladen werden: ${loadError}`, `The versions could not be loaded: ${loadError}`)}</p>
          <button
            className="btn sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              setLoadError(null)
              setVersions(null)
              setReloadKey((key) => key + 1)
            }}
          >
            {tr('Erneut versuchen', 'Try again')}
          </button>
        </div>
      ) : versions.length === 0 ? (
        <p className="hint">
          {item.provider === 'local'
            ? tr('Diese Datei wurde von Hand hinzugefügt, es gibt daher keine Versionsliste.', 'This file was added by hand, so there is no version list.')
            : tr('Für dieses Projekt wurden keine Versionen gefunden.', 'No versions were found for this project.')}
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
              {tr('Nur passende zu Minecraft', 'Only versions matching Minecraft')} {mcVersion}
              {loader !== 'vanilla' ? tr(` und ${LOADER_LABELS[loader]}`, ` and ${LOADER_LABELS[loader]}`) : ''}
              {hiddenCount > 0 && onlyCompatible ? tr(` (${hiddenCount} ausgeblendet)`, ` (${hiddenCount} hidden)`) : ''}
            </span>
          </label>

          {shown.length === 0 ? (
            <p className="hint">
              {tr(
                'Keine passende Version. Nimm den Haken heraus, um alle zu sehen, dann kann die Instanz aber abstürzen.',
                'No matching version. Untick the box to see all of them, but then the instance may crash.'
              )}
            </p>
          ) : (
            <div className="col gap-8">
              {shown.slice(0, 60).map((version) => {
                // By version id: a switched off mod carries ".disabled" in its
                // file name and was never marked, and two versions sharing a
                // file name were both marked.
                const active = item.versionId
                  ? version.versionId === item.versionId
                  : version.fileName === item.fileName.replace(/\.disabled$/, '')
                const compatible = fits(version)
                return (
                  <div key={version.versionId} className={`content-row${active ? ' is-you' : ''}`}>
                    <div className="grow" style={{ overflow: 'hidden' }}>
                      <div className="row gap-8">
                        <span className="content-name truncate">{version.versionNumber}</span>
                        {version.releaseType !== 'release' && (
                          <span className="badge warn">{releaseTypeLabel(version.releaseType)}</span>
                        )}
                        {active && <span className="badge ok">{tr('Installiert', 'Installed')}</span>}
                        {!compatible && <span className="badge danger">{tr('Passt nicht', 'Does not fit')}</span>}
                      </div>
                      <div className="content-meta">
                        <span>{formatRelative(new Date(version.releasedAt).getTime())}</span>
                        {version.size ? <span>{formatBytes(version.size)}</span> : null}
                        <span className="truncate">{version.gameVersions.slice(0, 4).join(', ')}</span>
                      </div>
                    </div>

                    <div className="content-actions">
                      {active ? (
                        <span className="badge ok dot">{tr('Aktiv', 'Active')}</span>
                      ) : (
                        <button
                          className="btn sm primary"
                          // Blocked, not merely flagged. The badge alone was
                          // decoration: the click still installed a version
                          // that cannot run with this Minecraft release or
                          // loader. Taking the filter off is the deliberate
                          // way to reach it.
                          disabled={installing !== null || (onlyCompatible && !compatible)}
                          title={
                            onlyCompatible && !compatible
                              ? tr('Passt nicht zu dieser Instanz. Nimm den Haken oben heraus, um es trotzdem zu tun.', 'Does not fit this instance. Untick the box above to do it anyway.')
                              : undefined
                          }
                          onClick={() => void install(version)}
                        >
                          {installing === version.versionId ? (
                            <span className="spinner" />
                          ) : compatible ? (
                            <IconCheck size={13} />
                          ) : (
                            <IconDownload size={13} />
                          )}
                          {tr('Einsetzen', 'Use')}
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
