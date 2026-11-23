import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, IconButton } from '@mui/material'
import { api } from '../lib/api'
import {
  MEDAL_COLORS,
  MEDAL_LABELS,
  distanceLabel,
  cadenceUnit,
  formatDate,
  stepsPerMinute,
  formatDistance,
  formatDuration,
  formatPace,
  kindLabel,
  ordinal,
  sportColor,
  sportLabel,
} from '@kinetic/shared/format'
import { rankItems } from '@kinetic/shared/forms'
import { createHoverBus } from '@kinetic/shared/hoverBus'
import { routeLegs } from '@kinetic/shared/performance'
import type { Activity, ActivityDetail, ActivityStreams, Friend, RaceResult, RaceSplit } from '@kinetic/shared/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ActivityEditDialog, ConfirmDeleteDialog } from '../components/ActivityDialogs'
import { DataTable } from '../components/DataTable'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ActivityBreakdown } from '../components/performance/ActivityBreakdown'
import { Icon, Medal, SportIcon } from '../components/icons'
import { FriendAvatar } from '../components/FriendAvatar'
import { FriendPicker } from '../components/FriendPicker'
import { accountLabel } from '@kinetic/shared/friends'
import { useNotify } from '../components/Notify'
import { RaceResultDialog } from '../components/RaceResultDialog'
import { RouteMap } from '../components/RouteMap'
import '../styles/detail.css'

// The charts pull in Plotly (several MB), so they load only once an activity is opened
const ActivityCharts = lazy(() => import('../components/ActivityCharts'))

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
    </div>
  )
}

