import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Icon } from '../components/Icon'
import { useNotify } from '../components/Notify'
import { AppleSection, type AppleTokenInfo } from '../components/sync/AppleSection'
import { GarminSection, type GarminStatus } from '../components/sync/GarminSection'
import { StravaSection } from '../components/sync/StravaSection'
import { Loading, PageHeader, Screen, T, useColors } from '../components/ui'
import { api } from '../lib/api'

type Platform = 'garmin' | 'apple' | 'strava'

const PLATFORMS: { key: Platform; icon: string; name: string; method: string }[] = [
  { key: 'garmin', icon: 'watch', name: 'Garmin', method: 'Sync account' },
  { key: 'apple', icon: 'phone_iphone', name: 'Apple Watch', method: 'Auto sync' },
  { key: 'strava', icon: 'directions_run', name: 'Strava', method: 'Import archive' },
]

const isPlatform = (value: unknown): value is Platform => PLATFORMS.some((p) => p.key === value)

/** The Sync screen: one tab per platform, each with its own way of bringing activities in. */
export default function SyncScreen() {
  const notify = useNotify()
  const c = useColors()
  const params = useLocalSearchParams<{ source?: string }>()
  const [platform, setPlatform] = useState<Platform>(isPlatform(params.source) ? params.source : 'garmin')
  const [garmin, setGarmin] = useState<GarminStatus | null>(null)
  const [appleToken, setAppleToken] = useState<AppleTokenInfo | null | undefined>(undefined)

  const refreshGarmin = useCallback(async () => {
    const status = await api.get<GarminStatus>('/garmin/status')
    setGarmin(status)
    return status
  }, [])

  useEffect(() => {
    refreshGarmin().catch((error) => notify((error as Error).message, 'error'))
    api
      .get<{ token: AppleTokenInfo | null }>('/integrations/apple-health')
      .then((r) => setAppleToken(r.token))
      .catch(() => setAppleToken(null))
  }, [refreshGarmin, notify])

  const select = (key: Platform) => {
    setPlatform(key)
    router.setParams({ source: key })
  }

  const status = (key: Platform): { ok: boolean; text: string } | null => {
    if (key === 'garmin' && garmin) return { ok: garmin.authenticated, text: garmin.authenticated ? 'Connected' : 'Not connected' }
    if (key === 'apple' && appleToken !== undefined) return { ok: !!appleToken, text: appleToken ? 'Token active' : 'Not set up' }
    return null
  }

  return (
    <Screen>
      <PageHeader kicker="Import" title="Sync" subtitle="Bring in activities from Garmin Connect, Apple Watch and Strava." />

      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
        {PLATFORMS.map((p) => {
          const selected = p.key === platform
          const s = status(p.key)
          return (
            <Pressable
              key={p.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${p.name}${s ? `, ${s.text}` : ''}`}
              onPress={() => select(p.key)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                gap: 4,
                paddingVertical: 10,
                paddingHorizontal: 4,
                borderRadius: 12,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? c.primary : c.cardBorder,
                backgroundColor: selected ? c.primarySoft : c.card,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View>
                <Icon name={p.icon} size={24} color={selected ? c.primary : c.text} />
                {s && (
                  <View
                    style={{
                      position: 'absolute',
                      right: -4,
                      top: -2,
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      borderWidth: 1.5,
                      borderColor: c.card,
                      backgroundColor: s.ok ? c.positive : c.muted,
                    }}
                  />
                )}
              </View>
              <T numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: selected ? c.primary : c.text }}>
                {p.name}
              </T>
              <T muted numberOfLines={1} style={{ fontSize: 11 }}>
                {s ? s.text : p.method}
              </T>
            </Pressable>
          )
        })}
      </View>

      {platform === 'garmin' && (garmin ? <GarminSection status={garmin} refreshStatus={refreshGarmin} /> : <Loading />)}
      {platform === 'apple' && <AppleSection onChange={setAppleToken} />}
      {platform === 'strava' && <StravaSection />}
    </Screen>
  )
}
