import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { formatDate, formatDistance, formatDuration, formatPace, sportColor } from '@kinetic/shared/format'
import type { ActivityRow } from '@kinetic/shared/types'
import { Icon, SportIcon } from './Icon'
import { Card, KindChip, T, useColors } from './ui'

/** One activity in a list, opening its detail screen. */
export function ActivityCard({ a }: { a: ActivityRow }) {
  const c = useColors()
  const dist = a.distance_meters
  const dur = a.duration_seconds
  const metrics: [string, string][] = []
  if (dist) metrics.push(['Distance', formatDistance(dist, a.sport)])
  metrics.push(['Duration', formatDuration(dur)])
  if (dist && dur) metrics.push(['Pace', formatPace(dist, dur, a.sport)])
  if (a.avg_heart_rate) metrics.push(['Avg HR', `${a.avg_heart_rate} bpm`])
  return (
    <Card onPress={() => router.push(`/activity/${a.id}`)} style={{ borderLeftWidth: 3, borderLeftColor: sportColor(a.sport, '#6b7280') }}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: c.soft }]}>
          <SportIcon sport={a.sport} size={24} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.title}>
            <T style={{ fontSize: 15, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{a.name}</T>
            {a.parent_sport && <SportIcon sport={a.parent_sport} size={16} />}
            {a.has_race_result && <Icon name="emoji_events" size={15} color="#f59e0b" />}
          </View>
          <View style={styles.title}>
            <T muted style={{ fontSize: 12 }}>{formatDate(a.date)}</T>
            <KindChip kind={a.kind} />
          </View>
        </View>
      </View>
      <View style={styles.metrics}>
        {metrics.map(([label, value]) => (
          <View key={label}>
            <T style={{ fontWeight: '700' }}>{value}</T>
            <T muted style={{ fontSize: 11 }}>{label}</T>
          </View>
        ))}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
})
