// Calculations behind the Graphs page charts that are built in the browser.

import { isSwimming, parseDate, toIsoLocal } from './format'
import type { GraphPoint, GraphTotals } from './types'

export type Metric = 'distance' | 'count' | 'time' | 'elevation'

export interface MetricConfig {
  label: string
  fmt: string
  unit: string
  value: (t: GraphTotals) => number
}

/** Metric settings, switched to metres when only swimming is selected. */
export function metricConfig(metric: Metric, sport: string): MetricConfig {
  if (metric === 'count') return { label: 'Activities', fmt: 'd', unit: '', value: (t) => t.count }
  if (metric === 'time')
    return { label: 'Time (h)', fmt: '.1f', unit: 'h', value: (t) => Math.round((t.duration_seconds / 3600) * 10) / 10 }
  if (metric === 'elevation')
    return { label: 'Elevation (m)', fmt: '.0f', unit: 'm', value: (t) => Math.round(t.elevation_meters) }
  if (isSwimming(sport)) return { label: 'Distance (m)', fmt: '.0f', unit: 'm', value: (t) => Math.round(t.distance_meters) }
  return { label: 'Distance (km)', fmt: '.1f', unit: 'km', value: (t) => Math.round(t.distance_meters / 100) / 10 }
}

export const emptyTotals = (): GraphTotals => ({ count: 0, distance_meters: 0, duration_seconds: 0, elevation_meters: 0 })

function add(total: GraphTotals, p: GraphPoint) {
  total.count += 1
  total.distance_meters += p.distance_meters ?? 0
  total.duration_seconds += p.duration_seconds ?? 0
  total.elevation_meters += p.elevation_meters ?? 0
}

/** Monday 00:00 of the week containing the date. */
export function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

export interface WeekTotal extends GraphTotals {
  start: Date
}

/**
 * Totals per week (Monday to Sunday): the weeks of the selected year, or the last 52 weeks
 * up to this week when no year is selected. Weeks without activities are included as zero.
 */
export function weeklyTotals(points: GraphPoint[], year: number | null, today = new Date()): WeekTotal[] {
  const thisWeek = weekStart(today)
  let first: Date
  let last: Date
  if (year) {
    first = weekStart(new Date(year, 0, 1))
    const yearEnd = weekStart(new Date(year, 11, 31))
    last = yearEnd < thisWeek ? yearEnd : thisWeek
  } else {
    last = thisWeek
    first = new Date(last.getTime())
    first.setDate(first.getDate() - 51 * 7)
  }

  const weeks: WeekTotal[] = []
  const index = new Map<number, WeekTotal>()
  for (let d = new Date(first.getTime()); d <= last; d.setDate(d.getDate() + 7)) {
    const week = { start: new Date(d.getTime()), ...emptyTotals() }
    weeks.push(week)
    index.set(week.start.getTime(), week)
  }
  for (const p of points) {
    const date = parseDate(p.date)
    if (!date) continue
    const week = index.get(weekStart(date).getTime())
    if (week) add(week, p)
  }
  return weeks
}

/** Average of each value with the (size - 1) values before it. */
export function rollingAverage(values: number[], size: number): number[] {
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - size + 1), i + 1)
    return window.reduce((s, v) => s + v, 0) / window.length
  })
}

export interface YearProgress {
  year: number
  /** Dates moved into the year 2000 (a leap year) so every year shares one Jan–Dec axis. */
  x: string[]
  y: number[]
}

/** Running total of the metric through each year, for the last `maxYears` years with data. */
export function cumulativeByYear(points: GraphPoint[], metric: MetricConfig, maxYears = 6): YearProgress[] {
  const byYear = new Map<number, GraphPoint[]>()
  for (const p of points) {
    const date = parseDate(p.date)
    if (!date) continue
    const list = byYear.get(date.getFullYear()) ?? []
    list.push(p)
    byYear.set(date.getFullYear(), list)
  }
  const years = [...byYear.keys()].sort((a, b) => a - b).slice(-maxYears)
  return years.map((year) => {
    const total = emptyTotals()
    const x = ['2000-01-01T00:00:00']
    const y = [0]
    for (const p of [...byYear.get(year)!].sort((a, b) => a.date.localeCompare(b.date))) {
      add(total, p)
      const d = parseDate(p.date)!
      x.push(toIsoLocal(new Date(2000, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())))
      y.push(metric.value(total))
    }
    return { year, x, y }
  })
}

