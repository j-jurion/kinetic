// Plotly figures for the Training page, shared by the web and mobile apps. Each builder takes
// prepared data from ../training.ts.

import type { Data, Layout, Shape } from 'plotly.js-dist-min'
import { activityUrl, dayUrl, weekUrl, withLinks } from '../chartLinks'
import { formatDate, sportColor, sportLabel } from '../format'
import { rollingAverage } from '../graphs'
import { formatClock, paceAxis } from '../speed'
import {
  DISCIPLINES,
  DISCIPLINE_COLORS,
  RAMP_WARNING_PCT,
  ZONE_COLORS,
  dayKey,
  inRange,
  linearFit,
} from '../training'
import type {
  BrickRun,
  CalendarGrid,
  Discipline,
  FitnessDay,
  GradeAdjusted,
  HeatPoint,
  RunValue,
  Week,
  WeeklyLoad,
} from '../training'
import type { TrainingActivity } from '../types'
import { noDataLayout } from './theme'
import type { Chart } from './theme'

export type { Chart }

const FITNESS_COLOR = '#3b82f6'
const FATIGUE_COLOR = '#ec4899'
const LOAD_COLOR = '#6366f1'
const WARNING_COLOR = '#f59e0b'
const NEUTRAL = '#6b7280'

const LEGEND_BELOW: Partial<Layout['legend']> = { orientation: 'h', y: -0.18, x: 0 }

/** Rolling-average window, in activities, for the per-activity trends. */
export const TREND_WINDOW = 10

const activityHover = (a: TrainingActivity) => [a.name, formatDate(a.date)]

/** Fitness and fatigue lines with form as a shaded area underneath, on its own axis. */
export function fitnessChart(days: FitnessDay[]): Chart {
  const title = 'Fitness & form'
  if (!days.length) return [[], noDataLayout(title)]
  const x = days.map((d) => dayKey(d.date))
  const tsb = days.map((d) => d.tsb)
  // A day with training opens its activities
  const links = days.map((d) => (d.load > 0 ? dayUrl(d.date) : null))
  const lo = Math.min(-35, Math.floor(Math.min(...tsb) - 5))
  const hi = Math.max(15, Math.ceil(Math.max(...tsb) + 5))
  // Form bands, clipped to the axis range: fresh, productive and overreaching
  const band = (y0: number, y1: number, color: string): Partial<Shape> => ({
    type: 'rect',
    xref: 'paper',
    yref: 'y2',
    x0: 0,
    x1: 1,
    y0: Math.max(lo, y0),
    y1: Math.min(hi, y1),
    fillcolor: color,
    opacity: 0.12,
    line: { width: 0 },
    layer: 'below',
  })
  return [
    [
      withLinks({
        type: 'scatter',
        mode: 'lines',
        x,
        y: days.map((d) => d.ctl),
        name: 'Fitness (CTL)',
        line: { color: FITNESS_COLOR, width: 2.5 },
        hovertemplate: 'Fitness: %{y:.0f}<extra></extra>',
      }, links),
      withLinks({
        type: 'scatter',
        mode: 'lines',
        x,
        y: days.map((d) => d.atl),
        name: 'Fatigue (ATL)',
        line: { color: FATIGUE_COLOR, width: 1.5 },
        hovertemplate: 'Fatigue: %{y:.0f}<extra></extra>',
      }, links),
      withLinks({
        type: 'scatter',
        mode: 'lines',
        x,
        y: tsb,
        name: 'Form (TSB)',
        yaxis: 'y2',
        fill: 'tozeroy',
        line: { color: NEUTRAL, width: 1 },
        fillcolor: 'rgba(107,114,128,0.35)',
        hovertemplate: 'Form: %{y:+.0f}<extra></extra>',
      }, links),
    ],
    {
      title: { text: title },
      hovermode: 'x unified',
      xaxis: { type: 'date', anchor: 'y2', hoverformat: '%a %d-%m-%Y' },
      yaxis: { title: { text: 'Load / day' }, domain: [0.38, 1], rangemode: 'tozero' },
      yaxis2: { title: { text: 'Form' }, domain: [0, 0.3], anchor: 'x', range: [lo, hi], zeroline: true },
      shapes: [band(5, hi, '#22c55e'), band(-30, -10, '#3b82f6'), band(lo, -30, '#ef4444')],
      legend: LEGEND_BELOW,
      margin: { l: 55, r: 20, t: 50, b: 40 },
    },
  ]
}

