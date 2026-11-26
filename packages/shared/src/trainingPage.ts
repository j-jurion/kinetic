// The Training page's calculations, shared by the web and mobile apps: both render the same
// view, charts and captions; only the cards and controls around them differ.
import { sportColor } from './format'
import {
  RAMP_WARNING_PCT,
  activeDays,
  activitiesByDay,
  addDays,
  aerobicEfficiency,
  brickRuns,
  calendarGrid,
  currentStreak,
  dailyLoads,
  dayKey,
  disciplineActivities,
  fitnessSeries,
  gradeAdjustedRuns,
  heatVsPace,
  inRange,
  intensitySplit,
  isRun,
  longDecoupling,
  longestStreak,
  rangeStart,
  runField,
  startOfDay,
  weeklyDisciplines,
  weeklyLoad,
  weeklyStreak,
  weeklyZones,
} from './training'
import type { Range, RunValue } from './training'
import type { TrainingActivity, TrainingOverview } from './types'
import {
  balanceChart,
  balanceDonut,
  brickChart,
  calendarChart,
  decouplingChart,
  fitnessChart,
  gradeAdjustedChart,
  heatChart,
  trendChart,
  weeklyLoadChart,
} from './charts/training'
import type { Chart } from './charts/training'

export type ZoneMode = 'hours' | 'pct'
export type Dynamics = 'avg_step_length' | 'avg_ground_contact' | 'avg_vertical_oscillation' | 'avg_cadence'
export type SwimMetric = 'swolf' | 'stroke_rate'

export const DYNAMICS: Record<Dynamics, { label: string; title: string; format: string; unit: string }> = {
  avg_cadence: { label: 'Cadence', title: 'Cadence (spm)', format: '.0f', unit: 'spm' },
  avg_step_length: { label: 'Step length', title: 'Step length (m)', format: '.2f', unit: 'm' },
  avg_ground_contact: { label: 'Ground contact', title: 'Ground contact time (ms)', format: '.0f', unit: 'ms' },
  avg_vertical_oscillation: { label: 'Vertical osc.', title: 'Vertical oscillation (cm)', format: '.1f', unit: 'cm' },
}

export interface AnalyseProgress {
  done: number
  total: number
  name: string
}

