// The charts on the Graphs page, shared by the web and mobile apps.
//
// Both apps render GRAPHS_PAGE in order, so adding, removing or reordering an entry here
// changes the page in both. The apps only supply the UI around each chart: the card, the
// controls and the Plotly renderer.
import type { Data } from 'plotly.js-dist-min'
import { qs } from '../api'
import {
  ALL_RUNNING,
  GOLD,
  distanceLabel,
  formatDate,
  formatDuration,
  formatPace,
  isSwimming,
  kindLabel,
  sportColor,
  sportLabel,
  toIsoLocal,
} from '../format'
import {
  KIND_COLORS,
  cumulativeByYear,
  inYear,
  metricConfig,
  monthlyTotals,
  paceAsTime,
  paceTrend,
  personalBestProgression,
  rollingAverage,
  totalsBy,
  weeklyTotals,
  yearlyTotals,
} from '../graphs'
import type { Metric, MetricConfig } from '../graphs'
import { formatClock, heartRateAxis, paceAxis } from '../speed'
import type { BestEffortRow, GraphPoint, GraphStats } from '../types'
import { noDataLayout } from './theme'
import type { ChartSpec } from './theme'

/** The page-wide filters, chosen above the charts. */
export interface GraphsFilters {
  sport: string
  year: number | null
  metric: Metric
}

/** The data the page loads; null while a request is still running. */
export interface GraphsData {
  stats: GraphStats | null
  efforts: BestEffortRow[] | null
}

/** The API requests behind GraphsData. The year filter is applied on the device for stats. */
export const graphsPageRequests = {
  stats: (f: GraphsFilters) => `/stats/graphs${qs({ sport: f.sport })}`,
  // Distances only compare within one sport, so "All sports" shows running
  efforts: (f: GraphsFilters) => `/best-efforts${qs({ sport: f.sport || ALL_RUNNING, year: f.year })}`,
}

export const METRIC_OPTIONS: [Metric, string][] = [
  ['distance', 'Distance'],
  ['count', 'Activities'],
  ['time', 'Time'],
  ['elevation', 'Elevation'],
]

/** A choice that belongs to one chart, e.g. weekly / monthly / yearly. */
export interface ChartControl {
  key: string
  label: string
  /** Shown as a toggle group, or as a dropdown when there can be many options. */
  style: 'toggle' | 'select'
  options: (filters: GraphsFilters, data: GraphsData) => [string, string][]
  /** The value used when none is chosen yet or the chosen one is no longer an option. */
  defaultValue: (options: [string, string][]) => string | undefined
}

/** What a chart card shows: the chart, a message instead of it, or nothing while loading. */
export type ChartContent =
  | { kind: 'chart'; chart: ChartSpec }
  | { kind: 'message'; title: string; message: string }
  | null

export interface GraphDefinition {
  id: string
  /** Chart height in pixels. */
  height: number
  /** Consecutive charts with the same group sit side by side on wide screens. */
  group?: string
  controls?: ChartControl[]
  build: (filters: GraphsFilters, data: GraphsData, controls: Record<string, string>) => ChartContent
}

/** The value of each control: the chosen one while it is still an option, else the default. */
export function resolveControls(
  graph: GraphDefinition,
  filters: GraphsFilters,
  data: GraphsData,
  chosen: Record<string, string>,
): { values: Record<string, string>; options: Record<string, [string, string][]> } {
  const values: Record<string, string> = {}
  const options: Record<string, [string, string][]> = {}
  for (const control of graph.controls ?? []) {
    const list = control.options(filters, data)
    options[control.key] = list
    const current = chosen[control.key]
    const value = current !== undefined && list.some(([v]) => v === current) ? current : control.defaultValue(list)
    if (value !== undefined) values[control.key] = value
  }
  return { values, options }
}

// Colours for the earlier years on the year-over-year chart; the highlighted year uses the sport colour
const YEAR_COLORS = ['#94a3b8', '#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6']
// Activities averaged together in the pace trend line
const PACE_WINDOW = 10

type Period = 'weekly' | 'monthly' | 'yearly'
type Breakdown = 'sport' | 'kind'

const chart = (data: Data[], layout: ChartSpec['layout']): ChartContent => ({ kind: 'chart', chart: { data, layout } })
const sportTitle = (sport: string) => (sport ? sportLabel(sport) : 'All Sports')
const yearSuffix = (year: number | null) => (year ? ` (${year})` : '')

