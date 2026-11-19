import { Suspense, lazy, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { eventFromLegs } from '../../lib/performance'
import type { BreakdownEvent } from '../../lib/performance'
import type { Activity, MultisportEvent, RaceResult } from '../../lib/types'
import { useLatestRequest } from '../../lib/useLatestRequest'

// Plotly is large: the chart loads only on multisport activities
const RaceBreakdownCharts = lazy(() => import('./RaceBreakdownCharts'))

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
    const splits = (raceResult?.splits ?? []).filter((s) => s.label.trim() && s.duration_seconds)
    if (splits.length >= 2) {
      latest(Promise.resolve(null), () =>
        setEvent({
          id: activity.id,
          name: activity.name,
          date: activity.date,
          source: 'splits',
          segments: splits.map((s) => ({ label: s.label.trim(), seconds: s.duration_seconds! })),
        }),
      )
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