/** Weekly load bars, steep weeks highlighted, with the ramp rate on a second axis. */
export function weeklyLoadChart(weeks: WeeklyLoad[]): Chart {
  const title = 'Weekly load & ramp rate'
  if (!weeks.some((w) => w.load > 0)) return [[], noDataLayout(title)]
  const x = weeks.map((w) => dayKey(w.start))
  const steep = (w: WeeklyLoad) => (w.ramp ?? 0) > RAMP_WARNING_PCT
  const links = weeks.map((w) => (w.load > 0 ? weekUrl(w.start) : null))
  return [
    [
      withLinks({
        type: 'bar',
        x,
        y: weeks.map((w) => Math.round(w.load)),
        name: 'Weekly load',
        marker: { color: weeks.map((w) => (steep(w) ? WARNING_COLOR : LOAD_COLOR)) },
        opacity: 0.85,
        hovertemplate: 'Week of %{x|%d-%m-%Y}<br>Load: %{y}<extra></extra>',
      }, links),
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: weeks.map((w) => w.ramp),
        name: 'Ramp (4-week average, % per week)',
        yaxis: 'y2',
        connectgaps: false,
        line: { color: NEUTRAL, width: 1.5, dash: 'dot' },
        hovertemplate: 'Ramp: %{y:+.0f}%<extra></extra>',
      },
    ],
    {
      title: { text: title },
      xaxis: { type: 'date', tickformat: '%d %b' },
      yaxis: { title: { text: 'Load' } },
      // Whole percentages; Plotly's own ticks land on values like 31.9 and −39.9
      yaxis2: {
        title: { text: 'Ramp' },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        zeroline: false,
        tickformat: '.0f',
        ticksuffix: '%',
        dtick: 50,
      },
      shapes: [
        {
          type: 'line',
          xref: 'paper',
          yref: 'y2',
          x0: 0,
          x1: 1,
          y0: RAMP_WARNING_PCT,
          y1: RAMP_WARNING_PCT,
          line: { color: WARNING_COLOR, width: 1, dash: 'dash' },
        },
      ],
      legend: LEGEND_BELOW,
      margin: { l: 50, r: 50, t: 50, b: 40 },
    },
  ]
}

/** Weekly time in heart-rate zones, stacked, as hours or as a share of the week. */
export function zonesChart(weeks: Week<number[]>[], mode: 'hours' | 'pct'): Chart {
  const title = 'Intensity distribution'
  if (!weeks.some((w) => w.value.some((s) => s > 0))) return [[], noDataLayout(title)]
  const x = weeks.map((w) => dayKey(w.start))
  const totals = weeks.map((w) => w.value.reduce((s, v) => s + v, 0))
  const links = weeks.map((w, i) => (totals[i] > 0 ? weekUrl(w.start) : null))
  return [
    ZONE_COLORS.map(
      (color, zone): Data => withLinks({
        type: 'bar',
        x,
        y: weeks.map((w, i) =>
          mode === 'hours' ? w.value[zone] / 3600 : totals[i] ? (w.value[zone] / totals[i]) * 100 : 0,
        ),
        name: `Z${zone + 1}`,
        marker: { color },
        hovertemplate:
          mode === 'hours'
            ? `Z${zone + 1}: %{y:.1f} h<extra></extra>`
            : `Z${zone + 1}: %{y:.0f}%<extra></extra>`,
      } as Data, links),
    ),
    {
      title: { text: title },
      barmode: 'stack',
      hovermode: 'x unified',
      xaxis: { type: 'date', tickformat: '%d %b', hoverformat: 'Week of %d-%m-%Y' },
      yaxis: mode === 'hours' ? { title: { text: 'Hours' } } : { title: { text: 'Share (%)' }, range: [0, 100] },
      legend: LEGEND_BELOW,
      margin: { l: 50, r: 20, t: 50, b: 40 },
    },
  ]
}