const hoverFor = (mc: MetricConfig, x: string) =>
  `<b>${x}</b><br>${mc.label}: %{y:${mc.fmt}}${mc.unit ? ` ${mc.unit}` : ''}<extra></extra>`

/** Weekly, monthly or yearly volume as bars with an average line. */
function volumeChart(points: GraphPoint[], period: Period, mc: MetricConfig, color: string, title: string, year: number | null): ChartContent {
  const unit = mc.unit ? ` ${mc.unit}` : ''
  let x: string[]
  let y: number[]
  let average: number[]
  let averageName: string
  let xaxis: ChartSpec['layout']['xaxis']
  let hoverX: string
  let heading: string

  if (period === 'weekly') {
    const weeks = weeklyTotals(points, year)
    x = weeks.map((w) => toIsoLocal(w.start))
    y = weeks.map(mc.value)
    average = rollingAverage(y, 4)
    averageName = '4-week average'
    xaxis = { type: 'date', tickformat: '%d %b' }
    hoverX = 'Week of %{x|%d-%m-%Y}'
    heading = `Weekly ${mc.label} – ${title}${year ? ` (${year})` : ' (last 52 weeks)'}`
  } else if (period === 'monthly') {
    const months = monthlyTotals(points, year)
    x = months.map((m) => toIsoLocal(m.start))
    y = months.map(mc.value)
    average = rollingAverage(y, 3)
    averageName = '3-month average'
    xaxis = { type: 'date', tickformat: '%b %Y', dtick: year ? 'M1' : undefined }
    hoverX = '%{x|%b %Y}'
    heading = `Monthly ${mc.label} – ${title}${yearSuffix(year)}`
  } else {
    const years = yearlyTotals(points)
    x = years.map((t) => String(t.year))
    y = years.map(mc.value)
    const mean = y.length ? y.reduce((s, v) => s + v, 0) / y.length : 0
    average = y.map(() => mean)
    averageName = 'Average per year'
    xaxis = { type: 'category' }
    hoverX = '%{x}'
    heading = `Yearly ${mc.label} – ${title}`
  }

  if (!y.some((v) => v > 0)) return chart([], noDataLayout(heading))
  return chart(
    [
      { type: 'bar', x, y, name: mc.label, marker: { color }, opacity: 0.85, hovertemplate: hoverFor(mc, hoverX) },
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: average,
        name: averageName,
        line: { color: '#6b7280', width: 2, dash: 'dot', shape: period === 'yearly' ? 'linear' : 'spline' },
        hovertemplate: `${averageName}: %{y:.1f}${unit}<extra></extra>`,
      },
    ],
    {
      title: { text: heading },
      xaxis,
      yaxis: { title: { text: mc.label } },
      legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.12 },
      margin: { l: 50, r: 20, t: 60, b: 50 },
    },
  )
}

const volume: GraphDefinition = {
  id: 'volume',
  height: 340,
  controls: [
    {
      key: 'period',
      label: 'Period',
      style: 'toggle',
      options: () => [
        ['weekly', 'Weekly'],
        ['monthly', 'Monthly'],
        ['yearly', 'Yearly'],
      ],
      defaultValue: () => 'monthly',
    },
  ],
  build: ({ sport, year, metric }, { stats }, { period }) =>
    stats &&
    volumeChart(stats.activities, period as Period, metricConfig(metric, sport), sportColor(sport), sportTitle(sport), year),
}

/** Year-over-year running total. */
const cumulative: GraphDefinition = {
  id: 'cumulative',
  height: 360,
  group: 'year-and-breakdown',
  build: ({ sport, year, metric }, { stats }) => {
    if (!stats) return null
    const mc = metricConfig(metric, sport)
    const unit = mc.unit ? ` ${mc.unit}` : ''
    const color = sportColor(sport)
    const progress = cumulativeByYear(stats.activities, mc)
    if (!progress.length) return chart([], noDataLayout())
    const highlighted = year ?? progress[progress.length - 1]?.year
    return chart(
      progress.map((p, i): Data => {
        const main = p.year === highlighted
        return {
          type: 'scatter',
          mode: 'lines',
          x: p.x,
          y: p.y,
          name: String(p.year),
          line: { color: main ? color : YEAR_COLORS[i % YEAR_COLORS.length], width: main ? 3.5 : 1.5, shape: 'hv' },
          opacity: main ? 1 : 0.7,
          hovertemplate: `<b>${p.year}</b> · %{x|%d %b}<br>${mc.label}: %{y:${mc.fmt}}${unit}<extra></extra>`,
        }
      }),
      {
        title: { text: `${mc.label} through the year – ${sportTitle(sport)}` },
        xaxis: { type: 'date', tickformat: '%b', range: ['2000-01-01', '2000-12-31'], dtick: 'M1' },
        yaxis: { title: { text: `Total ${mc.label.toLowerCase()}` } },
        legend: { orientation: 'h', y: -0.15 },
        margin: { l: 55, r: 20, t: 50, b: 40 },
      },
    )
  },
}

