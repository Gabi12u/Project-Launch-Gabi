import { useEffect, useState, type JSX } from 'react'
import type { ContentItem, LoaderId, ProjectVersion } from '@shared/types'
import { Modal } from './ui'
import { IconCheck, IconDownload } from './Icons'
import { formatBytes, formatRelative } from '../lib/format'
import { toast, toastError } from '../lib/store'
import { t } from '../lib/i18n'

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
        toastError(err, t('content', 'picker.loadFailed'))
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
      toast('success', t('content', 'picker.installSuccess', { name: item.name, version: version.versionNumber }))
      await onChanged()
      onClose()
    } catch (err) {
      toastError(err, t('content', 'picker.installFailed'))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <Modal
      open
      title={t('content', 'picker.title', { name: item.name })}
      subtitle={item.version ? t('content', 'picker.subtitle', { version: item.version }) : undefined}
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
            ? t('content', 'picker.localNoVersions')
            : t('content', 'picker.noVersions')}
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
              {t('content', 'picker.filter.label', { version: mcVersion })}
              {loader !== 'vanilla' ? ` ${t('content', 'picker.filter.andLoader', { loader })}` : ''}
              {hiddenCount > 0 && onlyCompatible
                ? ` ${t('content', 'picker.filter.hidden', { count: hiddenCount })}`
                : ''}
            </span>
          </label>

          {shown.length === 0 ? (
            <p className="hint">{t('content', 'picker.noneMatch')}</p>
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
                        {active && <span className="badge ok">{t('content', 'status.installed')}</span>}
                        {!compatible && <span className="badge danger">{t('content', 'status.incompatible')}</span>}
                      </div>
                      <div className="content-meta">
                        <span>{formatRelative(new Date(version.releasedAt).getTime())}</span>
                        {version.size ? <span>{formatBytes(version.size)}</span> : null}
                        <span className="truncate">{version.gameVersions.slice(0, 4).join(', ')}</span>
                      </div>
                    </div>

                    <div className="content-actions">
                      {active ? (
                        <span className="badge ok dot">{t('content', 'status.active')}</span>
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
                              ? t('content', 'picker.incompatibleTooltip')
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
                          {t('content', 'action.apply')}
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
