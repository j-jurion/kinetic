// Calculations behind the Training page: fitness and form, weekly totals, streaks and the
// running, swimming and decoupling trends. Pure functions so they are easy to test.

import { parseDate, stepsPerMinute } from './format'
import { weekStart } from './graphs'
import type { TrainingActivity } from './types'

/** Days over which fitness (chronic training load) is averaged. */
export const FITNESS_DAYS = 42
/** Days over which fatigue (acute training load) is averaged. */
export const FATIGUE_DAYS = 7
/** Week-over-week rise of the 4-week average load above which the ramp counts as steep. */
export const RAMP_WARNING_PCT = 8

export const ZONE_COLORS = ['#94a3b8', '#3b82f6', '#22c55e', '#f97316', '#ef4444']

export type Range = '3m' | '12m' | 'all'
export type Discipline = 'Swim' | 'Bike' | 'Run' | 'Other'
export const DISCIPLINES: Discipline[] = ['Swim', 'Bike', 'Run', 'Other']
export const DISCIPLINE_COLORS: Record<Discipline, string> = {
  Swim: '#00a3ff',
  Bike: '#00c853',
  Run: '#ff2d55',
  Other: '#90a4ae',
}

const MULTISPORT = new Set(['triathlon', 'duathlon', 'multisport'])
const RUNNING = new Set(['running', 'trail_running'])
// Hard sessions make the aerobic efficiency of a run incomparable with easy ones
const NOT_AEROBIC = new Set(['race', 'interval', 'tempo'])

const pad = (n: number) => String(n).padStart(2, '0')
const DAY_MS = 86_400_000

/** "2026-11-19" for a local date. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Local midnight of the date. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** The date `days` days later (or earlier when negative), at midnight. */
export const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)

export const isRun = (a: TrainingActivity) => RUNNING.has(a.sport)
export const isMultisportParent = (a: TrainingActivity) => a.parent_id === null && MULTISPORT.has(a.sport)

/** Activities that count once for load, zones and the calendar: no multisport legs. */
export const topLevel = (activities: TrainingActivity[]) => activities.filter((a) => a.parent_id === null)

/** Activities per discipline: multisport legs instead of the event that holds them. */
export const disciplineActivities = (activities: TrainingActivity[]) => activities.filter((a) => !isMultisportParent(a))

export function discipline(sport: string): Discipline {
  if (sport === 'swimming') return 'Swim'
  if (sport === 'cycling') return 'Bike'
  if (RUNNING.has(sport)) return 'Run'
  return 'Other'
}

/** First day shown for a range, or null for all history. */
export function rangeStart(range: Range, today = new Date()): Date | null {
  if (range === 'all') return null
  const d = startOfDay(today)
  d.setMonth(d.getMonth() - (range === '3m' ? 3 : 12))
  return d
}

/** Whether an activity (or any dated item) falls on or after the range start. */
export const inRange = (date: string, from: Date | null) => !from || (parseDate(date) ?? new Date(0)) >= from

/** Average speed in m/s, from the recorded average or distance over moving time. */
export function speedOf(a: TrainingActivity): number | null {
  if (a.avg_speed_ms && a.avg_speed_ms > 0) return a.avg_speed_ms
  if (a.distance_meters && a.moving_seconds > 0) return a.distance_meters / a.moving_seconds
  return null
}

/** Seconds per km for a speed in m/s. */
export const paceOf = (speed: number) => 1000 / speed

// ── Fitness and form ─────────────────────────────────────────────────────────

export interface FitnessDay {
  date: Date
  load: number
  /** Fitness: 42-day exponentially weighted average of the daily load. */
  ctl: number
  /** Fatigue: 7-day exponentially weighted average of the daily load. */
  atl: number
  /** Form: yesterday's fitness minus yesterday's fatigue. */
  tsb: number
}

/** Total load per day (key from dayKey) of the top-level activities. */
export function dailyLoads(activities: TrainingActivity[]): Map<string, number> {
  const loads = new Map<string, number>()
  for (const a of topLevel(activities)) {
    const date = parseDate(a.date)
    if (!date) continue
    const key = dayKey(date)
    loads.set(key, (loads.get(key) ?? 0) + (a.load || 0))
  }
  return loads
}

/**
 * Daily fitness (CTL), fatigue (ATL) and form (TSB) from the first activity up to today,
 * with the usual exponentially weighted averages: x += (load − x) / days.
 */
