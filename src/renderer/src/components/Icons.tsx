import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** All icons share one 24px stroke grid so they line up optically. */
function Icon({ size = 18, children, ...props }: IconProps & { children: JSX.Element }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconHome = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-7v6h-4A1.5 1.5 0 0 1 3 20z" />
  </Icon>
)

export const IconGrid = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </g>
  </Icon>
)

export const IconPackage = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="m12 2.5 8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" />
      <path d="M3.5 7.25 12 12l8.5-4.75M12 12v9.5" />
    </g>
  </Icon>
)

export const IconCompass = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m15.5 8.5-2 5.5-5.5 2 2-5.5z" />
    </g>
  </Icon>
)

export const IconSave = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h10L20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M8 4v5h7M8 20v-6h8v6" />
    </g>
  </Icon>
)

export const IconSettings = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.5 12a7.5 7.5 0 0 0-.13-1.36l2-1.55-2-3.46-2.36.95a7.5 7.5 0 0 0-2.35-1.36L14.4 2.8h-4l-.26 2.42a7.5 7.5 0 0 0-2.35 1.36l-2.36-.95-2 3.46 2 1.55a7.6 7.6 0 0 0 0 2.72l-2 1.55 2 3.46 2.36-.95a7.5 7.5 0 0 0 2.35 1.36l.26 2.42h4l.26-2.42a7.5 7.5 0 0 0 2.35-1.36l2.36.95 2-3.46-2-1.55c.09-.44.13-.9.13-1.36z" />
    </g>
  </Icon>
)

export const IconPlay = (p: IconProps): JSX.Element => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M8 5.2a1 1 0 0 1 1.53-.85l9 6.8a1 1 0 0 1 0 1.7l-9 6.8A1 1 0 0 1 8 18.8z" />
  </Icon>
)

export const IconStop = (p: IconProps): JSX.Element => (
  <Icon {...p} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </Icon>
)

export const IconPlus = (p: IconProps): JSX.Element => (
  <Icon {...p} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const IconSearch = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </g>
  </Icon>
)

export const IconRefresh = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M20.5 11a8.5 8.5 0 0 0-15-4.3" />
      <path d="M3.5 13a8.5 8.5 0 0 0 15 4.3" />
      <path d="M5 3v3.7h3.7M19 21v-3.7h-3.7" />
    </g>
  </Icon>
)

export const IconDownload = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
    </g>
  </Icon>
)

export const IconUpload = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
      <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
    </g>
  </Icon>
)

export const IconTrash = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M4 6.5h16M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
      <path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.9-13.5" />
      <path d="M10.5 10.5v6.5M13.5 10.5v6.5" />
    </g>
  </Icon>
)

export const IconFolder = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.5h8.8A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
  </Icon>
)

export const IconWrench = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M14.5 6.2a4.6 4.6 0 0 1 6 6L18 9.7l-2.8.8-.8-2.8zM13.4 10.6 4.6 19.4a2 2 0 1 0 2.8 2.8l8.8-8.8" />
  </Icon>
)

export const IconWarning = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3.1L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4.5M12 17h.01" />
    </g>
  </Icon>
)

export const IconCheck = (p: IconProps): JSX.Element => (
  <Icon {...p} strokeWidth={2.4}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
)

export const IconCheckCircle = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <circle cx="12" cy="12" r="9.2" />
      <path d="m8 12.3 2.7 2.7L16 9.5" />
    </g>
  </Icon>
)

export const IconInfo = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </g>
  </Icon>
)

export const IconX = (p: IconProps): JSX.Element => (
  <Icon {...p} strokeWidth={2.1}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
)

export const IconChevronRight = (p: IconProps): JSX.Element => (
  <Icon {...p} strokeWidth={2.2}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
)

export const IconChevronLeft = (p: IconProps): JSX.Element => (
  <Icon {...p} strokeWidth={2.2}>
    <path d="M15 5 8 12l7 7" />
  </Icon>
)

