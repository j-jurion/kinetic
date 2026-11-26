import { Suspense, lazy, useEffect, useState } from 'react'
import { reloadIfStale } from '../../lib/staleVersion'
import { api } from '../../lib/api'
import { eventFromSplits } from '@kinetic/shared/charts/races'
import { eventFromLegs } from '@kinetic/shared/performance'
import type { BreakdownEvent } from '@kinetic/shared/performance'
import type { Activity, MultisportEvent, RaceResult } from '@kinetic/shared/types'
import { useLatestRequest } from '../../lib/useLatestRequest'

// Plotly is large: the chart loads only on multisport activities
const RaceBreakdownCharts = lazy(reloadIfStale(() => import('./RaceBreakdownCharts')))

interface Props {
  activity: Activity
  /** The official result; its splits are used instead of the legs when there are two or more. */
  raceResult: RaceResult | null
}

/** The stacked legs-and-transitions bar of one triathlon, duathlon or multisport activity. */
export function ActivityBreakdown({ activity, raceResult }: Props) {
  const [event, setEvent] = useState<BreakdownEvent | null>(null)
  const latest = useLatestRequest()

  useEffect(() => {
    const fromSplits = eventFromSplits(activity, raceResult)
    if (fromSplits) {
      latest(Promise.resolve(null), () => setEvent(fromSplits))
      return
    }
    latest(api.get<MultisportEvent[]>('/multisport'), (events) => {
      const found = events.find((e) => e.id === activity.id)
      setEvent(found ? eventFromLegs(found) : null)
    })
  }, [activity, raceResult, latest])

  if (!event) return null
  return (
    <div className="w-full q-mb-md">
      <Suspense fallback={<div style={{ height: 214 }} />}>
        <RaceBreakdownCharts events={[event]} single />
      </Suspense>
    </div>
  )
}