/** Weekly moving hours per discipline, stacked. */
export function balanceChart(weeks: Week<Record<Discipline, number>>[]): Chart {
  const title = 'Training balance (hours per week)'
  if (!weeks.some((w) => DISCIPLINES.some((d) => w.value[d] > 0))) return [[], noDataLayout(title)]
  const x = weeks.map((w) => dayKey(w.start))
  const links = weeks.map((w) => (DISCIPLINES.some((d) => w.value[d] > 0) ? weekUrl(w.start) : null))
  return [
    DISCIPLINES.map(
      (d): Data => withLinks({
        type: 'bar',
        x,
        y: weeks.map((w) => w.value[d]),
        name: d,
        marker: { color: DISCIPLINE_COLORS[d] },
        hovertemplate: `${d}: %{y:.1f} h<extra></extra>`,
      } as Data, links),
    ),
    {
      title: { text: title },
      barmode: 'stack',
      hovermode: 'x unified',
      xaxis: { type: 'date', tickformat: '%d %b', hoverformat: 'Week of %d-%m-%Y' },
      yaxis: { title: { text: 'Hours' } },
      legend: LEGEND_BELOW,
      margin: { l: 50, r: 20, t: 50, b: 40 },
    },
  ]
}

/** Share of moving time per discipline over the whole range. */
export function balanceDonut(weeks: Week<Record<Discipline, number>>[]): Chart {
  const title = 'Share of time'
  const totals = DISCIPLINES.map((d) => weeks.reduce((s, w) => s + w.value[d], 0))
  if (!totals.some((t) => t > 0)) return [[], noDataLayout(title)]
  const shown = DISCIPLINES.filter((_, i) => totals[i] > 0)
  return [
    [
      {
        type: 'pie',
        hole: 0.5,
        sort: false,
        labels: shown,
        values: totals.filter((t) => t > 0),
        marker: { colors: shown.map((d) => DISCIPLINE_COLORS[d]) },
        hovertemplate: '<b>%{label}</b><br>%{value:.1f} h (%{percent})<extra></extra>',
      },
    ],
    { title: { text: title }, legend: LEGEND_BELOW, margin: { l: 20, r: 20, t: 50, b: 20 } },
  ]
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** GitHub-style calendar: a column per week, a row per weekday, coloured by daily load. */
export function calendarChart(grid: CalendarGrid): Chart {
  const values = grid.z.flat().filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b)
  // Cap the scale at the 95th percentile so one huge day does not wash out the rest
  const zmax = values.length ? Math.max(values[Math.floor((values.length - 1) * 0.95)], 1) : 1
  const text = grid.z.map((row, weekday) =>
    row.map((v, week) => {
      const date = formatDate(grid.keys[weekday][week])
      if (v === null) return ''
      return v > 0 ? `${WEEKDAYS[weekday]} ${date}<br>Load ${Math.round(v)}` : `${WEEKDAYS[weekday]} ${date}<br>Rest`
    }),
  )
  // A day with training opens its activities
  const links = grid.z.map((row, weekday) =>
    row.map((v, week) => (v ? dayUrl(new Date(`${grid.keys[weekday][week]}T12:00:00`)) : null)),
  )
  return [
    [
      withLinks({
        type: 'heatmap',
        x: grid.weeks.map(dayKey),
        y: WEEKDAYS,
        z: grid.z as never,
        text: text as never,
        zmin: 0,
        zmax,
        xgap: 3,
        ygap: 3,
        showscale: false,
        hoverongaps: false,
        colorscale: [
          [0, 'rgba(148,163,184,0.18)'],
          [0.0001, '#fed7aa'],
          [0.5, '#fb923c'],
          [1, '#c2410c'],
        ],
        hovertemplate: '%{text}<extra></extra>',
      } as Data, links),
    ],
    {
      title: { text: 'Consistency' },
      xaxis: { type: 'date', tickformat: '%b', showgrid: false, zeroline: false, ticklabelmode: 'period' },
      yaxis: { autorange: 'reversed', showgrid: false, zeroline: false, fixedrange: true },
      margin: { l: 40, r: 10, t: 50, b: 30 },
    },
  ]
}

interface TrendOptions {
  title: string
  yTitle: string
  color: string
  /** d3 number format for the hover, e.g. '.2f'. */
  format: string
  unit: string
}

