import { useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { api, qs } from '../lib/api'
import { isSwimming, sportColor, sportLabel } from '../lib/format'
import type { GraphStats, Totals } from '../lib/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { SelectField, SportSelect, YearSelect } from '../components/fields'
import { Plot, noDataLayout } from '../components/Plot'

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Metric = 'distance' | 'count' | 'time'

interface MetricConfig {
  label: string
  fmt: string
  unit: string
  value: (t: Totals) => number
}

/** Metric settings, switched to metres when only swimming is selected. */
function metricConfig(metric: Metric, sport: string): MetricConfig {
  if (metric === 'count') return { label: 'Activities', fmt: 'd', unit: '', value: (t) => t.count }
  if (metric === 'time')
    return { label: 'Time (h)', fmt: '.1f', unit: 'h', value: (t) => Math.round((t.duration_seconds / 3600) * 10) / 10 }
  if (isSwimming(sport)) return { label: 'Distance (m)', fmt: '.0f', unit: 'm', value: (t) => Math.round(t.distance_meters) }
  return { label: 'Distance (km)', fmt: '.1f', unit: 'km', value: (t) => Math.round(t.distance_meters / 100) / 10 }
}

export function GraphsPage() {
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [metric, setMetric] = useState<Metric>('distance')
  const [stats, setStats] = useState<GraphStats | null>(null)
  const latest = useLatestRequest()

  useEffect(() => {
    latest(api.get<GraphStats>(`/stats/graphs${qs({ sport, year })}`), setStats)
  }, [sport, year, latest])

  const charts = useMemo(() => {
    if (!stats) return null
    const mc = metricConfig(metric, sport)
    const color = sportColor(sport)
    const unit = mc.unit ? ` ${mc.unit}` : ''
    const hover = `<b>%{x}</b><br>${mc.label}: %{y:${mc.fmt}}${unit}<extra></extra>`
    const sportTitle = sport ? sportLabel(sport) : 'All Sports'

    const monthly: [Data[], Partial<Layout>] = stats.monthly.length
      ? [
          [
            {
              type: 'bar',
              x: stats.monthly.map((d) => `${MONTH_NAMES[d.month]} ${d.year}`),
              y: stats.monthly.map(mc.value),
              name: mc.label,
              marker: { color },
              opacity: 0.85,
              hovertemplate: hover,
            },
          ],
          {
            title: { text: `Monthly ${mc.label} – ${sportTitle}${year ? ` (${year})` : ''}` },
            xaxis: { title: { text: 'Month' } },
            yaxis: { title: { text: mc.label } },
            margin: { l: 50, r: 20, t: 50, b: 60 },
          },
        ]
      : [[], noDataLayout()]

    const yearly: [Data[], Partial<Layout>] = stats.yearly.length
      ? [
          [
            {
              type: 'bar',
              x: stats.yearly.map((d) => String(d.year)),
              y: stats.yearly.map(mc.value),
              name: mc.label,
              marker: { color },
              opacity: 0.85,
              hovertemplate: hover,
            },
          ],
          {
            title: { text: `Yearly ${mc.label} – ${sportTitle}` },
            xaxis: { title: { text: 'Year' }, type: 'category' },
            yaxis: { title: { text: mc.label } },
            margin: { l: 50, r: 20, t: 50, b: 40 },
          },
        ]
      : [[], noDataLayout()]

    const pie: [Data[], Partial<Layout>] = stats.by_sport.length
      ? [
          [
            {
              type: 'pie',
              labels: stats.by_sport.map((s) => sportLabel(s.sport)),
              values: stats.by_sport.map(mc.value),
              marker: { colors: stats.by_sport.map((s) => sportColor(s.sport, '#6b7280')) },
              hovertemplate: `<b>%{label}</b><br>%{value:${mc.fmt}}${unit} (%{percent})<extra></extra>`,
            },
          ],
          {
            title: { text: `${mc.label} by Sport${year ? ` (${year})` : ''}` },
            margin: { l: 20, r: 20, t: 50, b: 20 },
          },
        ]
      : [[], noDataLayout()]

    return { monthly, yearly, pie }
  }, [stats, metric, sport, year])

  return (
    <>
      <div className="row items-center justify-between w-full q-mb-md flex-wrap gap-3">
        <div className="text-h5 text-weight-bold">Graphs</div>
        <div className="row gap-2">
          <SportSelect value={sport} onChange={setSport} />
          <YearSelect value={year} onChange={setYear} />
          <SelectField
            label="Metric"
            width={128}
            value={metric}
            options={[
              ['distance', 'Distance'],
              ['count', 'Activities'],
              ['time', 'Time'],
            ]}
            onChange={(v) => setMetric(v as Metric)}
          />
        </div>
      </div>

      {charts && (
        <div className="column w-full gap-4">
          <div className="card w-full q-pa-sm">
            <Plot data={charts.monthly[0]} layout={charts.monthly[1]} style={{ height: 340 }} />
          </div>
          <div className="w-full graphs-grid">
            <div className="card w-full q-pa-sm">
              <Plot data={charts.yearly[0]} layout={charts.yearly[1]} style={{ height: 300 }} />
            </div>
            <div className="card w-full q-pa-sm">
              <Plot data={charts.pie[0]} layout={charts.pie[1]} style={{ height: 300 }} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
