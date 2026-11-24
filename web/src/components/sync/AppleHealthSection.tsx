import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, CircularProgress, IconButton, LinearProgress, Tooltip } from '@mui/material'
import { api } from '../../lib/api'
import { formatDate, parseDateInput } from '@kinetic/shared/format'
import { useBackgroundJobs } from '../../lib/backgroundJobs'
import { DateField } from '../DateField'
import { Stat } from '../fields'
import { Icon } from '../icons'
import { useNotify } from '../Notify'

const WEBHOOK_PATH = '/api/integrations/apple-health/webhook'

function when(value: string | null): string {
  if (!value) return 'never'
  // The API returns naive UTC timestamps
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
  return date.toLocaleString()
}

function CopyField({ label, value }: { label: string; value: string }) {
  const notify = useNotify()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      notify(`${label} copied`, 'success')
    } catch {
      notify('Could not copy — select the text instead', 'warning')
    }
  }
  return (
    <div className="column gap-0 w-full min-w-0">
      <span className="text-caption text-grey-6">{label}</span>
      <div className="copy-field">
        <code>{value}</code>
        <Tooltip title="Copy">
          <IconButton size="small" onClick={copy} aria-label={`Copy ${label}`}>
            <Icon name="content_copy" size={18} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  )
}

export interface AppleTokenInfo {
  created_at: string
  last_used_at: string | null
}

/** Health Auto Export webhook setup and the Apple Health export.zip import. */
export function AppleHealthSection({ onChange }: { onChange?: (token: AppleTokenInfo | null) => void }) {
  const notify = useNotify()
  const [info, setInfo] = useState<AppleTokenInfo | null | undefined>(undefined)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [since, setSince] = useState('')
  // The import runs in the background: it carries on when you leave this page
  const { apple, startAppleImport, cancelAppleImport } = useBackgroundJobs()
  const { progress, summary } = apple
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const response = await api.get<{ token: AppleTokenInfo | null }>('/integrations/apple-health')
    setInfo(response.token)
    onChange?.(response.token)
  }, [onChange])

  useEffect(() => {
    refresh().catch((error) => notify((error as Error).message, 'error'))
  }, [refresh, notify])

  const createToken = async () => {
    if (info && !window.confirm('Create a new token? The current one stops working.')) return
    setTokenBusy(true)
    try {
      const response = await api.post<{ token: string }>('/integrations/apple-health/token')
      setNewToken(response.token)
      await refresh()
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setTokenBusy(false)
    }
  }

  const revokeToken = async () => {
    if (!window.confirm('Revoke the token? Health Auto Export can no longer send workouts.')) return
    await api.delete('/integrations/apple-health/token')
    setNewToken(null)
    await refresh()
    notify('Token revoked', 'info')
  }

  const runImport = () => {
    if (!file) return
    const sinceIso = since.trim() ? parseDateInput(since) : null
    if (since.trim() && !sinceIso) {
      notify('Invalid date — use dd-mm-yyyy', 'error')
      return
    }
    startAppleImport(file, sinceIso ? Date.parse(sinceIso) : null)
  }

  const importing = apple.running
  const webhookUrl = `${window.location.origin}${WEBHOOK_PATH}`

  return (
    <div className="sync-grid">
      <div className="card">
        <div className="card-heading">
          <span className="card-heading-icon">
            <Icon name="watch" size={22} />
          </span>
          <div className="column gap-0 flex-1 min-w-0">
            <span className="card-title">Automatic sync</span>
            <span className="text-caption text-grey-6">
              {info ? `Last workout received: ${when(info.last_used_at)}` : 'New workouts are sent by the Health Auto Export app'}
            </span>
          </div>
          {info !== undefined && (
            <span className={`status-pill ${info ? 'status-pill--ok' : 'status-pill--off'}`}>
              <Icon name={info ? 'check_circle' : 'error_outline'} size={16} />
              {info ? 'Token active' : 'Not set up'}
            </span>
          )}
        </div>

        <ol className="setup-steps">
          <li>Install <b>Health Auto Export</b> on your iPhone and allow it to read workouts.</li>
          <li>Create a token below.</li>
          <li>
            In the app, add an <b>Automation</b> of type <b>REST API</b>: paste the URL, add a header{' '}
            <code>Authorization</code> with the value below, choose <b>Workouts</b>, format <b>JSON</b>,
            export version <b>2</b>, and turn on <b>Include Route Data</b> and <b>Include Workout Metrics</b>.
          </li>
        </ol>

        {newToken && (
          <div className="column w-full gap-2">
            <CopyField label="URL" value={webhookUrl} />
            <CopyField label="Authorization header" value={`Bearer ${newToken}`} />
            <span className="text-caption text-warning">
              Copy the header now — the token is not shown again.
            </span>
          </div>
        )}

        <div className="row items-center gap-3 w-full">
          <Button
            variant="outlined"
            startIcon={tokenBusy ? <CircularProgress size={16} /> : <Icon name="key" size={18} />}
            onClick={createToken}
            disabled={tokenBusy}
          >
            {info ? 'New token' : 'Create token'}
          </Button>
          {info && (
            <Button color="error" startIcon={<Icon name="block" size={18} />} onClick={revokeToken}>
              Revoke
            </Button>
          )}
          {info && <span className="text-caption text-grey-6">Created {formatDate(info.created_at)}</span>}
        </div>
      </div>

      <div className="card">
        <div className="card-heading">
          <span className="card-heading-icon">
            <Icon name="folder_zip" size={22} />
          </span>
          <div className="column gap-0 flex-1 min-w-0">
            <span className="card-title">Import history</span>
            <span className="text-caption text-grey-6">
              Health app → your profile → Export All Health Data. Read in this browser; only workouts are sent.
            </span>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
          }}
        />
        <div className="row items-center gap-3 w-full">
          <Button
            variant="outlined"
            startIcon={<Icon name="upload_file" size={18} />}
            onClick={() => fileInput.current?.click()}
            disabled={importing}
          >
            Choose export.zip
          </Button>
          <span className="text-caption text-grey-6 ellipsis flex-1 min-w-0">
            {file
              ? `${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)`
              : importing
                ? `Importing ${apple.fileName}`
                : 'No file chosen'}
          </span>
        </div>
        <div className="row items-center gap-3 w-full">
          <DateField label="Only workouts since (optional)" value={since} onChange={setSince} />
        </div>
        <div className="row items-center gap-3 w-full">
          <Button
            variant="contained"
            startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <Icon name="download" size={18} />}
            onClick={runImport}
            disabled={!file || importing}
          >
            {importing ? 'Importing…' : 'Import workouts'}
          </Button>
          {importing && <Button onClick={cancelAppleImport}>Cancel</Button>}
        </div>

        {progress && (
          <div className="column w-full gap-1">
            <LinearProgress variant="determinate" value={progress.fraction * 100} />
            <span className="text-caption text-grey-6">{progress.message}</span>
          </div>
        )}

        {apple.error && (
          <Alert severity="error" variant="outlined" className="w-full">
            Import failed: {apple.error}
          </Alert>
        )}

        {summary && (
          <div className="column w-full gap-2">
            <span className="card-label">Import complete — {summary.found} workouts in the export</span>
            <div className="stat-grid">
              <Stat label="Imported" value={summary.imported} valueClass="text-positive" />
              <Stat label="Skipped" value={summary.skipped} valueClass="text-grey-6" />
              <Stat label="Errors" value={summary.errors.length} valueClass={summary.errors.length ? 'text-negative' : 'text-grey-6'} />
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