/** Breakdown by sport or by training type. */
const breakdown: GraphDefinition = {
  id: 'breakdown',
  height: 320,
  group: 'year-and-breakdown',
  controls: [
    {
      key: 'breakdown',
      label: 'Breakdown',
      style: 'toggle',
      options: () => [
        ['sport', 'Sport'],
        ['kind', 'Training type'],
      ],
      defaultValue: () => 'sport',
    },
  ],
  build: ({ sport, year, metric }, { stats }, controls) => {
    if (!stats) return null
    const by = controls.breakdown as Breakdown
    const mc = metricConfig(metric, sport)
    const unit = mc.unit ? ` ${mc.unit}` : ''
    const parts = totalsBy(inYear(stats.activities, year), by, mc)
    const title = `${mc.label} by ${by === 'sport' ? 'Sport' : 'Training Type'}${yearSuffix(year)}`
    if (!parts.length) return chart([], noDataLayout(title))
    return chart(
      [
        {
          type: 'pie',
          hole: 0.45,
          sort: false,
          labels: parts.map((p) => (by === 'sport' ? sportLabel(p.key) : kindLabel(p.key))),
          values: parts.map((p) => p.value),
          marker: {
            colors: parts.map((p) => (by === 'sport' ? sportColor(p.key, '#6b7280') : (KIND_COLORS[p.key] ?? '#94a3b8'))),
          },
          hovertemplate: `<b>%{label}</b><br>%{value:${mc.fmt}}${unit} (%{percent})<extra></extra>`,
        },
      ],
      { title: { text: title }, margin: { l: 20, r: 20, t: 50, b: 20 } },
    )
  },
}

/** Every best-effort time at one distance over time, with races and the personal-best line. */
const distanceResults: GraphDefinition = {
  id: 'distance-results',
  height: 360,
  controls: [
    {
      key: 'distance',
      label: 'Distance',
      style: 'select',
      options: ({ sport }, { efforts }) => {
        const resultsSport = sport || ALL_RUNNING
        return [...new Set((efforts ?? []).map((e) => e.distance_meters))]
          .sort((a, b) => a - b)
          .map((d): [string, string] => [String(d), distanceLabel(d, resultsSport)])
      },
      // Prefer 5 km
      defaultValue: (options) => (options.some(([v]) => v === '5000') ? '5000' : options[0]?.[0]),
    },
  ],
  build: ({ sport, year }, { efforts }, controls) => {
    if (!efforts) return null
    const resultsSport = sport || ALL_RUNNING
    if (controls.distance === undefined) {
      return {
        kind: 'message',
        title: 'Distance results',
        message: `No ${sportLabel(resultsSport).toLowerCase()} best efforts${year ? ` in ${year}` : ''} yet.`,
      }
    }
    const selected = Number(controls.distance)
    const label = distanceLabel(selected, resultsSport)
    const color = sportColor(resultsSport)
    const rows = efforts.filter((e) => e.distance_meters === selected).sort((a, b) => a.date.localeCompare(b.date))
    const times = rows.map((r) => r.duration_seconds)
    const tickformat = Math.max(...times) >= 3600 ? '%-H:%M:%S' : '%-M:%S'
    const custom = (list: BestEffortRow[]) =>
      list.map((r) => [
        r.activity_name,
        formatDate(r.date),
        formatDuration(r.duration_seconds),
        formatPace(r.distance_meters, r.duration_seconds, r.sport),
      ]) as never
    const hover = '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Time: %{customdata[2]} (%{customdata[3]})<extra></extra>'
    const isRace = (r: BestEffortRow) => r.is_race ?? r.kind === 'race'
    const races = rows.filter(isRace)
    const others = rows.filter((r) => !isRace(r))

    return chart(
      [
        {
          type: 'scatter',
          mode: 'markers',
          x: others.map((r) => r.date),
          y: others.map((r) => paceAsTime(r.duration_seconds)),
          name: 'Training',
          marker: { color, size: 8, opacity: 0.6 },
          customdata: custom(others),
          hovertemplate: hover,
        },
        {
          type: 'scatter',
          mode: 'markers',
          x: races.map((r) => r.date),
          y: races.map((r) => paceAsTime(r.duration_seconds)),
          name: 'Race',
          marker: { color: GOLD, size: 12, symbol: 'diamond', line: { color: '#7e4a18', width: 1 } },
          customdata: custom(races),
          hovertemplate: hover,
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: rows.map((r) => r.date),
          y: personalBestProgression(times).map(paceAsTime),
          name: 'Personal best',
          line: { color: '#6b7280', width: 2, shape: 'hv', dash: 'dot' },
          hovertemplate: `Personal best: %{y|${tickformat}}<extra></extra>`,
        },
      ],
      {
        title: { text: `${label} results – ${sportLabel(resultsSport)}${yearSuffix(year)}` },
        xaxis: { type: 'date', tickformat: '%b %Y' },
        // Faster times higher up
        yaxis: { title: { text: 'Time' }, type: 'date', tickformat, autorange: 'reversed' },
        legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.12 },
        margin: { l: 70, r: 20, t: 60, b: 40 },
      },
    )
  },
}