function RaceResultsCard({
  activity,
  result,
  onEdit,
  onDelete,
}: {
  activity: Activity
  result: RaceResult | null
  onEdit: () => void
  onDelete: () => void
}) {
  const ranks = rankItems(result)
  void activity

  return (
    <div className="card w-full q-pa-md q-mb-md race-results-panel gap-0">
      <div className="row items-center justify-between no-wrap w-full q-mb-md race-results-heading">
        <div className="row items-center gap-2">
          <Icon name="flag" size={22} className="race-results-icon" />
          <span className="text-subtitle1 text-weight-bold">Race result</span>
        </div>
        <div className="row gap-1">
          {result ? (
            <>
              <IconButton size="small" onClick={onEdit} aria-label="Edit race result">
                <Icon name="edit" size={18} />
              </IconButton>
              <IconButton size="small" color="error" onClick={onDelete} aria-label="Delete race result">
                <Icon name="delete" size={18} />
              </IconButton>
            </>
          ) : (
            <Button size="small" startIcon={<Icon name="add" size={18} />} onClick={onEdit}>
              Add race results
            </Button>
          )}
        </div>
      </div>

      {!result ? (
        <div className="row items-center no-wrap gap-3 q-pa-md w-full race-empty-state">
          <Icon name="flag" size={24} className="race-results-icon" />
          <div className="column gap-0">
            <span className="text-weight-medium">No official results yet</span>
            <span className="text-caption text-grey-6">Add a finish time, rankings, and race splits.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="w-full q-mb-md race-results-hero">
            <div className="column gap-1 race-results-hero-copy">
              <span className="race-results-eyebrow">OFFICIAL FINISH</span>
              <span className="race-results-time">
                {result.official_time_seconds ? formatDuration(result.official_time_seconds) : 'Result recorded'}
              </span>
              {!result.official_time_seconds && (
                <span className="text-caption race-results-subtitle">No official time entered</span>
              )}
            </div>
            <Icon name="flag" size={48} className="race-results-flag" />
          </div>

          {(result.bib_number || result.age_group) && (
            <div className="q-mb-md race-results-facts">
              {result.bib_number && (
                <span className="row items-center no-wrap gap-1 race-result-fact">
                  <Icon name="confirmation_number" size={16} />
                  Bib #{result.bib_number}
                </span>
              )}
              {result.age_group && (
                <span className="row items-center no-wrap gap-1 race-result-fact">
                  <Icon name="groups" size={16} />
                  {result.age_group}
                </span>
              )}
            </div>
          )}

          {ranks.length > 0 && (
            <div className="q-mb-md race-rank-grid">
              {ranks.map(([label, rank, total]) => (
                <div key={label} className="race-rank-tile">
                  <div className="row items-center justify-between no-wrap race-rank-tile-heading" style={{ minHeight: 24 }}>
                    <span className="race-rank-label">{label}</span>
                    {MEDAL_COLORS[rank] && (
                      <Icon name="military_tech" size={24} color={MEDAL_COLORS[rank]} title={`${MEDAL_LABELS[rank]} place medal`} />
                    )}
                  </div>
                  <div className="race-rank-value q-mt-xs">{ordinal(rank)}</div>
                  {!!total && (
                    <div className="race-rank-detail q-mt-sm">
                      of {total} finishers · top {Math.round((rank / total) * 100)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.splits.length > 0 && (
            <>
              <div className="row items-center no-wrap gap-2 q-mb-sm w-full">
                <span className="text-subtitle2 text-weight-bold" style={{ whiteSpace: 'nowrap' }}>Race splits</span>
                <div className="separator flex-1" />
              </div>
              <div className="w-full q-mb-sm">
                <DataTable<RaceSplit & { index: number }>
                  bordered
                  rows={result.splits.map((s, i) => ({ ...s, index: i + 1 }))}
                  rowKey={(s) => s.index}
                  columns={[
                    { name: 'order', label: '#', render: (s) => s.index },
                    { name: 'label', label: 'Split', render: (s) => s.label },
                    { name: 'time', label: 'Time', align: 'right', render: (s) => (s.duration_seconds ? formatDuration(s.duration_seconds) : '–') },
                    {
                      name: 'rank',
                      label: 'Rank',
                      align: 'right',
                      render: (s) =>
                        s.rank && MEDAL_COLORS[s.rank] ? <Medal rank={s.rank} /> : s.rank ? ordinal(s.rank) : '–',
                    },
                  ]}
                />
              </div>
            </>
          )}

          {(result.results_url || result.notes) && (
            <div className="column gap-0 q-mt-sm">
              {result.results_url && (
                <div className="row items-center gap-1">
                  <Icon name="link" size={16} className="text-grey-6" />
                  <a href={result.results_url} target="_blank" rel="noreferrer" className="text-body2 text-primary">
                    Official results
                  </a>
                </div>
              )}
              {result.notes && <div className="text-caption text-grey-6 q-mt-xs">{result.notes}</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FriendsCard({ activityId, current, onChange }: { activityId: number; current: Friend[]; onChange: () => void }) {
  const notify = useNotify()
  const [all, setAll] = useState<Friend[]>([])

  useEffect(() => {
    api.get<Friend[]>('/friends').then(setAll)
  }, [])

  const update = async (next: Friend[]) => {
    const before = new Set(current.map((f) => f.id))
    const after = new Set(next.map((f) => f.id))
    try {
      await Promise.all([
        ...next.filter((f) => !before.has(f.id)).map((f) => api.put(`/activities/${activityId}/friends/${f.id}`)),
        ...current.filter((f) => !after.has(f.id)).map((f) => api.delete(`/activities/${activityId}/friends/${f.id}`)),
      ])
    } catch (error) {
      notify(`Failed to update friends: ${(error as Error).message}`, 'error')
    }
    onChange()
  }

  return (
    <div className="card w-full q-pa-md q-mb-md gap-2">
      <div className="card-label">Friends</div>
      {current.length > 0 && (
        <div className="activity-friends">
          {current.map((f) => (
            <div key={f.id} className="activity-friend">
              <Link to={`/friends/${f.id}`} className="row items-center no-wrap gap-2 flex-1 min-w-0 card-link">
                <FriendAvatar name={f.name} size={32} />
                <div className="column gap-0 min-w-0">
                  <span className="text-weight-bold text-body2 ellipsis">{f.name}</span>
                  <span className={`friend-account ellipsis ${f.username ? 'friend-account--linked' : ''}`}>
                    {accountLabel(f)}
                  </span>
                </div>
              </Link>
              <IconButton
                size="small"
                onClick={() => update(current.filter((c) => c.id !== f.id))}
                aria-label={`Remove ${f.name} from this activity`}
              >
                <Icon name="close" size={16} className="text-grey-6" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <FriendPicker
        className="w-full"
        friends={all}
        value={current}
        onChange={update}
        onCreated={(friend) => setAll((friends) => [...friends, friend])}
        label=""
        placeholder={current.length ? 'Add another friend' : 'Who did you do this with? Type a name to add someone new'}
        size="small"
        hideSelected
      />
    </div>
  )
}

export function ActivityDetailPage() {
  const { id } = useParams()
  const activityId = Number(id)
  const navigate = useNavigate()
  const [detail, setDetail] = useState<ActivityDetail | null | 'missing'>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [raceDialog, setRaceDialog] = useState(false)

  const latest = useLatestRequest()

  const load = useCallback(() => {
    // Moving between a multisport event and its legs must not show a slower, older response
    latest(
      api.get<ActivityDetail>(`/activities/${activityId}/detail`).catch((): 'missing' => 'missing'),
      setDetail,
    )
  }, [activityId, latest])

  useEffect(load, [load])

  // Per-second data for the map and the charts, fetched once per activity (null = loading)
  const [streams, setStreams] = useState<ActivityStreams | null>(null)
  const latestStreams = useLatestRequest()
  const [hoverBus] = useState(createHoverBus)
  useEffect(() => {
    setStreams(null)
    latestStreams(
      api.get<ActivityStreams>(`/activities/${activityId}/streams`).catch((): ActivityStreams => ({ available: false })),
      setStreams,
    )
  }, [activityId, latestStreams])

  // A multisport event's route is coloured per leg, like its breakdown bar
  const legs = useMemo(
    () =>
      detail && detail !== 'missing' && detail.children.length >= 2
        ? routeLegs(detail.activity.date, detail.children, sportLabel)
        : undefined,
    [detail],
  )

  if (detail === 'missing' || Number.isNaN(activityId)) {
    return (
      <div className="column items-center q-mt-xl w-full gap-0">
        <Icon name="error_outline" size={48} className="text-grey-4" />
        <div className="text-grey-6 q-mt-sm">Activity not found.</div>
      </div>
    )
  }
  if (!detail) return null

  const a = detail.activity
  const sport = a.sport
  const color = sportColor(sport, '#6b7280')
  const dist = a.distance_meters
  const dur = a.duration_seconds

  return (
    <div className="column w-full gap-0">
      {/* Header */}
      <div className="card activity-hero q-mb-md" style={{ '--accent': color } as CSSProperties}>
        <div className="row items-center no-wrap gap-3 w-full">
          <IconButton size="small" onClick={() => navigate(-1)} aria-label="Back">
            <Icon name="arrow_back" />
          </IconButton>
          <span className="sport-badge">
            <SportIcon sport={sport} size={30} />
          </span>
          <div className="column gap-0 flex-1 min-w-0">
            <h1 className="activity-hero-title">{a.name}</h1>
            <div className="activity-sub">
              <span>{formatDate(a.date)}</span>
              <span className="kind-chip" data-kind={a.kind}>
                {kindLabel(a.kind)}
              </span>
              <span>{sportLabel(sport)}</span>
            </div>
          </div>
          <div className="row no-wrap gap-0 shrink-0">
            <IconButton size="small" onClick={() => setEditing(true)} aria-label="Edit">
              <Icon name="edit" />
            </IconButton>
            <IconButton size="small" color="error" onClick={() => setDeleting(true)} aria-label="Delete">
              <Icon name="delete" />
            </IconButton>
          </div>
        </div>
        <div className="stat-grid">
          {!!dist && <StatCard label="Distance" value={formatDistance(dist, sport)} />}
          <StatCard label="Duration" value={formatDuration(dur)} />
          {!!dist && !!dur && <StatCard label="Pace" value={formatPace(dist, dur, sport)} />}
          {!!a.avg_heart_rate && <StatCard label="Avg HR" value={`${a.avg_heart_rate} bpm`} color="#ef4444" />}
          {!!a.max_heart_rate && <StatCard label="Max HR" value={`${a.max_heart_rate} bpm`} color="#ef4444" />}
          {!!a.elevation_gain_meters && <StatCard label="Elevation" value={`${a.elevation_gain_meters.toFixed(0)} m`} color="#10b981" />}
          {!!a.calories && <StatCard label="Calories" value={`${a.calories} kcal`} color="#f59e0b" />}
          {!!a.avg_cadence && (
            <StatCard
              label="Cadence"
              value={`${stepsPerMinute(a.avg_cadence, sport)} ${cadenceUnit(sport)}`}
              color="#8b5cf6"
            />
          )}
          {!!a.avg_power && <StatCard label="Power" value={`${a.avg_power} W`} color="#3b82f6" />}
        </div>
      </div>

      {/* Multisport navigation */}
      {detail.parent && (
        <div className="row items-center gap-2 q-mb-md">
          <Button size="small" startIcon={<Icon name="arrow_back" size={18} />} onClick={() => navigate(`/activity/${detail.parent!.id}`)}>
            Back to {detail.parent.name || 'Triathlon'}
          </Button>
        </div>
      )}
      {detail.children.length > 0 && (
        <div className="card w-full q-pa-md q-mb-md gap-0">
          <div className="card-label q-mb-sm">Sub-activities</div>
          <div className="row gap-2 flex-wrap">
            {detail.children.map((child) => {
              const childColor = sportColor(child.sport, '#6b7280')
              const parts = [child.name || sportLabel(child.sport)]
              if (child.distance_meters) parts.push(formatDistance(child.distance_meters, child.sport))
              if (child.duration_seconds) parts.push(formatDuration(child.duration_seconds))
              return (
                <Button
                  key={child.id}
                  variant="outlined"
                  size="small"
                  startIcon={<SportIcon sport={child.sport} size={20} color={childColor} />}
                  sx={{ color: childColor, borderColor: childColor }}
                  onClick={() => navigate(`/activity/${child.id}`)}
                >
                  {parts.join(' · ')}
                </Button>
              )
            })}
          </div>
        </div>
      )}
      {detail.children.length >= 2 && <ActivityBreakdown activity={a} raceResult={detail.race_result} />}

      <RaceResultsCard
        activity={a}
        result={detail.race_result}
        onEdit={() => setRaceDialog(true)}
        onDelete={async () => {
          await api.delete(`/activities/${activityId}/race-result`)
          load()
        }}
      />

      {a.has_route && (
        <div className="card w-full q-mb-md" style={{ padding: 0, overflow: 'hidden' }}>
          <RouteMap activityId={activityId} sport={sport} streams={streams} hoverBus={hoverBus} legs={legs} />
        </div>
      )}

      <ErrorBoundary
        key={activityId}
        fallback={<div className="text-caption text-grey-6 q-mb-md">The charts for this activity could not be shown.</div>}
      >
        <Suspense>
          <ActivityCharts activity={a} laps={detail.laps} streams={streams} hoverBus={hoverBus} />
        </Suspense>
      </ErrorBoundary>

      {a.notes && (
        <div className="card w-full q-pa-md q-mb-md gap-0">
          <div className="card-label q-mb-xs">Notes</div>
          <div className="text-body1" style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</div>
        </div>
      )}

      {detail.laps.length > 0 && (
        <>
          <div className="card w-full q-mb-md gap-2" style={{ padding: '14px 14px 6px' }}>
            <div className="card-title" style={{ paddingLeft: 2 }}>Laps</div>
            <DataTable
              rows={detail.laps}
              rowKey={(lap) => lap.lap_number}
              columns={[
                { name: 'lap', label: '#', render: (lap) => lap.lap_number },
                { name: 'duration', label: 'Time', align: 'right', render: (lap) => (lap.duration_seconds ? formatDuration(lap.duration_seconds) : '–') },
                { name: 'distance', label: 'Dist', align: 'right', render: (lap) => (lap.distance_meters ? formatDistance(lap.distance_meters, sport) : '–') },
                {
                  name: 'pace',
                  label: 'Pace',
                  align: 'right',
                  render: (lap) =>
                    lap.distance_meters && lap.duration_seconds ? formatPace(lap.distance_meters, lap.duration_seconds, sport) : '–',
                },
                { name: 'hr', label: 'Avg HR', align: 'right', render: (lap) => lap.avg_heart_rate ?? '–' },
                { name: 'elev', label: 'Elev', align: 'right', render: (lap) => (lap.elevation_gain ? `${lap.elevation_gain.toFixed(0)} m` : '–') },
              ]}
            />
          </div>
        </>
      )}

      {detail.best_efforts.length > 0 && (
        <div className="card w-full q-pa-md q-mb-md activity-best-efforts-panel gap-0">
          <div className="row items-center gap-2 q-mb-md w-full activity-best-efforts-section-heading">
            <Icon name="emoji_events" size={22} className="activity-best-efforts-section-icon" />
            <span className="text-subtitle1 text-weight-bold">Best Efforts</span>
          </div>
          <div className="activity-best-efforts-grid">
            {detail.best_efforts.map((be) => (
              <div key={be.id} className="activity-best-effort-tile">
                <div className="row items-center justify-between no-wrap activity-best-effort-heading" style={{ minHeight: 24 }}>
                  <div className="row items-center no-wrap gap-2 min-w-0">
                    <SportIcon sport={be.sport} size={18} color="#ffdc8c" className="activity-best-effort-sport" />
                    <span className="activity-best-effort-distance">{distanceLabel(be.distance_meters, be.sport)}</span>
                  </div>
                  {MEDAL_COLORS[be.rank] && (
                    <span className="activity-best-effort-medal" style={{ display: 'inline-flex' }}>
                      <Icon name="military_tech" size={24} color={MEDAL_COLORS[be.rank]} title={`${MEDAL_LABELS[be.rank]} place medal`} />
                    </span>
                  )}
                </div>
                <div className="activity-best-effort-time q-mt-xs">{formatDuration(be.duration_seconds)}</div>
                <div className="activity-best-effort-rank q-mt-xs">All-time #{be.rank}</div>
                {!!be.distance_meters && !!be.duration_seconds && (
                  <div className="text-caption activity-best-effort-pace q-mt-xs">
                    {formatPace(be.distance_meters, be.duration_seconds, sport)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <FriendsCard activityId={activityId} current={detail.friends} onChange={load} />

      <ActivityEditDialog open={editing} activity={a} onClose={() => setEditing(false)} onSaved={load} />
      <ConfirmDeleteDialog
        activity={deleting ? a : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => navigate(detail.parent ? `/activity/${detail.parent.id}` : '/')}
      />
      <RaceResultDialog
        open={raceDialog}
        activityId={activityId}
        sport={sport}
        existing={detail.race_result}
        onClose={() => setRaceDialog(false)}
        onSaved={load}
      />
    </div>
  )
}
