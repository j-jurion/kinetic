import { useMemo } from 'react'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { qs } from '@kinetic/shared/api'
import { attemptsChart } from '@kinetic/shared/charts/records'
import { ALL_RUNNING, distanceLabel, formatDate, formatDuration, formatPace, markYearBests, measuredShortNote, sportLabel } from '@kinetic/shared/format'
import type { BestEffortRow } from '@kinetic/shared/types'
import { Medal, YearBestDate } from '../../components/Icon'
import { ChartView } from '../../components/PlotView'
import { Table } from '../../components/Table'
import { Card, Empty, PageHeader, Screen, Stat, StatGrid, T, YearSelect } from '../../components/ui'
import { useApi } from '../../lib/useApi'
import { useFilters } from '../../lib/useFilters'

type Row = BestEffortRow & { rank: number; yearBest: boolean }

/** Every attempt at one distance, fastest first. */
export default function BestEffortDistanceScreen() {
  const distance = Number(useLocalSearchParams<{ distance: string }>().distance)
  // Every best effort belongs to a sport, so "all sports" would mix unrelated records
  const { sport, year, setYear } = useFilters(ALL_RUNNING)
  const label = distanceLabel(distance, sport)
  const { data: attempts } = useApi<BestEffortRow[]>(`/best-efforts/attempts${qs({ distance, sport, year })}`)

  const rows: Row[] = useMemo(() => {
    if (!attempts) return []
    const bests = markYearBests(attempts.map((a) => a.year))
    return attempts.map((a, i) => ({ ...a, rank: i + 1, yearBest: bests[i] }))
  }, [attempts])
  const chart = useMemo(() => attemptsChart(rows, sport, label), [rows, sport, label])
  const times = rows.map((r) => r.duration_seconds)

  return (
    <Screen>
      <Stack.Screen options={{ title: label }} />
      <PageHeader kicker={sportLabel(sport)} title={`${label} – all attempts`}>
        <YearSelect value={year} onChange={setYear} />
      </PageHeader>
      {attempts && attempts.length === 0 && (
        <Empty icon="emoji_events">
          No {sportLabel(sport || ALL_RUNNING).toLowerCase()} attempts recorded at {label} yet.
        </Empty>
      )}
      {attempts && attempts.length > 0 && (
        <>
          <StatGrid>
            <Stat label="Attempts" value={attempts.length} />
            <Stat label="Best" value={formatDuration(Math.min(...times))} />
            <Stat label="Average" value={formatDuration(times.reduce((s, t) => s + t, 0) / times.length)} />
            <Stat label="Slowest" value={formatDuration(Math.max(...times))} />
            <Stat label="Best pace" value={formatPace(distance, Math.min(...times), attempts[0].sport)} />
          </StatGrid>
          <Card>
            <Table
              rows={rows}
              rowKey={(r) => r.id}
              onRowPress={(r) => router.push(`/activity/${r.activity_id}`)}
              columns={[
                { label: '#', width: 52, render: (r) => (r.rank <= 3 ? <Medal rank={r.rank} /> : `#${r.rank}`) },
                { label: 'Date', width: 100, render: (r) => <YearBestDate date={formatDate(r.date)} best={r.yearBest} /> },
                { label: 'Activity', width: 150, render: (r) => (measuredShortNote(r) ? `${r.activity_name} (${measuredShortNote(r)})` : r.activity_name) },
                { label: 'Time', width: 76, align: 'right', render: (r) => formatDuration(r.duration_seconds) },
                { label: 'Pace', width: 84, align: 'right', render: (r) => formatPace(r.distance_meters, r.duration_seconds, r.sport) },
                { label: 'Elevation', width: 76, align: 'right', render: (r) => (r.elevation_gain_meters ? `${r.elevation_gain_meters.toFixed(0)} m` : '–') },
                { label: 'Type', width: 80, render: (r) => r.kind.replace(/_/g, ' ') },
              ]}
            />
          </Card>
          <Card>
            <ChartView chart={chart} height={320} />
          </Card>
        </>
      )}
    </Screen>
  )
}
