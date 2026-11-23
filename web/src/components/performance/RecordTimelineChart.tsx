import { useMemo } from 'react'
import { recordTimelineChart } from '@kinetic/shared/charts/records'
import type { RecordHistory } from '@kinetic/shared/performance'
import { Plot } from '../Plot'

/** New personal records over time as pace per distance; faster is higher. */
export default function RecordTimelineChart({ histories, sport }: { histories: RecordHistory[]; sport: string }) {
  const [data, layout] = useMemo(() => recordTimelineChart(histories, sport), [histories, sport])
  return <Plot data={data} layout={layout} style={{ height: 440 }} />
}