export interface PacePoint {
  point: GraphPoint
  /** Seconds per km, or per 100 m for swimming. */
  pace: number
}

/** Activities with a usable pace, oldest first. */
export function paceTrend(points: GraphPoint[], sport: string): PacePoint[] {
  const reference = isSwimming(sport) ? 100 : 1000
  return points
    .filter((p) => (p.distance_meters ?? 0) > 0 && p.duration_seconds > 0)
    .map((p) => ({ point: p, pace: p.duration_seconds / (p.distance_meters! / reference) }))
    .sort((a, b) => a.point.date.localeCompare(b.point.date))
}

/** A pace in seconds as a Plotly date value, so the axis can show it as m:ss. */
export const paceAsTime = (seconds: number) => new Date(Date.UTC(1970, 0, 1) + seconds * 1000).toISOString()

export const KIND_COLORS: Record<string, string> = {
  race: '#ef4444',
  training: '#3b82f6',
  easy: '#22c55e',
  social: '#a855f7',
  long_run: '#f97316',
  tempo: '#eab308',
  interval: '#ec4899',
  recovery: '#14b8a6',
  other: '#94a3b8',
}

export const inYear = (points: GraphPoint[], year: number | null) =>
  year ? points.filter((p) => p.date.startsWith(String(year))) : points

export interface MonthTotal extends GraphTotals {
  start: Date
}

/**
 * Totals per calendar month, without gaps: every month of the selected year (up to this
 * month), or from the first activity up to this month when no year is selected.
 */
export function monthlyTotals(points: GraphPoint[], year: number | null, today = new Date()): MonthTotal[] {
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  let first: Date
  let last: Date
  if (year) {
    first = new Date(year, 0, 1)
    const december = new Date(year, 11, 1)
    last = december < thisMonth ? december : thisMonth
  } else {
    const firstDate = points.length ? parseDate(points[0].date) : null
    if (!firstDate) return []
    first = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1)
    last = thisMonth
  }
  const months: MonthTotal[] = []
  const index = new Map<string, MonthTotal>()
  for (let d = new Date(first.getTime()); d <= last; d.setMonth(d.getMonth() + 1)) {
    const month = { start: new Date(d.getTime()), ...emptyTotals() }
    months.push(month)
    index.set(`${d.getFullYear()}-${d.getMonth()}`, month)
  }
  for (const p of points) {
    const date = parseDate(p.date)
    const month = date && index.get(`${date.getFullYear()}-${date.getMonth()}`)
    if (month) add(month, p)
  }
  return months
}

/** Totals per year, from the first year with an activity up to the last. */
export function yearlyTotals(points: GraphPoint[]): (GraphTotals & { year: number })[] {
  const totals = new Map<number, GraphTotals>()
  for (const p of points) {
    const date = parseDate(p.date)
    if (!date) continue
    const total = totals.get(date.getFullYear()) ?? emptyTotals()
    add(total, p)
    totals.set(date.getFullYear(), total)
  }
  const years = [...totals.keys()].sort((a, b) => a - b)
  if (!years.length) return []
  const result = []
  for (let y = years[0]; y <= years[years.length - 1]; y++) {
    result.push({ year: y, ...(totals.get(y) ?? emptyTotals()) })
  }
  return result
}

/** Totals per value of a field (sport or kind), largest first. */
export function totalsBy(
  points: GraphPoint[],
  field: 'sport' | 'kind',
  metric: MetricConfig,
): { key: string; value: number }[] {
  const totals = new Map<string, GraphTotals>()
  for (const p of points) {
    const total = totals.get(p[field]) ?? emptyTotals()
    add(total, p)
    totals.set(p[field], total)
  }
  return [...totals.entries()]
    .map(([key, total]) => ({ key, value: metric.value(total) }))
    .filter((k) => k.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** The fastest time so far at each point in a list sorted by date. */
export function personalBestProgression(times: number[]): number[] {
  let best = Infinity
  return times.map((t) => (best = Math.min(best, t)))
}
