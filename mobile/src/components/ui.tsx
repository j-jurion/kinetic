import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'

export const colors = (dark: boolean) =>
  dark
    ? { background: '#0f1115', card: '#171a21', text: '#f3f4f6', muted: '#9ca3af', border: 'rgba(255,255,255,0.12)', accent: '#60a5fa' }
    : { background: '#f5f6f8', card: '#ffffff', text: '#111827', muted: '#6b7280', border: '#e5e7eb', accent: '#2563eb' }

export const useColors = () => colors(useColorScheme() === 'dark')

/** A labelled, horizontally scrolling row of choices: the mobile toggle group and dropdown. */
export function ChipRow<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T | undefined
  options: [T, string][]
  onChange: (value: T) => void
}) {
  const c = useColors()
  return (
    <View style={styles.chipRow}>
      <Text style={[styles.chipLabel, { color: c.muted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {options.map(([key, text]) => {
          const selected = key === value
          return (
            <Pressable
              key={key || '__all'}
              onPress={() => onChange(key)}
              style={[styles.chip, { borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent : c.card }]}
            >
              <Text style={{ color: selected ? '#ffffff' : c.text, fontSize: 13 }}>{text}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

export function Card({ children }: { children: ReactNode }) {
  const c = useColors()
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>{children}</View>
}

const styles = StyleSheet.create({
  chipRow: { gap: 6 },
  chipLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { gap: 6, paddingRight: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
})
