import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { Data, Layout, PlotHoverEvent } from 'plotly.js-dist-min'
import { formatDistance, formatDuration, formatPace, isSwimming, sportColor } from '../lib/format'
import { paceAsTime } from '../lib/graphs'
import type { HoverBus } from '../lib/hoverBus'
import { PACE_SPORTS, formatClock, heartRateAxis, paceAxis } from '../lib/speed'
import type { Activity, ActivityStreams, Lap } from '../lib/types'
import { Plot } from './Plot'
import { AnalysisSummary } from './activity/AnalysisSummary'
import { ClimbsTable } from './activity/ClimbsTable'
import { SwimLengths } from './activity/SwimLengths'
import { indexAtDistance } from './activity/streamIndex'

const ZONE_COLORS = ['#94a3b8', '#3b82f6', '#22c55e', '#f97316', '#ef4444']
const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'Maximum']
// Coggan Z1–Z7: the heart-rate colours, stretched with a yellow and a purple for the extra zones
const POWER_ZONE_COLORS = ['#94a3b8', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7']
const DYNAMICS_COLOR = '#8b5cf6'

type Chart = [Data[], Partial<Layout>]
type XMode = 'distance' | 'time'
type Axis = NonNullable<Partial<Layout['yaxis']>>

/** True when at least a fifth of the points have a value (older activities lack some series). */
const filled = (values: (number | null)[] | undefined): values is (number | null)[] =>
  !!values?.length && values.filter((v) => v !== null).length >= values.length * 0.2
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

const numbers = (values: (number | null)[]) => values.filter((v): v is number => v !== null)

interface ProfileRow {
  traces: Partial<Data>[]
  axis: Axis
  /** Relative height: the main rows are 1, the running-dynamics and temperature rows less. */
  weight: number
}

const ROW_PX = 130
const COMPACT = 0.65
const ROW_GAP_PX = 16
const PROFILE_MARGIN = { l: 70, r: 20, t: 20, b: 45 }

/** A row with one line; `hover` is the value part of its hover label. */
function lineRow(
  y: (number | null)[],
  name: string,
  color: string,
  hover: string,
  title: string,
  { weight = 1, width = 1 }: { weight?: number; width?: number } = {},
): ProfileRow {
  return {
    traces: [{ y, name, line: { color, width }, hovertemplate: hover }],
    // Compact rows only have room for a few labels
    axis: { title: { text: title }, ...(weight < 1 ? { nticks: 3 } : {}) },
    weight,
  }
}

/** Pace on a reversed m:ss axis, with the grade-adjusted pace as a dotted line for runs. */
function paceRow(sport: string, p: NonNullable<ActivityStreams['points']>, color: string): ProfileRow {
  const swim = isSwimming(sport)
  const per = swim ? 100 : 1000
  const suffix = ` /${swim ? '100m' : 'km'}`
  const asClock = (series: (number | null)[]) => series.map((s) => (s === null ? '' : formatClock(s) + suffix)) as never
  const pace = paceSeries(p.speed, per)
  const traces: Partial<Data>[] = [
    { y: pace, customdata: asClock(pace), name: 'Pace', line: { color, width: 1.5 }, hovertemplate: '%{customdata}' },
  ]
  // What the effort would have been on the flat; only running sports get this series
  const gradeAdjusted = !swim && filled(p.grade_adjusted_speed) ? paceSeries(p.grade_adjusted_speed, per) : null
  if (gradeAdjusted) {
    traces.push({
      y: gradeAdjusted,
      customdata: asClock(gradeAdjusted),
      name: 'Grade-adjusted pace',
      line: { color, width: 1, dash: 'dot' },
      opacity: 0.8,
      hovertemplate: '%{customdata}',
    })
  }
  // The profile rows are short, so fewer labels; both lines count towards the range
  const axis = paceAxis([...numbers(pace), ...numbers(gradeAdjusted ?? [])], true, 3)
  return {
    traces,
    axis: {
      title: { text: `Pace (/${swim ? '100m' : 'km'})` },
      ...(axis ? { range: axis.range, tickvals: axis.tickvals, ticktext: axis.ticktext } : { autorange: 'reversed' }),
    },
    weight: 1,
  }
}

function profileChart(activity: Activity, streams: ActivityStreams, xMode: XMode): { chart: Chart; height: number } | null {
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

  // Heart rate, pace or speed, elevation, cadence, power, then running dynamics and temperature
  const rows: ProfileRow[] = []
  if (filled(p.heart_rate)) {
    rows.push(lineRow(p.heart_rate, 'Heart rate', '#ef4444', '%{y:.0f} bpm', 'HR (bpm)', { width: 1.5 }))
  }
  if (filled(p.speed)) {
    if (PACE_SPORTS.has(sport)) {
      rows.push(paceRow(sport, p, color))
    } else {
      const kmh = p.speed.map((s) => (s === null ? null : s * 3.6))
      rows.push(lineRow(kmh, 'Speed', color, '%{y:.1f} km/h', 'Speed (km/h)', { width: 1.5 }))
    }
  }
  if (filled(p.altitude)) {
    const altitudes = numbers(p.altitude)
    const low = Math.min(...altitudes)
    const high = Math.max(...altitudes)
    const pad = Math.max(5, (high - low) * 0.1)
    rows.push({
      traces: [
        {
          y: p.altitude,
          name: 'Elevation',
          line: { color: '#10b981', width: 1 },
          fill: 'tozeroy',
          fillcolor: 'rgba(16, 185, 129, 0.18)',
          hovertemplate: '%{y:.0f} m',
        },
      ],
      axis: { title: { text: 'Elev. (m)' }, range: [low - pad, high + pad] },
      weight: 1,
    })
  }
  if (filled(p.cadence)) {
    const unit = PACE_SPORTS.has(sport) && !swim ? 'spm' : 'rpm'
    rows.push(lineRow(p.cadence, 'Cadence', '#8b5cf6', `%{y:.0f} ${unit}`, `Cadence (${unit})`))
  }
  if (filled(p.power)) rows.push(lineRow(p.power, 'Power', '#3b82f6', '%{y:.0f} W', 'Power (W)'))
  // These change slowly, so their rows are compact, with short axis titles that fit their height
  const compact = { weight: COMPACT }
  if (filled(p.step_length)) {
    rows.push(lineRow(p.step_length, 'Step length', DYNAMICS_COLOR, '%{y:.2f} m', 'Step (m)', compact))
  }
  if (filled(p.ground_contact)) {
    rows.push(lineRow(p.ground_contact, 'Ground contact', DYNAMICS_COLOR, '%{y:.0f} ms', 'GCT (ms)', compact))
  }
  if (filled(p.vertical_oscillation)) {
    rows.push(lineRow(p.vertical_oscillation, 'Vertical oscillation', DYNAMICS_COLOR, '%{y:.1f} cm', 'V. osc. (cm)', compact))
  }
  if (filled(p.vertical_ratio)) {
    rows.push(lineRow(p.vertical_ratio, 'Vertical ratio', DYNAMICS_COLOR, '%{y:.1f}%', 'V. ratio (%)', compact))
  }
  if (filled(p.temperature)) {
    rows.push(lineRow(p.temperature, 'Temperature', '#f59e0b', '%{y:.1f} °C', 'Temp (°C)', compact))
  }
  if (!rows.length) return null

  // Stack the rows top to bottom in fixed pixel heights, so compact rows stay compact however
  // many there are; they share the x-axis, which is drawn under the last one
  const plotPx = rows.reduce((sum, r) => sum + r.weight * ROW_PX, 0) + ROW_GAP_PX * (rows.length - 1)
  const layout: Partial<Layout> & Record<string, unknown> = {
    hovermode: 'x unified',
    showlegend: false,
    margin: PROFILE_MARGIN,
    xaxis: {
      anchor: `y${rows.length === 1 ? '' : rows.length}` as never,
      title: { text: byDistance ? `Distance (${swim ? 'm' : 'km'})` : 'Time' },
      ...(byDistance ? {} : { type: 'date', tickformat: timeFormat }),
      hoverformat: byDistance ? (swim ? '.0f' : '.2f') : timeFormat,
    },
  }
  const data: Data[] = []
  let offsetPx = 0
  rows.forEach((row, i) => {
    const key = i === 0 ? '' : String(i + 1)
    const top = 1 - offsetPx / plotPx
    offsetPx += row.weight * ROW_PX
    const bottom = Math.max(0, 1 - offsetPx / plotPx)
    offsetPx += ROW_GAP_PX
    layout[`yaxis${key}`] = { ...row.axis, domain: [bottom, top], title: { ...(row.axis.title as object), font: { size: 11 } } }
    for (const trace of row.traces) {
      data.push({
        type: 'scatter',
        mode: 'lines',
        x,
        connectgaps: false,
        ...trace,
        yaxis: `y${key}`,
        hovertemplate: `${(trace as { hovertemplate: string }).hovertemplate}<extra>${trace.name}</extra>`,
      } as Data)
    }
  })
  return { chart: [data, layout], height: Math.round(plotPx + PROFILE_MARGIN.t + PROFILE_MARGIN.b) }
}

/** Horizontal bars of the time in each zone, the highest zone at the top. */
function zoneBars(labels: string[], seconds: number[], colors: string[], title: string, subtitle: string): Chart | null {
  const total = seconds.reduce((s, z) => s + z, 0)
  if (!total) return null
  return [
    [
      {
        type: 'bar',
        orientation: 'h',
        y: labels,
        x: seconds.map((s) => s / 60),
        marker: { color: colors.slice(0, seconds.length) },
        text: seconds.map((s) => (s ? `${formatDuration(s)} · ${Math.round((s / total) * 100)}%` : '')),
        textposition: 'auto',
        hovertemplate: '%{y}<br>%{text}<extra></extra>',
      },
    ],
    {
      title: { text: title, subtitle: { text: subtitle, font: { size: 11, color: '#9e9e9e' } } } as Partial<Layout['title']>,
      xaxis: { title: { text: 'Minutes' } },
      yaxis: { automargin: true },
      margin: { l: 20, r: 20, t: 70, b: 45 },
    },
  ]
}

function zonesChart(streams: ActivityStreams): Chart | null {
  const zones = streams.zones ?? []
  const labels = zones.map((z, i) => `${z.zone} ${ZONE_NAMES[i]}<br>${i === zones.length - 1 ? `${z.low}+` : `${z.low}–${z.high}`} bpm`)
  const subtitle =
    streams.zone_source === 'watch'
      ? `Based on your watch's max heart rate: ${streams.zone_max_hr} bpm`
      : `Based on your highest recorded heart rate: ${streams.zone_max_hr} bpm`
  return zoneBars(labels, zones.map((z) => z.seconds), ZONE_COLORS, 'Time in heart-rate zones', subtitle)
}

function powerZonesChart(streams: ActivityStreams): Chart | null {
  const zones = streams.power_zones ?? []
  const labels = zones.map((z) => `${z.zone} ${z.name}<br>${z.high === null ? `${z.low}+` : `${z.low}–${z.high}`} W`)
  const subtitle = streams.ftp ? `Based on your FTP: ${Math.round(streams.ftp)} W` : 'Based on your FTP'
  return zoneBars(labels, zones.map((z) => z.seconds), POWER_ZONE_COLORS, 'Time in power zones', subtitle)
}


function lapsChart(activity: Activity, laps: Lap[], streams: ActivityStreams | null): Chart | null {
  const usable = laps.filter((l) => l.distance_meters && l.duration_seconds)
  if (usable.length < 2) return null
  const sport = activity.sport
  const color = sportColor(sport, '#6b7280')
  const swim = isSwimming(sport)
  const pace = PACE_SPORTS.has(sport)
  const per = swim ? 100 : 1000
  // Faster laps are taller bars. Speed sports plot km/h. Pace sports plot the pace itself on
  // a reversed axis (faster up) so the labels are evenly spaced; each bar rises from a slow
  // baseline at the bottom up to the lap's pace.
  const speeds = usable.map((l) => l.distance_meters! / l.duration_seconds!)
  const low = Math.min(...speeds)
  const high = Math.max(...speeds)
  let yaxis: Partial<Layout['yaxis']> = { title: { text: 'Speed (km/h)' }, range: [low * 3.6 * 0.85, high * 3.6 * 1.05] }
  let y = speeds.map((s) => s * 3.6)
  let base: number | undefined
  const paces = speeds.map((s) => per / s)
  // Every lap counts towards the range, and the unlabelled baseline keeps clear of the x labels
  const axis = pace ? paceAxis([Math.min(...paces), Math.max(...paces)], false) : null
  if (axis) {
    base = axis.slow
    y = paces.map((p) => p - axis.slow)
    yaxis = {
      title: { text: `Pace (/${swim ? '100m' : 'km'})` },
      range: axis.range,
      tickvals: axis.tickvals,
      ticktext: axis.ticktext,
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
      base,
      name: pace ? 'Pace' : 'Speed',
      marker: { color },
      opacity: 0.85,
      customdata: custom as never,
      hovertemplate: '<b>%{customdata[0]}</b>: %{customdata[1]} in %{customdata[2]} · %{customdata[3]}<extra></extra>',
    } as Data,
  ]
  const layout: Partial<Layout> & Record<string, unknown> = {
    title: { text: hasProfile ? 'Laps & elevation' : 'Laps' },
    // The unit is in the tick labels, which leaves the row under the axis for the legend
    xaxis: { ticksuffix: swim ? ' m' : ' km', range: [0, covered], hoverformat: swim ? '.0f' : '.2f' },
    yaxis,
    // Below the chart: in a half-width card a legend at the top wraps into the title and plot
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.12, yanchor: 'top', font: { size: 11 } },
    margin: { l: 60, r: 60, t: 45, b: 55 },
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
    // Whole-number ticks (rounded 2.5 steps read as 134, 136, 139…) and headroom above the line
    layout[`yaxis${hrAxis.slice(1)}`] = {
      title: { text: 'Avg HR (bpm)' },
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      ...heartRateAxis(usable.map((l) => l.avg_heart_rate ?? 0)),
    }
  }
  return [data, layout]
}

