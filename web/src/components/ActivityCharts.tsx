import { useEffect, useMemo, useState } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { Data, Layout } from 'plotly.js-dist-min'
import { api } from '../lib/api'
import { formatDistance, formatDuration, formatPace, isSwimming, sportColor } from '../lib/format'
import { paceAsTime } from '../lib/graphs'
import type { Activity, ActivityStreams, Lap } from '../lib/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { Plot } from './Plot'

// Sports shown as pace (time per km or per 100 m); everything else as speed in km/h
const PACE_SPORTS = new Set(['running', 'trail_running', 'walking', 'hiking', 'swimming'])
const ZONE_COLORS = ['#94a3b8', '#3b82f6', '#22c55e', '#f97316', '#ef4444']
const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'Maximum']

type Chart = [Data[], Partial<Layout>]
type XMode = 'distance' | 'time'
type Axis = NonNullable<Partial<Layout['yaxis']>>

const filled = (values: (number | null)[]) => values.filter((v) => v !== null).length >= values.length * 0.2
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Seconds per km (or per 100 m) for a speed, dropping standstills and implausible outliers. */
function paceSeries(speeds: (number | null)[], reference: number): (number | null)[] {
  const raw = speeds.map((s) => (s && s > 0.3 ? reference / s : null))
  const typical = median(raw.filter((p): p is number => p !== null))
  return raw.map((p) => (p !== null && p <= typical * 3 ? p : null))
}

function profileChart(activity: Activity, streams: ActivityStreams, xMode: XMode): Chart | null {
  const p = streams.points
  if (!p || !p.t.length) return null
  const sport = activity.sport
  const color = sportColor(sport, '#6b7280')
  const swim = isSwimming(sport)
  const byDistance = xMode === 'distance' && filled(p.distance)
  const x = byDistance
    ? p.distance.map((d) => (d === null ? null : swim ? Math.round(d) : d / 1000))
    : p.t.map(paceAsTime)
  const longActivity = p.t[p.t.length - 1] >= 3600
  const timeFormat = longActivity ? '%-H:%M:%S' : '%-M:%S'

  const rows: { trace: Partial<Data>; axis: Axis }[] = []
  if (filled(p.heart_rate)) {
    rows.push({
      trace: { y: p.heart_rate, name: 'Heart rate', line: { color: '#ef4444', width: 1.5 }, hovertemplate: '%{y:.0f} bpm' },
      axis: { title: { text: 'HR (bpm)' } },
    })
  }
  if (filled(p.speed)) {
    if (PACE_SPORTS.has(sport)) {
      const per = swim ? 100 : 1000
      const pace = paceSeries(p.speed, per)
      rows.push({
        trace: {
          y: pace.map((s) => (s === null ? null : paceAsTime(s))),
          name: 'Pace',
          line: { color, width: 1.5 },
          hovertemplate: `%{y|%-M:%S} /${swim ? '100m' : 'km'}`,
        },
        axis: { title: { text: `Pace (/${swim ? '100m' : 'km'})` }, type: 'date', tickformat: '%-M:%S', autorange: 'reversed' },
      })
    } else {
      rows.push({
        trace: {
          y: p.speed.map((s) => (s === null ? null : s * 3.6)),
          name: 'Speed',
          line: { color, width: 1.5 },
          hovertemplate: '%{y:.1f} km/h',
        },
        axis: { title: { text: 'Speed (km/h)' } },
      })
    }
  }
  if (filled(p.altitude)) {
    const altitudes = p.altitude.filter((a): a is number => a !== null)
    const low = Math.min(...altitudes)
    const high = Math.max(...altitudes)
    const pad = Math.max(5, (high - low) * 0.1)
    rows.push({
      trace: {
        y: p.altitude,
        name: 'Elevation',
        line: { color: '#10b981', width: 1 },
        fill: 'tozeroy',
        fillcolor: 'rgba(16, 185, 129, 0.18)',
        hovertemplate: '%{y:.0f} m',
      },
      axis: { title: { text: 'Elev. (m)' }, range: [low - pad, high + pad] },
    })
  }
  if (filled(p.cadence)) {
    const steps = PACE_SPORTS.has(sport) && !swim
    rows.push({
      trace: {
        y: p.cadence,
        name: 'Cadence',
        line: { color: '#8b5cf6', width: 1 },
        hovertemplate: `%{y:.0f} ${steps ? 'spm' : 'rpm'}`,
      },
      axis: { title: { text: steps ? 'Cadence (spm)' : 'Cadence (rpm)' } },
    })
  }
  if (filled(p.power)) {
    rows.push({
      trace: { y: p.power, name: 'Power', line: { color: '#3b82f6', width: 1 }, hovertemplate: '%{y:.0f} W' },
      axis: { title: { text: 'Power (W)' } },
    })
  }
  if (!rows.length) return null

  // Stack the rows top to bottom; they share the x-axis, which is drawn under the last one
  const gap = 0.04
  const height = (1 - gap * (rows.length - 1)) / rows.length
  const layout: Partial<Layout> & Record<string, unknown> = {
    hovermode: 'x unified',
    showlegend: false,
    margin: { l: 70, r: 20, t: 20, b: 45 },
    xaxis: {
      anchor: `y${rows.length === 1 ? '' : rows.length}` as never,
      title: { text: byDistance ? `Distance (${swim ? 'm' : 'km'})` : 'Time' },
      ...(byDistance ? {} : { type: 'date', tickformat: timeFormat }),
      hoverformat: byDistance ? (swim ? '.0f' : '.2f') : timeFormat,
    },
  }
  const data: Data[] = rows.map((row, i) => {
    const key = i === 0 ? '' : String(i + 1)
    const top = 1 - i * (height + gap)
    layout[`yaxis${key}`] = { ...row.axis, domain: [top - height, top], title: { ...(row.axis.title as object), font: { size: 11 } } }
    return {
      type: 'scatter',
      mode: 'lines',
      x,
      connectgaps: false,
      ...row.trace,
      yaxis: `y${key}`,
      hovertemplate: `${(row.trace as { hovertemplate: string }).hovertemplate}<extra>${row.trace.name}</extra>`,
    } as Data
  })
  return [data, layout]
}

