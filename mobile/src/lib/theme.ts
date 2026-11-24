// Colours of the web app (web/src/index.css), for light and dark mode.
import { useCallback } from 'react'
import { useColorScheme } from 'react-native'
import { readableColor } from '@kinetic/shared/color'

const LIGHT = {
  dark: false,
  /** The brand orange for fills and icons; too light for text on white (2.8:1). */
  primary: '#f97316',
  /** The brand orange as text: 4.5:1 or more on every light background. */
  primaryText: '#b93d0a',
  /** Behind white text, such as contained buttons (5.2:1). */
  primaryStrong: '#c2410c',
  primarySoft: 'rgba(249, 115, 22, 0.1)',
  positive: '#16a34a',
  positiveText: '#15803d',
  negative: '#c10015',
  background: '#f5f6f8',
  card: '#ffffff',
  text: '#111827',
  muted: '#636b77',
  border: 'rgba(15, 23, 42, 0.1)',
  cardBorder: 'rgba(15, 23, 42, 0.07)',
  soft: 'rgba(15, 23, 42, 0.04)',
}

export type Colors = typeof LIGHT

const DARK: Colors = {
  dark: true,
  primary: '#f97316',
  primaryText: '#fb923c',
  primaryStrong: '#c2410c',
  primarySoft: 'rgba(249, 115, 22, 0.14)',
  positive: '#4ade80',
  positiveText: '#4ade80',
  negative: '#f87171',
  background: '#0f1115',
  card: '#171a21',
  text: '#f3f4f6',
  muted: '#9ca3af',
  border: 'rgba(255, 255, 255, 0.12)',
  cardBorder: 'rgba(255, 255, 255, 0.07)',
  soft: 'rgba(255, 255, 255, 0.05)',
}

export const useColors = (): Colors => (useColorScheme() === 'dark' ? DARK : LIGHT)

/**
 * Turns a data colour (a sport, zone or metric colour) into one that is readable as text on
 * the page: darkened just enough in light mode, lightened in dark mode when needed.
 */
export function useTextColor(): (color: string | undefined) => string | undefined {
  const c = useColors()
  return useCallback((color) => (color ? readableColor(color, c.dark ? DARK.card : LIGHT.background) : color), [c.dark])
}

/** Text and background of the training-type chip, like .kind-chip in the web app. */
export function kindChipColors(kind: string, c: Colors): { color: string; backgroundColor: string } {
  const light = !c.dark
  switch (kind) {
    case 'race':
      return { color: light ? '#0f766e' : '#5eead4', backgroundColor: 'rgba(20, 184, 166, 0.13)' }
    case 'long_run':
      return { color: light ? '#6d28d9' : '#c4b5fd', backgroundColor: 'rgba(139, 92, 246, 0.13)' }
    case 'tempo':
    case 'interval':
      return { color: light ? '#c2410c' : '#fdba74', backgroundColor: 'rgba(249, 115, 22, 0.13)' }
    case 'easy':
    case 'recovery':
      return { color: light ? '#166534' : '#86efac', backgroundColor: 'rgba(34, 197, 94, 0.13)' }
    case 'social':
      return { color: light ? '#be185d' : '#f9a8d4', backgroundColor: 'rgba(236, 72, 153, 0.12)' }
    default:
      return { color: c.muted, backgroundColor: c.soft }
  }
}
