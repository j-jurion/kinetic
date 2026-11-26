import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { reloadIfStale } from '../../lib/staleVersion'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { formatDate } from '@kinetic/shared/format'
import type { PowerSport } from '@kinetic/shared/performance'
import { POWER_CAPTION, POWER_SPORT_NAMES, availablePowerSports, pickPowerSport, powerStats, wattsPerKg } from '@kinetic/shared/powerStats'
import type { TrainingOverview } from '@kinetic/shared/types'
import { useLatestRequest } from '../../lib/useLatestRequest'
import { StatTile } from '../fields'
import { SectionHeading } from './SectionHeading'
import { Toggle } from './Toggle'

// Plotly is large: only load it when there is power data to chart
const PowerCharts = lazy(reloadIfStale(() => import('./PowerCharts')))

/** Power curve, FTP history and W/kg; hidden when no activity has a power curve. */
export function PowerSection({ preferRunning }: { preferRunning: boolean }) {
  const [training, setTraining] = useState<TrainingOverview | null>(null)
  const [choice, setChoice] = useState<PowerSport | null>(null)
  const latest = useLatestRequest()

  useEffect(() => {
    latest(api.get<TrainingOverview>('/training'), setTraining)
  }, [latest])

  const available = useMemo(() => (training ? availablePowerSports(training) : []), [training])
  const sport = pickPowerSport(available, choice, preferRunning)
  const stats = useMemo(() => (training && sport ? powerStats(training, sport) : null), [training, sport])

  if (!training || !sport || !stats) return null
  const { estimate, weight, watchFtp, backendFtp } = stats
  const wkg = (watts: number | null | undefined) => wattsPerKg(watts, weight)

  return (
    <div className="column w-full gap-3">
      <SectionHeading
        icon="bolt"
        title="Power curve & FTP"
        caption={POWER_CAPTION}
      >
        {available.length > 1 && (
          <Toggle<PowerSport>
            value={sport}
            onChange={setChoice}
            label="Power sport"
            options={available.map((s): [PowerSport, string] => [s, POWER_SPORT_NAMES[s]])}
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
          title={POWER_SPORT_NAMES[sport]}
        />
      </Suspense>
    </div>
  )
}
