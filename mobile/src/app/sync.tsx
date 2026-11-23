import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { formatDate, parseDateInput } from '@kinetic/shared/format'
import { Icon } from '../components/Icon'
import { useNotify } from '../components/Notify'
import { Button, Caption, Card, CardTitle, Field, FormSheet, Loading, PageHeader, Screen, Stat, StatGrid, T, useColors } from '../components/ui'
import { api, postStream } from '../lib/api'

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

export default function SyncScreen() {
  const notify = useNotify()
  const c = useColors()
  const [status, setStatus] = useState<Status | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
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
    if (!email.trim() || !password) return notify('Email and password are required', 'error')
    setAuthBusy(true)
    try {
      const response = await api.post<{ needs_mfa: boolean }>('/garmin/login', { email, password })
      if (response.needs_mfa) {
        setMfaCode('')
        setMfaOpen(true)
      } else {
        await refreshStatus()
        notify('Authenticated successfully!', 'success')
      }
    } catch (error) {
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
    if (syncing) return
    if (!status?.authenticated && (!email.trim() || !password)) {
      return notify('No cached tokens — authenticate first or enter credentials', 'error')
    }
    const sinceIso = parseDateInput(since)
    const untilIso = until.trim() ? parseDateInput(until) : null
    if (!sinceIso || (until.trim() && !untilIso)) return notify('Invalid date — use dd-mm-yyyy', 'error')

    setSyncing(true)
    setProgress([])
    setResult(null)
    try {
      await postStream(
        '/garmin/sync',
        {
          since: sinceIso.slice(0, 10),
          until: untilIso?.slice(0, 10) ?? null,
          email: status?.authenticated ? '' : email,
          password: status?.authenticated ? '' : password,
        },
        (message) => {
          // Keep the last 50 lines to avoid unbounded growth
          if (message.type === 'progress') setProgress((p) => [...p, String(message.message)].slice(-50))
          else if (message.type === 'result') setResult(message as unknown as SyncResult)
          else if (message.type === 'error') notify(String(message.message), 'error', 8000)
        },
      )
      await refreshStatus()
    } catch (error) {
      notify((error as Error).message, 'error', 8000)
    } finally {
      setSyncing(false)
    }
  }

  if (!status) return <Loading />
  return (
    <Screen>
      <PageHeader kicker="Import" title="Garmin Sync" subtitle="Connect your Garmin account and pull in new activities." />

      <Card>
        <CardTitle
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={status.authenticated ? 'check_circle' : 'error_outline'} size={16} color={status.authenticated ? c.positive : c.muted} />
              <T style={{ fontSize: 12, color: status.authenticated ? c.positive : c.muted }}>{status.authenticated ? 'Connected' : 'Not connected'}</T>
            </View>
          }
        >
          Garmin Connect
        </CardTitle>
        <Caption>
          {status.authenticated ? (status.email ? `Logged in as ${status.email}` : 'Garmin tokens cached — ready to sync') : 'Enter your credentials to connect'}
        </Caption>
        <Field label="Garmin email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
        <Field label="Password (not stored)" secureTextEntry value={password} onChangeText={setPassword} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Authenticate" icon="login" variant="outlined" onPress={authenticate} busy={authBusy} />
          </View>
          {status.authenticated && (
            <View style={{ flex: 1 }}>
              <Button title="Log out" icon="logout" variant="text" color={c.negative} onPress={logout} />
            </View>
          )}
        </View>
      </Card>

      <Card>
        <CardTitle>Sync activities</CardTitle>
        <Caption>Activities already imported are skipped.</Caption>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field label="Since (dd-mm-yyyy)" value={since} onChangeText={setSince} style={{ flex: 1 }} />
          <Field label="Until (optional)" value={until} onChangeText={setUntil} style={{ flex: 1 }} />
        </View>
        <Button title={syncing ? 'Syncing…' : 'Sync now'} icon="sync" onPress={sync} busy={syncing} />
        {progress.length > 0 && (
          <View style={{ backgroundColor: '#0f172a', borderRadius: 8, padding: 10, gap: 2 }}>
            {progress.map((line, i) => (
              <T key={i} style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11 }}>
                {line}
              </T>
            ))}
          </View>
        )}
        {result && (
          <>
            <T style={{ fontWeight: '700' }}>Sync complete</T>
            <StatGrid>
              <Stat label="Imported" value={result.imported} color={c.positive} />
              <Stat label="Skipped" value={result.skipped} />
              <Stat label="Errors" value={result.errors.length} color={result.errors.length ? c.negative : undefined} />
            </StatGrid>
            {result.errors.map((err, i) => (
              <T key={i} style={{ color: c.negative, fontSize: 12 }}>
                • {err}
              </T>
            ))}
          </>
        )}
      </Card>

      <FormSheet visible={mfaOpen} title="Two-factor code" onClose={() => setMfaOpen(false)} onSave={submitMfa} saveLabel="Submit">
        <Caption>Enter the 6-digit code from your authenticator app or the code sent via email/SMS.</Caption>
        <Field label="MFA code" placeholder="123456" keyboardType="number-pad" maxLength={8} autoFocus value={mfaCode} onChangeText={setMfaCode} />
      </FormSheet>
    </Screen>
  )
}
