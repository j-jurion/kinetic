import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, qs } from '../lib/api'
import {
  ALL_RUNNING,
  distanceLabel,
  formatDate,
  formatDuration,
  formatPace,
  markYearBests,
  sportLabel,
} from '@kinetic/shared/format'
import { attemptsChart } from '@kinetic/shared/charts/records'
import type { BestEffortRow } from '@kinetic/shared/types'
import { useFilters } from '../lib/useFilters'
import { useLatestRequest } from '../lib/useLatestRequest'
import { DataTable } from '../components/DataTable'
import { EmptyCard, StatTile, YearSelect } from '../components/fields'
import { Medal, MultisportMarker } from '../components/icons'
import { Plot } from '../components/Plot'
import { RankingToolbar, YearBestDate } from '../components/RankingParts'

type Row = BestEffortRow & { rank: number; yearBest: boolean }

export function BestEffortDistancePage() {
  const navigate = useNavigate()
  const distance = Number(useParams().distance)
  // Every best effort belongs to a sport, so "all sports" would mix unrelated records
  const { sport, year, setYear } = useFilters(ALL_RUNNING)
  const [attempts, setAttempts] = useState<BestEffortRow[] | null>(null)
  const latest = useLatestRequest()
  const label = distanceLabel(distance, sport)

  useEffect(() => {
    latest(api.get<BestEffortRow[]>(`/best-efforts/attempts${qs({ distance, sport, year })}`), setAttempts)
  }, [distance, sport, year, latest])

  const rows: Row[] = useMemo(() => {
    if (!attempts) return []
    const bests = markYearBests(attempts.map((a) => a.year))
    return attempts.map((a, i) => ({ ...a, rank: i + 1, yearBest: bests[i] }))
  }, [attempts])

  const chart = useMemo(() => attemptsChart(rows, sport, label), [rows, sport, label])

  const times = rows.map((r) => r.duration_seconds)

  return (
    <>
      <RankingToolbar sport={sport} year={year} title={`${label} – all attempts`}>
        <YearSelect value={year} onChange={setYear} />
      </RankingToolbar>

      {attempts && attempts.length === 0 && (
        <EmptyCard icon="emoji_events">
          No {sportLabel(sport || ALL_RUNNING).toLowerCase()} attempts recorded at {label} yet.
        </EmptyCard>
      )}

      {attempts && attempts.length > 0 && (
        <div className="column w-full gap-4">
          <div className="card w-full q-pa-md">
            <div className="row gap-8 justify-around w-full">
              <StatTile label="Attempts" value={attempts.length} />
              <StatTile label="Best" value={formatDuration(Math.min(...times))} />
              <StatTile label="Average" value={formatDuration(times.reduce((s, t) => s + t, 0) / times.length)} />
              <StatTile label="Slowest" value={formatDuration(Math.max(...times))} />
              <StatTile label="Best pace" value={formatPace(distance, Math.min(...times), attempts[0].sport)} />
            </div>
          </div>

          <div className="card w-full q-pa-md">
            <DataTable<Row>
              rows={rows}
              rowKey={(r) => r.id}
              pageSize={25}
              onRowClick={(r) => navigate(`/activity/${r.activity_id}`)}
              columns={[
                { name: 'rank', label: '#', render: (r) => `#${r.rank}` },
                { name: 'medal', label: '', align: 'center', render: (r) => <Medal rank={r.rank} /> },
                {
                  name: 'date',
                  label: 'Date',
                  sortValue: (r) => r.date.slice(0, 10),
                  render: (r) => <YearBestDate date={formatDate(r.date)} year={r.year} best={r.yearBest} />,
                },
                {
                  name: 'activity',
                  label: 'Activity',
                  sortValue: (r) => r.activity_name,
                  render: (r) => (
                    <span className="row items-center no-wrap gap-0" style={{ display: 'inline-flex' }}>
                      {r.activity_name}
                      <MultisportMarker parentSport={r.parent_sport} />
                    </span>
                  ),
                },
                { name: 'kind', label: 'Type', render: (r) => r.kind.replace(/_/g, ' ') },
                {
                  name: 'elevation',
                  label: 'Elevation',
                  align: 'right',
                  sortValue: (r) => r.elevation_gain_meters ?? 0,
                  render: (r) => (r.elevation_gain_meters ? `${r.elevation_gain_meters.toFixed(0)} m` : '–'),
                },
                {
                  name: 'time',
                  label: 'Time',
                  align: 'right',
                  sortValue: (r) => r.duration_seconds,
                  render: (r) => formatDuration(r.duration_seconds),
                },
                {
                  name: 'pace',
                  label: 'Pace',
                  align: 'right',
                  render: (r) => formatPace(r.distance_meters, r.duration_seconds, r.sport),
                },
              ]}
            />
          </div>

          <div className="card w-full q-pa-md">
            <Plot data={chart[0]} layout={chart[1]} style={{ height: 340 }} />
          </div>
        </div>
      )}
    </>
  )
}
