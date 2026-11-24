import { useCallback, useEffect, useState } from 'react'
import { Alert, Share, View } from 'react-native'
import { formatDate } from '@kinetic/shared/format'
import { Icon } from '../Icon'
import { useNotify } from '../Notify'
import { Button, Caption, Card, CardTitle, IconButton, T, useColors } from '../ui'
import { ORIGIN, api } from '../../lib/api'

export interface AppleTokenInfo {
  created_at: string
  last_used_at: string | null
}

const WEBHOOK_PATH = '/api/integrations/apple-health/webhook'

function when(value: string | null): string {
  if (!value) return 'never'
  // The API returns naive UTC timestamps
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleString()
}

function confirm(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  )
}

/** A value to paste into Health Auto Export: selectable, with a share button to copy it. */
function ShareField({ label, value }: { label: string; value: string }) {
  const c = useColors()
  return (
    <View style={{ gap: 2 }}>
      <T muted style={{ fontSize: 12 }}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, borderRadius: 8, backgroundColor: c.soft }}>
        <T style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{value}</T>
        <IconButton icon="ios_share" size={18} onPress={() => Share.share({ message: value })} label={`Share ${label}`} />
      </View>
    </View>
  )
}

/** Apple Watch: the Health Auto Export token. The export.zip history import is on the website. */
export function AppleSection({ onChange }: { onChange?: (token: AppleTokenInfo | null) => void }) {
  const notify = useNotify()
  const c = useColors()
  const [info, setInfo] = useState<AppleTokenInfo | null | undefined>(undefined)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const response = await api.get<{ token: AppleTokenInfo | null }>('/integrations/apple-health')
    setInfo(response.token)
    onChange?.(response.token)
  }, [onChange])

  useEffect(() => {
    refresh().catch((error) => notify((error as Error).message, 'error'))
  }, [refresh, notify])

  const createToken = async () => {
    if (info && !(await confirm('New token?', 'The current token stops working.', 'Create'))) return
    setBusy(true)
    try {
      const response = await api.post<{ token: string }>('/integrations/apple-health/token')
      setNewToken(response.token)
      await refresh()
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const revokeToken = async () => {
    if (!(await confirm('Revoke the token?', 'Health Auto Export can no longer send workouts.', 'Revoke'))) return
    await api.delete('/integrations/apple-health/token')
    setNewToken(null)
    await refresh()
    notify('Token revoked', 'info')
  }

  return (
    <>
      <Card>
        <CardTitle
          right={
            info !== undefined && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name={info ? 'check_circle' : 'error_outline'} size={16} color={info ? c.positiveText : c.muted} />
                <T style={{ fontSize: 12, color: info ? c.positiveText : c.muted }}>{info ? 'Token active' : 'Not set up'}</T>
              </View>
            )
          }
        >
          Automatic sync
        </CardTitle>
        <Caption>{info ? `Last workout received: ${when(info.last_used_at)}` : 'New workouts are sent by the Health Auto Export app.'}</Caption>
        <T>1. Install Health Auto Export on your iPhone and allow it to read workouts.</T>
        <T>2. Create a token below.</T>
        <T>
          3. In the app, add an Automation of type REST API: paste the URL, add a header Authorization with the value below,
          choose Workouts, format JSON, export version 2, and turn on Include Route Data and Include Workout Metrics.
        </T>
        {newToken && (
          <>
            <ShareField label="URL" value={`${ORIGIN}${WEBHOOK_PATH}`} />
            <ShareField label="Authorization header" value={`Bearer ${newToken}`} />
            <T style={{ fontSize: 12, color: '#b45309' }}>Copy the header now — the token is not shown again.</T>
          </>
        )}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title={info ? 'New token' : 'Create token'} icon="key" variant="outlined" onPress={createToken} busy={busy} />
          </View>
          {info && (
            <View style={{ flex: 1 }}>
              <Button title="Revoke" icon="block" variant="text" color={c.negative} onPress={revokeToken} />
            </View>
          )}
        </View>
        {info && <Caption>Created {formatDate(info.created_at)}</Caption>}
      </Card>

      <Card>
        <CardTitle>Import history</CardTitle>
        <Caption>
          Older workouts come from the export.zip of the Health app (your profile → Export All Health Data). It can be
          gigabytes, so import it on the Kinetic website: Sync → Apple Watch → Import history.
        </Caption>
      </Card>
    </>
  )
}
