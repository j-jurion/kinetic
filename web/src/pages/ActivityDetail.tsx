import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, IconButton, MenuItem, TextField } from '@mui/material'
import { api } from '../lib/api'
import {
  MEDAL_COLORS,
  MEDAL_LABELS,
  distanceLabel,
  formatDate,
  formatDistance,
  formatDuration,
  formatPace,
  kindLabel,
  ordinal,
  sportColor,
  sportLabel,
} from '../lib/format'
import type { Activity, ActivityDetail, Friend, RaceResult, RaceSplit } from '../lib/types'
import { ActivityEditDialog, ConfirmDeleteDialog } from '../components/ActivityDialogs'
import { DataTable } from '../components/DataTable'
import { Icon, Medal, SportIcon } from '../components/icons'
import { RaceResultDialog } from '../components/RaceResultDialog'
import { RouteMap } from '../components/RouteMap'
import '../styles/detail.css'

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card q-pa-md items-center gap-0" style={{ minWidth: 96 }}>
      <div className="text-h6 text-weight-bold" style={{ color }}>{value}</div>
      <div className="text-caption text-grey-6">{label}</div>
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
  const rankItems: [string, number, number | null][] = []
  if (result?.overall_rank) rankItems.push(['Overall', result.overall_rank, result.overall_total])
  if (result?.gender_rank) rankItems.push(['Gender', result.gender_rank, result.gender_total])
  if (result?.age_group_rank) rankItems.push([result.age_group || 'Age group', result.age_group_rank, result.age_group_total])
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

          {rankItems.length > 0 && (
            <div className="q-mb-md race-rank-grid">
              {rankItems.map(([label, rank, total]) => (
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
  const [all, setAll] = useState<Friend[]>([])
  const [selected, setSelected] = useState('')

  useEffect(() => {
    api.get<Friend[]>('/friends').then(setAll)
  }, [])

  const currentIds = new Set(current.map((f) => f.id))
  const available = all.filter((f) => !currentIds.has(f.id))

  const add = async () => {
    if (!selected) return
    await api.put(`/activities/${activityId}/friends/${selected}`)
    setSelected('')
    onChange()
  }
  const remove = async (friendId: number) => {
    await api.delete(`/activities/${activityId}/friends/${friendId}`)
    onChange()
  }

  return (
    <div className="card w-full q-pa-md q-mb-md gap-0">
      <div className="text-caption text-grey-6 q-mb-sm">Friends</div>
      <div className="row items-center flex-wrap gap-2">
        {current.map((f) => (
          <span key={f.id} className="friend-pill">
            <span className="text-body2 text-weight-medium">{f.name}</span>
            <IconButton size="small" onClick={() => remove(f.id)} sx={{ p: '2px' }} aria-label={`Remove ${f.name}`}>
              <Icon name="close" size={14} className="text-grey-6" />
            </IconButton>
          </span>
        ))}
      </div>
      {available.length > 0 ? (
        <div className="row items-end no-wrap gap-1">
          <TextField
            select
            label="Add friend"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            sx={{ minWidth: 180, mt: 1 }}
          >
            {available.map((f) => (
              <MenuItem key={f.id} value={String(f.id)}>
                {f.name}
              </MenuItem>
            ))}
          </TextField>
          <IconButton onClick={add} aria-label="Add friend">
            <Icon name="person_add" />
          </IconButton>
        </div>
      ) : (
        current.length === 0 && (
          <div className="text-caption text-grey-5">No friends yet — add some on the Friends page.</div>
        )
      )}
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

  const load = useCallback(() => {
    api
      .get<ActivityDetail>(`/activities/${activityId}/detail`)
      .then(setDetail)
      .catch(() => setDetail('missing'))
  }, [activityId])

  useEffect(load, [load])

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
      <div className="row items-center no-wrap gap-3 w-full q-mb-md">
        <IconButton size="small" onClick={() => navigate(-1)} aria-label="Back">
          <Icon name="arrow_back" />
        </IconButton>
        <SportIcon sport={sport} size={32} />
        <div className="column gap-0 flex-1">
          <div className="text-h5 text-weight-bold">{a.name}</div>
          <div className="text-caption text-grey-6">
            {formatDate(a.date)}&nbsp;&nbsp;•&nbsp;&nbsp;{kindLabel(a.kind)}&nbsp;&nbsp;•&nbsp;&nbsp;{sportLabel(sport)}
          </div>
        </div>
        <IconButton size="small" onClick={() => setEditing(true)} aria-label="Edit">
          <Icon name="edit" />
        </IconButton>
        <IconButton size="small" color="error" onClick={() => setDeleting(true)} aria-label="Delete">
          <Icon name="delete" />
        </IconButton>
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
          <div className="text-caption text-grey-6 q-mb-sm">Sub-activities</div>
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

      {/* Stats */}
      <div className="row flex-wrap gap-3 q-mb-md">
        {!!dist && <StatCard label="Distance" value={formatDistance(dist, sport)} color={color} />}
        <StatCard label="Duration" value={formatDuration(dur)} color={color} />
        {!!dist && !!dur && <StatCard label="Pace" value={formatPace(dist, dur, sport)} color={color} />}
        {!!a.avg_heart_rate && <StatCard label="Avg HR" value={`${a.avg_heart_rate} bpm`} color="#ef4444" />}
        {!!a.max_heart_rate && <StatCard label="Max HR" value={`${a.max_heart_rate} bpm`} color="#ef4444" />}
        {!!a.elevation_gain_meters && <StatCard label="Elevation" value={`${a.elevation_gain_meters.toFixed(0)} m`} color="#10b981" />}
        {!!a.calories && <StatCard label="Calories" value={`${a.calories} kcal`} color="#f59e0b" />}
        {!!a.avg_cadence && <StatCard label="Cadence" value={`${a.avg_cadence} spm`} color="#8b5cf6" />}
        {!!a.avg_power && <StatCard label="Power" value={`${a.avg_power} W`} color="#3b82f6" />}
      </div>

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
          <RouteMap activityId={activityId} />
        </div>
      )}

      {a.notes && (
        <div className="card w-full q-pa-md q-mb-md gap-0">
          <div className="text-caption text-grey-6 q-mb-xs">Notes</div>
          <div className="text-body1" style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</div>
        </div>
      )}

      {detail.laps.length > 0 && (
        <>
          <div className="text-h6 text-weight-bold q-mb-sm">Laps</div>
          <div className="card w-full q-mb-md" style={{ padding: 0, boxShadow: 'none' }}>
            <DataTable
              bordered
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
