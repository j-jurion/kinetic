import { useEffect, useMemo, useState } from 'react'
import { breakdownChart, breakdownHeight, eventFromSplits, transitionChart, withTransitions } from '@kinetic/shared/charts/races'
import { eventFromLegs } from '@kinetic/shared/performance'
import type { BreakdownEvent } from '@kinetic/shared/performance'
import type { Activity, MultisportEvent, RaceResult } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { ChartView } from './PlotView'
import { Card } from './ui'

/** The stacked legs-and-transitions bars and, for two or more events, the transition trend. */
export function RaceBreakdownCharts({ events, single = false }: { events: BreakdownEvent[]; single?: boolean }) {
  const breakdown = useMemo(() => breakdownChart(events, single), [events, single])
  const transitions = useMemo(() => {
    if (single) return null
    const timed = withTransitions(events)
    return timed.length >= 2 ? transitionChart(timed) : null
  }, [events, single])
  return (
    <>
      <Card>
        <ChartView chart={breakdown} height={breakdownHeight(events.length, single)} />
      </Card>
      {transitions && (
        <Card>
          <ChartView chart={transitions} height={300} />
        </Card>
      )}
    </>
  )
}

/** The breakdown of one multisport activity: its official splits, else the recorded legs. */
export function ActivityBreakdown({ activity, raceResult }: { activity: Activity; raceResult: RaceResult | null }) {
  const [event, setEvent] = useState<BreakdownEvent | null>(null)
  useEffect(() => {
    const fromSplits = eventFromSplits(activity, raceResult)
    if (fromSplits) return setEvent(fromSplits)
    let cancelled = false
    api.get<MultisportEvent[]>('/multisport').then((events) => {
      const found = events.find((e) => e.id === activity.id)
      if (!cancelled) setEvent(found ? eventFromLegs(found) : null)
    })
    return () => {
      cancelled = true
    }
  }, [activity, raceResult])
  if (!event) return null
  return <RaceBreakdownCharts events={[event]} single />
}
