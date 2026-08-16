import type { JSX } from 'react'

interface LogoProps {
  size?: number
  /** Adds the animated neon glow used on the onboarding screen. */
  glow?: boolean
}

/**
 * The LG monogram: two neon strokes over an isometric block, with a few
 * scattered voxels as the Minecraft nod. Drawn as SVG so it stays crisp at
 * every size and picks up the current accent colour.
 */
export function Logo({ size = 34, glow = false }: LogoProps): JSX.Element {
  const id = glow ? 'lg-glow' : 'lg'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-label="Launch Gabi"
      style={glow ? { filter: 'drop-shadow(0 0 16px var(--accent-glow))' } : undefined}
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
      </defs>

      {/* Rounded plate */}
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id}-a)`} opacity="0.16" />
      <rect
        x="2.75"
        y="2.75"
        width="58.5"
        height="58.5"
        rx="16.25"
        stroke={`url(#${id}-a)`}
        strokeWidth="1.5"
        opacity="0.55"
      />

      {/* Isometric block behind the monogram */}
      <g opacity="0.5">
        <path d="M42 15.5 51 20.5v10L42 35.5 33 30.5v-10z" fill={`url(#${id}-a)`} opacity="0.55" />
        <path d="m33 20.5 9 5 9-5M42 25.5v10" stroke="#fff" strokeWidth="1.3" strokeOpacity="0.5" />
      </g>

      {/* L */}
      <path
        d="M17 15v27.5a2 2 0 0 0 2 2h11.5"
        stroke={`url(#${id}-b)`}
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* G */}
      <path
        d="M49 33.5v6.2a2 2 0 0 1-.9 1.7A12.5 12.5 0 0 1 41 43.6c-6.2 0-10.6-4.2-10.6-10.4S34.8 22.8 41 22.8c2.6 0 5 .8 6.8 2.2"
        stroke={`url(#${id}-b)`}
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M41.5 33.6H49" stroke={`url(#${id}-b)`} strokeWidth="5.2" strokeLinecap="round" />

      {/*
        Voxel sparks. These used to blink via SMIL; the logo sits in the
        sidebar on every screen, so an always-running animation there repaints
        continuously for the entire session. Not worth it.
      */}
      <rect x="9" y="9" width="3.4" height="3.4" rx="0.8" fill="var(--accent-2)" opacity="0.85" />
      <rect x="53" y="48" width="4" height="4" rx="1" fill="var(--accent)" opacity="0.8" />
      <rect x="8" y="50" width="2.6" height="2.6" rx="0.7" fill="var(--accent)" opacity="0.6" />
    </svg>
  )
}

/** Full lockup for the onboarding and about screens. */
export function LogoLockup(): JSX.Element {
  return (
    <div className="row gap-16">
      <Logo size={64} glow />
      <div className="col">
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05 }}>
          Launch{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            Gabi
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 650,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--text-4)'
          }}
        >
          Minecraft Launcher
        </div>
      </div>
    </div>
  )
}
