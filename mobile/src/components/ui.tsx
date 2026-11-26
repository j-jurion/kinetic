// The mobile versions of the web app's building blocks: cards, stats, toggles, dropdowns,
// buttons and form fields.
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { kindLabel, sportFilterOptions, yearOptions } from '@kinetic/shared/format'
import { kindChipColors, useColors, useTextColor } from '../lib/theme'
import { readableColor } from '@kinetic/shared/color'
import { Icon } from './Icon'

export { useColors }

/**
 * A label that switches something on or off, such as a sport in a filter or a friend on an
 * activity. On: in its colour, tinted, with a check. Off: grey text and a dashed border, while its
 * icon keeps its colour so the row stays easy to scan. Like FilterChip in the web app.
 */
export function FilterChip({ label, on, color, icon, onPress }: {
  label: string
  on: boolean
  color: string
  /** Shown while off; a check replaces it while on. */
  icon?: ReactNode
  onPress: () => void
}) {
  const c = useColors()
  const textColor = useTextColor()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
        borderColor: on ? color : c.border,
        borderStyle: on ? 'solid' : 'dashed',
        backgroundColor: on ? `${color}26` : 'transparent',
      }}
    >
      {on ? <Icon name="check" size={14} color={color} /> : icon}
      <T style={{ color: on ? textColor(color) : c.muted, fontWeight: on ? '600' : '500', fontSize: 12 }}>{label}</T>
    </Pressable>
  )
}

/** A scrolling page with the standard padding; pull to refresh when onRefresh is given. */
export function Screen({ children, onRefresh }: { children: ReactNode; onRefresh?: () => void }) {
  const c = useColors()
  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.page}
      refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  )
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  )
}

/**
 * A card; with `onPress` it is one button for screen readers, read as its `label` (or, by
 * default, all of its text).
 */
export function Card({ children, style, onPress, label, hint }: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  label?: string
  hint?: string
}) {
  const c = useColors()
  const cardStyle = [styles.card, { backgroundColor: c.card, borderColor: c.cardBorder }, style]
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={({ pressed }) => [cardStyle, pressed && { opacity: 0.7 }]}
      >
        {children}
      </Pressable>
    )
  }
  return <View style={cardStyle}>{children}</View>
}

export function T({ children, style, muted, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; numberOfLines?: number }) {
  const c = useColors()
  return (
    <Text style={[{ color: muted ? c.muted : c.text, fontSize: 14 }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  )
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const c = useColors()
  return (
    <View style={styles.rowBetween}>
      <Text accessibilityRole="header" style={[styles.cardTitle, { color: c.text }]}>{children}</Text>
      {right}
    </View>
  )
}

/** A heading between sections of a page, with an icon and an optional caption. */
export function SectionHeading({ icon, title, caption, right }: { icon: string; title: string; caption?: string; right?: ReactNode }) {
  const c = useColors()
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      <View style={styles.rowBetween}>
        <View style={styles.row}>
          <View style={[styles.headingIcon, { backgroundColor: c.primarySoft }]}>
            <Icon name={icon} size={16} color={c.primary} />
          </View>
          <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{title}</Text>
        </View>
        {right}
      </View>
      {caption && <T muted style={{ fontSize: 12 }}>{caption}</T>}
    </View>
  )
}

/** Page title with a kicker above and a subtitle below, like the web page headers. */
export function PageHeader({ kicker, title, subtitle, children }: { kicker?: string; title: string; subtitle?: string; children?: ReactNode }) {
  const c = useColors()
  return (
    <View style={{ gap: 2 }}>
      {kicker && <Text style={[styles.kicker, { color: c.primaryText }]}>{kicker.toUpperCase()}</Text>}
      <Text accessibilityRole="header" style={[styles.pageTitle, { color: c.text }]}>{title}</Text>
      {subtitle && <T muted>{subtitle}</T>}
      {children && <View style={{ gap: 10, marginTop: 10 }}>{children}</View>}
    </View>
  )
}

export function Caption({ children }: { children: ReactNode }) {
  return <T muted style={{ fontSize: 12, lineHeight: 17 }}>{children}</T>
}

/** A labelled number in a soft tile; wrap several in a StatGrid. */
export function Stat({ label, value, color, hint }: { label: string; value: ReactNode; color?: string; hint?: string }) {
  const c = useColors()
  const textColor = useTextColor()
  // Read as one item, "Distance, 12.3 km", instead of two separate texts
  const spoken = typeof value === 'string' || typeof value === 'number' ? `${label}, ${value}` : undefined
  return (
    <View style={[styles.stat, { backgroundColor: c.soft }]} accessible={spoken !== undefined} accessibilityLabel={spoken} accessibilityHint={hint}>
      <T muted style={styles.statLabel}>{label}</T>
      <T style={[styles.statValue, color ? { color: textColor(color) } : null]}>{value}</T>
      {hint && <T muted style={{ fontSize: 11 }}>{hint}</T>}
    </View>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>
}

export function KindChip({ kind }: { kind: string }) {
  const c = useColors()
  const colors = kindChipColors(kind, c)
  return (
    <View style={[styles.kindChip, { backgroundColor: colors.backgroundColor }]}>
      <Text style={{ color: colors.color, fontSize: 11, fontWeight: '600' }}>{kindLabel(kind)}</Text>
    </View>
  )
}

/** A centred message card for empty states. */
export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  const c = useColors()
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <View style={[styles.emptyIcon, { backgroundColor: c.primarySoft }]}>
        <Icon name={icon} size={28} color={c.primary} />
      </View>
      <T muted style={{ textAlign: 'center' }}>{children}</T>
    </Card>
  )
}

