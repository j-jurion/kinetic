import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, LinearProgress } from '@mui/material'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatDate, sportColor } from '../lib/format'
import { formatClock } from '../lib/speed'
import {
  RAMP_WARNING_PCT,
  activeDays,
  addDays,
  aerobicEfficiency,
  brickRuns,
  calendarGrid,
  currentStreak,
  dailyLoads,
  dayKey,
  disciplineActivities,
  fitnessSeries,
  formBand,
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
} from '../lib/training'
import type { FormBand, Range, RunValue } from '../lib/training'
import type { TrainingActivity, TrainingOverview } from '../lib/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ChartCard, Toggle } from '../components/ChartCard'
import { StatTile } from '../components/fields'
import { Icon } from '../components/icons'
import { useNotify } from '../components/Notify'
import { Plot } from '../components/Plot'
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
  zonesChart,
} from '../components/training/charts'
import type { Chart } from '../components/training/charts'

type ZoneMode = 'hours' | 'pct'
type Dynamics = 'avg_step_length' | 'avg_ground_contact' | 'avg_vertical_oscillation' | 'avg_cadence'
type SwimMetric = 'swolf' | 'stroke_rate'

const DYNAMICS: Record<Dynamics, { label: string; title: string; format: string; unit: string }> = {
  avg_cadence: { label: 'Cadence', title: 'Cadence (spm)', format: '.0f', unit: 'spm' },
  avg_step_length: { label: 'Step length', title: 'Step length (m)', format: '.2f', unit: 'm' },
  avg_ground_contact: { label: 'Ground contact', title: 'Ground contact time (ms)', format: '.0f', unit: 'ms' },
  avg_vertical_oscillation: { label: 'Vertical osc.', title: 'Vertical oscillation (cm)', format: '.1f', unit: 'cm' },
}

const FORM_CLASS: Record<FormBand, string> = {
  Fresh: 'text-positive',
  Neutral: 'text-grey-7',
  Productive: 'text-primary',
  Overreaching: 'text-negative',
}

