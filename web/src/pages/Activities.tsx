import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@mui/material'
import { api, qs } from '../lib/api'
import { hours, km, totals } from '@kinetic/shared/activityList'
import type { Activity, ActivityRow } from '@kinetic/shared/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ActivityEditDialog, ConfirmDeleteDialog, UploadDialog } from '../components/ActivityDialogs'
import { EmptyCard, SportSelect, Stat, YearSelect } from '../components/fields'
import { Icon } from '../components/icons'
import { ActivityMonths } from '../components/ActivityMonths'
import { PageHeader } from '../components/PageHeader'

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

      <ActivityMonths activities={activities} onEdit={setEditing} onDelete={setDeleting} />

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
