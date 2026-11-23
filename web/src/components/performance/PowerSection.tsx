import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { formatDate } from '@kinetic/shared/format'
import { POWER_SPORTS, estimatedFtp, ftpSettingSteps, latestWeight, monthlyFtp, withPowerCurve } from '@kinetic/shared/performance'
import type { PowerSport } from '@kinetic/shared/performance'
import type { TrainingOverview } from '@kinetic/shared/types'
import { useLatestRequest } from '../../lib/useLatestRequest'
import { StatTile } from '../fields'
import { SectionHeading } from './SectionHeading'
import { Toggle } from './Toggle'

// Plotly is large: only load it when there is power data to chart
const PowerCharts = lazy(() => import('./PowerCharts'))

const SPORT_NAMES: Record<PowerSport, string> = { running: 'Running', cycling: 'Cycling' }

/** Power curve, FTP history and W/kg; hidden when no activity has a power curve. */
export function PowerSection({ preferRunning }: { preferRunning: boolean }) {
  const [training, setTraining] = useState<TrainingOverview | null>(null)
  const [choice, setChoice] = useState<PowerSport | null>(null)
  const latest = useLatestRequest()

  useEffect(() => {
    latest(api.get<TrainingOverview>('/training'), setTraining)
  }, [latest])

  const available = useMemo(
    () =>
      (Object.keys(POWER_SPORTS) as PowerSport[]).filter(
        (s) => training && withPowerCurve(training.activities, s).length > 0,
      ),
    [training],
  )
  const preferred: PowerSport = preferRunning ? 'running' : 'cycling'
  const sport: PowerSport | undefined =
    choice && available.includes(choice) ? choice : available.includes(preferred) ? preferred : available[0]

  const stats = useMemo(() => {
    if (!training || !sport) return null
    const sports: readonly string[] = POWER_SPORTS[sport]
    const activities = withPowerCurve(training.activities, sport)
    const today = new Date()
    const current = estimatedFtp(activities, today)
    const monthly = monthlyFtp(activities, today)
    const last = monthly[monthly.length - 1] ?? null
    const settings = ftpSettingSteps(training.activities.filter((a) => sports.includes(a.sport)))
    const weight = training.thresholds.weight_kg ?? latestWeight(training.activities)
    const backendFtp = sport === 'running' ? training.thresholds.ftp_running : training.thresholds.ftp_cycling
    return {
      activities,
      monthly,
      settings,
      weight,
      backendFtp,
      // Fall back to the most recent month with a 20-minute effort
      estimate: current ? { ...current, asOf: null } : last ? { ftp: last.ftp, activity: last.activity, asOf: last.month } : null,
      watchFtp: settings.length ? settings[settings.length - 1].ftp : null,
    }
  }, [training, sport])

  if (!training || !sport || !stats) return null
  const { estimate, weight, watchFtp, backendFtp } = stats
  const wkg = (watts: number | null | undefined) => (watts && weight ? `${(watts / weight).toFixed(2)} W/kg` : '–')

  return (
    <div className="column w-full gap-3">
      <SectionHeading
        icon="bolt"
        title="Power curve & FTP"
        caption="Best average power per duration; FTP estimated as 95% of your best 20-minute power over the previous 6 weeks."
      >
        {available.length > 1 && (
          <Toggle<PowerSport>
            value={sport}
            onChange={setChoice}
            label="Power sport"
            options={available.map((s): [PowerSport, string] => [s, SPORT_NAMES[s]])}
          />
        )}
      </SectionHeading>

      <div className="card w-full q-pa-md trophy-summary">
        <div className="row gap-8 flex-wrap justify-around w-full">
          <StatTile label="Estimated FTP" value={estimate ? `${Math.round(estimate.ftp)} W` : '–'} />
          <StatTile label="Estimated FTP per kg" value={wkg(estimate?.ftp)} />
          <StatTile label="Watch FTP setting" value={watchFtp ? `${Math.round(watchFtp)} W` : '–'} valueClass="text-grey-6" />
          <StatTile label="Watch FTP per kg" value={wkg(watchFtp)} valueClass="text-grey-6" />
          {backendFtp != null && <StatTile label="FTP used for zones" value={`${Math.round(backendFtp)} W`} valueClass="text-grey-6" />}
          <StatTile label="Weight" value={weight ? `${weight.toFixed(1)} kg` : '–'} valueClass="text-grey-6" />
        </div>
        {estimate && (
          <div className="text-caption trophy-date">
            {estimate.asOf ? `No 20-minute effort in the last 6 weeks; latest estimate is from ${estimate.asOf.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}, based on `: 'Based on '}
            <Link to={`/activity/${estimate.activity.id}`} className="perf-link">
              {estimate.activity.name}
            </Link>{' '}
            of {formatDate(estimate.activity.date)}.
          </div>
        )}
      </div>

      <Suspense fallback={<div style={{ height: 400 }} />}>
        <PowerCharts
          activities={stats.activities}
          monthly={stats.monthly}
          settings={stats.settings}
          weight={weight}
          title={SPORT_NAMES[sport]}
        />
      </Suspense>
    </div>
  )
}
