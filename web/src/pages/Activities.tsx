import { useState } from 'react'
import { Button } from '@mui/material'
import { hours, km } from '@kinetic/shared/activityList'
import type { Activity } from '@kinetic/shared/types'
import { usePagedActivities } from '../lib/usePagedActivities'
import { useBackgroundJobs } from '../lib/backgroundJobs'
import { ActivityEditDialog, ConfirmDeleteDialog, UploadDialog } from '../components/ActivityDialogs'
import { EmptyCard, SportSelect, Stat, YearSelect } from '../components/fields'
import { Icon } from '../components/icons'
import { ActivityMonths } from '../components/ActivityMonths'
import { LoadMore } from '../components/LoadMore'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/PageLoading'

export function ActivitiesPage() {
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [editing, setEditing] = useState<Activity | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Activity | null>(null)
  const [uploading, setUploading] = useState(false)
  // Reload when a background sync or upload brings in activities
  const { dataVersion } = useBackgroundJobs()

  // A page at a time, with the totals of every activity the filters list
  const { activities, totals: summary, hasMore, loadingMore, loadMore, reload: refresh } = usePagedActivities(
    { sport, year },
    dataVersion,
  )

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

      {activities === null && <PageLoading />}
      {activities && activities.length === 0 && (
        <EmptyCard icon="directions_run">No activities yet. Upload a .fit file or add one manually.</EmptyCard>
      )}

      <ActivityMonths activities={activities} onEdit={setEditing} onDelete={setDeleting} />
      <LoadMore hasMore={hasMore} loading={loadingMore} onLoad={loadMore} />

      <ActivityEditDialog
        open={editing !== undefined}
        activity={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={refresh}
      />
      <ConfirmDeleteDialog activity={deleting} onClose={() => setDeleting(null)} onDeleted={refresh} />
      <UploadDialog
        open={uploading}
        onClose={() => setUploading(false)}
      />
    </>
  )
}
