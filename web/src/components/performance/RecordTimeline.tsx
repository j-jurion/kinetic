import { Suspense, lazy, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { distanceLabel, formatDate, formatDuration } from '../../lib/format'
import { formatImprovement, recordTimeline } from '../../lib/performance'
import type { BestEffortRow } from '../../lib/types'
import { Icon } from '../icons'
import { SectionHeading } from './SectionHeading'
import { Toggle } from './Toggle'

// Plotly is large: only load it when the chart is shown
const RecordTimelineChart = lazy(() => import('./RecordTimelineChart'))

// Records shown per distance before "show all"
const COLLAPSED = 4

type View = 'list' | 'chart'

/**
 * When each personal record was set, per distance. Records are computed over all seasons;
 * with a year selected only the records set in that year are listed.
 */
export function RecordTimeline({ efforts, sport, year }: { efforts: BestEffortRow[]; sport: string; year: number | null }) {
  const [view, setView] = useState<View>('list')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const histories = useMemo(
    () =>
      recordTimeline(efforts)
        .map((h) => ({ ...h, steps: year ? h.steps.filter((s) => s.effort.year === year) : h.steps }))
        .filter((h) => h.steps.length > 0),
    [efforts, year],
  )

  if (!histories.length) return null
  const toggle = (distance: number) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(distance)) next.delete(distance)
      else next.add(distance)
      return next
    })

  return (
    <div className="column w-full gap-3">
      <SectionHeading
        icon="trending_up"
        title="Personal-record timeline"
        caption={year ? `Every new personal record set in ${year}.` : 'Every time you set a new personal record.'}
      >
        <Toggle<View>
          value={view}
          onChange={setView}
          label="Timeline view"
          options={[
            ['list', 'List'],
            ['chart', 'Chart'],
          ]}
        />
      </SectionHeading>

      {view === 'chart' ? (
        <div className="card w-full q-pa-sm trophy-summary">
          <Suspense fallback={<div style={{ height: 420 }} />}>
            <RecordTimelineChart histories={histories} sport={sport} />
          </Suspense>
        </div>
      ) : (
        <div className="w-full perf-pr-grid">
          {histories.map(({ distance, steps }) => {
            // Newest first: the current record on top
            const newest = [...steps].reverse()
            const open = expanded.has(distance)
            const shown = open ? newest : newest.slice(0, COLLAPSED)
            return (
              <div key={distance} className="card w-full q-pa-md gap-2 trophy-summary perf-pr-card">
                <div className="row items-center justify-between no-wrap gap-2">
                  <div className="row items-center no-wrap gap-2">
                    <Icon name="emoji_events" size={18} className="trophy-category-icon" />
                    <span className="text-subtitle1 text-weight-bold">{distanceLabel(distance, sport)}</span>
                  </div>
                  <span className="text-caption trophy-date">
                    {steps.length} {steps.length === 1 ? 'record' : 'records'}
                  </span>
                </div>
                <div className="column w-full gap-0">
                  {shown.map(({ effort, improvement }) => (
                    <Link
                      key={effort.id}
                      to={`/activity/${effort.activity_id}`}
                      className="row items-center no-wrap gap-2 w-full perf-pr-row"
                      title={effort.activity_name}
                    >
                      <span className="text-caption trophy-date perf-pr-date">{formatDate(effort.date)}</span>
                      <span className="text-weight-bold perf-pr-time">{formatDuration(effort.duration_seconds)}</span>
                      <span className="text-caption ellipsis flex-1 min-w-0 trophy-date">{effort.activity_name}</span>
                      {improvement !== null ? (
                        <span className="perf-improvement">{formatImprovement(improvement)}</span>
                      ) : (
                        <span className="perf-improvement perf-improvement--first">first</span>
                      )}
                    </Link>
                  ))}
                </div>
                {newest.length > COLLAPSED && (
                  <button type="button" className="perf-more text-caption" onClick={() => toggle(distance)}>
                    {open ? 'Show fewer' : `Show all ${newest.length}`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
