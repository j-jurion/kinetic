// Pure performance calculations for the Best Efforts and Races pages: race predictions,
// personal-record progressions, power curves, FTP estimates and race split breakdowns.
import { parseDate } from './format'
import type { BestEffortRow, MultisportEvent, RaceRow, TrainingActivity } from './types'

const DAY_MS = 86_400_000

// ── Race predictor ────────────────────────────────────────────────────────────

/** Riegel's fatigue exponent: each doubling of distance costs ~4% pace. */
export const RIEGEL_EXPONENT = 1.06
/** Race distances the predictor estimates, in metres. */
export const PREDICTION_TARGETS = [5000, 10000, 21097.5, 42195]
/** Shorter efforts are too sprint-like to extrapolate from. */
export const MIN_PREDICTION_SOURCE = 3000

/** Riegel's formula: the time for `toMeters` given `seconds` over `fromMeters`. */
export function riegel(seconds: number, fromMeters: number, toMeters: number): number {
  return seconds * (toMeters / fromMeters) ** RIEGEL_EXPONENT
}

/** Stored distances come from a fixed set, so a small tolerance absorbs float rounding. */
export const sameDistance = (a: number, b: number) => Math.abs(a - b) < 0.5

/** The fastest effort per distance, sorted by distance. */
export function fastestPerDistance(efforts: BestEffortRow[]): BestEffortRow[] {
  const best = new Map<number, BestEffortRow>()
  for (const e of efforts) {
    const current = best.get(e.distance_meters)
    if (!current || e.duration_seconds < current.duration_seconds) best.set(e.distance_meters, e)
  }
  return [...best.values()].sort((a, b) => a.distance_meters - b.distance_meters)
}

/**
 * The same calendar day and time `months` months earlier, or the last day of that month when
 * it is shorter: 31 May minus 3 months is 28 February, not 3 March (which setMonth would give).
 */
export function monthsBefore(date: Date, months: number): Date {
  const year = date.getFullYear()
  const month = date.getMonth() - months
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(
    year,
    month,
    Math.min(date.getDate(), lastDay),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  )
}

export interface Prediction {
  target: number
  seconds: number
  /** The effort the prediction is extrapolated from. */
  source: BestEffortRow
  /** The all-time record at the target distance, if any. */
  record: BestEffortRow | null
}

export interface Predictions {
  predictions: Prediction[]
  /** True when there were no efforts in the last 12 months and all-time efforts were used. */
  allTime: boolean
}

/**
 * Riegel predictions for 5 km, 10 km, half and full marathon.
 *
 * Uses the fastest effort per distance (≥ 3 km) of the last 12 months, falling back to all
 * time when there are none. Each target is predicted from the source distance closest to it
 * on a log scale (extrapolating over a smaller ratio is more reliable).
 */
export function predictRaces(efforts: BestEffortRow[], today = new Date()): Predictions {
  const eligible = efforts.filter((e) => e.distance_meters >= MIN_PREDICTION_SOURCE - 0.5)
  const since = monthsBefore(today, 12)
  const recent = eligible.filter((e) => {
    const d = parseDate(e.date)
    return d !== null && d >= since && d <= today
  })
  const allTime = recent.length === 0
  const sources = fastestPerDistance(allTime ? eligible : recent)
  const records = fastestPerDistance(efforts)
  if (!sources.length) return { predictions: [], allTime }

  const predictions = PREDICTION_TARGETS.map((target): Prediction => {
    const source = sources.reduce((best, e) =>
      Math.abs(Math.log(e.distance_meters / target)) < Math.abs(Math.log(best.distance_meters / target)) ? e : best,
    )
    return {
      target,
      seconds: riegel(source.duration_seconds, source.distance_meters, target),
      source,
      record: records.find((r) => sameDistance(r.distance_meters, target)) ?? null,
    }
  })
  return { predictions, allTime }
}

// ── Personal-record timeline ─────────────────────────────────────────────────

export interface RecordStep {
  effort: BestEffortRow
  /** Seconds faster than the previous record; null for the first time at the distance. */
  improvement: number | null
}

export interface RecordHistory {
  distance: number
  steps: RecordStep[]
}

/**
 * The moments a new personal record was set, per distance (shortest first): efforts sorted
 * by date, keeping each one faster than every earlier effort at that distance.
 */
