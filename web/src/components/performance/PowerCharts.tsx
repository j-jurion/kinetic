import { useMemo } from 'react'
import { curveChart, ftpChart } from '@kinetic/shared/charts/power'
import type { FtpPoint } from '@kinetic/shared/performance'
import type { TrainingActivity } from '@kinetic/shared/types'
import { Plot } from '../Plot'

interface Props {
  /** Activities of one power sport that have a power curve. */
  activities: TrainingActivity[]
  monthly: FtpPoint[]
  settings: { date: string; ftp: number }[]
  weight: number | null
  title: string
}

/** The power curve and FTP history charts (loaded lazily: they need Plotly). */
export default function PowerCharts({ activities, monthly, settings, weight, title }: Props) {
  const curve = useMemo(() => curveChart(activities, weight, title), [activities, weight, title])
  const ftp = useMemo(() => ftpChart(monthly, settings, weight, title), [monthly, settings, weight, title])
  return (
    <div className="w-full graphs-grid">
      <div className="card w-full q-pa-sm trophy-summary">
        <Plot data={curve[0]} layout={curve[1]} style={{ height: 400 }} />
      </div>
      <div className="card w-full q-pa-sm trophy-summary">
        <Plot data={ftp[0]} layout={ftp[1]} style={{ height: 400 }} />
      </div>
    </div>
  )
}
