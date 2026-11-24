import { useCallback } from 'react'
import { readableColor } from '@kinetic/shared/color'
import { useDarkMode } from '../theme'

/** The light page background; data colours used as text must be readable on it. */
const LIGHT_TEXT_BACKGROUND = '#f5f6f8'

/**
 * Turns a data colour (a sport, zone or metric colour) into one that is readable as text:
 * unchanged in dark mode, where these colours already pass, and darkened just enough in
 * light mode.
 */
export function useTextColor(): (color: string | undefined) => string | undefined {
  const { dark } = useDarkMode()
  return useCallback(
    (color) => (color && !dark ? readableColor(color, LIGHT_TEXT_BACKGROUND) : color),
    [dark],
  )
}
