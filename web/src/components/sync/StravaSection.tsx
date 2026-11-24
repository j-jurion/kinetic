import { useRef, useState } from 'react'
import { Alert, Button, CircularProgress, LinearProgress } from '@mui/material'
import { parseDateRange } from '@kinetic/shared/format'
import { useBackgroundJobs, type StravaSource } from '../../lib/backgroundJobs'
import { DateField } from '../DateField'
import { Stat } from '../fields'
import { Icon } from '../icons'
import { useNotify } from '../Notify'

function describe(source: StravaSource | null): string {
  if (!source) return 'No file chosen'
  if (source.kind === 'zip') return `${source.file.name} (${(source.file.size / 1024 / 1024).toFixed(0)} MB)`
  const count = source.files.length
  return `${count} activity file${count === 1 ? '' : 's'}`
}

/** Strava: how to get the archive, and the bulk import of it (or of loose activity files). */
export function StravaSection() {
  const notify = useNotify()
  const [source, setSource] = useState<StravaSource | null>(null)
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  // The import runs in the background: it carries on when you leave this page
  const { strava, startStravaImport, cancelStravaImport } = useBackgroundJobs()
  const { progress, summary } = strava
  const zipInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)

  const runImport = () => {
    if (!source) return
    try {
      startStravaImport(source, parseDateRange(since, until))
    } catch (error) {
      notify((error as Error).message, 'error')
      return
    }
    setSource(null)
  }

  const importing = strava.running

  return (
    <div className="sync-grid">
      <div className="card">
        <div className="card-heading">
          <span className="card-heading-icon">
            <Icon name="inventory_2" size={22} />
          </span>
          <div className="column gap-0 flex-1 min-w-0">
            <span className="card-title">Get your archive</span>
            <span className="text-caption text-grey-6">Strava has no sync for other apps; it sends every activity in one zip.</span>
          </div>
        </div>
        <ol className="setup-steps">
          <li>
            On strava.com, open <b>Settings</b> → <b>My Account</b> → <b>Download or Delete Your Account</b> →{' '}
            <b>Get Started</b>.
          </li>
          <li>
            Under <b>Download Request</b>, choose <b>Request Your Archive</b>. Strava emails a download link, usually
            within a few hours.
          </li>
          <li>Download the zip and choose it under <b>Import activities</b>. You do not need to unzip it.</li>
        </ol>
        <span className="text-caption text-grey-6">
          Each activity keeps its Strava name, type and description. Activities already in Kinetic, for instance from
          Garmin, are skipped, so you can import the archive again later.
        </span>
      </div>

      <div className="card">
        <div className="card-heading">
          <span className="card-heading-icon">
            <Icon name="folder_zip" size={22} />
          </span>
          <div className="column gap-0 flex-1 min-w-0">
            <span className="card-title">Import activities</span>
            <span className="text-caption text-grey-6">
              Read in this browser; only the activity files are sent, not your photos. The import keeps running
              when you leave this page.
            </span>
          </div>
        </div>

        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            setSource(file ? { kind: 'zip', file } : null)
            e.target.value = ''
          }}
        />
        <input
          ref={filesInput}
          type="file"
          accept=".fit,.gpx,.tcx,.gz"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            setSource(files.length ? { kind: 'files', files } : null)
            e.target.value = ''
          }}
        />
        <div className="row items-center gap-2 w-full">
          <Button
            variant="outlined"
            startIcon={<Icon name="upload_file" size={18} />}
            onClick={() => zipInput.current?.click()}
            disabled={importing}
          >
            Choose export zip
          </Button>
          <Button
            variant="text"
            startIcon={<Icon name="library_add" size={18} />}
            onClick={() => filesInput.current?.click()}
            disabled={importing}
          >
            Or choose files
          </Button>
        </div>
        <span className="text-caption text-grey-6 ellipsis w-full">
          {importing && !source ? `Importing ${strava.label}` : describe(source)}
        </span>
        <span className="text-caption text-grey-6">.fit, .gpx and .tcx files, gzipped or not.</span>
        <div className="row items-center gap-3 w-full">
          <DateField label="From (optional)" value={since} onChange={setSince} />
          <DateField label="Until (optional)" value={until} onChange={setUntil} />
        </div>
        <div className="row items-center gap-3 w-full">
          <Button
            variant="contained"
            startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <Icon name="download" size={18} />}
            onClick={runImport}
            disabled={!source || importing}
          >
            {importing ? 'Importing…' : 'Import activities'}
          </Button>
          {importing && <Button onClick={cancelStravaImport}>Cancel</Button>}
        </div>

        {progress && (
          <div className="column w-full gap-1">
            <LinearProgress variant="determinate" value={progress.fraction * 100} />
            <span className="text-caption text-grey-6">{progress.message}</span>
          </div>
        )}

        {strava.error && (
          <Alert severity="error" variant="outlined" className="w-full">
            Import failed: {strava.error}
          </Alert>
        )}

        {summary && (
          <div className="column w-full gap-2">
            <span className="card-label">Import complete — {summary.found} activity files</span>
            <div className="stat-grid">
              <Stat label="Imported" value={summary.imported} valueClass="text-positive" />
              <Stat label="Skipped" value={summary.skipped} valueClass="text-grey-6" />
              <Stat
                label="Errors"
                value={summary.errors.length}
                valueClass={summary.errors.length ? 'text-negative' : 'text-grey-6'}
              />
            </div>
            {summary.errors.slice(0, 20).map((err, i) => (
              <div key={i} className="text-caption text-negative">
                • {err}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
