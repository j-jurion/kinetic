import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { AppleHealthSection, type AppleTokenInfo } from '../components/sync/AppleHealthSection'
import { GarminSection, type GarminStatus } from '../components/sync/GarminSection'
import { StravaSection } from '../components/sync/StravaSection'
import { Icon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { useNotify } from '../components/Notify'
import { useBackgroundJobs } from '../lib/backgroundJobs'

type Platform = 'garmin' | 'apple' | 'strava'

interface PlatformTab {
  key: Platform
  icon: string
  name: string
  method: string
}

const PLATFORMS: PlatformTab[] = [
  { key: 'garmin', icon: 'watch', name: 'Garmin Connect', method: 'Sync from your account' },
  { key: 'apple', icon: 'phone_iphone', name: 'Apple Watch', method: 'Automatic sync or Health export' },
  { key: 'strava', icon: 'directions_run', name: 'Strava', method: 'Import your archive' },
]

function isPlatform(value: string | null): value is Platform {
  return PLATFORMS.some((p) => p.key === value)
}

/** The Sync page: one tab per platform, each with its own way of bringing activities in. */
export function SyncPage() {
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const requested = params.get('source')
  const platform: Platform = isPlatform(requested) ? requested : 'garmin'
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

  const select = (key: Platform) => setParams({ source: key }, { replace: true })

  const badge = (key: Platform): { ok: boolean; text: string } | null => {
    if (key === 'garmin') {
      return garmin ? { ok: garmin.authenticated, text: garmin.authenticated ? 'Connected' : 'Not connected' } : null
    }
    if (key === 'apple') {
      return appleToken === undefined ? null : { ok: !!appleToken, text: appleToken ? 'Token active' : 'Not set up' }
    }
    return null
  }

  return (
    <>
      <PageHeader
        icon="sync"
        kicker="Import"
        title="Sync"
        subtitle="Bring in activities from Garmin Connect, Apple Watch and Strava."
      />

      <div className="platform-tabs" role="tablist" aria-label="Platform">
        {PLATFORMS.map((p) => {
          const selected = p.key === platform
          const status = badge(p.key)
          return (
            <button
              key={p.key}
              type="button"
              role="tab"
              id={`platform-${p.key}`}
              aria-selected={selected}
              aria-controls="platform-panel"
              className={`platform-tab ${selected ? 'platform-tab--selected' : ''}`}
              onClick={() => select(p.key)}
            >
              <span className="card-heading-icon">
                <Icon name={p.icon} size={22} />
              </span>
              <span className="column gap-0 flex-1 min-w-0">
                <span className="platform-tab-name">{p.name}</span>
                <span className="text-caption text-grey-6 ellipsis">{status ? status.text : p.method}</span>
              </span>
              {status && <span className={`status-dot ${status.ok ? 'status-dot--ok' : ''}`} aria-hidden />}
            </button>
          )
        })}
      </div>

      <div id="platform-panel" role="tabpanel" aria-labelledby={`platform-${platform}`} className="w-full">
        {platform === 'garmin' && garmin && <GarminSection status={garmin} refreshStatus={refreshGarmin} />}
        {platform === 'apple' && <AppleHealthSection onChange={setAppleToken} />}
        {platform === 'strava' && <StravaSection />}
      </div>
    </>
  )
}
