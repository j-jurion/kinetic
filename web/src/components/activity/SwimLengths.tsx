import { useMemo } from 'react'
import { lengthStats, lengthsChart } from '@kinetic/shared/charts/activity'
import type { SwimLength } from '@kinetic/shared/types'
import { Plot } from '../Plot'

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
