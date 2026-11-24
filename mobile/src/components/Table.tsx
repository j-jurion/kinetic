import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { T, useColors } from './ui'

export interface Column<R> {
  label: string
  /** Column width in pixels; the table scrolls sideways when the columns are wider than the screen. */
  width: number
  align?: 'left' | 'right' | 'center'
  render: (row: R) => ReactNode
}

/** A compact table, like the web DataTable without sorting. */
export function Table<R>({ columns, rows, rowKey, onRowPress }: {
  columns: Column<R>[]
  rows: R[]
  rowKey: (row: R) => string | number
  onRowPress?: (row: R) => void
}) {
  const c = useColors()
  const cell = (col: Column<R>, content: ReactNode, header = false) => (
    <View key={col.label} style={[styles.cell, { width: col.width, alignItems: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start' }]}>
      {typeof content === 'string' || typeof content === 'number' ? (
        <T muted={header} style={header ? styles.header : styles.text} numberOfLines={header ? 1 : 2}>
          {content}
        </T>
      ) : (
        content
      )}
    </View>
  )
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={[styles.row, { borderColor: c.border }]}>{columns.map((col) => cell(col, col.label, true))}</View>
        {rows.map((row) => (
          <Pressable
            key={rowKey(row)}
            disabled={!onRowPress}
            onPress={() => onRowPress?.(row)}
            // A whole row is one button when it opens something; otherwise its cells are read
            accessibilityRole={onRowPress ? 'button' : 'none'}
            accessible={!!onRowPress}
            style={({ pressed }) => [styles.row, { borderColor: c.cardBorder }, pressed && { backgroundColor: c.soft }]}
          >
            {columns.map((col) => cell(col, col.render(row)))}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 36, alignItems: 'center' },
  cell: { paddingHorizontal: 6, paddingVertical: 6, justifyContent: 'center' },
  header: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  text: { fontSize: 13 },
})
