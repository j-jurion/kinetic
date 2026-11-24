import { MaterialIcons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { Text, View } from 'react-native'
import type { ColorValue } from 'react-native'
import { GOLD, MEDAL_COLORS, MEDAL_LABELS, SPORT_GROUPS, sportColor } from '@kinetic/shared/format'
import { useColors } from '../lib/theme'

type GlyphName = ComponentProps<typeof MaterialIcons>['name']

/** Hides a decorative element from screen readers, or names a meaningful one. */
export function iconAccessibility(label?: string) {
  return label
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel: label } as const)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const)
}

/**
 * A Material icon by its web name (e.g. "directions_run"). Decorative unless it has a
 * `label`, which screen readers then read out.
 */
export function Icon({ name, size = 24, color, label }: { name: string; size?: number; color?: ColorValue; label?: string }) {
  return (
    <MaterialIcons
      name={name.replace(/_/g, '-') as GlyphName}
      size={size}
      color={color as string | undefined}
      {...iconAccessibility(label)}
    />
  )
}

const MATERIAL_SPORT_ICONS: Record<string, string> = {
  running: 'directions_run',
  cycling: 'directions_bike',
  swimming: 'pool',
  hiking: 'hiking',
  walking: 'directions_walk',
  strength: 'fitness_center',
  yoga: 'self_improvement',
  other: 'sports',
  trail_running: 'directions_run',
}

// The multisport icons of the web app: rings in the sport colour
const RINGS: Record<string, { count: number; color: string; grid?: boolean }> = {
  triathlon: { count: 3, color: '#7c4dff' },
  duathlon: { count: 2, color: '#ff4dd8' },
  multisport: { count: 4, color: '#00bfa5', grid: true },
}

function baseSport(sport: string | null | undefined): string | null {
  if (!sport) return null
  return SPORT_GROUPS[sport] ? SPORT_GROUPS[sport][0] : sport
}

/** The icon of a sport (or sport group); decorative unless it has a `label`. */
export function SportIcon({ sport, size = 24, color, label }: { sport: string | null | undefined; size?: number; color?: string; label?: string }) {
  const base = baseSport(sport)
  const rings = base ? RINGS[base] : undefined
  if (rings) {
    const ring = rings.grid ? size * 0.4 : size / (rings.count + 0.4)
    return (
      <View
        {...iconAccessibility(label)}
        style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', alignContent: 'center', gap: size * 0.04 }}
      >
        {Array.from({ length: rings.count }, (_, i) => (
          <View key={i} style={{ width: ring, height: ring, borderRadius: ring / 2, borderWidth: Math.max(1.5, size / 14), borderColor: rings.color }} />
        ))}
      </View>
    )
  }
  const name = (base && MATERIAL_SPORT_ICONS[base]) || 'sports'
  return <Icon name={name} size={size} color={color ?? (base ? sportColor(base) : undefined)} label={label} />
}

/** Gold / silver / bronze medal for podium ranks. */
export function Medal({ rank, size = 22 }: { rank: number; size?: number }) {
  const color = MEDAL_COLORS[rank]
  if (!color) return null
  return <Icon name="military_tech" size={size} color={color} label={`${MEDAL_LABELS[rank]} place medal`} />
}

/** A date with a gold medal when it is the best result of its year. */
export function YearBestDate({ date, best }: { date: string; best: boolean }) {
  const c = useColors()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 13, color: c.text }}>{date}</Text>
      {best && <Icon name="military_tech" size={15} color={GOLD} label="Best of the year" />}
    </View>
  )
}
