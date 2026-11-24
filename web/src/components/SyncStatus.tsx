import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircularProgress, IconButton, Tooltip } from '@mui/material'
import { jobStatuses, useBackgroundJobs } from '../lib/backgroundJobs'
import type { JobStatus } from '../lib/backgroundJobs'
import { Icon } from './icons'

// A finished job without errors stays in the header this long; one with errors until dismissed
const DONE_VISIBLE_MS = 10_000

function StatusIcon({ status }: { status: JobStatus }) {
  if (status.state === 'running') {
    return status.fraction !== null && status.fraction > 0 ? (
      <CircularProgress size={16} thickness={5} variant="determinate" value={Math.max(status.fraction * 100, 5)} color="inherit" />
    ) : (
      <CircularProgress size={16} thickness={5} color="inherit" />
    )
  }
  return <Icon name={status.state === 'done' ? 'check_circle' : 'error'} size={18} />
}

/** The syncs and uploads running in the background, in the header; click to open the page that shows it. */
export function SyncStatus() {
  const jobs = useBackgroundJobs()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const statuses = jobStatuses(jobs).filter((s) => !dismissed.has(s.key))

  const doneKeys = statuses.filter((s) => s.state === 'done').map((s) => s.key).join(',')
  useEffect(() => {
    if (!doneKeys) return
    const timer = window.setTimeout(
      () => setDismissed((set) => new Set([...set, ...doneKeys.split(',')])),
      DONE_VISIBLE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [doneKeys])

  if (!statuses.length) return null
  const running = statuses.some((s) => s.state === 'running')
  const failed = statuses.some((s) => s.state === 'error')
  const state = running ? 'running' : failed ? 'error' : 'done'
  // Several jobs at once: the running one leads, the tooltip lists them all
  const lead = statuses.find((s) => s.state === state) ?? statuses[0]
  const finishedKeys = statuses.filter((s) => s.state !== 'running').map((s) => s.key)
  const dismiss = () => setDismissed((set) => new Set([...set, ...finishedKeys]))

  return (
    <div className={`sync-status sync-status--${state}`} role="status" aria-live="polite">
      <Tooltip
        title={
          <div className="column gap-1">
            {statuses.map((s) => (
              <span key={s.key}>{s.detail}</span>
            ))}
            <span style={{ opacity: 0.75 }}>Click to open</span>
          </div>
        }
      >
        <button
          type="button"
          className="sync-status-button"
          onClick={() => {
            dismiss()
            navigate(lead.href)
          }}
        >
          <StatusIcon status={lead} />
          <span className="sync-status-label">{lead.label}</span>
          {statuses.length > 1 && <span className="sync-status-more">+{statuses.length - 1}</span>}
        </button>
      </Tooltip>
      {!running && (
        <IconButton size="small" color="inherit" onClick={dismiss} aria-label="Dismiss" sx={{ p: 0.25 }}>
          <Icon name="close" size={16} />
        </IconButton>
      )}
    </div>
  )
}
