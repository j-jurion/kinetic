import { useMemo } from 'react'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { qs } from '@kinetic/shared/api'
import { ALL_RUNNING, formatDate, formatDuration, formatPace, markYearBests, sportLabel } from '@kinetic/shared/format'
import { TOP_METRICS } from '@kinetic/shared/topMetrics'
import type { TopMetric } from '@kinetic/shared/topMetrics'
import type { ActivityRow } from '@kinetic/shared/types'
import { Medal, YearBestDate } from '../../../components/Icon'
import { Table } from '../../../components/Table'
import { Card, Empty, FilterRow, PageHeader, Screen, SportSelect, Stat, StatGrid, YearSelect } from '../../../components/ui'
import { useApi } from '../../../lib/useApi'
import { useFilters } from '../../../lib/useFilters'

type Row = ActivityRow & { rank: number; yearBest: boolean }

/** The activities ranked by one metric, e.g. most elevation. */
export default function TopActivitiesScreen() {
  const metric = useLocalSearchParams<{ metric: string }>().metric as TopMetric
  const config = TOP_METRICS[metric]
  const { sport, year, setSport, setYear } = useFilters(ALL_RUNNING)
  const { data: activities } = useApi<ActivityRow[]>(config ? `/top-activities/${metric}${qs({ sport, year })}` : null)

  const rows: Row[] = useMemo(() => {
    if (!activities) return []
    const bests = markYearBests(activities.map((a) => Number(a.date.slice(0, 4))))
    return activities.map((a, i) => ({ ...a, rank: i + 1, yearBest: bests[i] }))
  }, [activities])

  if (!config) return <Empty icon="error_outline">Unknown ranking '{metric}'.</Empty>
  const other = TOP_METRICS[metric === 'elevation' ? 'distance' : 'elevation']
  const values = rows.map((a) => a[config.field] ?? 0)

  return (
    <Screen>
      <Stack.Screen options={{ title: config.cardTitle }} />
      <PageHeader kicker={sportLabel(sport)} title={config.pageTitle}>
        <FilterRow>
          <SportSelect value={sport} onChange={setSport} includeAllSports={false} />
          <YearSelect value={year} onChange={setYear} />
        </FilterRow>
      </PageHeader>
      {activities && activities.length === 0 && (
        <Empty icon={config.icon}>
          No {sportLabel(sport || ALL_RUNNING).toLowerCase()} activities with {metric} data yet.
        </Empty>
      )}
      {activities && activities.length > 0 && (
        <>
          <StatGrid>
            <Stat label="Activities" value={rows.length} />
            <Stat label={config.bestLabel} value={config.format(Math.max(...values), sport)} />
            <Stat label="Average" value={config.format(values.reduce((s, v) => s + v, 0) / values.length, sport)} />
            <Stat label={config.totalLabel} value={config.formatTotal(values.reduce((s, v) => s + v, 0), sport)} />
          </StatGrid>
          <Card>
            <Table
              rows={rows}
              rowKey={(r) => r.id}
              onRowPress={(r) => router.push(`/activity/${r.id}`)}
              columns={[
                { label: '#', width: 40, align: 'center', render: (r) => (r.rank <= 3 ? <Medal rank={r.rank} /> : String(r.rank)) },
                { label: 'Activity', width: 150, render: (r) => r.name },
                { label: 'Date', width: 100, render: (r) => <YearBestDate date={formatDate(r.date)} best={r.yearBest} /> },
                { label: config.column, width: 86, align: 'right', render: (r) => config.format(r[config.field] ?? 0, r.sport) },
                { label: other.column, width: 86, align: 'right', render: (r) => (r[other.field] ? other.format(r[other.field]!, r.sport) : '–') },
                { label: 'Time', width: 76, align: 'right', render: (r) => formatDuration(r.duration_seconds ?? 0) },
                {
                  label: 'Pace',
                  width: 84,
                  align: 'right',
                  render: (r) => (r.distance_meters && r.duration_seconds ? formatPace(r.distance_meters, r.duration_seconds, r.sport) : '–'),
                },
              ]}
            />
          </Card>
        </>
      )}
    </Screen>
  )
}
