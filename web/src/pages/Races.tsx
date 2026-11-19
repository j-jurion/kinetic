import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { formatDate, formatDuration, kindLabel } from '../lib/format'
import type { RaceRow } from '../lib/types'
import { EmptyCard } from '../components/fields'
import { MultisportMarker, SportIcon } from '../components/icons'
import '../styles/races.css'

function formatRank(rank: number | null, total: number | null): string | null {
  if (!rank) return null
  return total ? `${rank}/${total}` : String(rank)
}

export function RacesPage() {
  const navigate = useNavigate()
  const [results, setResults] = useState<RaceRow[] | null>(null)

  useEffect(() => {
    api.get<RaceRow[]>('/races').then(setResults)
  }, [])

  if (!results) return null

  return (
    <>
      <div className="row items-center justify-between w-full q-mb-md">
        <div className="text-h5 text-weight-bold">Races</div>
        <div className="text-caption text-grey-6">{results.length} results</div>
      </div>

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
                <div className="row items-center no-wrap gap-3 w-full clickable" onClick={() => navigate(`/activity/${a.id}`)}>
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
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
