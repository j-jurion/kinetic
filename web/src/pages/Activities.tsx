import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Button, IconButton } from '@mui/material'
import { api, qs } from '../lib/api'
import { formatDate, formatDistance, formatDuration, formatPace, kindLabel, sportColor } from '../lib/format'
import type { Activity, ActivityRow } from '../lib/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ActivityEditDialog, ConfirmDeleteDialog, UploadDialog } from '../components/ActivityDialogs'
import { EmptyCard, SportSelect, Stat, YearSelect } from '../components/fields'
import { Icon, MultisportMarker, SportIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

interface Totals {
  count: number
  meters: number
  seconds: number
  climb: number
}

/** Totals over the activities, counting a multisport leg only when its event is not listed too. */
function totals(activities: ActivityRow[]): Totals {
  const ids = new Set(activities.map((a) => a.id))
  const t: Totals = { count: 0, meters: 0, seconds: 0, climb: 0 }
  for (const a of activities) {
    if (a.parent_id !== null && ids.has(a.parent_id)) continue
    t.count += 1
    t.meters += a.distance_meters ?? 0
    t.seconds += a.duration_seconds ?? 0
    t.climb += a.elevation_gain_meters ?? 0
  }
  return t
}

const km = (meters: number) => `${Math.round(meters / 1000).toLocaleString('en')} km`
const hours = (seconds: number) => `${Math.round(seconds / 3600).toLocaleString('en')} h`

function monthTitle(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

/** Activities grouped per calendar month, in the order they arrive (newest first). */
function byMonth(activities: ActivityRow[]): [string, ActivityRow[]][] {
  const groups = new Map<string, ActivityRow[]>()
  for (const a of activities) {
    const key = a.date.slice(0, 7)
    const group = groups.get(key)
    if (group) group.push(a)
    else groups.set(key, [a])
  }
  return [...groups.entries()]
}

export function ActivitiesPage() {
  const latest = useLatestRequest()
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [activities, setActivities] = useState<ActivityRow[] | null>(null)
  const [editing, setEditing] = useState<Activity | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Activity | null>(null)
  const [uploading, setUploading] = useState(false)

  const refresh = useCallback(() => {
    latest(api.get<ActivityRow[]>(`/activities${qs({ sport, year })}`), setActivities)
  }, [sport, year, latest])

  useEffect(refresh, [refresh])

  const summary = useMemo(() => (activities ? totals(activities) : null), [activities])
  const months = useMemo(() => (activities ? byMonth(activities) : []), [activities])

  return (
    <>
      <PageHeader icon="directions_run" kicker="Training log" title="Activities" subtitle="Every session you've logged, newest first.">
        <SportSelect value={sport} onChange={setSport} />
        <YearSelect value={year} onChange={setYear} />
        <Button variant="outlined" startIcon={<Icon name="upload_file" size={20} />} onClick={() => setUploading(true)}>
          Upload .fit
        </Button>
        <Button variant="contained" startIcon={<Icon name="add" size={20} />} onClick={() => setEditing(null)}>
          Add manual
        </Button>
      </PageHeader>

      {summary && summary.count > 0 && (
        <div className="stat-grid">
          <Stat label="Activities" value={summary.count.toLocaleString('en')} />
          <Stat label="Distance" value={km(summary.meters)} />
          <Stat label="Moving time" value={hours(summary.seconds)} />
          <Stat label="Climbing" value={`${Math.round(summary.climb).toLocaleString('en')} m`} />
        </div>
      )}

      {activities && activities.length === 0 && (
        <EmptyCard icon="directions_run">No activities yet. Upload a .fit file or add one manually.</EmptyCard>
      )}

      {months.map(([key, group]) => {
        const t = totals(group)
        return (
          <section key={key} className="month-group">
            <div className="month-heading">
              <span className="month-heading-title">{monthTitle(key)}</span>
              <span className="month-heading-meta">
                {t.count} {t.count === 1 ? 'activity' : 'activities'} · {km(t.meters)} · {hours(t.seconds)}
              </span>
            </div>
            {group.map((a) => {
              const dist = a.distance_meters
              const dur = a.duration_seconds
              const accent = { '--accent': sportColor(a.sport, '#6b7280') } as CSSProperties
              return (
                <div key={a.id} className="card activity-row" style={accent}>
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
                  <div className="row no-wrap gap-0 shrink-0 row-actions">
                    <IconButton size="small" onClick={() => setEditing(a)} aria-label="Edit">
                      <Icon name="edit" size={18} />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => setDeleting(a)} aria-label="Delete">
                      <Icon name="delete" size={18} />
                    </IconButton>
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}

      <ActivityEditDialog
        open={editing !== undefined}
        activity={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={refresh}
      />
      <ConfirmDeleteDialog activity={deleting} onClose={() => setDeleting(null)} onDeleted={refresh} />
      <UploadDialog
        open={uploading}
        onClose={() => {
          setUploading(false)
          refresh()
        }}
      />
    </>
  )
}
