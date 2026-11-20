import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { distanceLabel, formatDate, formatDuration, formatPace } from '../../lib/format'
import { formatImprovement } from '../../lib/performance'
import type { RecordHistory } from '../../lib/performance'
import { paceAxis } from '../../lib/speed'
import { Plot } from '../Plot'

// One colour per distance, short to long
const PALETTE = ['#00a3ff', '#14b8a6', '#00c853', '#aeea00', '#ffb300', '#ff7a00', '#ff2d55', '#d946ef', '#7c4dff', '#64748b']

/** New personal records over time as pace per distance; faster is higher. */
export default function RecordTimelineChart({ histories, sport }: { histories: RecordHistory[]; sport: string }) {
  const [data, layout] = useMemo((): [Data[], Partial<Layout>] => {
    const pace = (meters: number, seconds: number) => seconds / (meters / 1000)
    const traces: Data[] = histories.map(({ distance, steps }, i) => ({
      type: 'scatter',
      mode: 'lines+markers',
      name: distanceLabel(distance, sport),
      x: steps.map((s) => s.effort.date),
      y: steps.map((s) => pace(distance, s.effort.duration_seconds)),
      line: { color: PALETTE[i % PALETTE.length], width: 1.5, shape: 'hv', dash: 'dot' },
      marker: { color: PALETTE[i % PALETTE.length], size: 9 },
      customdata: steps.map((s) => [
        s.effort.activity_name,
        formatDate(s.effort.date),
        formatDuration(s.effort.duration_seconds),
        formatPace(distance, s.effort.duration_seconds, sport),
        s.improvement === null ? 'first record' : formatImprovement(s.improvement),
      ]) as never,
      hovertemplate: `<b>${distanceLabel(distance, sport)}: %{customdata[2]}</b> (%{customdata[4]})<br>%{customdata[0]}<br>%{customdata[1]} · %{customdata[3]}<extra></extra>`,
    }))
    const paces = histories.flatMap((h) => h.steps.map((s) => pace(h.distance, s.effort.duration_seconds)))
    // Only the extremes: paceAxis trims outliers, but every record should stay in view
    const axis = paces.length ? paceAxis([Math.min(...paces), Math.max(...paces)], true, 6) : null
    return [
      traces,
      {
        title: { text: 'New personal records' },
        xaxis: { type: 'date', tickformat: '%b %Y' },
        // Pace per km, faster higher up
        yaxis: axis
          ? { title: { text: 'Pace (/km)' }, range: axis.range, tickvals: axis.tickvals, ticktext: axis.ticktext }
          : { title: { text: 'Pace (/km)' }, autorange: 'reversed' },
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.15, yanchor: 'top' },
        margin: { l: 70, r: 20, t: 50, b: 40 },
        hovermode: 'closest',
      },
    ]
  }, [histories, sport])

  return <Plot data={data} layout={layout} style={{ height: 440 }} />
}
