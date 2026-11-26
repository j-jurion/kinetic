import type { ReactElement } from 'react'
import { Chip } from '@mui/material'
import { Icon } from './icons'

/**
 * A label that switches something on or off, such as a sport in a filter. On: in its colour,
 * tinted, with a check. Off: grey text and a dashed border, while its icon keeps its colour so the
 * row stays easy to scan. The difference does not rest on colour alone.
 */
export function FilterChip({ label, on, color, icon, onClick, title }: {
  label: string
  on: boolean
  color: string
  /** Shown while off; a check replaces it while on. */
  icon?: ReactElement
  onClick: () => void
  /** What a click does, e.g. "Hide Running routes". */
  title?: string
}) {
  return (
    <Chip
      label={label}
      size="small"
      variant="outlined"
      aria-pressed={on}
      title={title}
      icon={on ? <Icon name="check" size={16} color={color} /> : icon}
      onClick={onClick}
      sx={
        on
          ? {
              color,
              borderColor: color,
              fontWeight: 600,
              bgcolor: `${color}26`,
              '&&:hover': { bgcolor: `${color}40` },
              '& .MuiChip-icon': { color, ml: '6px' },
            }
          : {
              color: 'text.secondary',
              borderColor: 'divider',
              borderStyle: 'dashed',
              fontWeight: 500,
              bgcolor: 'transparent',
              '&&:hover': { bgcolor: 'action.hover', borderColor: color },
              '& .MuiChip-icon': { color, ml: '6px' },
            }
      }
    />
  )
}