interface Props {
  activity: Activity
  laps: Lap[]
  /** Null while loading. */
  streams: ActivityStreams | null
  /** Receives the hovered stream point, so the map can show where it was. */
  hoverBus: HoverBus
}

/**
 * Charts of one activity: derived metrics, the profile over distance or time, heart-rate and
 * power zones, laps, pool lengths and climbs. Each part is left out when its data is missing.
 */
export default function ActivityCharts({ activity, laps, streams, hoverBus }: Props) {
  const [xMode, setXMode] = useState<XMode>('distance')

  const ready = streams?.available ? streams : null
  const profile = useMemo(() => (ready ? profileChart(activity, ready, xMode) : null), [activity, ready, xMode])
  const zones = useMemo(() => (ready ? zonesChart(ready) : null), [ready])
  const powerZones = useMemo(() => (ready ? powerZonesChart(ready) : null), [ready])
  const lapChart = useMemo(() => lapsChart(activity, laps, streams), [activity, laps, streams])
  const hasDistance = !!streams?.points && filled(streams.points.distance)
  const lengths = ready?.lengths ?? []
  const climbs = ready?.climbs ?? []

  // Every profile row is drawn from the stream points, so a point's index is the stream index
  const onProfileHover = useCallback(
    (event: PlotHoverEvent) => hoverBus.set(event.points[0]?.pointIndex ?? null),
    [hoverBus],
  )
  // The laps chart is on a distance axis; prefer the elevation trace, which follows the pointer
  const onLapsHover = useCallback(
    (event: PlotHoverEvent) => {
      const distances = streams?.points?.distance
      if (!distances) return
      const point = event.points.find((p) => p.data.name === 'Elevation') ?? event.points[0]
      if (!point || typeof point.x !== 'number') return
      const unit = isSwimming(activity.sport) ? 1 : 1000
      hoverBus.set(indexAtDistance(distances, point.x * unit))
    },
    [hoverBus, streams, activity.sport],
  )
  const onUnhover = useCallback(() => hoverBus.set(null), [hoverBus])

  if (!ready && !lapChart) return null

  const zoneCards = (
    [
      ['heart-rate', zones],
      ['power', powerZones],
    ] as const
  ).flatMap(([key, chart]) =>
    chart
      ? [
          <div key={key} className="card w-full chart-card">
            <Plot data={chart[0]} layout={chart[1]} style={{ height: 340 }} />
          </div>,
        ]
      : [],
  )
  const lapCard = lapChart && (
    <div key="laps" className="card w-full chart-card">
      <Plot data={lapChart[0]} layout={lapChart[1]} style={{ height: 340 }} onHover={onLapsHover} onUnhover={onUnhover} />
    </div>
  )
  // Two zone charts sit side by side with the laps full width below; otherwise one zone chart
  // and the laps share a row
  const grid = (cards: ReactNode[]) =>
    cards.length > 0 && <div className={`w-full ${cards.length === 2 ? 'graphs-grid' : ''}`}>{cards}</div>

  return (
    <div className="column w-full gap-4 q-mb-md">
      {ready && <AnalysisSummary activity={activity} streams={ready} />}
      {profile && (
        <div className="card w-full chart-card">
          <div className="row items-center justify-between no-wrap w-full q-pa-xs">
            <span className="card-title" style={{ paddingLeft: 4 }}>Activity profile</span>
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
            data={profile.chart[0]}
            layout={profile.chart[1]}
            style={{ height: profile.height }}
            onHover={onProfileHover}
            onUnhover={onUnhover}
          />
        </div>
      )}
      {zoneCards.length === 2 ? (
        <>
          {grid(zoneCards)}
          {lapCard}
        </>
      ) : (
        grid(lapCard ? [...zoneCards, lapCard] : zoneCards)
      )}
      {lengths.length > 0 && <SwimLengths lengths={lengths} />}
      {climbs.length > 0 && <ClimbsTable climbs={climbs} distances={ready?.points?.distance} hoverBus={hoverBus} />}
    </div>
  )
}