export function recordTimeline(efforts: BestEffortRow[]): RecordHistory[] {
  const byDistance = new Map<number, BestEffortRow[]>()
  for (const e of efforts) {
    const list = byDistance.get(e.distance_meters) ?? []
    list.push(e)
    byDistance.set(e.distance_meters, list)
  }
  return [...byDistance.entries()]
    .sort(([a], [b]) => a - b)
    .map(([distance, list]) => {
      const sorted = [...list].sort(
        (a, b) => a.date.localeCompare(b.date) || a.duration_seconds - b.duration_seconds,
      )
      const steps: RecordStep[] = []
      let best = Infinity
      for (const effort of sorted) {
        if (effort.duration_seconds < best) {
          steps.push({ effort, improvement: Number.isFinite(best) ? best - effort.duration_seconds : null })
          best = effort.duration_seconds
        }
      }
      return { distance, steps }
    })
}

/** An improvement in seconds as "−0:42" (or "−1:02:03"). */
export function formatImprovement(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return `−${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${s}`
}

// ── Power curve & FTP ────────────────────────────────────────────────────────

/** Durations (seconds) the backend computes best average power for. */
export const POWER_DURATIONS = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600]

/** Sports that share a power curve; running power and cycling power do not compare. */
export const POWER_SPORTS = {
  running: ['running', 'trail_running'],
  cycling: ['cycling'],
} as const
export type PowerSport = keyof typeof POWER_SPORTS

/** Coggan's estimate: FTP is 95% of the best 20-minute power. */
export const FTP_FACTOR = 0.95
/** Days of history the rolling FTP estimate looks back over. */
export const FTP_WINDOW_DAYS = 42

