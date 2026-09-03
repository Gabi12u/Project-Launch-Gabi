import type { JSX } from 'react'

/**
 * The backdrop, deliberately almost nothing.
 *
 * This used to be three large drifting colour fields, a scatter of 34
 * animated voxels and a perspective floor grid. Together they put a moving
 * wash of colour behind every page, which is the single thing that made the
 * launcher read as a generic dark dashboard rather than a piece of desktop
 * software. What is left is a flat field with one very faint tint at the top
 * and a vignette: enough that the window is not a dead rectangle, little
 * enough that the cards on top of it are what the eye lands on.
 *
 * It also costs nothing now. There is no animation left to pause and no
 * element per frame for the compositor to move.
 */
export function Ambient(): JSX.Element {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-tint" />
      <div className="ambient-vignette" />
    </div>
  )
}