/** One value per activity over time, with a rolling average; the range only limits what is shown. */
export function trendChart(points: RunValue[], from: Date | null, options: TrendOptions): Chart {
  const average = rollingAverage(points.map((p) => p.value), TREND_WINDOW)
  const shown = points.map((p, i) => ({ ...p, average: average[i] })).filter((p) => inRange(p.activity.date, from))
  if (!shown.length) return [[], noDataLayout(options.title)]
  const x = shown.map((p) => p.activity.date)
  const unit = options.unit ? ` ${options.unit}` : ''
  return [
    [
      withLinks({
        type: 'scatter',
        mode: 'markers',
        x,
        y: shown.map((p) => p.value),
        name: options.yTitle,
        marker: { color: options.color, size: 7, opacity: 0.5 },
        customdata: shown.map((p) => activityHover(p.activity)) as never,
        hovertemplate: `<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{y:${options.format}}${unit}<extra></extra>`,
      } as Data, shown.map((p) => activityUrl(p.activity.id))),
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: shown.map((p) => p.average),
        name: `${TREND_WINDOW}-activity average`,
        line: { color: options.color, width: 3, shape: 'spline' },
        hovertemplate: `Average: %{y:${options.format}}${unit}<extra></extra>`,
      },
    ],
    {
      title: { text: options.title },
      xaxis: { type: 'date', tickformat: '%b %Y' },
      yaxis: { title: { text: options.yTitle } },
      legend: LEGEND_BELOW,
      margin: { l: 60, r: 20, t: 50, b: 40 },
    },
  ]
}

/** Average temperature against pace per run, with a straight trend line. */
export function heatChart(points: HeatPoint[]): Chart {
  const title = 'Heat vs pace'
  if (!points.length) return [[], noDataLayout(title)]
  const axis = paceAxis(points.map((p) => p.pace))
  const fit = linearFit(
    points.map((p) => p.temperature),
    points.map((p) => p.pace),
  )
  const temps = points.map((p) => p.temperature)
  const lo = Math.min(...temps)
  const hi = Math.max(...temps)
  const data: Data[] = [
    withLinks({
      type: 'scatter',
      mode: 'markers',
      x: temps,
      y: points.map((p) => p.pace),
      name: 'Run',
      marker: { color: points.map((p) => sportColor(p.activity.sport)), size: 7, opacity: 0.55 },
      customdata: points.map((p) => [...activityHover(p.activity), formatClock(p.pace)]) as never,
      hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{x:.0f} °C · %{customdata[2]} /km<extra></extra>',
    } as Data, points.map((p) => activityUrl(p.activity.id))),
  ]
  if (fit && hi > lo) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: [lo, hi],
      y: [fit.intercept + fit.slope * lo, fit.intercept + fit.slope * hi],
      name: `Trend: ${fit.slope >= 0 ? '+' : '−'}${Math.abs(fit.slope * 5).toFixed(0)} s/km per 5 °C`,
      line: { color: NEUTRAL, width: 2, dash: 'dot' },
      hoverinfo: 'skip',
    })
  }
  return [
    data,
    {
      title: { text: title },
      // The unit in the tick labels keeps the row below the axis free for the legend
      xaxis: { ticksuffix: ' °C' },
      yaxis: {
        title: { text: 'Pace (min/km)' },
        ...(axis ? { range: axis.range, tickvals: axis.tickvals, ticktext: axis.ticktext } : { autorange: 'reversed' }),
      },
      legend: LEGEND_BELOW,
      margin: { l: 60, r: 20, t: 50, b: 50 },
    },
  ]
}