export function fitnessSeries(activities: TrainingActivity[], today = new Date()): FitnessDay[] {
  const loads = dailyLoads(activities)
  const first = activities.map((a) => parseDate(a.date)).find((d): d is Date => d !== null)
  if (!first) return []
  const series: FitnessDay[] = []
  let ctl = 0
  let atl = 0
  const end = startOfDay(today)
  for (let d = startOfDay(first); d <= end; d = addDays(d, 1)) {
    const load = loads.get(dayKey(d)) ?? 0
    const tsb = ctl - atl
    ctl += (load - ctl) / FITNESS_DAYS
    atl += (load - atl) / FATIGUE_DAYS
    series.push({ date: d, load, ctl, atl, tsb })
  }
  return series
}

export type FormBand = 'Fresh' | 'Neutral' | 'Productive' | 'Overreaching'

/** Form bands: above +5 fresh, −10…+5 neutral, −30…−10 productive, below −30 overreaching. */
export function formBand(tsb: number): FormBand {
  if (tsb > 5) return 'Fresh'
  if (tsb >= -10) return 'Neutral'
  if (tsb >= -30) return 'Productive'
  return 'Overreaching'
}

// ── Weekly totals ────────────────────────────────────────────────────────────

export interface Week<T> {
  start: Date
  value: T
}

/**
 * Buckets per week (Monday to Sunday) from the week of `first` to the week of `last`,
 * including empty weeks; activities outside those weeks are skipped.
 */
export function groupByWeek<T>(
  activities: TrainingActivity[],
  first: Date,
  last: Date,
  empty: () => T,
  add: (bucket: T, a: TrainingActivity) => void,
): Week<T>[] {
  const weeks: Week<T>[] = []
  const index = new Map<string, Week<T>>()
  for (let d = weekStart(first); d <= last; d = addDays(d, 7)) {
    const week = { start: d, value: empty() }
    weeks.push(week)
    index.set(dayKey(d), week)
  }
  for (const a of activities) {
    const date = parseDate(a.date)
    const week = date && index.get(dayKey(weekStart(date)))
    if (week) add(week.value, a)
  }
  return weeks
}

const firstDate = (activities: TrainingActivity[]) =>
  activities.map((a) => parseDate(a.date)).find((d): d is Date => d !== null) ?? null

export interface WeeklyLoad {
  start: Date
  load: number
  /** Average weekly load over this and the three weeks before. */
  average: number
  /** % change of that 4-week average compared to the week before, null without a base. */
  ramp: number | null
}

/** Weekly load of the top-level activities with the ramp rate, from `from` (or the start). */
export function weeklyLoad(activities: TrainingActivity[], from: Date | null, today = new Date()): WeeklyLoad[] {
  const top = topLevel(activities)
  const first = firstDate(top)
  if (!first) return []
  // The whole history, so the rolling average is right in the first weeks of the range
  const weeks = groupByWeek(top, first, today, () => ({ load: 0 }), (w, a) => (w.load += a.load || 0))
  const rows: WeeklyLoad[] = weeks.map((w, i) => {
    const window = weeks.slice(Math.max(0, i - 3), i + 1)
    return { start: w.start, load: w.value.load, average: window.reduce((s, x) => s + x.value.load, 0) / 4, ramp: null }
  })
  rows.forEach((row, i) => {
    const before = rows[i - 1]?.average
    if (before && before > 1) row.ramp = ((row.average - before) / before) * 100
  })
  return from ? rows.filter((r) => r.start >= weekStart(from)) : rows
}

/** Weekly seconds in heart-rate zones Z1–Z5 of the top-level activities. */
export function weeklyZones(activities: TrainingActivity[], from: Date | null, today = new Date()): Week<number[]>[] {
  const top = topLevel(activities)
  const first = from ?? firstDate(top)
  if (!first) return []
  return groupByWeek(top, first, today, () => [0, 0, 0, 0, 0], (zones, a) => {
    a.zone_seconds?.forEach((s, i) => {
      if (i < 5) zones[i] += s
    })
  })
}

export interface IntensitySplit {
  /** Shares 0–100 of the zone time. */
  easy: number
  moderate: number
  hard: number
  totalSeconds: number
}

/** Share of time easy (Z1–Z2), moderate (Z3) and hard (Z4–Z5) over the weeks. */
export function intensitySplit(weeks: Week<number[]>[]): IntensitySplit {
  const zones = [0, 0, 0, 0, 0]
  for (const w of weeks) w.value.forEach((s, i) => (zones[i] += s))
  const total = zones.reduce((s, v) => s + v, 0)
  const pct = (v: number) => (total ? (v / total) * 100 : 0)
  return { easy: pct(zones[0] + zones[1]), moderate: pct(zones[2]), hard: pct(zones[3] + zones[4]), totalSeconds: total }
}

