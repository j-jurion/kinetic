import { useEffect, useRef, useState } from 'react'
import { Button, CircularProgress, LinearProgress } from '@mui/material'
import {
  activitiesFromFiles,
  activitiesFromZip,
  importStravaActivities,
  type StravaProgress,
  type StravaSummary,
} from '../lib/stravaExport'
import { Stat } from './fields'
import { Icon } from './icons'
import { useNotify } from './Notify'

type Source = { kind: 'zip'; file: File } | { kind: 'files'; files: File[] }

function describe(source: Source | null): string {
  if (!source) return 'No file chosen'
  if (source.kind === 'zip') return `${source.file.name} (${(source.file.size / 1024 / 1024).toFixed(0)} MB)`
  const count = source.files.length
  return `${count} activity file${count === 1 ? '' : 's'}`
}

/** Bulk import of a Strava export zip, or of many loose .fit/.gpx/.tcx files at once. */
export function StravaCard() {
  const notify = useNotify()
  const [source, setSource] = useState<Source | null>(null)
  const [progress, setProgress] = useState<StravaProgress | null>(null)
  const [summary, setSummary] = useState<StravaSummary | null>(null)
  const abort = useRef<AbortController | null>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const choose = (next: Source | null) => {
    setSource(next)
    setSummary(null)
  }

  const runImport = async () => {
    if (!source) return
    const controller = new AbortController()
    abort.current = controller
    setSummary(null)
    setProgress({ fraction: 0, message: 'Reading export…' })
    try {
      const activities =
        source.kind === 'zip' ? await activitiesFromZip(source.file) : activitiesFromFiles(source.files)
      if (!activities.length) throw new Error('No .fit, .gpx or .tcx files chosen')
      const result = await importStravaActivities(activities, {
        onProgress: setProgress,
        signal: controller.signal,
      })
      setSummary(result)
      notify(`Strava import complete: ${result.imported} imported`, 'success')
    } catch (error) {
      if ((error as Error).name === 'AbortError') notify('Import cancelled', 'info')
      else notify((error as Error).message, 'error', 8000)
    } finally {
      abort.current = null
      setProgress(null)
    }
  }

  const importing = progress !== null

  return (
    <div className="card">
      <div className="card-heading">
        <span className="card-heading-icon">
          <Icon name="folder_zip" size={22} />
        </span>
        <div className="column gap-0 flex-1 min-w-0">
          <span className="card-title">Strava export</span>
          <span className="text-caption text-grey-6">
            Strava → Settings → My Account → Download or Delete Your Account → Request your archive.
            Read in this browser; only the activity files are sent.
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
          choose(file ? { kind: 'zip', file } : null)
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
          choose(files.length ? { kind: 'files', files } : null)
          e.target.value = ''
        }}
      />
      <div className="row items-center gap-3 w-full">
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
        <span className="text-caption text-grey-6 ellipsis flex-1 min-w-0">{describe(source)}</span>
      </div>
      <span className="text-caption text-grey-6">
        Accepts .fit, .gpx and .tcx files, gzipped or not. Activities that are already in Kinetic are skipped.
      </span>
      <div className="row items-center gap-3 w-full">
        <Button
          variant="contained"
          startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <Icon name="download" size={18} />}
          onClick={runImport}
          disabled={!source || importing}
        >
          {importing ? 'Importing…' : 'Import activities'}
        </Button>
        {importing && <Button onClick={() => abort.current?.abort()}>Cancel</Button>}
      </div>

      {progress && (
        <div className="column w-full gap-1">
          <LinearProgress variant="determinate" value={progress.fraction * 100} />
          <span className="text-caption text-grey-6">{progress.message}</span>
        </div>
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
  )
}