interface Progress {
  done: number
  total: number
  name: string
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`

function SectionTitle({ children }: { children: string }) {
  return <div className="text-h6 text-weight-bold q-mt-sm">{children}</div>
}

/** "Zones and load use max HR 192 bpm (watch) and threshold 175 bpm (watch)". */
function thresholdText(t: TrainingOverview['thresholds']): string | null {
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

/** Banner offering to compute the metrics that are missing, with live progress. */
function AnalyseBanner({ pending, onDone }: { pending: number; onDone: () => void }) {
  const notify = useNotify()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [running, setRunning] = useState(false)

  const analyse = async () => {
    setRunning(true)
    setProgress(null)
    try {
      const response = await fetch('/api/training/analyse', { method: 'POST', credentials: 'same-origin' })
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Analysing failed')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const message = JSON.parse(line)
          if (message.type === 'progress') {
            setProgress({ done: message.done, total: message.total, name: message.name ?? '' })
          } else if (message.type === 'result') {
            const failed = message.failed ? `, ${message.failed} failed` : ''
            notify(`Analysed ${message.computed} activities${failed}`, message.failed ? 'warning' : 'success')
          } else if (message.type === 'error') {
            notify(message.message, 'error', 8000)
          }
        }
      }
    } catch (error) {
      notify((error as Error).message, 'error', 8000)
    } finally {
      setRunning(false)
      onDone()
    }
  }

  if (!pending && !running) return null
  return (
    <div className="card w-full q-pa-md gap-2">
      <div className="row items-center justify-between w-full no-wrap gap-3">
        <div className="row items-center no-wrap gap-2">
          <Icon name="insights" className="text-primary" />
          <span>
            {running
              ? progress
                ? `Analysing ${progress.done} of ${progress.total}${progress.name ? ` · ${progress.name}` : ''}`
                : 'Starting analysis…'
              : `${pending} ${pending === 1 ? 'activity is' : 'activities are'} not analysed yet, so some charts are incomplete.`}
          </span>
        </div>
        <Button variant="contained" size="small" disabled={running} onClick={analyse}>
          Analyse now
        </Button>
      </div>
      {running && (
        <LinearProgress
          className="w-full"
          variant={progress?.total ? 'determinate' : 'indeterminate'}
          value={progress?.total ? (progress.done / progress.total) * 100 : 0}
        />
      )}
    </div>
  )
}

function ChartPlot({ chart, height = 340 }: { chart: Chart; height?: number }) {
  return <Plot data={chart[0]} layout={chart[1]} style={{ height }} />
}

function BrickTable({ activities }: { activities: ReturnType<typeof brickRuns> }) {
  return (
    <table className="data-table w-full">
      <thead>
        <tr>
          <th>Date</th>
          <th>Run</th>
          <th className="text-right">Distance</th>
          <th className="text-right">Pace</th>
          <th className="text-right">Normal runs</th>
          <th className="text-right">Difference</th>
        </tr>
      </thead>
      <tbody>
        {[...activities].reverse().map((b) => (
          <tr key={b.activity.id}>
            <td>{formatDate(b.activity.date)}</td>
            <td>
              <Link to={`/activity/${b.activity.parent_id ?? b.activity.id}`}>{b.activity.name}</Link>
            </td>
            <td className="text-right">{((b.activity.distance_meters ?? 0) / 1000).toFixed(1)} km</td>
            <td className="text-right">{formatClock(b.pace)} /km</td>
            <td className="text-right">
              {b.normalPace !== null ? `${formatClock(b.normalPace)} /km (${b.normalCount})` : '–'}
            </td>
            <td className="text-right">{b.normalPace !== null ? `${signed(b.pace - b.normalPace)} s/km` : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TrainingPage() {
  const [overview, setOverview] = useState<TrainingOverview | null>(null)
  const [range, setRange] = useState<Range>('12m')
  const [zoneMode, setZoneMode] = useState<ZoneMode>('hours')
  const [dynamics, setDynamics] = useState<Dynamics>('avg_cadence')
  const [swimMetric, setSwimMetric] = useState<SwimMetric>('swolf')
  const latest = useLatestRequest()

  const load = useCallback(() => latest(api.get<TrainingOverview>('/training'), setOverview), [latest])
  useEffect(load, [load])

  const view = useMemo(() => {
    if (!overview) return null
    const all: TrainingActivity[] = overview.activities
    const today = new Date()
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
      fitness: fitnessChart(fitnessShown),
      weeklyLoad: weeklyLoadChart(weeklyLoad(all, from, today)),
      zoneWeeks,
      split: intensitySplit(zoneWeeks),
      balance: balanceChart(balanceWeeks),
      donut: balanceDonut(balanceWeeks),
      calendar: calendarChart(calendarGrid(dailyLoads(all), days, calendarFrom, today)),
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
  }, [overview, range])

  // Charts behind a toggle are rebuilt on their own, without redoing the whole page
  const zones = useMemo(() => view && zonesChart(view.zoneWeeks, zoneMode), [view, zoneMode])
  const dynamicsChart = useMemo(() => {
    if (!view) return null
    const config = DYNAMICS[dynamics]
    return trendChart(runField(view.legs, dynamics), view.from, {
      title: `Running dynamics – ${config.label.toLowerCase()}`,
      yTitle: config.title,
      color: sportColor('trail_running'),
      format: config.format,
      unit: config.unit,
    })
  }, [view, dynamics])
  const swimChart = useMemo(() => {
    if (!view || !view.swims.length) return null
    const swolf = swimMetric === 'swolf'
    return trendChart(swolf ? view.swims : view.strokes, view.from, {
      title: swolf ? 'SWOLF' : 'Stroke rate',
      yTitle: swolf ? 'SWOLF' : 'Strokes / min',
      color: sportColor('swimming'),
      format: '.0f',
      unit: swolf ? '' : 'spm',
    })
  }, [view, swimMetric])

  if (!overview || !view) return null
  const thresholds = thresholdText(overview.thresholds)
  const band = view.now ? formBand(view.now.tsb) : null
  const { split } = view

  return (
    <>
      <div className="row items-center justify-between w-full flex-wrap gap-3">
        <div className="text-h5 text-weight-bold">Training</div>
        <Toggle<Range>
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            ['3m', '3 months'],
            ['12m', '12 months'],
            ['all', 'All'],
          ]}
        />
      </div>

      <AnalyseBanner pending={overview.pending} onDone={load} />

      {/* ── Fitness & form ── */}
      <ChartCard
        caption={
          <>
            Fitness is the 42-day and fatigue the 7-day weighted average of your daily load (one hour at threshold
            = 100). Form is yesterday&apos;s fitness minus fatigue: green above +5 is fresh, blue −10 to −30 is
            productive training, red below −30 is overreaching.
            {thresholds && ` ${thresholds}`}
          </>
        }
      >
        {view.now && band && (
          <div className="row justify-around w-full q-pa-sm">
            <StatTile label="Fitness" value={Math.round(view.now.ctl)} valueClass="text-primary" />
            <StatTile label="Fatigue" value={Math.round(view.now.atl)} valueClass="text-grey-7" />
            <StatTile
              label={`Form · ${band}`}
              value={signed(view.now.tsb)}
              valueClass={FORM_CLASS[band]}
            />
          </div>
        )}
        <ChartPlot chart={view.fitness} height={420} />
      </ChartCard>

      <div className="w-full graphs-grid">
        <ChartCard
          caption={`Bars turn amber when the 4-week average load rises more than ${RAMP_WARNING_PCT}% in a week (dashed line): building that fast raises the risk of injury and illness.`}
        >
          <ChartPlot chart={view.weeklyLoad} />
        </ChartCard>
        <ChartCard
          controls={
            <Toggle<ZoneMode>
              label="Unit"
              value={zoneMode}
              onChange={setZoneMode}
              options={[
                ['hours', 'Hours'],
                ['pct', '% share'],
              ]}
            />
          }
          caption={
            split.totalSeconds > 0 ? (
              <>
                Easy (Z1–Z2) <b>{Math.round(split.easy)}%</b> · moderate (Z3) <b>{Math.round(split.moderate)}%</b> ·
                hard (Z4–Z5) <b>{Math.round(split.hard)}%</b>. The 80/20 guideline is about 80% easy and 20% moderate
                or hard{split.easy >= 75 ? ' — you are close to it.' : ' — more easy time would match it better.'}
              </>
            ) : undefined
          }
        >
          {zones && <ChartPlot chart={zones} />}
        </ChartCard>
      </div>

      <div className="w-full graphs-grid">
        <ChartCard caption="Moving time per week. Multisport events count per leg; running includes trail running.">
          <ChartPlot chart={view.balance} />
        </ChartCard>
        <ChartCard>
          <ChartPlot chart={view.donut} />
        </ChartCard>
      </div>

      {/* ── Consistency ── */}
      <ChartCard caption="Each square is a day, darker for a higher training load.">
        <div className="row justify-around w-full q-pa-sm">
          <StatTile label="Current streak (days)" value={view.streaks.current} />
          <StatTile label="Longest streak (days)" value={view.streaks.longest} />
          <StatTile label="Weekly streak (weeks)" value={view.streaks.weekly} />
          <StatTile label="Active days in range" value={view.streaks.active} />
        </div>
        <ChartPlot chart={view.calendar} height={240} />
      </ChartCard>

      {/* ── Running ── */}
      {view.hasRuns && (
        <>
          <SectionTitle>Running</SectionTitle>
          <div className="w-full graphs-grid">
            <ChartCard caption="Speed (metres per minute) per heartbeat on steady runs; races, intervals and tempo runs are left out. Higher = more speed per heartbeat.">
              <ChartPlot chart={view.efficiency} />
            </ChartCard>
            <ChartCard
              controls={
                <Toggle<Dynamics>
                  label="Running dynamics"
                  value={dynamics}
                  onChange={setDynamics}
                  options={Object.entries(DYNAMICS).map(([key, c]): [Dynamics, string] => [key as Dynamics, c.label])}
                />
              }
            >
              {dynamicsChart && <ChartPlot chart={dynamicsChart} />}
            </ChartCard>
            <ChartCard caption="The watch's temperature sensor reads warm (body heat, sun), so values are higher than the air temperature.">
              <ChartPlot chart={view.heat} />
            </ChartCard>
            <ChartCard caption="Grade-adjusted pace (GAP) is the flat-ground equivalent effort. Shown for trail runs and runs with at least 15 m of climbing per km.">
              <ChartPlot chart={view.gap} />
            </ChartCard>
          </div>
          <ChartCard caption="Runs straight off the bike: multisport run legs after a ride, or runs starting within 30 minutes of a ride ending. Compared with the average pace of your other runs within ±30% of the distance.">
            {view.bricks.length ? (
              <div className="column w-full gap-2">
                <ChartPlot chart={view.brickChart} height={300} />
                <div className="w-full" style={{ overflowX: 'auto' }}>
                  <BrickTable activities={view.bricks} />
                </div>
              </div>
            ) : (
              <div className="column items-center w-full q-pa-xl gap-0">
                <div className="text-subtitle1 text-weight-medium">Brick runs</div>
                <div className="text-grey-6">No brick runs yet{view.from ? ' in this period' : ''}.</div>
              </div>
            )}
          </ChartCard>
        </>
      )}

      {/* ── Swimming ── */}
      {swimChart && (
        <>
          <SectionTitle>Swimming</SectionTitle>
          <ChartCard
            controls={
              <Toggle<SwimMetric>
                label="Swim metric"
                value={swimMetric}
                onChange={setSwimMetric}
                options={[
                  ['swolf', 'SWOLF'],
                  ['stroke_rate', 'Stroke rate'],
                ]}
              />
            }
            caption={
              swimMetric === 'swolf'
                ? 'SWOLF is the seconds plus strokes per length: lower is more efficient.'
                : 'Average strokes per minute.'
            }
          >
            <ChartPlot chart={swimChart} />
          </ChartCard>
        </>
      )}

      {/* ── Decoupling ── */}
      <SectionTitle>Endurance</SectionTitle>
      <ChartCard caption="How much output per heartbeat (pace or power) drops from the first to the second half of sessions of an hour or more. Below 5% (dashed line) means your aerobic base held up well.">
        <ChartPlot chart={view.decoupling} />
      </ChartCard>
    </>
  )
}
