import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, LinearProgress } from '@mui/material'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatDate } from '@kinetic/shared/format'
import { formatClock } from '@kinetic/shared/speed'
import { formBand } from '@kinetic/shared/training'
import type { FormBand, Range, brickRuns } from '@kinetic/shared/training'
import {
  DYNAMICS,
  TRAINING_CAPTIONS,
  dynamicsChart,
  signed,
  swimChart,
  thresholdText,
  trainingView,
} from '@kinetic/shared/trainingPage'
import type { AnalyseProgress, Dynamics, SwimMetric, ZoneMode } from '@kinetic/shared/trainingPage'
import type { TrainingOverview } from '@kinetic/shared/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ChartCard, Toggle } from '../components/ChartCard'
import { Stat } from '../components/fields'
import { PageHeader, SectionHeading } from '../components/PageHeader'
import { Icon } from '../components/icons'
import { useNotify } from '../components/Notify'
import { Plot } from '../components/Plot'
import { zonesChart } from '@kinetic/shared/charts/training'
import type { Chart } from '@kinetic/shared/charts/training'

const FORM_CLASS: Record<FormBand, string> = {
  Fresh: 'text-positive',
  Neutral: 'text-grey-7',
  Productive: 'text-primary',
  Overreaching: 'text-negative',
}

/** Banner offering to compute the metrics that are missing, with live progress. */
function AnalyseBanner({ pending, onDone }: { pending: number; onDone: () => void }) {
  const notify = useNotify()
  const [progress, setProgress] = useState<AnalyseProgress | null>(null)
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

  const view = useMemo(() => (overview ? trainingView(overview, range) : null), [overview, range])

  // Charts behind a toggle are rebuilt on their own, without redoing the whole page
  const zones = useMemo(() => view && zonesChart(view.zoneWeeks, zoneMode), [view, zoneMode])
  const dynamicsTrend = useMemo(() => view && dynamicsChart(view, dynamics), [view, dynamics])
  const swimTrend = useMemo(() => view && swimChart(view, swimMetric), [view, swimMetric])

  if (!overview || !view) return null
  const thresholds = thresholdText(overview.thresholds)
  const band = view.now ? formBand(view.now.tsb) : null
  const { split } = view

  return (
    <>
      <PageHeader icon="monitor_heart" kicker="Insights" title="Training" subtitle="Fitness, fatigue and form, and how you spread your effort.">
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
      </PageHeader>

      <AnalyseBanner pending={overview.pending} onDone={load} />

      {/* ── Fitness & form ── */}
      <SectionHeading icon="trending_up">Fitness &amp; form</SectionHeading>
      <ChartCard
        caption={
          <>
            {TRAINING_CAPTIONS.fitness}
            {thresholds && ` ${thresholds}`}
          </>
        }
      >
        {view.now && band && (
          <div className="stat-grid q-mb-sm">
            <Stat label="Fitness" value={Math.round(view.now.ctl)} valueClass="text-primary" />
            <Stat label="Fatigue" value={Math.round(view.now.atl)} valueClass="text-grey-7" />
            <Stat
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
          caption={TRAINING_CAPTIONS.weeklyLoad}
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

      <SectionHeading icon="donut_large">Discipline balance</SectionHeading>
      <div className="w-full graphs-grid">
        <ChartCard caption={TRAINING_CAPTIONS.balance}>
          <ChartPlot chart={view.balance} />
        </ChartCard>
        <ChartCard>
          <ChartPlot chart={view.donut} />
        </ChartCard>
      </div>

      {/* ── Consistency ── */}
      <SectionHeading icon="calendar_month">Consistency</SectionHeading>
      <ChartCard caption={TRAINING_CAPTIONS.calendar}>
        <div className="stat-grid q-mb-sm">
          <Stat label="Current streak (days)" value={view.streaks.current} />
          <Stat label="Longest streak (days)" value={view.streaks.longest} />
          <Stat label="Weekly streak (weeks)" value={view.streaks.weekly} />
          <Stat label="Active days in range" value={view.streaks.active} />
        </div>
        <ChartPlot chart={view.calendar} height={240} />
      </ChartCard>

      {/* ── Running ── */}
      {view.hasRuns && (
        <>
          <SectionHeading icon="directions_run">Running</SectionHeading>
          <div className="w-full graphs-grid">
            <ChartCard caption={TRAINING_CAPTIONS.efficiency}>
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
              {dynamicsTrend && <ChartPlot chart={dynamicsTrend} />}
            </ChartCard>
            <ChartCard caption={TRAINING_CAPTIONS.heat}>
              <ChartPlot chart={view.heat} />
            </ChartCard>
            <ChartCard caption={TRAINING_CAPTIONS.gap}>
              <ChartPlot chart={view.gap} />
            </ChartCard>
          </div>
          <ChartCard caption={TRAINING_CAPTIONS.bricks}>
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
      {swimTrend && (
        <>
          <SectionHeading icon="pool">Swimming</SectionHeading>
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
                ? TRAINING_CAPTIONS.swolf
                : TRAINING_CAPTIONS.strokeRate
            }
          >
            <ChartPlot chart={swimTrend} />
          </ChartCard>
        </>
      )}

      {/* ── Decoupling ── */}
      <SectionHeading icon="favorite">Endurance</SectionHeading>
      <ChartCard caption={TRAINING_CAPTIONS.decoupling}>
        <ChartPlot chart={view.decoupling} />
      </ChartCard>
    </>
  )
}
