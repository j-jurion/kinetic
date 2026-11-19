import type { CSSProperties } from 'react'
import { Tooltip } from '@mui/material'
import { MEDAL_COLORS, MEDAL_LABELS, SPORT_GROUPS, sportColor, sportLabel } from '../lib/format'

interface IconProps {
  name: string
  size?: number | string
  color?: string
  className?: string
  style?: CSSProperties
  title?: string
  onClick?: () => void
}

/** A Material icon by name, like ui.icon(). */
export function Icon({ name, size = 24, color, className, style, title, onClick }: IconProps) {
  return (
    <span
      className={`material-icons ${className ?? ''}`}
      style={{ fontSize: size, color, lineHeight: 1, userSelect: 'none', ...style }}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      onClick={onClick}
    >
      {name}
    </span>
  )
}

// Custom ring icons for the multisport disciplines and a runner on a hill for trail running.
const svgIcons: Record<string, string> = {
  triathlon:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='4' cy='12' r='3.5' fill='none' stroke='#7c4dff' stroke-width='1.8'/><circle cx='12' cy='12' r='3.5' fill='none' stroke='#7c4dff' stroke-width='1.8'/><circle cx='20' cy='12' r='3.5' fill='none' stroke='#7c4dff' stroke-width='1.8'/></svg>",
  duathlon:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='7' cy='12' r='5.5' fill='none' stroke='#ff4dd8' stroke-width='1.8'/><circle cx='17' cy='12' r='5.5' fill='none' stroke='#ff4dd8' stroke-width='1.8'/></svg>",
  multisport:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='7' cy='7' r='3.5' fill='none' stroke='#00bfa5' stroke-width='1.8'/><circle cx='17' cy='7' r='3.5' fill='none' stroke='#00bfa5' stroke-width='1.8'/><circle cx='7' cy='17' r='3.5' fill='none' stroke='#00bfa5' stroke-width='1.8'/><circle cx='17' cy='17' r='3.5' fill='none' stroke='#00bfa5' stroke-width='1.8'/></svg>",
  trail_running:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path transform='translate(2.4,0) scale(0.8)' fill='#ff7a00' d='M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z'/><path fill='#ff7a00' d='M0 24L0 22.6C4.5 22.6 6 17.8 11 17.8C16 17.8 18 22.6 24 22.6L24 24Z'/></svg>",
}

const materialIcons: Record<string, string> = {
  running: 'directions_run',
  cycling: 'directions_bike',
  swimming: 'pool',
  hiking: 'hiking',
  walking: 'directions_walk',
  strength: 'fitness_center',
  yoga: 'self_improvement',
  other: 'sports',
}

function baseSport(sport: string | null | undefined): string | null {
  if (!sport) return null
  return SPORT_GROUPS[sport] ? SPORT_GROUPS[sport][0] : sport
}

interface SportIconProps {
  sport: string | null | undefined
  size?: number
  /** Colour for Material icons; defaults to the sport colour. Custom SVG icons keep theirs. */
  color?: string
  className?: string
  fallback?: string
}

/** The icon of a sport (or sport group). */
export function SportIcon({ sport, size = 24, color, className, fallback = 'sports' }: SportIconProps) {
  const base = baseSport(sport)
  if (base && svgIcons[base]) {
    return (
      <img
        src={`data:image/svg+xml,${encodeURIComponent(svgIcons[base])}`}
        width={size}
        height={size}
        alt=""
        className={className}
        style={{ flex: 'none', display: 'inline-block' }}
      />
    )
  }
  const name = (base && materialIcons[base]) || fallback
  return <Icon name={name} size={size} color={color ?? (base ? sportColor(base) : undefined)} className={className} />
}

/** Marks an activity that is a leg of a multisport event with the event's icon. */
export function MultisportMarker({ parentSport }: { parentSport?: string | null }) {
  if (!parentSport) return null
  return (
    <Tooltip title={sportLabel(parentSport)}>
      <span style={{ display: 'inline-flex', marginLeft: 8, verticalAlign: 'middle' }}>
        <SportIcon sport={parentSport} size={20} />
      </span>
    </Tooltip>
  )
}

/** Gold / silver / bronze medal for podium ranks. */
export function Medal({ rank, size = 22, tooltip }: { rank: number; size?: number; tooltip?: string }) {
  const color = MEDAL_COLORS[rank]
  if (!color) return null
  return (
    <Tooltip title={tooltip ?? MEDAL_LABELS[rank]}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
        <Icon name="military_tech" size={size} color={color} title={`${MEDAL_LABELS[rank]} place medal`} />
      </span>
    </Tooltip>
  )
}