/** Weekly moving hours per discipline (multisport legs counted, their parent not). */
export function weeklyDisciplines(
  activities: TrainingActivity[],
  from: Date | null,
  today = new Date(),
): Week<Record<Discipline, number>>[] {
  const legs = disciplineActivities(activities)
  const first = from ?? firstDate(legs)
  if (!first) return []
  return groupByWeek(legs, first, today, () => ({ Swim: 0, Bike: 0, Run: 0, Other: 0 }), (hours, a) => {
    hours[discipline(a.sport)] += (a.moving_seconds || 0) / 3600
  })
}

// ── Consistency ──────────────────────────────────────────────────────────────

/** Day keys with at least one top-level activity. */
export function activeDays(activities: TrainingActivity[]): Set<string> {
  const days = new Set<string>()
  for (const a of topLevel(activities)) {
    const date = parseDate(a.date)
    if (date) days.add(dayKey(date))
  }
  return days
}

/** Consecutive active days ending today, or yesterday when today has no activity yet. */
export function currentStreak(days: Set<string>, today = new Date()): number {
  let d = startOfDay(today)
  if (!days.has(dayKey(d))) d = addDays(d, -1)
  let count = 0
  while (days.has(dayKey(d))) {
    count++
    d = addDays(d, -1)
  }
  return count
}

/** The longest run of consecutive active days. */
export function longestStreak(days: Set<string>): number {
  let best = 0
  for (const key of days) {
    const date = parseDate(key)!
    if (days.has(dayKey(addDays(date, -1)))) continue // not the start of a streak
    let length = 1
    for (let d = addDays(date, 1); days.has(dayKey(d)); d = addDays(d, 1)) length++
    best = Math.max(best, length)
  }
  return best
}

/** Consecutive weeks with an activity, ending this week (or last week when this one is empty). */
export function weeklyStreak(days: Set<string>, today = new Date()): number {
  const weeks = new Set([...days].map((key) => dayKey(weekStart(parseDate(key)!))))
  let w = weekStart(today)
  if (!weeks.has(dayKey(w))) w = addDays(w, -7)
  let count = 0
  while (weeks.has(dayKey(w))) {
    count++
    w = addDays(w, -7)
  }
  return count
}

export interface CalendarGrid {
  /** Monday of each column. */
  weeks: Date[]
  /** z[weekday][week]: the day's load, or null for days after today. */
  z: (number | null)[][]
  /** keys[weekday][week]: the date as yyyy-mm-dd. */
  keys: string[][]
}

/** A week-by-weekday grid of daily load from the week of `from` up to today. */
export function calendarGrid(loads: Map<string, number>, days: Set<string>, from: Date, today = new Date()): CalendarGrid {
  const end = startOfDay(today)
  const weeks: Date[] = []
  for (let d = weekStart(from); d <= end; d = addDays(d, 7)) weeks.push(d)
  const z: (number | null)[][] = []
  const keys: string[][] = []
  for (let weekday = 0; weekday < 7; weekday++) {
    z.push(
      weeks.map((w) => {
        const day = addDays(w, weekday)
        if (day > end || day < startOfDay(from)) return null
        const key = dayKey(day)
        // Active days without load (no heart rate) still show as a light square
        return loads.get(key) || (days.has(key) ? 1 : 0)
      }),
    )
    keys.push(weeks.map((w) => dayKey(addDays(w, weekday))))
  }
  return { weeks, z, keys }
}

// ── Running ──────────────────────────────────────────────────────────────────

export interface RunValue {
  activity: TrainingActivity
  value: number
}

/**
 * Aerobic efficiency per steady run: speed in metres per minute divided by the average heart
 * rate. Races, intervals and tempo runs are left out.
 */
export function aerobicEfficiency(activities: TrainingActivity[]): RunValue[] {
  return activities
    .filter((a) => isRun(a) && !NOT_AEROBIC.has(a.kind) && (a.avg_heart_rate ?? 0) > 0 && a.moving_seconds >= 600)
    .flatMap((a) => {
      const speed = speedOf(a)
      return speed ? [{ activity: a, value: (speed * 60) / a.avg_heart_rate! }] : []
    })
}

/** Runs with a value for the field, e.g. avg_ground_contact. */
export function runField(
  activities: TrainingActivity[],
  field: 'avg_step_length' | 'avg_ground_contact' | 'avg_vertical_oscillation' | 'avg_cadence',
): RunValue[] {
  return activities
    .filter((a) => isRun(a) && (a[field] ?? 0) > 0)
    .map((a) => ({
      activity: a,
      // Stored cadence counts one foot; steps per minute are twice that
      value: field === 'avg_cadence' ? stepsPerMinute(a.avg_cadence!, a.sport) : a[field]!,
    }))
}