/** Pace and heart-rate trend (only meaningful within one sport). */
const paceAndHeartRate: GraphDefinition = {
  id: 'pace-heart-rate',
  height: 360,
  build: ({ sport, year }, { stats }) => {
    if (!sport) {
      return {
        kind: 'message',
        title: 'Pace & Heart Rate',
        message: 'Pick a sport to see how your pace and heart rate develop.',
      }
    }
    if (!stats) return null
    const title = sportTitle(sport)
    const trend = paceTrend(inYear(stats.activities, year), sport)
    if (!trend.length) return chart([], noDataLayout(`Pace & Heart Rate – ${title}`))
    const color = sportColor(sport)
    const per = isSwimming(sport) ? '/100m' : '/km'
    const x = trend.map((t) => t.point.date)
    const withHr = trend.filter((t) => t.point.avg_heart_rate)
    const average = rollingAverage(
      trend.map((t) => t.pace),
      PACE_WINDOW,
    )
    const hrAverage = rollingAverage(
      withHr.map((t) => t.point.avg_heart_rate!),
      PACE_WINDOW,
    )
    const axis = paceAxis(trend.map((t) => t.pace))
    return chart(
      [
        {
          type: 'scatter',
          mode: 'markers',
          x,
          y: trend.map((t) => t.pace),
          name: `Pace (${per.slice(1)})`,
          marker: { color, size: 7, opacity: 0.55 },
          customdata: trend.map((t) => [
            t.point.name,
            formatDate(t.point.date),
            formatPace(t.point.distance_meters!, t.point.duration_seconds, sport),
          ]) as never,
          hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Pace: %{customdata[2]}<extra></extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x,
          y: average,
          customdata: average.map((s) => `${formatClock(s)} ${per}`) as never,
          name: `Pace, ${PACE_WINDOW}-activity average`,
          line: { color, width: 3, shape: 'spline' },
          hovertemplate: 'Average pace: %{customdata}<extra></extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: withHr.map((t) => t.point.date),
          y: hrAverage,
          name: `Avg HR, ${PACE_WINDOW}-activity average`,
          yaxis: 'y2',
          line: { color: '#ef4444', width: 2, dash: 'dot', shape: 'spline' },
          hovertemplate: 'Average HR: %{y:.0f} bpm<extra></extra>',
        },
      ],
      {
        title: { text: `Pace & Heart Rate – ${title}${yearSuffix(year)}` },
        xaxis: { type: 'date', tickformat: '%b %Y' },
        // Faster paces higher up, with evenly spaced m:ss labels
        yaxis: {
          title: { text: `Pace (min${per})` },
          ...(axis ? { range: axis.range, tickvals: axis.tickvals, ticktext: axis.ticktext } : { autorange: 'reversed' }),
        },
        yaxis2: {
          title: { text: 'Avg HR (bpm)' },
          overlaying: 'y',
          side: 'right',
          showgrid: false,
          ...heartRateAxis(hrAverage),
        },
        legend: { orientation: 'h', y: -0.18 },
        margin: { l: 60, r: 60, t: 50, b: 40 },
      },
    )
  },
}

/** The Graphs page, top to bottom. Remove or reorder entries here to change both apps. */
export const GRAPHS_PAGE: GraphDefinition[] = [volume, cumulative, breakdown, distanceResults, paceAndHeartRate]
