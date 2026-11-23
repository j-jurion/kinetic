import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { byMonth, hours, km, monthSummary, monthTitle, totals } from '@kinetic/shared/activityList'
import { qs } from '@kinetic/shared/api'
import { formatDate, formatDistance, formatDuration, formatPace, sportColor } from '@kinetic/shared/format'
import type { Activity, ActivityRow } from '@kinetic/shared/types'
import { ActivityEditSheet, UploadSheet } from '../../components/ActivitySheets'
import { Icon, SportIcon } from '../../components/Icon'
import { Button, Card, Empty, FilterRow, KindChip, PageHeader, Screen, SportSelect, Stat, StatGrid, T, YearSelect, useColors } from '../../components/ui'
import { useApi } from '../../lib/useApi'

function ActivityCard({ a }: { a: ActivityRow }) {
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

export default function ActivitiesScreen() {
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [editing, setEditing] = useState<Activity | null | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const { data: activities, reload } = useApi<ActivityRow[]>(`/activities${qs({ sport, year })}`)

  const summary = useMemo(() => (activities ? totals(activities) : null), [activities])
  const months = useMemo(() => (activities ? byMonth(activities) : []), [activities])

  return (
    <Screen onRefresh={reload}>
      <PageHeader kicker="Training log" title="Activities" subtitle="Every session you've logged, newest first.">
        <FilterRow>
          <SportSelect value={sport} onChange={setSport} />
          <YearSelect value={year} onChange={setYear} />
        </FilterRow>
        <FilterRow>
          <View style={{ flex: 1 }}>
            <Button title="Upload .fit" icon="upload_file" variant="outlined" onPress={() => setUploading(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Add manual" icon="add" onPress={() => setEditing(null)} />
          </View>
        </FilterRow>
      </PageHeader>

      {summary && summary.count > 0 && (
        <StatGrid>
          <Stat label="Activities" value={summary.count.toLocaleString('en')} />
          <Stat label="Distance" value={km(summary.meters)} />
          <Stat label="Moving time" value={hours(summary.seconds)} />
          <Stat label="Climbing" value={`${Math.round(summary.climb).toLocaleString('en')} m`} />
        </StatGrid>
      )}

      {activities && activities.length === 0 && (
        <Empty icon="directions_run">No activities yet. Upload a .fit file or add one manually.</Empty>
      )}

      {months.map(([key, group]) => (
        <View key={key} style={{ gap: 8 }}>
          <View style={styles.month}>
            <T style={{ fontWeight: '700' }}>{monthTitle(key)}</T>
            <T muted style={{ fontSize: 12 }}>{monthSummary(group)}</T>
          </View>
          {group.map((a) => (
            <ActivityCard key={a.id} a={a} />
          ))}
        </View>
      ))}

      <ActivityEditSheet visible={editing !== undefined} activity={editing ?? null} onClose={() => setEditing(undefined)} onSaved={reload} />
      <UploadSheet
        visible={uploading}
        onClose={() => {
          setUploading(false)
          reload()
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  month: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 8, flexWrap: 'wrap' },
})
