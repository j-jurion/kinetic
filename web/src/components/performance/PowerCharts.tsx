import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { GOLD, formatDate, toIsoLocal } from '@kinetic/shared/format'
import { POWER_DURATIONS, bestCurve, durationLabel, monthsBefore } from '@kinetic/shared/performance'
import type { CurvePoint, FtpPoint } from '@kinetic/shared/performance'
import type { TrainingActivity } from '@kinetic/shared/types'
import { Plot, noDataLayout } from '../Plot'

type Chart = [Data[], Partial<Layout>]

interface Props {
  /** Activities of one power sport that have a power curve. */
  activities: TrainingActivity[]
  monthly: FtpPoint[]
  settings: { date: string; ftp: number }[]
  weight: number | null
  title: string
}

const legendBelow: Partial<Layout['legend']> = { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.18, yanchor: 'top' }

function curveChart(activities: TrainingActivity[], weight: number | null, title: string): Chart {
  const today = new Date()
  const lines: [string, CurvePoint[], string, number][] = [
    ['All time best', bestCurve(activities), GOLD, 3],
    ['Last 12 months', bestCurve(activities, monthsBefore(today, 12)), '#f97316', 2],
    ['Last 90 days', bestCurve(activities, new Date(today.getTime() - 90 * 86_400_000)), '#0ea5e9', 2],
  ]
  const heading = `Power curve – ${title}`
  const allTime = lines[0][1]
  if (!allTime.length) return [[], noDataLayout(heading)]
  const perKg = (w: number) => (weight ? ` · ${(w / weight).toFixed(2)} W/kg` : '')

  const traces: Data[] = lines
    .filter(([, points]) => points.length > 0)
    .map(([name, points, color, width]) => ({
      type: 'scatter',
      mode: 'lines+markers',
      name,
      x: points.map((p) => p.duration),
      y: points.map((p) => p.watts),
      line: { color, width, shape: 'spline' },
      marker: { color, size: 6 },
      customdata: points.map((p) => [
        durationLabel(p.duration),
        perKg(p.watts),
        p.activity.name,
        formatDate(p.activity.date),
      ]) as never,
      hovertemplate: `<b>${name}</b><br>%{customdata[0]}: %{y:.0f} W%{customdata[1]}<br>%{customdata[2]} · %{customdata[3]}<extra></extra>`,
    }))

  const top = Math.max(...allTime.map((p) => p.watts)) * 1.1
  const layout: Partial<Layout> = {
    title: { text: heading },
    xaxis: {
      type: 'log',
      title: { text: 'Duration' },
      tickvals: POWER_DURATIONS,
      ticktext: POWER_DURATIONS.map(durationLabel),
    },
    yaxis: { title: { text: 'Watts' }, range: [0, top] },
    legend: legendBelow,
    margin: { l: 60, r: weight ? 60 : 20, t: 50, b: 50 },
    hovermode: 'closest',
  }
  if (weight) {
    // A second scale in W/kg that lines up with the watts axis
    layout.yaxis2 = {
      title: { text: 'W/kg' },
      overlaying: 'y',
      side: 'right',
      range: [0, top / weight],
      showgrid: false,
      tickformat: '.1f',
    }
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: allTime.map((p) => p.duration),
      y: allTime.map((p) => p.watts / weight),
      yaxis: 'y2',
      marker: { opacity: 0 },
      showlegend: false,
      hoverinfo: 'skip',
    })
  }
  return [traces, layout]
}

function ftpChart(monthly: FtpPoint[], settings: { date: string; ftp: number }[], weight: number | null, title: string): Chart {
  const heading = `FTP over time – ${title}`
  if (!monthly.length && !settings.length) return [[], noDataLayout(heading)]
  const perKg = (w: number) => (weight ? ` (${(w / weight).toFixed(2)} W/kg)` : '')
  const traces: Data[] = []
  if (monthly.length) {
    traces.push({
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Estimated FTP (95% of best 20 min, 6 weeks)',
      x: monthly.map((m) => toIsoLocal(m.month)),
      y: monthly.map((m) => m.ftp),
      line: { color: '#f97316', width: 2.5 },
      marker: { color: '#f97316', size: 7 },
      customdata: monthly.map((m) => [perKg(m.ftp), m.activity.name, formatDate(m.activity.date)]) as never,
      hovertemplate:
        '<b>%{x|%b %Y}</b><br>Estimated FTP: %{y:.0f} W%{customdata[0]}<br>From %{customdata[1]} · %{customdata[2]}<extra></extra>',
    })
  }
  if (settings.length) {
    // Carry the latest setting through to today
    const x = [...settings.map((s) => s.date), toIsoLocal(new Date())]
    const y = [...settings.map((s) => s.ftp), settings[settings.length - 1].ftp]
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: 'Watch FTP setting',
      x,
      y,
      line: { color: '#6b7280', width: 2, dash: 'dash', shape: 'hv' },
      customdata: y.map(perKg) as never,
      hovertemplate: 'Watch FTP setting: %{y:.0f} W%{customdata}<extra></extra>',
    })
  }
  return [
    traces,
    {
      title: { text: heading },
      xaxis: { type: 'date', tickformat: '%b %Y' },
      yaxis: { title: { text: 'Watts' }, rangemode: 'tozero' },
      legend: legendBelow,
      margin: { l: 60, r: 20, t: 50, b: 40 },
      hovermode: 'closest',
    },
  ]
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
