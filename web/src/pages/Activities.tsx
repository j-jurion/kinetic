import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, IconButton } from '@mui/material'
import { api, qs } from '../lib/api'
import { formatDate, formatDistance, formatDuration, formatPace, kindLabel } from '../lib/format'
import type { Activity, ActivityRow } from '../lib/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ActivityEditDialog, ConfirmDeleteDialog, UploadDialog } from '../components/ActivityDialogs'
import { SportSelect, YearSelect } from '../components/fields'
import { Icon, MultisportMarker, SportIcon } from '../components/icons'

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="column gap-0 items-end">
      <div className="text-weight-medium">{value}</div>
      <div className="text-caption text-grey-6">{label}</div>
    </div>
  )
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

  return (
    <>
      <div className="row items-center justify-between w-full q-mb-md flex-wrap gap-3">
        <div className="text-h5 text-weight-bold">Activities</div>
        <div className="row items-center gap-2">
          <SportSelect value={sport} onChange={setSport} />
          <YearSelect value={year} onChange={setYear} />
          <Button variant="outlined" size="small" startIcon={<Icon name="upload_file" size={20} />} onClick={() => setUploading(true)}>
            Upload .fit
          </Button>
          <Button variant="contained" size="small" startIcon={<Icon name="add" size={20} />} onClick={() => setEditing(null)}>
            Add Manual
          </Button>
        </div>
      </div>

      <div className="column w-full gap-0">
        {activities && activities.length === 0 && (
          <div className="text-grey-6 q-mt-lg text-center w-full">
            No activities yet. Upload a .fit file or add one manually.
          </div>
        )}
        {activities?.map((a) => {
          const dist = a.distance_meters
          const dur = a.duration_seconds
          return (
            <div key={a.id} className="card w-full q-pa-sm q-mb-sm hover-shadow">
              <div className="row items-center no-wrap w-full gap-2">
                <Link to={`/activity/${a.id}`} className="row items-center no-wrap gap-3 flex-1 card-link">
                  <SportIcon sport={a.sport} size={28} />
                  <div className="column gap-0 min-w-0">
                    <div className="row items-center no-wrap gap-1">
                      <span className="text-weight-medium text-body1">{a.name}</span>
                      <MultisportMarker parentSport={a.parent_sport} />
                      {a.has_race_result && <Icon name="emoji_events" size={14} className="text-amber" />}
                    </div>
                    <div className="text-caption text-grey-6">
                      {formatDate(a.date)}&nbsp;&nbsp;•&nbsp;&nbsp;{kindLabel(a.kind)}
                    </div>
                  </div>
                  <div className="row items-center no-wrap gap-6 text-right ml-auto activity-metrics">
                    {!!dist && <Metric value={formatDistance(dist, a.sport)} label="Distance" />}
                    <Metric value={formatDuration(dur)} label="Duration" />
                    {!!dist && !!dur && <Metric value={formatPace(dist, dur, a.sport)} label="Pace" />}
                    {!!a.avg_heart_rate && <Metric value={`${a.avg_heart_rate} bpm`} label="Avg HR" />}
                  </div>
                </Link>
                <div className="row no-wrap gap-1 shrink-0">
                  <IconButton size="small" onClick={() => setEditing(a)} aria-label="Edit">
                    <Icon name="edit" size={18} />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => setDeleting(a)} aria-label="Delete">
                    <Icon name="delete" size={18} />
                  </IconButton>
                </div>
              </div>
            </div>
          )
        })}
      </div>

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
