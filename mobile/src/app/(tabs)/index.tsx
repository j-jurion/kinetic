import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { byMonth, hours, km, monthSummary, monthTitle, totals } from '@kinetic/shared/activityList'
import { qs } from '@kinetic/shared/api'
import type { Activity, ActivityRow } from '@kinetic/shared/types'
import { ActivityEditSheet, UploadSheet } from '../../components/ActivitySheets'
import { ActivityCard } from '../../components/ActivityCard'
import { Button, Empty, FilterRow, PageHeader, Screen, SportSelect, Stat, StatGrid, T, YearSelect } from '../../components/ui'
import { useApi } from '../../lib/useApi'

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
  month: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 8, flexWrap: 'wrap' },
})