/** A duration as a short axis label: 5s, 1m, 20m, 60m. */
export function durationLabel(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`
}

/** Activities of the power sport that have a power curve. */
export function withPowerCurve(activities: TrainingActivity[], sport: PowerSport): TrainingActivity[] {
  const sports: readonly string[] = POWER_SPORTS[sport]
  return activities.filter((a) => a.power_curve && sports.includes(a.sport))
}

export interface CurvePoint {
  duration: number
  watts: number
  activity: TrainingActivity
}

/** The best power per duration over the activities on or after `since` (all when null). */
export function bestCurve(activities: TrainingActivity[], since: Date | null = null): CurvePoint[] {
  const best = new Map<number, CurvePoint>()
  for (const a of activities) {
    if (!a.power_curve) continue
    if (since) {
      const d = parseDate(a.date)
      if (!d || d < since) continue
    }
    for (const [key, watts] of Object.entries(a.power_curve)) {
      const duration = Number(key)
      if (!(watts > 0) || !Number.isFinite(duration)) continue
      const current = best.get(duration)
      if (!current || watts > current.watts) best.set(duration, { duration, watts, activity: a })
    }
  }
  return [...best.values()].sort((a, b) => a.duration - b.duration)
}

const twentyMinutes = (a: TrainingActivity) => a.power_curve?.['1200'] ?? 0

/**
 * Estimated FTP at `end`: 95% of the best 20-minute power in the `FTP_WINDOW_DAYS` before it.
 * Null without a 20-minute effort in that window.
 */
export function estimatedFtp(
  activities: TrainingActivity[],
  end: Date,
): { ftp: number; activity: TrainingActivity } | null {
  const start = new Date(end.getTime() - FTP_WINDOW_DAYS * DAY_MS)
  let best: TrainingActivity | null = null
  for (const a of activities) {
    const d = parseDate(a.date)
    if (!d || d < start || d > end || !(twentyMinutes(a) > 0)) continue
    if (!best || twentyMinutes(a) > twentyMinutes(best)) best = a
  }
  return best ? { ftp: twentyMinutes(best) * FTP_FACTOR, activity: best } : null
}

export interface FtpPoint {
  /** First day of the month. */
  month: Date
  ftp: number
  activity: TrainingActivity
}

/**
 * Estimated FTP per month, from the first month with a 20-minute effort up to `today`: the
 * rolling estimate at each month's end (or today for the current month). Months without a
 * 20-minute effort in the window are skipped.
 */
export function monthlyFtp(activities: TrainingActivity[], today = new Date()): FtpPoint[] {
  const dates = activities
    .filter((a) => twentyMinutes(a) > 0)
    .map((a) => parseDate(a.date))
    .filter((d): d is Date => d !== null)
  if (!dates.length) return []
  const first = new Date(Math.min(...dates.map((d) => d.getTime())))
  const points: FtpPoint[] = []
  for (let month = new Date(first.getFullYear(), first.getMonth(), 1); month <= today; ) {
    const next = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    const end = new Date(Math.min(next.getTime() - 1, today.getTime()))
    const estimate = estimatedFtp(activities, end)
    if (estimate) points.push({ month, ...estimate })
    month = next
  }
  return points
}

/** The watch's FTP setting over time: one point per change, in date order. */
export function ftpSettingSteps(activities: TrainingActivity[]): { date: string; ftp: number }[] {
  const steps: { date: string; ftp: number }[] = []
  for (const a of [...activities].sort((x, y) => x.date.localeCompare(y.date))) {
    if (!a.ftp_setting) continue
    if (steps.length && steps[steps.length - 1].ftp === a.ftp_setting) continue
    steps.push({ date: a.date, ftp: a.ftp_setting })
  }
  return steps
}

/** The most recent body weight recorded with an activity. */
export function latestWeight(activities: TrainingActivity[]): number | null {
  let latest: TrainingActivity | null = null
  for (const a of activities) {
    if (a.weight_kg && (!latest || a.date > latest.date)) latest = a
  }
  return latest?.weight_kg ?? null
}

// ── Multisport race breakdown ────────────────────────────────────────────────

export type SplitKind = 'swim' | 't1' | 'bike' | 't2' | 'run' | 'other'

/** What a split label stands for, e.g. "Swim 1.9 km" → swim, "T1" → t1. */
export function splitKind(label: string): SplitKind {
  const text = label.trim().toLowerCase()
  if (/^t\s*1\b|transition\s*1|swim.*bike/.test(text)) return 't1'
  if (/^t\s*2\b|transition\s*2|bike.*run/.test(text)) return 't2'
  if (/swim|zwem/.test(text)) return 'swim'
  if (/bike|cycl|ride|fiets/.test(text)) return 'bike'
  if (/run|loop|lopen/.test(text)) return 'run'
  return 'other'
}

/** Colours of the disciplines and transitions, shared by the breakdown bars and route maps. */
export const KIND_COLORS: Partial<Record<SplitKind, string>> = {
  swim: '#00a3ff',
  t1: '#9ca3af',
  bike: '#00c853',
  t2: '#6b7280',
  run: '#f97316',
}
/** Labels that are not swim, bike, run or a first/second transition. */
export const OTHER_COLORS = ['#7c4dff', '#ff4dd8', '#14b8a6', '#ffb300', '#ff2d55', '#64748b']
// Repeated disciplines (a duathlon's Run 1 and Run 2) get a lighter shade for the second one
const SECOND_SHADE: Partial<Record<SplitKind, string>> = { swim: '#66c7ff', bike: '#5ee08f', run: '#fdba74' }

export const isTransition = (label: string) => /^t\d+$/.test(splitKind(label)) || /^T\s*\d+$/i.test(label.trim())

/** Colour per segment label of one event: by discipline, lighter for its second run/ride/swim. */
export function segmentColors(labels: string[]): string[] {
  const used = new Map<SplitKind, number>()
  return labels.map((label) => {
    if (isTransition(label)) return splitKind(label) === 't2' ? KIND_COLORS.t2! : KIND_COLORS.t1!
    const kind = splitKind(label)
    const base = KIND_COLORS[kind]
    if (!base) return OTHER_COLORS[0]
    const count = used.get(kind) ?? 0
    used.set(kind, count + 1)
    return count > 0 ? (SECOND_SHADE[kind] ?? base) : base
  })
}

/** One leg of a multisport activity on its timeline: seconds from the event's start. */
export interface RouteLeg {
  label: string
  color: string
  start: number
  end: number
}

/** The leg label a sport gets in a breakdown: Swim, Bike, Run or the sport's own name. */
function legLabel(sport: string, fallback: string): string {
  if (/swim/.test(sport)) return 'Swim'
  if (/cycl|bik|rid/.test(sport)) return 'Bike'
  if (/run/.test(sport)) return 'Run'
  return fallback
}

/**
 * The legs of a multisport event placed on its timeline, coloured like the breakdown bar.
 * `legs` are the event's sub-activities; `nameOf` gives the label for sports other than swim,
 * bike and run.
 */
export function routeLegs(
  eventDate: string,
  legs: { sport: string; date: string; duration_seconds: number | null }[],
  nameOf: (sport: string) => string,
): RouteLeg[] {
  const start = parseDate(eventDate)?.getTime()
  if (start === undefined) return []
  const ordered = legs
    .map((leg) => ({ leg, at: parseDate(leg.date)?.getTime() }))
    .filter((x): x is { leg: (typeof legs)[number]; at: number } => x.at !== undefined)
    .sort((a, b) => a.at - b.at)
  const names = ordered.map(({ leg }) => legLabel(leg.sport, nameOf(leg.sport)))
  // Repeated disciplines are numbered, like the breakdown bar: Run 1, Bike, Run 2
  const seen = new Map<string, number>()
  const labels = names.map((name) => {
    if (names.filter((n) => n === name).length < 2) return name
    seen.set(name, (seen.get(name) ?? 0) + 1)
    return `${name} ${seen.get(name)}`
  })
  const colors = segmentColors(labels)
  return ordered.map(({ leg, at }, i) => {
    const from = (at - start) / 1000
    return { label: labels[i], color: colors[i], start: from, end: from + (leg.duration_seconds ?? 0) }
  })
}

const KIND_ORDER: Record<SplitKind, number> = { swim: 0, t1: 1, bike: 2, t2: 3, run: 4, other: 5 }

/** A multisport event as stacked segments: legs and transitions in the order they happened. */
export interface BreakdownEvent {
  /** The event's activity. */
  id: number
  name: string
  date: string
  /** Typed-in race splits, or the legs recorded in the FIT file. */
  source: 'splits' | 'legs'
  segments: { label: string; seconds: number }[]
}

/** A race result with at least two timed, labelled splits, as a breakdown event. */
export function eventFromRace(race: RaceRow): BreakdownEvent | null {
  const segments = [...race.splits]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((s) => s.label.trim() && s.duration_seconds)
    .map((s) => ({ label: s.label.trim(), seconds: s.duration_seconds! }))
  if (segments.length < 2) return null
  return { id: race.activity.id, name: race.activity.name, date: race.activity.date, source: 'splits', segments }
}

/** A multisport activity as a breakdown event, from its legs and the gaps between them. */
export function eventFromLegs(event: MultisportEvent): BreakdownEvent {
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    source: 'legs',
    segments: event.segments.map((s) => ({ label: s.label, seconds: s.seconds })),
  }
}

/**
 * Every multisport event to show, oldest first. Typed-in race splits win over the recorded
 * legs of the same activity, since they are the official times.
 */
export function breakdownEvents(races: RaceRow[], multisport: MultisportEvent[]): BreakdownEvent[] {
  const fromSplits = races.map(eventFromRace).filter((e): e is BreakdownEvent => e !== null)
  const official = new Set(fromSplits.map((e) => e.id))
  const fromLegs = multisport.filter((m) => !official.has(m.id)).map(eventFromLegs)
  return [...fromSplits, ...fromLegs].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The distinct segment labels in stacking order: the order they happened in the events (a
 * duathlon's "Run 1" comes before T1), with swim → T1 → bike → T2 → run only breaking ties
 * between labels at the same position.
 */
export function segmentLabels(events: BreakdownEvent[]): string[] {
  const position = new Map<string, number>()
  for (const event of events) {
    event.segments.forEach((s, i) => position.set(s.label, Math.min(position.get(s.label) ?? Infinity, i)))
  }
  return [...position.keys()].sort(
    (a, b) =>
      (position.get(a) ?? 0) - (position.get(b) ?? 0) ||
      KIND_ORDER[splitKind(a)] - KIND_ORDER[splitKind(b)] ||
      a.localeCompare(b),
  )
}

/** The duration of an event's segment whose label falls under `kind`, if any. */
export function segmentSeconds(event: BreakdownEvent, kind: SplitKind): number | null {
  return event.segments.find((s) => splitKind(s.label) === kind)?.seconds ?? null
}