function zonesChart(streams: ActivityStreams): Chart | null {
  const zones = streams.zones ?? []
  const total = zones.reduce((s, z) => s + z.seconds, 0)
  if (!total) return null
  const labels = zones.map((z, i) => `${z.zone} ${ZONE_NAMES[i]}<br>${i === zones.length - 1 ? `${z.low}+` : `${z.low}–${z.high}`} bpm`)
  return [
    [
      {
        type: 'bar',
        orientation: 'h',
        y: labels,
        x: zones.map((z) => z.seconds / 60),
        marker: { color: ZONE_COLORS },
        text: zones.map((z) => (z.seconds ? `${formatDuration(z.seconds)} · ${Math.round((z.seconds / total) * 100)}%` : '')),
        textposition: 'auto',
        hovertemplate: '%{y}<br>%{text}<extra></extra>',
      },
    ],
    {
      title: {
        text: 'Time in heart-rate zones',
        subtitle: {
          text: `Based on your highest recorded heart rate: ${streams.zone_max_hr} bpm`,
          font: { size: 11, color: '#9e9e9e' },
        },
      } as Partial<Layout['title']>,
      xaxis: { title: { text: 'Minutes' } },
      yaxis: { automargin: true },
      margin: { l: 20, r: 20, t: 70, b: 45 },
    },
  ]
}

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

