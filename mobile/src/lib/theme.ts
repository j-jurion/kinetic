// Colours of the web app (web/src/index.css), for light and dark mode.
import { useColorScheme } from 'react-native'

const LIGHT = {
  dark: false,
  primary: '#f97316',
  primarySoft: 'rgba(249, 115, 22, 0.1)',
  positive: '#16a34a',
  negative: '#c10015',
  background: '#f5f6f8',
  card: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  border: 'rgba(15, 23, 42, 0.1)',
  cardBorder: 'rgba(15, 23, 42, 0.07)',
  soft: 'rgba(15, 23, 42, 0.04)',
}

export type Colors = typeof LIGHT

const DARK: Colors = {
  dark: true,
  primary: '#f97316',
  primarySoft: 'rgba(249, 115, 22, 0.14)',
  positive: '#4ade80',
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
      return { color: light ? '#15803d' : '#86efac', backgroundColor: 'rgba(34, 197, 94, 0.13)' }
    case 'social':
      return { color: '#be185d', backgroundColor: 'rgba(236, 72, 153, 0.12)' }
    default:
      return { color: c.muted, backgroundColor: c.soft }
  }
}
