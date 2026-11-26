import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { reloadIfStale } from '../lib/staleVersion'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatDate, formatDuration, kindLabel } from '@kinetic/shared/format'
import { breakdownEvents } from '@kinetic/shared/performance'
import { formatRank } from '@kinetic/shared/forms'
import type { MultisportEvent, RaceRow } from '@kinetic/shared/types'
import { EmptyCard } from '../components/fields'
import { MultisportMarker, SportIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import '../styles/races.css'
import { PageLoading } from '../components/PageLoading'

// Plotly is large: the multisport charts load only when there are such races
const RaceBreakdownCharts = lazy(reloadIfStale(() => import('../components/performance/RaceBreakdownCharts')))

export function RacesPage() {
  const [results, setResults] = useState<RaceRow[] | null>(null)
  const [multisportEvents, setMultisportEvents] = useState<MultisportEvent[]>([])

  useEffect(() => {
    api.get<RaceRow[]>('/races').then(setResults)
    // Triathlons and duathlons from their recorded legs, so no splits need typing in
    api.get<MultisportEvent[]>('/multisport').then(setMultisportEvents)
  }, [])

  const multisport = useMemo(() => breakdownEvents(results ?? [], multisportEvents), [results, multisportEvents])

  if (!results) return <PageLoading />

  return (
    <>
      <PageHeader
        variant="race"
        icon="flag"
        kicker="Race results"
        title="Races"
        subtitle={`${results.length} ${results.length === 1 ? 'result' : 'results'} on record — official times, rankings and splits.`}
      />

      {multisport.length > 0 && (
        <div className="w-full">
          <Suspense fallback={<div style={{ height: 160 + 44 * multisport.length }} />}>
            <RaceBreakdownCharts events={multisport} />
          </Suspense>
        </div>
      )}

      {results.length === 0 ? (
        <EmptyCard icon="emoji_events">No race results recorded yet.</EmptyCard>
      ) : (
        <div className="column w-full gap-0">
          {results.map((r) => {
            const a = r.activity
            const splitSummary = r.splits
              .map((s) => (s.duration_seconds ? `${s.label}: ${formatDuration(s.duration_seconds)}` : s.label))
              .join(' · ')
            const details = [
              r.bib_number ? `Bib ${r.bib_number}` : '',
              r.age_group ? `Age group ${r.age_group}` : '',
              splitSummary,
            ].filter(Boolean)
            const metrics: [string, string | null][] = [
              ['Official time', r.official_time_seconds ? formatDuration(r.official_time_seconds) : null],
              ['Overall', formatRank(r.overall_rank, r.overall_total)],
              ['Gender', formatRank(r.gender_rank, r.gender_total)],
              ['Age group rank', formatRank(r.age_group_rank, r.age_group_total)],
            ]
            return (
              <div key={r.id} className="card w-full q-pa-sm q-mb-sm races-result-card">
                <Link to={`/activity/${a.id}`} className="row items-center no-wrap gap-3 w-full card-link">
                  <SportIcon sport={a.sport} size={28} />
                  <div className="column gap-0 min-w-0">
                    <div className="row items-center no-wrap gap-1">
                      <span className="text-weight-medium text-body1">{a.name}</span>
                      <MultisportMarker parentSport={r.parent_sport} />
                    </div>
                    <div className="text-caption text-grey-6">
                      {formatDate(a.date)}&nbsp;&nbsp;·&nbsp;&nbsp;{kindLabel(a.kind)}
                    </div>
                    {details.length > 0 && <div className="text-caption text-grey-6">{details.join(' · ')}</div>}
                  </div>
                  <div className="row items-center no-wrap gap-6 text-right ml-auto activity-metrics">
                    {metrics.map(
                      ([label, value]) =>
                        value && (
                          <div key={label} className="column gap-0 items-end">
                            <div className="text-weight-medium">{value}</div>
                            <div className="text-caption text-grey-6">{label}</div>
                          </div>
                        ),
                    )}
                  </div>
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
