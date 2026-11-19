import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@mui/material'
import { api, qs } from '../lib/api'
import { ALL_RUNNING, formatDate, formatDuration, formatPace, markYearBests, sportLabel } from '../lib/format'
import { TOP_METRICS } from '../lib/topMetrics'
import type { TopMetric } from '../lib/topMetrics'
import type { ActivityRow } from '../lib/types'
import { useFilters } from '../lib/useFilters'
import { DataTable } from '../components/DataTable'
import { EmptyCard, SportSelect, StatTile, YearSelect } from '../components/fields'
import { Icon, Medal, MultisportMarker } from '../components/icons'
import { RankingToolbar, YearBestDate } from '../components/RankingParts'

type Row = ActivityRow & { rank: number; year: number; yearBest: boolean }

export function TopActivitiesPage() {
  const navigate = useNavigate()
  const metric = useParams().metric as TopMetric
  const config = TOP_METRICS[metric]
  const { sport, year, setSport, setYear } = useFilters(ALL_RUNNING)
  const [activities, setActivities] = useState<ActivityRow[] | null>(null)

  useEffect(() => {
    if (config) api.get<ActivityRow[]>(`/top-activities/${metric}${qs({ sport, year })}`).then(setActivities)
  }, [metric, config, sport, year])

  const rows: Row[] = useMemo(() => {
    if (!activities) return []
    const years = activities.map((a) => Number(a.date.slice(0, 4)))
    const bests = markYearBests(years)
    return activities.map((a, i) => ({ ...a, rank: i + 1, year: years[i], yearBest: bests[i] }))
  }, [activities])

  if (!config) {
    return (
      <>
        <div className="text-h6 text-grey-6">Unknown ranking '{metric}'.</div>
        <Button size="small" startIcon={<Icon name="arrow_back" size={18} />} sx={{ textTransform: 'none' }} onClick={() => navigate('/best-efforts')}>
          Best Efforts
        </Button>
      </>
    )
  }

  const other = TOP_METRICS[metric === 'elevation' ? 'distance' : 'elevation']
  const values = rows.map((a) => a[config.field] ?? 0)

  return (
    <>
      <RankingToolbar sport={sport} year={year} title={config.pageTitle}>
        <SportSelect value={sport} onChange={setSport} includeAllSports={false} width={160} />
        <YearSelect value={year} onChange={setYear} />
      </RankingToolbar>

      {activities && activities.length === 0 && (
        <EmptyCard icon={config.icon}>
          No {sportLabel(sport || ALL_RUNNING).toLowerCase()} activities with {metric} data yet.
        </EmptyCard>
      )}

      {activities && activities.length > 0 && (
        <div className="column w-full gap-4">
          <div className="card w-full q-pa-md">
            <div className="row gap-8 justify-around w-full">
              <StatTile label="Activities" value={rows.length} />
              <StatTile label={config.bestLabel} value={config.format(Math.max(...values), sport)} />
              <StatTile label="Average" value={config.format(values.reduce((s, v) => s + v, 0) / values.length, sport)} />
              <StatTile label={config.totalLabel} value={config.formatTotal(values.reduce((s, v) => s + v, 0), sport)} />
            </div>
          </div>

          <div className="card w-full q-pa-md">
            <DataTable<Row>
              rows={rows}
              rowKey={(r) => r.id}
              pageSize={25}
              onRowClick={(r) => navigate(`/activity/${r.id}`)}
              columns={[
                {
                  name: 'rank',
                  label: '#',
                  align: 'center',
                  render: (r) =>
                    r.rank <= 3 ? <Medal rank={r.rank} /> : <span style={{ display: 'inline-block', width: 22, textAlign: 'center' }}>{r.rank}</span>,
                },
                {
                  name: 'activity',
                  label: 'Activity',
                  sortValue: (r) => r.name,
                  render: (r) => (
                    <span className="row items-center no-wrap gap-0" style={{ display: 'inline-flex' }}>
                      {r.name}
                      <MultisportMarker parentSport={r.parent_sport} />
                    </span>
                  ),
                },
                {
                  name: 'date',
                  label: 'Date',
                  sortValue: (r) => r.date.slice(0, 10),
                  render: (r) => <YearBestDate date={formatDate(r.date)} year={r.year} best={r.yearBest} />,
                },
                {
                  name: 'value',
                  label: config.column,
                  align: 'right',
                  sortValue: (r) => r[config.field] ?? 0,
                  render: (r) => config.format(r[config.field] ?? 0, r.sport),
                },
                {
                  name: 'other',
                  label: other.column,
                  align: 'right',
                  sortValue: (r) => r[other.field] ?? 0,
                  render: (r) => (r[other.field] ? other.format(r[other.field]!, r.sport) : '–'),
                },
                {
                  name: 'duration',
                  label: 'Time',
                  align: 'right',
                  sortValue: (r) => r.duration_seconds ?? 0,
                  render: (r) => formatDuration(r.duration_seconds ?? 0),
                },
                {
                  name: 'pace',
                  label: 'Pace',
                  align: 'right',
                  render: (r) =>
                    r.distance_meters && r.duration_seconds ? formatPace(r.distance_meters, r.duration_seconds, r.sport) : '–',
                },
              ]}
            />
          </div>
        </div>
      )}
    </>
  )
}