/** A segmented control: the mobile version of the web toggle groups. */
export function Toggle<V extends string>({ value, options, onChange }: { value: V | undefined; options: [V, string][]; onChange: (value: V) => void }) {
  const c = useColors()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.toggle, { borderColor: c.border }]}>
      {options.map(([key, text]) => {
        const selected = key === value
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.toggleItem, selected && { backgroundColor: c.primarySoft }]}
          >
            <Text style={{ color: selected ? c.primaryText : c.text, fontSize: 13, fontWeight: selected ? '600' : '400' }}>{text}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/** A labelled dropdown that opens a list to pick from. */
export function Select<V extends string>({ label, value, options, onChange, style }: {
  label: string
  value: V | undefined
  options: [V, string][]
  onChange: (value: V) => void
  style?: StyleProp<ViewStyle>
}) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const current = options.find(([v]) => v === value)?.[1] ?? ''
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${current}`}
        accessibilityHint="Opens a list to choose from"
        style={[styles.field, { borderColor: c.border, backgroundColor: c.card }, style]}
      >
        <T muted style={styles.fieldLabel}>{label}</T>
        <View style={styles.rowBetween}>
          <T style={{ fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{current}</T>
          <Icon name="expand_more" size={20} color={c.muted} />
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
          <View style={[styles.sheet, { backgroundColor: c.card, paddingBottom: insets.bottom + 8 }]} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={[styles.cardTitle, { padding: 16, paddingBottom: 8, color: c.text }]}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={([v]) => v || '__all'}
              renderItem={({ item: [v, text] }) => (
                <Pressable
                  onPress={() => {
                    setOpen(false)
                    onChange(v)
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: v === value }}
                  style={({ pressed }) => [styles.option, pressed && { backgroundColor: c.soft }]}
                >
                  <T style={{ fontSize: 15, color: v === value ? c.primaryText : c.text, fontWeight: v === value ? '600' : '400' }}>{text}</T>
                  {v === value && <Icon name="check" size={18} color={c.primaryText} />}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const ALL_YEARS = 'all'

export function YearSelect({ value, onChange, style }: { value: number | null; onChange: (year: number | null) => void; style?: StyleProp<ViewStyle> }) {
  const options: [string, string][] = [[ALL_YEARS, 'All years'], ...yearOptions().map((y): [string, string] => [String(y), String(y)])]
  return (
    <Select
      label="Year"
      value={value === null ? ALL_YEARS : String(value)}
      options={options}
      onChange={(v) => onChange(v === ALL_YEARS ? null : Number(v))}
      style={style}
    />
  )
}

export function SportSelect({ value, onChange, includeAllSports = true, style }: {
  value: string
  onChange: (sport: string) => void
  includeAllSports?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return <Select label="Sport" value={value} options={sportFilterOptions(includeAllSports)} onChange={onChange} style={style} />
}

/** Side-by-side filters that share the width. */
export function FilterRow({ children }: { children: ReactNode }) {
  return <View style={styles.filterRow}>{children}</View>
}

export function Button({ title, onPress, icon, variant = 'contained', color, disabled, busy }: {
  title: string
  onPress: () => void
  icon?: string
  variant?: 'contained' | 'outlined' | 'text'
  color?: string
  disabled?: boolean
  busy?: boolean
}) {
  const c = useColors()
  const textColor = useTextColor()
  const contained = variant === 'contained'
  // Contained: white text on a fill dark enough for it; otherwise text readable on the page
  const fill = readableColor(color ?? c.primaryStrong, '#ffffff')
  const tint = contained ? fill : (textColor(color ?? c.primaryText) ?? c.primaryText)
  const fg = contained ? '#ffffff' : tint
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        contained && { backgroundColor: tint },
        variant === 'outlined' && { borderWidth: 1, borderColor: tint },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon && <Icon name={icon} size={18} color={fg} />}
      <Text style={{ color: fg, fontWeight: '600', fontSize: 14 }}>{title}</Text>
    </Pressable>
  )
}

/** A button showing only an icon; `label` is what screen readers say for it. */
export function IconButton({ icon, onPress, color, size = 22, label }: { icon: string; onPress: () => void; color?: string; size?: number; label: string }) {
  const c = useColors()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: c.soft }]}
    >
      <Icon name={icon} size={size} color={color ?? c.muted} />
    </Pressable>
  )
}

/** A labelled text input. */
export function Field({ label, error, style, ...input }: TextInputProps & { label: string; error?: string | false; style?: StyleProp<ViewStyle> }) {
  const c = useColors()
  return (
    <View style={[{ gap: 4 }, style]}>
      <T muted style={styles.fieldLabel}>{label}</T>
      <TextInput
        placeholderTextColor={c.muted}
        accessibilityLabel={label}
        accessibilityHint={error || undefined}
        {...input}
        style={[styles.input, { color: c.text, borderColor: error ? c.negative : c.border, backgroundColor: c.card }, input.multiline && { minHeight: 70, textAlignVertical: 'top' }]}
      />
      {error ? <Text style={{ color: c.negative, fontSize: 12 }}>{error}</Text> : null}
    </View>
  )
}

/** A full-screen form sheet with a title, a scrolling body and Cancel / Save buttons. */
export function FormSheet({ visible, title, onClose, onSave, saveLabel = 'Save', busy, children }: {
  visible: boolean
  title: string
  onClose: () => void
  onSave?: () => void
  saveLabel?: string
  busy?: boolean
  children: ReactNode
}) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View style={[styles.sheetHeader, { borderColor: c.cardBorder }]}>
          <Button title="Cancel" variant="text" onPress={onClose} />
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: c.text }]}>{title}</Text>
          {onSave ? <Button title={saveLabel} variant="text" onPress={onSave} busy={busy} /> : <View style={{ width: 70 }} />}
        </View>
        <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

export const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  pageTitle: { fontSize: 28, fontWeight: '800' },
  headingIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stat: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, flexGrow: 1, flexBasis: '30%', minWidth: 96, gap: 2 },
  statLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: 18, fontWeight: '700' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  toggleItem: { paddingHorizontal: 12, paddingVertical: 7 },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, flex: 1 },
  fieldLabel: { fontSize: 11, fontWeight: '600' },
  filterRow: { flexDirection: 'row', gap: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  iconButton: { padding: 6, borderRadius: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1 },
})
