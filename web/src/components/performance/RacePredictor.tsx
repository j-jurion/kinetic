import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { distanceLabel, formatDate, formatDuration, formatPace } from '../../lib/format'
import { formatImprovement, predictRaces } from '../../lib/performance'
import type { Prediction } from '../../lib/performance'
import type { BestEffortRow } from '../../lib/types'
import { Icon } from '../icons'
import { SectionHeading } from './SectionHeading'

function PredictionTile({ prediction, sport }: { prediction: Prediction; sport: string }) {
  const { target, seconds, source, record } = prediction
  // Positive when the prediction beats the record
  const margin = record ? record.duration_seconds - seconds : null
  return (
    <div className="card w-full q-pa-md trophy-tile perf-prediction-tile">
      <div className="row items-center no-wrap gap-2 trophy-tile-heading">
        <Icon name="timer" size={18} className="trophy-record-icon shrink-0" />
        <span className="trophy-record-label">{distanceLabel(target, sport)}</span>
      </div>
      <div className="trophy-value q-mt-sm">{formatDuration(seconds)}</div>
      <div className="row items-center gap-2 q-mt-sm">
        <span className="trophy-detail">{formatPace(target, seconds, sport)}</span>
      </div>
      <div className="column w-full gap-0 trophy-tile-footer">
        <div className="separator q-mb-sm" />
        <div className="row items-center justify-between no-wrap gap-2 w-full">
          <span className="text-caption trophy-date">Current PR</span>
          {record ? (
            <Link to={`/activity/${record.activity_id}`} className="perf-link text-weight-bold">
              {formatDuration(record.duration_seconds)}
            </Link>
          ) : (
            <span className="text-caption trophy-date">none yet</span>
          )}
        </div>
        {margin !== null && Math.round(margin) > 0 && (
          <div className="text-caption perf-faster q-mt-xs">
            Prediction is {formatImprovement(margin).slice(1)} faster than your PR
          </div>
        )}
        <div className="text-caption trophy-date q-mt-xs">
          from your{' '}
          <Link to={`/activity/${source.activity_id}`} className="perf-link">
            {distanceLabel(source.distance_meters, sport)} of {formatDate(source.date)}
          </Link>{' '}
          ({formatDuration(source.duration_seconds)})
        </div>
      </div>
    </div>
  )
}

/** Riegel race-time predictions from the best efforts of the last 12 months. */
export function RacePredictor({ efforts, sport }: { efforts: BestEffortRow[]; sport: string }) {
  const { predictions, allTime } = useMemo(() => predictRaces(efforts), [efforts])
  if (!predictions.length) return null
  return (
    <div className="column w-full gap-3">
      <SectionHeading
        icon="speed"
        title="Race predictor"
        caption={
          allTime
            ? 'No efforts of 3 km or more in the last 12 months, so these use your all-time bests.'
            : "Riegel's formula on your best efforts of 3 km or more from the last 12 months."
        }
      />
      <div className="w-full trophy-grid">
        {predictions.map((p) => (
          <div key={p.target} className="trophy-grid-item">
            <PredictionTile prediction={p} sport={sport} />
          </div>
        ))}
      </div>
    </div>
  )
}
