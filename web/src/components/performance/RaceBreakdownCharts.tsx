import { useMemo } from 'react'
import { breakdownChart, breakdownHeight, transitionChart, withTransitions } from '@kinetic/shared/charts/races'
import type { BreakdownEvent } from '@kinetic/shared/performance'
import { Plot } from '../Plot'

interface Props {
  events: BreakdownEvent[]
  /** One event on its own activity page: a compact bar without the transition trend. */
  single?: boolean
}

/** Multisport charts: the breakdown per event and, with two or more events, transition trends. */
export default function RaceBreakdownCharts({ events, single = false }: Props) {
  const breakdown = useMemo(() => breakdownChart(events, single), [events, single])
  const transitions = useMemo(() => {
    if (single) return null
    const timed = withTransitions(events)
    return timed.length >= 2 ? transitionChart(timed) : null
  }, [events, single])
  const height = breakdownHeight(events.length, single)
  return (
    <div className="column w-full gap-3">
      <div className="card w-full q-pa-sm races-chart-card">
        <Plot data={breakdown[0]} layout={breakdown[1]} style={{ height }} />
      </div>
      {transitions && (
        <div className="card w-full q-pa-sm races-chart-card">
          <Plot data={transitions[0]} layout={transitions[1]} style={{ height: 320 }} />
        </div>
      )}
    </div>
  )
}
