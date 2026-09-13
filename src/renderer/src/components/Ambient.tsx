import { useMemo, type CSSProperties, type JSX } from 'react'
import { useStore } from '../lib/store'

/** How many cubes are scattered. Matches the density the canvas version used. */
const COUNT = 34

/**
 * The backdrop: three colour fields, a perspective floor grid and a scatter of
 * voxel cubes.
 *
 * The cubes drift, but nothing here runs on the main thread. An early version
 * repainted them on an animation-frame loop and that alone accounted for
 * roughly half the launcher's CPU on a laptop, which is why it was made
 * completely still for a while. This sits in between: each cube is a plain
 * element animated on `transform` only, which the compositor handles on its
 * own without waking JavaScript or re-running layout for a single frame.
 *
 * Positions are percentages, so one scatter works at any window size and a
 * resize needs no recalculation at all.
 */
export function Ambient(): JSX.Element {
  const { settings } = useStore()

  // Generated once. Re-rolling them on a theme change would make the whole
  // field visibly jump, and the colour comes from CSS anyway.
  const voxels = useMemo(
    () =>
      Array.from({ length: COUNT }, () => ({
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        size: `${4 + Math.random() * 10}px`,
        rotation: `${Math.random() * 180}deg`,
        alpha: 0.12 + Math.random() * 0.34,
        // Each cube gets its own path and pace, otherwise the field moves as
        // one block and reads as a sliding image rather than floating pieces.
        driftX: `${(Math.random() - 0.5) * 26}px`,
        driftY: `${(Math.random() - 0.5) * 26}px`,
        driftRotation: `${(Math.random() - 0.5) * 24}deg`,
        duration: `${14 + Math.random() * 22}s`,
        delay: `-${Math.random() * 20}s`
      })),
    []
  )

  return (
    <div className="ambient" aria-hidden="true">
      <div className="aurora a" />
      <div className="aurora b" />
      <div className="aurora c" />

      <div className={`voxel-field${settings.reduceMotion ? ' still' : ''}`}>
        {voxels.map((voxel, index) => (
          <span
            key={index}
            className="voxel"
            style={
              {
                left: voxel.left,
                top: voxel.top,
                '--s': voxel.size,
                '--r': voxel.rotation,
                '--a': voxel.alpha,
                '--dx': voxel.driftX,
                '--dy': voxel.driftY,
                '--dr': voxel.driftRotation,
                '--dur': voxel.duration,
                '--delay': voxel.delay
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="ambient-grid" />
      <div className="ambient-vignette" />
    </div>
  )
}