function lapsChart(activity: Activity, laps: Lap[], streams: ActivityStreams | null): Chart | null {
  const usable = laps.filter((l) => l.distance_meters && l.duration_seconds)
  if (usable.length < 2) return null
  const sport = activity.sport
  const color = sportColor(sport, '#6b7280')
  const swim = isSwimming(sport)
  const pace = PACE_SPORTS.has(sport)
  const per = swim ? 100 : 1000
  // Bars show speed so faster laps are taller; for pace sports the axis is labelled in pace
  const speeds = usable.map((l) => l.distance_meters! / l.duration_seconds!)
  const low = Math.min(...speeds)
  const high = Math.max(...speeds)
  let yaxis: Partial<Layout['yaxis']> = { title: { text: 'Speed (km/h)' }, range: [low * 3.6 * 0.85, high * 3.6 * 1.05] }
  let y = speeds.map((s) => s * 3.6)
  if (pace) {
    y = speeds
    const slow = per / low
    const fast = per / high
    const step = slow - fast > 240 ? 60 : slow - fast > 90 ? 30 : 15
    const ticks: number[] = []
    for (let t = Math.ceil(fast / step) * step; t <= slow + step; t += step) ticks.push(t)
    yaxis = {
      title: { text: `Pace (/${swim ? '100m' : 'km'})` },
      range: [low * 0.85, high * 1.05],
      tickvals: ticks.map((t) => per / t),
      ticktext: ticks.map(mmss),
    }
  }
  const withHr = usable.some((l) => l.avg_heart_rate)
  const custom = usable.map((l) => [
    `Lap ${l.lap_number}`,
    formatDistance(l.distance_meters!, sport),
    formatDuration(l.duration_seconds!),
    pace ? formatPace(l.distance_meters!, l.duration_seconds!, sport) : `${((l.distance_meters! / l.duration_seconds!) * 3.6).toFixed(1)} km/h`,
  ])

  // Place each lap where it was run: centred on its stretch of distance, as wide as the lap
  const unit = swim ? 1 : 1000
  const starts: number[] = []
  let covered = 0
  for (const l of usable) {
    starts.push(covered)
    covered += l.distance_meters! / unit
  }
  const widths = usable.map((l) => l.distance_meters! / unit)
  const centres = starts.map((s, i) => s + widths[i] / 2)

  // The elevation profile sits behind the bars on a hidden axis, scaled to the lower part
  const p = streams?.available ? streams.points : undefined
  const profile =
    p && filled(p.distance) && filled(p.altitude)
      ? p.distance
          .map((d, i) => [d, p.altitude[i]] as const)
          .filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null)
      : []
  const hasProfile = profile.length > 1
  // Laps on y; the elevation profile on a hidden overlay axis (y2) so it is drawn on top of
  // the bars; heart rate on the next overlay axis on the right
  const hrAxis = hasProfile ? 'y3' : 'y2'

  const data: Data[] = [
    {
      type: 'bar',
      x: centres,
      width: widths.map((w) => w * 0.94),
      y,
      name: pace ? 'Pace' : 'Speed',
      marker: { color },
      opacity: 0.85,
      customdata: custom as never,
      hovertemplate: '<b>%{customdata[0]}</b>: %{customdata[1]} in %{customdata[2]} · %{customdata[3]}<extra></extra>',
    } as Data,
  ]
  const layout: Partial<Layout> & Record<string, unknown> = {
    title: { text: hasProfile ? 'Laps & elevation' : 'Laps' },
    xaxis: { title: { text: `Distance (${swim ? 'm' : 'km'})` }, range: [0, covered], hoverformat: swim ? '.0f' : '.2f' },
    yaxis,
    legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.12 },
    margin: { l: 60, r: 60, t: 50, b: 45 },
    hovermode: 'x unified',
  }

  if (hasProfile) {
    const altitudes = profile.map(([, a]) => a)
    const lowest = Math.min(...altitudes)
    const span = Math.max(Math.max(...altitudes) - lowest, 10)
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: profile.map(([d]) => d / unit),
      y: altitudes,
      yaxis: 'y2',
      name: 'Elevation',
      line: { color: '#047857', width: 2 },
      fill: 'tozeroy',
      fillcolor: 'rgba(16, 185, 129, 0.35)',
      hovertemplate: 'Elevation: %{y:.0f} m<extra></extra>',
    } as Data)
    // The profile fills the bottom ~40% of the chart, like a terrain strip under the bars
    layout.yaxis2 = {
      overlaying: 'y',
      visible: false,
      range: [lowest - span * 0.05, lowest + span / 0.4],
      fixedrange: true,
    }
  }

  if (withHr) {
    data.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: centres,
      y: usable.map((l) => l.avg_heart_rate),
      name: 'Avg HR',
      yaxis: hrAxis,
      line: { color: '#ef4444', width: 2 },
      marker: { size: 6 },
      hovertemplate: 'Avg HR: %{y} bpm<extra></extra>',
    } as Data)
    layout[`yaxis${hrAxis.slice(1)}`] = {
      title: { text: 'Avg HR (bpm)' },
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      tickformat: '.0f',
    }
  }
  return [data, layout]
}

/** Charts of one activity: the profile over distance or time, heart-rate zones and laps. */
export default function ActivityCharts({ activity, laps }: { activity: Activity; laps: Lap[] }) {
  const [streams, setStreams] = useState<ActivityStreams | null>(null)
  const [xMode, setXMode] = useState<XMode>('distance')
  const latest = useLatestRequest()

  useEffect(() => {
    setStreams(null)
    latest(api.get<ActivityStreams>(`/activities/${activity.id}/streams`), setStreams)
  }, [activity.id, latest])

  const profile = useMemo(() => (streams?.available ? profileChart(activity, streams, xMode) : null), [activity, streams, xMode])
  const zones = useMemo(() => (streams?.available ? zonesChart(streams) : null), [streams])
  const lapChart = useMemo(() => lapsChart(activity, laps, streams), [activity, laps, streams])
  const hasDistance = !!streams?.points && filled(streams.points.distance)

  if (!profile && !zones && !lapChart) return null

  return (
    <div className="column w-full gap-4 q-mb-md">
      {profile && (
        <div className="card w-full q-pa-sm gap-0">
          <div className="row items-center justify-between no-wrap w-full q-pa-xs">
            <span className="text-subtitle1 text-weight-bold" style={{ paddingLeft: 8 }}>Activity profile</span>
            {hasDistance && (
              <ToggleButtonGroup
                exclusive
                size="small"
                color="primary"
                value={xMode}
                aria-label="X-axis"
                onChange={(_, next: XMode | null) => next && setXMode(next)}
              >
                <ToggleButton value="distance" sx={{ px: 1.5, py: 0.25 }}>Distance</ToggleButton>
                <ToggleButton value="time" sx={{ px: 1.5, py: 0.25 }}>Time</ToggleButton>
              </ToggleButtonGroup>
            )}
          </div>
          <Plot
            data={profile[0]}
            layout={profile[1]}
            style={{ height: 70 + 130 * profile[0].length }}
          />
        </div>
      )}
      {(zones || lapChart) && (
        <div className={`w-full ${zones && lapChart ? 'graphs-grid' : ''}`}>
          {zones && (
            <div className="card w-full q-pa-sm">
              <Plot data={zones[0]} layout={zones[1]} style={{ height: 320 }} />
            </div>
          )}
          {lapChart && (
            <div className="card w-full q-pa-sm">
              <Plot data={lapChart[0]} layout={lapChart[1]} style={{ height: 320 }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
