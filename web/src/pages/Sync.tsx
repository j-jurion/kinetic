import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  InputAdornment,
  TextField,
} from '@mui/material'
import { api } from '../lib/api'
import { formatDate, parseDateInput } from '../lib/format'
import { StatTile } from '../components/fields'
import { Icon } from '../components/icons'
import { useNotify } from '../components/Notify'

interface Status {
  authenticated: boolean
  email: string
  default_since: string
}

interface SyncResult {
  imported: number
  skipped: number
  errors: string[]
}

/** A dd-mm-yyyy text field with a calendar picker. */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const iso = parseDateInput(value)?.slice(0, 10) ?? ''
  return (
    <TextField
      label={label}
      value={value}
      variant="outlined"
      size="small"
      onChange={(e) => onChange(e.target.value)}
      sx={{ width: 250 }}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => picker.current?.showPicker?.()} aria-label="Pick a date">
                <Icon name="edit_calendar" size={20} />
              </IconButton>
              <input
                ref={picker}
                type="date"
                value={iso}
                tabIndex={-1}
                aria-hidden
                onChange={(e) => e.target.value && onChange(formatDate(e.target.value))}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none', right: 0, bottom: 0 }}
              />
            </InputAdornment>
          ),
        },
      }}
    />
  )
}

export function SyncPage() {
  const notify = useNotify()
  const [status, setStatus] = useState<Status | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authStatus, setAuthStatus] = useState('')
  const [mfaOpen, setMfaOpen] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<SyncResult | null>(null)

  const refreshStatus = useCallback(async () => {
    const s = await api.get<Status>('/garmin/status')
    setStatus(s)
    return s
  }, [])

  useEffect(() => {
    refreshStatus().then((s) => {
      setEmail(s.email)
      setSince(formatDate(s.default_since))
    })
  }, [refreshStatus])

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

  const sync = async () => {
    if (syncing) {
      notify('Sync already in progress', 'warning')
      return
    }
    if (!status?.authenticated && (!email.trim() || !password)) {
      notify('No cached tokens — authenticate first or enter credentials', 'error')
      return
    }
    const sinceIso = parseDateInput(since)
    const untilIso = until.trim() ? parseDateInput(until) : null
    if (!sinceIso || (until.trim() && !untilIso)) {
      notify('Invalid date — use dd-mm-yyyy', 'error')
      return
    }

    setSyncing(true)
    setProgress([])
    setResult(null)
    try {
      const response = await fetch('/api/garmin/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          since: sinceIso.slice(0, 10),
          until: untilIso?.slice(0, 10) ?? null,
          email: status?.authenticated ? '' : email,
          password: status?.authenticated ? '' : password,
        }),
      })
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Sync failed')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const message = JSON.parse(line)
          if (message.type === 'progress') {
            // Keep the last 50 lines to avoid unbounded growth
            setProgress((p) => [...p, message.message].slice(-50))
          } else if (message.type === 'result') {
            setResult(message)
          } else if (message.type === 'error') {
            notify(message.message, 'error', 8000)
          }
        }
      }
      await refreshStatus()
    } catch (error) {
      notify((error as Error).message, 'error', 8000)
    } finally {
      setSyncing(false)
    }
  }

  if (!status) return null

  return (
    <>
      <div className="card w-full q-pa-md q-mb-md gap-0">
        <div className="row items-center gap-3 q-mb-md">
          <Icon
            name={status.authenticated ? 'check_circle' : 'error'}
            size={24}
            className={status.authenticated ? 'text-positive' : 'text-negative'}
          />
          <span>
            {status.authenticated
              ? status.email
                ? `Logged in as ${status.email}`
                : 'Garmin tokens cached — ready to sync'
              : 'Not authenticated — enter credentials below'}
          </span>
          {status.authenticated && (
            <Button size="small" color="error" startIcon={<Icon name="logout" size={18} />} onClick={logout}>
              Log out
            </Button>
          )}
        </div>

        <div className="text-h6 text-weight-bold">Garmin Connect</div>
        <div className="separator q-my-sm" />

        <div className="row items-start gap-4 flex-wrap q-mt-sm">
          <TextField
            label="Garmin email"
            variant="outlined"
            size="small"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            sx={{ width: 280 }}
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
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            sx={{ width: 280 }}
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

        <div className="row items-center gap-3 q-mt-md">
          <Button
            variant="outlined"
            startIcon={authBusy ? <CircularProgress size={16} /> : <Icon name="login" size={18} />}
            onClick={authenticate}
            disabled={authBusy}
          >
            Authenticate
          </Button>
          <span className="text-caption text-grey-6">{authStatus}</span>
        </div>
      </div>

      <div className="card w-full q-pa-md gap-0">
        <div className="text-h6 text-weight-bold q-mb-sm">Sync Activities</div>
        <div className="separator q-my-sm" />
        <div className="row items-center gap-4 q-mb-md flex-wrap q-mt-sm">
          <DateField label="Sync since (dd-mm-yyyy)" value={since} onChange={setSince} />
          <DateField label="Until (optional, dd-mm-yyyy)" value={until} onChange={setUntil} />
        </div>
        <Button
          variant="contained"
          startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <Icon name="sync" size={18} />}
          onClick={sync}
          disabled={syncing}
        >
          Sync
        </Button>

        {progress.length > 0 && (
          <div className="column w-full gap-0 q-mt-md">
            {progress.map((line, i) => (
              <div key={i} className="text-caption text-grey-7">
                › {line}
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="card w-full q-pa-md q-mt-md gap-0">
            <div className="text-h6 text-weight-bold q-mb-sm">Sync complete</div>
            <div className="row gap-6 q-mb-sm">
              <StatTile label="Imported" value={result.imported} valueClass="text-positive" />
              <StatTile label="Skipped" value={result.skipped} valueClass="text-grey-6" />
              <StatTile label="Errors" value={result.errors.length} valueClass={result.errors.length ? 'text-negative' : 'text-grey-6'} />
            </div>
            {result.errors.length > 0 && (
              <>
                <div className="separator q-my-sm" />
                <div className="text-subtitle2 q-mb-xs">Errors</div>
                {result.errors.map((err, i) => (
                  <div key={i} className="text-caption text-negative">
                    • {err}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
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
