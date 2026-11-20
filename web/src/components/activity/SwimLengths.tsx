import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { sportColor } from '../../lib/format'
import { formatClock, heartRateAxis } from '../../lib/speed'
import type { SwimLength } from '../../lib/types'
import { Plot } from '../Plot'

const SWOLF_COLOR = '#f97316'

const average = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null)
const known = (values: (number | null)[]) => values.filter((v): v is number => v !== null && v > 0)

function lengthStats(lengths: SwimLength[]) {
  const strokes = known(lengths.map((l) => l.strokes))
  return {
    swolf: average(known(lengths.map((l) => l.swolf))),
    strokeRate: average(known(lengths.map((l) => l.stroke_rate))),
    totalStrokes: strokes.length ? strokes.reduce((s, v) => s + v, 0) : null,
  }
}

/** Seconds per length as bars, SWOLF as a line on its own axis on the right. */
function lengthsChart(lengths: SwimLength[]): [Data[], Partial<Layout>] {
  const x = lengths.map((l) => l.length)
  // One hover line per length: time, stroke type, strokes and stroke rate when known
  const custom = lengths.map((l) =>
    [
      `Time ${formatClock(l.seconds)}`,
      l.stroke,
      l.strokes !== null ? `${l.strokes} strokes` : null,
      l.stroke_rate !== null ? `${Math.round(l.stroke_rate)} spm` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  )
  const data: Data[] = [
    {
      type: 'bar',
      x,
      y: lengths.map((l) => l.seconds),
      name: 'Time per length',
      marker: { color: sportColor('swimming') },
      opacity: 0.85,
      customdata: custom as never,
      hovertemplate: '%{customdata}<extra></extra>',
    } as Data,
  ]
  const layout: Partial<Layout> = {
    title: { text: 'Pool lengths' },
    // Lengths are numbered #1, #2…; no axis title, which leaves the row below for the legend
    xaxis: { tickprefix: '#', hoverformat: 'd', dtick: lengths.length > 40 ? 10 : lengths.length > 16 ? 5 : 1 },
    yaxis: { title: { text: 'Seconds' } },
    // Below the chart, like the laps chart, so it never wraps into the title
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.12, yanchor: 'top', font: { size: 11 } },
    margin: { l: 60, r: 60, t: 45, b: 55 },
    hovermode: 'x unified',
  }
  if (lengths.some((l) => l.swolf !== null)) {
    data.push({
      type: 'scatter',
      mode: 'lines+markers',
      x,
      y: lengths.map((l) => l.swolf),
      name: 'SWOLF',
      yaxis: 'y2',
      line: { color: SWOLF_COLOR, width: 2 },
      marker: { size: 5 },
      connectgaps: false,
      hovertemplate: 'SWOLF %{y}<extra></extra>',
    } as Data)
    layout.yaxis2 = {
      title: { text: 'SWOLF' },
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      // Whole-number steps with headroom, like the heart-rate axes
      ...heartRateAxis(lengths.map((l) => l.swolf ?? 0)),
    }
  }
  return [data, layout]
}

/** Per-length analysis of a pool swim; renders nothing without lengths. */
export function SwimLengths({ lengths }: { lengths: SwimLength[] }) {
  const usable = useMemo(() => lengths.filter((l) => l.seconds > 0), [lengths])
  const chart = useMemo(() => lengthsChart(usable), [usable])
  if (!usable.length) return null
  const stats = lengthStats(usable)
  const tiles: [string, string][] = [['Lengths', String(usable.length)]]
  if (stats.swolf !== null) tiles.push(['Avg SWOLF', stats.swolf.toFixed(0)])
  if (stats.strokeRate !== null) tiles.push(['Avg stroke rate', `${stats.strokeRate.toFixed(0)} spm`])
  if (stats.totalStrokes !== null) tiles.push(['Total strokes', String(stats.totalStrokes)])

  return (
    <div className="card w-full chart-card">
      <div className="card-title" style={{ padding: '2px 4px 4px' }}>Swim lengths</div>
      <div className="stat-grid">
        {tiles.map(([label, value]) => (
          <div key={label} className="stat">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
          </div>
        ))}
      </div>
      <Plot data={chart[0]} layout={chart[1]} style={{ height: 340 }} />
    </div>
  )
}
