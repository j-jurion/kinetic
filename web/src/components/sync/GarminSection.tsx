import { useEffect, useRef, useState } from 'react'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  InputAdornment,
  LinearProgress,
  TextField,
} from '@mui/material'
import { api } from '../../lib/api'
import { formatDate, parseDateInput } from '@kinetic/shared/format'
import { Stat } from '../fields'
import { DateField } from '../DateField'
import { Icon } from '../icons'
import { useNotify } from '../Notify'
import { useBackgroundJobs } from '../../lib/backgroundJobs'

export interface GarminStatus {
  authenticated: boolean
  email: string
  default_since: string
}

/** Garmin Connect: the account connection and the sync of a date range. */
export function GarminSection({ status, refreshStatus }: { status: GarminStatus; refreshStatus: () => Promise<unknown> }) {
  const notify = useNotify()
  const [email, setEmail] = useState(status.email)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authStatus, setAuthStatus] = useState('')
  const [mfaOpen, setMfaOpen] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [since, setSince] = useState(() => formatDate(status.default_since))
  const [until, setUntil] = useState('')
  // The sync runs in the background: it carries on when you leave this page
  const { garmin, startGarminSync } = useBackgroundJobs()
  const { running: syncing, log: progress, result } = garmin

  const authenticate = async () => {
    if (!email.trim() || !password) {
      notify('Email and password are required', 'error')
      return
    }
    setAuthBusy(true)
    setAuthStatus('Authenticating…')
    try {
      const response = await api.post<{ needs_mfa: boolean }>('/garmin/login', { email, password })
      if (response.needs_mfa) {
        setAuthStatus('MFA code required — check your authenticator app')
        setMfaCode('')
        setMfaOpen(true)
      } else {
        setAuthStatus('')
        await refreshStatus()
        notify('Authenticated successfully!', 'success')
      }
    } catch (error) {
      setAuthStatus('')
      notify((error as Error).message, 'error', 8000)
    } finally {
      setAuthBusy(false)
    }
  }

  const submitMfa = async () => {
    if (!mfaCode.trim()) return
    setMfaOpen(false)
    try {
      await api.post('/garmin/mfa', { code: mfaCode })
      await refreshStatus()
      setAuthStatus('')
      notify('MFA complete — tokens saved!', 'success')
    } catch (error) {
      notify((error as Error).message, 'error', 8000)
    }
  }

  const logout = async () => {
    await api.post('/garmin/logout')
    await refreshStatus()
    notify('Logged out — tokens removed', 'info')
  }

  const sync = () => {
    if (syncing) {
      notify('Sync already in progress', 'warning')
      return
    }
    if (!status.authenticated && (!email.trim() || !password)) {
      notify('No cached tokens — authenticate first or enter credentials', 'error')
      return
    }
    const sinceIso = parseDateInput(since)
    const untilIso = until.trim() ? parseDateInput(until) : null
    if (!sinceIso || (until.trim() && !untilIso)) {
      notify('Invalid date — use dd-mm-yyyy', 'error')
      return
    }

    startGarminSync({
      since: sinceIso.slice(0, 10),
      until: untilIso?.slice(0, 10) ?? null,
      email: status.authenticated ? '' : email,
      password: status.authenticated ? '' : password,
    })
  }

  // A sync logs in with the entered credentials and caches tokens: show that once it is done
  const wasSyncing = useRef(syncing)
  useEffect(() => {
    if (wasSyncing.current && !syncing) void refreshStatus()
    wasSyncing.current = syncing
  }, [syncing, refreshStatus])

  return (
    <>
      <div className="sync-grid">
        <div className="card">
          <div className="card-heading">
            <span className="card-heading-icon">
              <Icon name="watch" size={22} />
            </span>
            <div className="column gap-0 flex-1 min-w-0">
              <span className="card-title">Account</span>
              <span className="text-caption text-grey-6">
                {status.authenticated
                  ? status.email
                    ? `Logged in as ${status.email}`
                    : 'Garmin tokens cached — ready to sync'
                  : 'Enter your credentials to connect'}
              </span>
            </div>
            <span className={`status-pill ${status.authenticated ? 'status-pill--ok' : 'status-pill--off'}`}>
              <Icon name={status.authenticated ? 'check_circle' : 'error_outline'} size={16} />
              {status.authenticated ? 'Connected' : 'Not connected'}
            </span>
          </div>

          <div className="column w-full gap-3">
            <TextField
              label="Garmin email"
              variant="outlined"
              size="small"
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              slotProps={{
                input: email
                  ? {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setEmail('')} aria-label="Clear">
                            <Icon name="cancel" size={18} />
                          </IconButton>
                        </InputAdornment>
                      ),
                    }
                  : undefined,
              }}
            />
            <TextField
              label="Password (not stored)"
              variant="outlined"
              size="small"
              fullWidth
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowPassword((s) => !s)} aria-label="Show password">
                        <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </div>

          <div className="row items-center gap-3 w-full">
            <Button
              variant="outlined"
              startIcon={authBusy ? <CircularProgress size={16} /> : <Icon name="login" size={18} />}
              onClick={authenticate}
              disabled={authBusy}
            >
              Authenticate
            </Button>
            {status.authenticated && (
              <Button color="error" startIcon={<Icon name="logout" size={18} />} onClick={logout}>
                Log out
              </Button>
            )}
            <span className="text-caption text-grey-6">{authStatus}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-heading">
            <span className="card-heading-icon">
              <Icon name="cloud_download" size={22} />
            </span>
            <div className="column gap-0 flex-1 min-w-0">
              <span className="card-title">Sync activities</span>
              <span className="text-caption text-grey-6">
                Activities already imported are skipped. The sync keeps running when you leave this page.
              </span>
            </div>
          </div>
          <div className="row items-center gap-3 w-full">
            <DateField label="Sync since (dd-mm-yyyy)" value={since} onChange={setSince} />
            <DateField label="Until (optional)" value={until} onChange={setUntil} />
          </div>
          <Button
            variant="contained"
            startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <Icon name="sync" size={18} />}
            onClick={sync}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>

          {syncing && garmin.total > 0 && (
            <div className="column w-full gap-1">
              <LinearProgress variant="determinate" value={(garmin.done / garmin.total) * 100} />
              <span className="text-caption text-grey-6">
                {garmin.done} of {garmin.total} activities
              </span>
            </div>
          )}

          {progress.length > 0 && (
            <div className="console">
              {progress.map((line, i) => (
                <div key={i} className="console-line">
                  {line}
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="column w-full gap-2">
              <span className="card-label">Sync complete</span>
              <div className="stat-grid">
                <Stat label="Imported" value={result.imported} valueClass="text-positive" />
                <Stat label="Skipped" value={result.skipped} valueClass="text-grey-6" />
                <Stat label="Errors" value={result.errors.length} valueClass={result.errors.length ? 'text-negative' : 'text-grey-6'} />
              </div>
              {result.errors.map((err, i) => (
                <div key={i} className="text-caption text-negative">
                  • {err}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      <Dialog open={mfaOpen} onClose={() => setMfaOpen(false)}>
        <DialogContent sx={{ p: 3 }}>
          <div className="text-h6 q-mb-sm">Two-factor Authentication</div>
          <div className="text-body2 text-grey-7 q-mb-md">
            Enter the 6-digit code from your authenticator app or the code sent via email/SMS.
          </div>
          <TextField
            label="MFA code"
            placeholder="123456"
            variant="outlined"
            size="small"
            autoFocus
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitMfa()}
            sx={{ width: 200 }}
            slotProps={{ htmlInput: { maxLength: 8 } }}
          />
          <div className="row gap-2 q-mt-md">
            <Button onClick={() => setMfaOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={submitMfa}>
              Submit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
