import { useId, type JSX } from 'react'

interface LogoIntroProps {
  size?: number
  /** Starts the intro. Until then every animated part stays hidden. */
  playing: boolean
}

/**
 * The launcher logo with its intro animation, for the boot splash.
 *
 * Geometry and colours are exactly those of Logo.tsx, which stays the static
 * logo everywhere else; only motion is added here (styles/logo-intro.css).
 * The plate outline draws itself, the block is set down from above and seats
 * with a short settle, L and G write themselves, the voxels appear and one
 * light pass crosses the plate.
 */
export function LogoIntro({ size = 76, playing }: LogoIntroProps): JSX.Element {
  // useId contains colons, which do not survive inside url(#...).
  const id = 'li' + useId().replace(/:/g, '')

  return (
    <svg
      className={`lg-anim is-ready${playing ? ' play' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-label="Launch Gabi"
      style={{ filter: 'drop-shadow(0 0 16px var(--accent-glow))' }}
    >
      <defs>
        <linearGradient id={`${id}-a`} x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="18" y1="10" x2="52" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <rect x="2" y="2" width="60" height="60" rx="17" />
        </clipPath>
      </defs>

      <g className="lg-plate">
        <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id}-a)`} opacity="0.16" />
      </g>
      <rect
        className="lg-plate-line"
        pathLength={100}
        x="2.75"
        y="2.75"
        width="58.5"
        height="58.5"
        rx="16.25"
        stroke={`url(#${id}-a)`}
        strokeWidth="1.5"
        opacity="0.55"
      />

      <g className="lg-block">
        <g opacity="0.5">
          <path d="M42 15.5 51 20.5v10L42 35.5 33 30.5v-10z" fill={`url(#${id}-a)`} opacity="0.55" />
          <path d="m33 20.5 9 5 9-5M42 25.5v10" stroke="#fff" strokeWidth="1.3" strokeOpacity="0.5" />
        </g>
      </g>

      <path
        className="lg-stroke lg-l"
        pathLength={100}
        d="M17 15v27.5a2 2 0 0 0 2 2h11.5"
        stroke={`url(#${id}-b)`}
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="lg-stroke lg-g"
        pathLength={100}
        d="M49 33.5v6.2a2 2 0 0 1-.9 1.7A12.5 12.5 0 0 1 41 43.6c-6.2 0-10.6-4.2-10.6-10.4S34.8 22.8 41 22.8c2.6 0 5 .8 6.8 2.2"
        stroke={`url(#${id}-b)`}
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="lg-stroke lg-gbar"
        pathLength={100}
        d="M41.5 33.6H49"
        stroke={`url(#${id}-b)`}
        strokeWidth="5.2"
        strokeLinecap="round"
      />

      <g className="lg-vox lg-vox-1">
        <rect x="9" y="9" width="3.4" height="3.4" rx="0.8" fill="var(--accent-2)" opacity="0.85" />
      </g>
      <g className="lg-vox lg-vox-2">
        <rect x="53" y="48" width="4" height="4" rx="1" fill="var(--accent)" opacity="0.8" />
      </g>
      <g className="lg-vox lg-vox-3">
        <rect x="8" y="50" width="2.6" height="2.6" rx="0.7" fill="var(--accent)" opacity="0.6" />
      </g>

      <g clipPath={`url(#${id}-c)`}>
        <g transform="rotate(22 32 32)">
          <rect className="lg-sweep" x="-34" y="-14" width="18" height="92" fill={`url(#${id}-s)`} opacity="0" />
        </g>
      </g>
    </svg>
  )
}