export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`

/** "Zones and load use max HR 192 bpm (watch) and threshold 175 bpm (watch)". */
export function thresholdText(t: TrainingOverview['thresholds']): string | null {
  const hr = (label: string, value: number | null, source: string | null) =>
    value ? `${label} ${Math.round(value)} bpm${source ? ` (${source})` : ''}` : null
  const parts = [hr('max HR', t.max_hr, t.max_hr_source), hr('threshold', t.threshold_hr, t.threshold_hr_source)].filter(
    (p): p is string => p !== null,
  )
  if (!parts.length && !t.ftp_cycling) return null
  let text = parts.length ? `Zones and load use ${parts.join(' and ')}` : 'Load uses heart rate'
  // Only rides use power for their load (runs use heart rate, even with running power)
  if (t.ftp_cycling) text += `; rides with power use your cycling FTP of ${Math.round(t.ftp_cycling)} W`
  return `${text}.`
}

/** Everything the Training page shows for a range, computed once per load or range change. */
export function trainingView(overview: TrainingOverview, range: Range, today = new Date()) {
  const all: TrainingActivity[] = overview.activities
  const from = rangeStart(range, today)

  // ── Fitness and form ──
  const fitness = fitnessSeries(all, today)
  const now = fitness[fitness.length - 1] ?? null
  const fitnessShown = from ? fitness.filter((d) => d.date >= from) : fitness

  // ── Weekly load, intensity and balance ──
  const zoneWeeks = weeklyZones(all, from, today)
  const balanceWeeks = weeklyDisciplines(all, from, today)

  // ── Consistency: the calendar spans at least the last 52 weeks ──
  const days = activeDays(all)
  const byDay = activitiesByDay(all)
  const yearAgo = addDays(startOfDay(today), -7 * 52 + 1)
  const calendarFrom = from && from > yearAgo ? from : yearAgo
  // Day keys sort like dates
  const fromKey = from ? dayKey(from) : ''
  const activeInRange = [...days].filter((key) => key >= fromKey).length

  // ── Per-discipline trends use the legs of multisport events ──
  const legs = disciplineActivities(all)
  const hasRuns = legs.some(isRun)
  const bricks = brickRuns(legs).filter((b) => inRange(b.activity.date, from))
  const swims: RunValue[] = legs
    .filter((a) => a.avg_swolf !== null)
    .map((a) => ({ activity: a, value: a.avg_swolf! }))
  const strokes: RunValue[] = legs
    .filter((a) => a.avg_stroke_rate !== null)
    .map((a) => ({ activity: a, value: a.avg_stroke_rate! }))

  return {
    now,
    fitness: fitnessChart(fitnessShown, byDay),
    weeklyLoad: weeklyLoadChart(weeklyLoad(all, from, today)),
    zoneWeeks,
    split: intensitySplit(zoneWeeks),
    balance: balanceChart(balanceWeeks),
    donut: balanceDonut(balanceWeeks),
    calendar: calendarChart(calendarGrid(dailyLoads(all), days, calendarFrom, today), byDay),
    streaks: {
      current: currentStreak(days, today),
      longest: longestStreak(days),
      weekly: weeklyStreak(days, today),
      active: activeInRange,
    },
    hasRuns,
    efficiency: trendChart(aerobicEfficiency(legs), from, {
      title: 'Aerobic efficiency',
      yTitle: 'm/min per bpm',
      color: sportColor('running'),
      format: '.2f',
      unit: 'm/min/bpm',
    }),
    heat: heatChart(heatVsPace(legs).filter((p) => inRange(p.activity.date, from))),
    gap: gradeAdjustedChart(gradeAdjustedRuns(legs).filter((r) => inRange(r.activity.date, from))),
    bricks,
    brickChart: brickChart(bricks),
    legs,
    from,
    swims,
    strokes,
    decoupling: decouplingChart(longDecoupling(all).filter((a) => inRange(a.date, from))),
  }
}

export type TrainingView = ReturnType<typeof trainingView>

/** The running-dynamics trend for the chosen metric. */
export function dynamicsChart(view: TrainingView, dynamics: Dynamics): Chart {
  const config = DYNAMICS[dynamics]
  return trendChart(runField(view.legs, dynamics), view.from, {
    title: `Running dynamics – ${config.label.toLowerCase()}`,
    yTitle: config.title,
    color: sportColor('trail_running'),
    format: config.format,
    unit: config.unit,
  })
}

/** The SWOLF or stroke-rate trend; null without swims. */
export function swimChart(view: TrainingView, metric: SwimMetric): Chart | null {
  if (!view.swims.length) return null
  const swolf = metric === 'swolf'
  return trendChart(swolf ? view.swims : view.strokes, view.from, {
    title: swolf ? 'SWOLF' : 'Stroke rate',
    yTitle: swolf ? 'SWOLF' : 'Strokes / min',
    color: sportColor('swimming'),
    format: '.0f',
    unit: swolf ? '' : 'spm',
  })
}

/** Explanations under the Training charts. */
export const TRAINING_CAPTIONS = {
  fitness:
    'Fitness is the 42-day and fatigue the 7-day weighted average of your daily load (one hour at threshold = 100). ' +
    'Form is yesterday\'s fitness minus fatigue: green above +5 is fresh, blue −10 to −30 is productive training, ' +
    'red below −30 is overreaching.',
  weeklyLoad: `Bars turn amber when the 4-week average load rises more than ${RAMP_WARNING_PCT}% in a week (dashed line): building that fast raises the risk of injury and illness.`,
  balance: 'Moving time per week. Multisport events count per leg; running includes trail running.',
  calendar: 'Each square is a day, darker for a higher training load.',
  efficiency:
    'Speed (metres per minute) per heartbeat on steady runs; races, intervals and tempo runs are left out. Higher = more speed per heartbeat.',
  heat:
    "A Garmin watch measures temperature on the wrist, which reads warm (body heat, sun); Apple Health workouts use the weather at the time.",
  gap: 'Grade-adjusted pace (GAP) is the flat-ground equivalent effort. Shown for trail runs and runs with at least 15 m of climbing per km.',
  bricks:
    'Runs straight off the bike: multisport run legs after a ride, or runs starting within 30 minutes of a ride ending. ' +
    'Compared with the average pace of your other runs within ±30% of the distance.',
  swolf: 'SWOLF is the seconds plus strokes per length: lower is more efficient.',
  strokeRate: 'Average strokes per minute.',
  decoupling:
    'How much output per heartbeat (pace or power) drops from the first to the second half of sessions of an hour or more. ' +
    'Below 5% (dashed line) means your aerobic base held up well.',
}

/** The 80/20 caption under the intensity chart, or null without zone time. */
export function intensityCaption(split: TrainingView['split']): string | null {
  if (!(split.totalSeconds > 0)) return null
  return (
    `Easy (Z1–Z2) ${Math.round(split.easy)}% · moderate (Z3) ${Math.round(split.moderate)}% · hard (Z4–Z5) ${Math.round(split.hard)}%. ` +
    'The 80/20 guideline is about 80% easy and 20% moderate or hard' +
    (split.easy >= 75 ? ' — you are close to it.' : ' — more easy time would match it better.')
  )
}