export interface HeatPoint {
  activity: TrainingActivity
  temperature: number
  /** Seconds per km. */
  pace: number
}

/** Runs with both an average temperature and a pace. */
export function heatVsPace(activities: TrainingActivity[]): HeatPoint[] {
  return activities.flatMap((a) => {
    const speed = speedOf(a)
    if (!isRun(a) || a.avg_temperature === null || !speed) return []
    return [{ activity: a, temperature: a.avg_temperature, pace: paceOf(speed) }]
  })
}

/** Least-squares line y = slope · x + intercept, or null with fewer than 3 points. */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (!den) return null
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}

/** Elapsed seconds of an activity, falling back to moving time when the duration is broken. */
function elapsed(a: TrainingActivity): number {
  return a.duration_seconds > 0 && a.duration_seconds < DAY_MS / 1000 ? a.duration_seconds : a.moving_seconds
}

export interface BrickRun {
  activity: TrainingActivity
  /** Seconds per km of the brick run. */
  pace: number
  /** Average pace of the normal runs of similar distance, or null when there are none. */
  normalPace: number | null
  normalCount: number
}

/**
 * Runs straight off the bike: multisport run legs whose previous leg was a ride, or runs
 * starting within 30 minutes after a ride ended. Each is compared with the average pace of
 * the other runs within ±30% of its distance.
 */
export function brickRuns(activities: TrainingActivity[]): BrickRun[] {
  const bricks = new Set<number>()
  const legsByParent = new Map<number, TrainingActivity[]>()
  for (const a of activities) {
    if (a.parent_id === null) continue
    const legs = legsByParent.get(a.parent_id) ?? []
    legs.push(a)
    legsByParent.set(a.parent_id, legs)
  }
  for (const legs of legsByParent.values()) {
    // Transitions and other legs between the ride and the run are skipped
    const sports = [...legs].sort((a, b) => a.date.localeCompare(b.date)).filter((l) => discipline(l.sport) !== 'Other')
    sports.forEach((leg, i) => {
      if (i > 0 && isRun(leg) && sports[i - 1].sport === 'cycling') bricks.add(leg.id)
    })
  }
  const rideEnds = activities
    .filter((a) => a.sport === 'cycling' && a.parent_id === null)
    .flatMap((a) => {
      const start = parseDate(a.date)
      return start ? [start.getTime() + elapsed(a) * 1000] : []
    })
  for (const run of activities) {
    if (!isRun(run) || run.parent_id !== null) continue
    const start = parseDate(run.date)?.getTime()
    if (start === undefined) continue
    // A few minutes of overlap covers rides whose recorded end is a little late
    if (rideEnds.some((end) => start - end <= 30 * 60_000 && start - end >= -5 * 60_000)) bricks.add(run.id)
  }

  const runs = activities.flatMap((a) => {
    const speed = speedOf(a)
    return isRun(a) && speed && (a.distance_meters ?? 0) > 0 ? [{ activity: a, pace: paceOf(speed) }] : []
  })
  const normal = runs.filter((r) => !bricks.has(r.activity.id))
  return runs
    .filter((r) => bricks.has(r.activity.id))
    .map((r) => {
      const distance = r.activity.distance_meters!
      const similar = normal.filter((n) => Math.abs(n.activity.distance_meters! - distance) <= distance * 0.3)
      const normalPace = similar.length ? similar.reduce((s, n) => s + n.pace, 0) / similar.length : null
      return { activity: r.activity, pace: r.pace, normalPace, normalCount: similar.length }
    })
}

export interface GradeAdjusted {
  activity: TrainingActivity
  /** Seconds per km. */
  pace: number
  gradeAdjustedPace: number
}

/** Trail runs and hilly runs (≥ 15 m climbing per km) with a grade-adjusted pace. */
export function gradeAdjustedRuns(activities: TrainingActivity[]): GradeAdjusted[] {
  return activities.flatMap((a) => {
    const speed = speedOf(a)
    if (!isRun(a) || !speed || !a.grade_adjusted_speed || !a.distance_meters) return []
    const climbPerKm = (a.elevation_gain_meters ?? 0) / (a.distance_meters / 1000)
    if (a.sport !== 'trail_running' && climbPerKm < 15) return []
    return [{ activity: a, pace: paceOf(speed), gradeAdjustedPace: paceOf(a.grade_adjusted_speed) }]
  })
}

/** Long sessions (≥ 60 min moving) with an aerobic decoupling value, multisport events left out. */
export const longDecoupling = (activities: TrainingActivity[]) =>
  disciplineActivities(activities).filter((a) => a.decoupling_pct !== null && a.moving_seconds >= 3600)
