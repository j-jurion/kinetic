import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { IconButton } from '@mui/material'
import { byMonth, monthSummary, monthTitle } from '@kinetic/shared/activityList'
import { formatDate, formatDistance, formatDuration, formatPace, kindLabel, sportColor } from '@kinetic/shared/format'
import type { ActivityRow } from '@kinetic/shared/types'
import { Icon, MultisportMarker, SportIcon } from './icons'

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

/** One activity as a card linking to its detail page, with optional edit and delete buttons. */
export function ActivityRowCard({
  activity: a,
  onEdit,
  onDelete,
}: {
  activity: ActivityRow
  onEdit?: (activity: ActivityRow) => void
  onDelete?: (activity: ActivityRow) => void
}) {
  const dist = a.distance_meters
  const dur = a.duration_seconds
  const accent = { '--accent': sportColor(a.sport, '#6b7280') } as CSSProperties
  return (
    <div className="card activity-row" style={accent}>
      <Link to={`/activity/${a.id}`} className="row items-center no-wrap gap-3 flex-1 min-w-0 card-link">
        <span className="sport-badge">
          <SportIcon sport={a.sport} size={24} />
        </span>
        <div className="column gap-0 min-w-0">
          <div className="row items-center no-wrap gap-1 min-w-0">
            <span className="activity-name ellipsis">{a.name}</span>
            <MultisportMarker parentSport={a.parent_sport} />
            {a.has_race_result && <Icon name="emoji_events" size={15} className="text-amber" title="Race result" />}
          </div>
          <div className="activity-sub">
            <span>{formatDate(a.date)}</span>
            <span className="kind-chip" data-kind={a.kind}>
              {kindLabel(a.kind)}
            </span>
          </div>
        </div>
        <div className="row items-center no-wrap gap-6 text-right ml-auto activity-metrics">
          {!!dist && <Metric value={formatDistance(dist, a.sport)} label="Distance" />}
          <Metric value={formatDuration(dur)} label="Duration" />
          {!!dist && !!dur && <Metric value={formatPace(dist, dur, a.sport)} label="Pace" />}
          {!!a.avg_heart_rate && <Metric value={`${a.avg_heart_rate} bpm`} label="Avg HR" />}
        </div>
      </Link>
      {(onEdit || onDelete) && (
        <div className="row no-wrap gap-0 shrink-0 row-actions">
          {onEdit && (
            <IconButton size="small" onClick={() => onEdit(a)} aria-label="Edit">
              <Icon name="edit" size={18} />
            </IconButton>
          )}
          {onDelete && (
            <IconButton size="small" color="error" onClick={() => onDelete(a)} aria-label="Delete">
              <Icon name="delete" size={18} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  )
}

/** Activities grouped per month, each row linking to its detail page. */
export function ActivityMonths({
  activities,
  onEdit,
  onDelete,
}: {
  activities: ActivityRow[] | null
  onEdit?: (activity: ActivityRow) => void
  onDelete?: (activity: ActivityRow) => void
}) {
  if (!activities) return null
  return (
    <>
      {byMonth(activities).map(([key, group]) => {
        return (
          <section key={key} className="month-group">
            <div className="month-heading">
              <span className="month-heading-title">{monthTitle(key)}</span>
              <span className="month-heading-meta">{monthSummary(group)}</span>
            </div>
            {group.map((a) => (
              <ActivityRowCard key={a.id} activity={a} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </section>
        )
      })}
    </>
  )
}
