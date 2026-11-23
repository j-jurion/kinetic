import { useMemo } from 'react'
import { router } from 'expo-router'
import { View } from 'react-native'
import { formatDate, formatDuration, kindLabel } from '@kinetic/shared/format'
import { formatRank } from '@kinetic/shared/forms'
import { breakdownEvents } from '@kinetic/shared/performance'
import type { MultisportEvent, RaceRow } from '@kinetic/shared/types'
import { SportIcon } from '../components/Icon'
import { RaceBreakdownCharts } from '../components/RaceBreakdown'
import { Card, Caption, Empty, Loading, PageHeader, Screen, T } from '../components/ui'
import { useApi } from '../lib/useApi'

export default function RacesScreen() {
  const { data: results, reload } = useApi<RaceRow[]>('/races')
  // Triathlons and duathlons from their recorded legs, so no splits need typing in
  const { data: multisportEvents } = useApi<MultisportEvent[]>('/multisport')
  const multisport = useMemo(() => breakdownEvents(results ?? [], multisportEvents ?? []), [results, multisportEvents])

  if (!results) return <Loading />
  return (
    <Screen onRefresh={reload}>
      <PageHeader
        kicker="Race results"
        title="Races"
        subtitle={`${results.length} ${results.length === 1 ? 'result' : 'results'} on record — official times, rankings and splits.`}
      />
      {multisport.length > 0 && <RaceBreakdownCharts events={multisport} />}
      {results.length === 0 && <Empty icon="emoji_events">No race results recorded yet.</Empty>}
      {results.map((r) => {
        const a = r.activity
        const splitSummary = r.splits.map((s) => (s.duration_seconds ? `${s.label}: ${formatDuration(s.duration_seconds)}` : s.label)).join(' · ')
        const details = [r.bib_number ? `Bib ${r.bib_number}` : '', r.age_group ? `Age group ${r.age_group}` : '', splitSummary].filter(Boolean)
        const metrics: [string, string | null][] = [
          ['Official time', r.official_time_seconds ? formatDuration(r.official_time_seconds) : null],
          ['Overall', formatRank(r.overall_rank, r.overall_total)],
          ['Gender', formatRank(r.gender_rank, r.gender_total)],
          ['Age group rank', formatRank(r.age_group_rank, r.age_group_total)],
        ]
        return (
          <Card key={r.id} onPress={() => router.push(`/activity/${a.id}`)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <SportIcon sport={a.sport} size={28} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T style={{ fontWeight: '600', flexShrink: 1 }}>{a.name}</T>
                  {r.parent_sport && <SportIcon sport={r.parent_sport} size={16} />}
                </View>
                <Caption>
                  {formatDate(a.date)} · {kindLabel(a.kind)}
                </Caption>
                {details.length > 0 && <Caption>{details.join(' · ')}</Caption>}
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
              {metrics.map(
                ([label, value]) =>
                  value && (
                    <View key={label}>
                      <T style={{ fontWeight: '700' }}>{value}</T>
                      <Caption>{label}</Caption>
                    </View>
                  ),
              )}
            </View>
          </Card>
        )
      })}
    </Screen>
  )
}