/** Seconds per km the hills cost on each trail or hilly run: actual pace minus grade-adjusted pace. */
export function gradeAdjustedChart(runs: GradeAdjusted[]): Chart {
  const title = 'Hills: actual vs grade-adjusted pace'
  if (!runs.length) return [[], noDataLayout(title)]
  return [
    [
      withLinks({
        type: 'scatter',
        mode: 'markers',
        x: runs.map((r) => r.activity.date),
        y: runs.map((r) => r.pace - r.gradeAdjustedPace),
        name: 'Pace lost to climbing',
        marker: { color: runs.map((r) => sportColor(r.activity.sport)), size: 8, opacity: 0.6 },
        customdata: runs.map((r) => [
          ...activityHover(r.activity),
          formatClock(r.pace),
          formatClock(r.gradeAdjustedPace),
        ]) as never,
        hovertemplate:
          '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Pace %{customdata[2]} /km · GAP %{customdata[3]} /km' +
          '<br>Difference: %{y:+.0f} s/km<extra></extra>',
      } as Data, runs.map((r) => activityUrl(r.activity.id))),
    ],
    {
      title: { text: title },
      xaxis: { type: 'date', tickformat: '%b %Y' },
      yaxis: { title: { text: 'Pace − GAP (s/km)' }, zeroline: true },
      showlegend: false,
      margin: { l: 60, r: 20, t: 50, b: 40 },
    },
  ]
}

/** Brick runs against normal runs of similar distance, as paired bars. */
export function brickChart(bricks: BrickRun[]): Chart {
  const title = 'Brick runs vs normal runs'
  const compared = bricks.filter((b) => b.normalPace !== null)
  if (!compared.length) return [[], noDataLayout(title)]
  const x = compared.map((b) => `${formatDate(b.activity.date)} · ${((b.activity.distance_meters ?? 0) / 1000).toFixed(1)} km`)
  const axis = paceAxis(compared.flatMap((b) => [b.pace, b.normalPace!]), true)
  const links = compared.map((b) => activityUrl(b.activity.id))
  const bar = (name: string, values: number[], color: string): Data => withLinks({
    type: 'bar',
    x,
    y: values,
    name,
    marker: { color },
    customdata: values.map(formatClock) as never,
    hovertemplate: `${name}: %{customdata} /km<extra></extra>`,
    // Bars grow up from the slow end of the reversed axis
    base: axis ? (values.map(() => axis.slow) as never) : undefined,
  } as Data, links)
  return [
    [
      bar('Brick run', compared.map((b) => b.pace - (axis?.slow ?? 0)), sportColor('triathlon')),
      bar('Normal runs, similar distance', compared.map((b) => b.normalPace! - (axis?.slow ?? 0)), NEUTRAL),
    ],
    {
      title: { text: title },
      barmode: 'group',
      xaxis: { type: 'category' },
      yaxis: {
        title: { text: 'Pace (min/km)' },
        ...(axis ? { range: axis.range, tickvals: axis.tickvals, ticktext: axis.ticktext } : { autorange: 'reversed' }),
      },
      legend: LEGEND_BELOW,
      margin: { l: 60, r: 20, t: 50, b: 60 },
    },
  ]
}

/** Aerobic decoupling of long sessions, one colour per sport, with the 5% guideline. */
export function decouplingChart(activities: TrainingActivity[]): Chart {
  const title = 'Aerobic decoupling of long sessions'
  if (!activities.length) return [[], noDataLayout(title)]
  const sports = [...new Set(activities.map((a) => a.sport))]
  return [
    sports.map((sport): Data => {
      const list = activities.filter((a) => a.sport === sport)
      return withLinks({
        type: 'scatter',
        mode: 'markers',
        x: list.map((a) => a.date),
        y: list.map((a) => a.decoupling_pct),
        name: sportLabel(sport),
        marker: { color: sportColor(sport), size: 8, opacity: 0.65 },
        customdata: list.map((a) => [...activityHover(a), Math.round(a.moving_seconds / 60)]) as never,
        hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]} · %{customdata[2]} min<br>Decoupling: %{y:.1f}%<extra></extra>',
      } as Data, list.map((a) => activityUrl(a.id)))
    }),
    {
      title: { text: title },
      xaxis: { type: 'date', tickformat: '%b %Y' },
      yaxis: { title: { text: 'Decoupling (%)' }, zeroline: true },
      shapes: [
        {
          type: 'line',
          xref: 'paper',
          yref: 'y',
          x0: 0,
          x1: 1,
          y0: 5,
          y1: 5,
          line: { color: WARNING_COLOR, width: 1.5, dash: 'dash' },
        },
      ],
      legend: LEGEND_BELOW,
      margin: { l: 55, r: 20, t: 50, b: 40 },
    },
  ]
}