export const IconChevronDown = (p: IconProps): JSX.Element => (
  <Icon {...p} strokeWidth={2.2}>
    <path d="m5 9 7 7 7-7" />
  </Icon>
)

export const IconStar = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="m12 3.5 2.7 5.6 6.1.85-4.4 4.3 1.05 6.1L12 17.45 6.55 20.35 7.6 14.25 3.2 9.95l6.1-.85z" />
  </Icon>
)

export const IconStarFilled = (p: IconProps): JSX.Element => (
  <Icon {...p} fill="currentColor">
    <path d="m12 3.5 2.7 5.6 6.1.85-4.4 4.3 1.05 6.1L12 17.45 6.55 20.35 7.6 14.25 3.2 9.95l6.1-.85z" />
  </Icon>
)

/** Three dots, for the "more actions" button on a card or row. */
export const IconMore = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </g>
  </Icon>
)

export const IconCopy = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <rect x="9" y="9" width="12" height="12" rx="2.2" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
    </g>
  </Icon>
)

export const IconLink = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M10 13.5a4 4 0 0 0 5.7.4l3-3a4 4 0 0 0-5.6-5.7l-1.7 1.7" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.4l-3 3a4 4 0 0 0 5.6 5.7l1.7-1.7" />
    </g>
  </Icon>
)

export const IconExternal = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 14v5.5A1.5 1.5 0 0 1 16.5 21h-11A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7H11" />
    </g>
  </Icon>
)

export const IconUser = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </g>
  </Icon>
)

export const IconCube = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="m12 2.5 8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" />
      <path d="M3.5 7.25 12 12l8.5-4.75M12 12v9.5" />
    </g>
  </Icon>
)

export const IconChip = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </g>
  </Icon>
)

export const IconClock = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 6.8V12l3.4 2" />
    </g>
  </Icon>
)

/** Film strip, for recordings as opposed to screenshots. */
export const IconFilm = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <rect x="2.5" y="5" width="19" height="14" rx="2.2" />
      <path d="M7 5v14M17 5v14M2.5 12h19M2.5 8.5h4.5M2.5 15.5h4.5M17 8.5h4.5M17 15.5h4.5" />
    </g>
  </Icon>
)

/** Filled dot, the universal "recording" marker. */
export const IconRecord = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconImage = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m3.5 17 5-4.5 4 3.5 3-2.5 5 4" />
    </g>
  </Icon>
)

export const IconPalette = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M12 21a9 9 0 1 1 9-9c0 2-1.6 3-3.4 3H16a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21z" />
      <circle cx="7.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9.8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </g>
  </Icon>
)

export const IconTerminal = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <path d="m7.5 10 2.5 2-2.5 2M13 14h4" />
    </g>
  </Icon>
)

export const IconShield = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6z" />
  </Icon>
)

export const IconSparkle = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Icon>
)

export const IconMinimize = (p: IconProps): JSX.Element => (
  <Icon {...p} size={p.size ?? 14} strokeWidth={1.6}>
    <path d="M5 12h14" />
  </Icon>
)

export const IconMaximize = (p: IconProps): JSX.Element => (
  <Icon {...p} size={p.size ?? 14} strokeWidth={1.6}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </Icon>
)

export const IconRestore = (p: IconProps): JSX.Element => (
  <Icon {...p} size={p.size ?? 14} strokeWidth={1.6}>
    <g>
      <rect x="4" y="8" width="12" height="12" rx="2" />
      <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
    </g>
  </Icon>
)

export const IconClose = (p: IconProps): JSX.Element => (
  <Icon {...p} size={p.size ?? 14} strokeWidth={1.7}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
)

export const IconPower = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="M12 3v9" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </g>
  </Icon>
)

export const IconFilter = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 5.5h18l-7 8v5.5l-4 2v-7.5z" />
  </Icon>
)

export const IconLayers = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <g>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </g>
  </Icon>
)
