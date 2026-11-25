// The Training page: the same view, charts and captions as the web
// (packages/shared/src/trainingPage.ts), in mobile cards.
import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import { View } from 'react-native'
import { zonesChart } from '@kinetic/shared/charts/training'
import type { Chart } from '@kinetic/shared/charts/training'
import { formatDate } from '@kinetic/shared/format'
import { formatClock } from '@kinetic/shared/speed'
import { formBand } from '@kinetic/shared/training'
import type { FormBand, Range } from '@kinetic/shared/training'
import {
  DYNAMICS,
  TRAINING_CAPTIONS,
  analyseSummary,
  dynamicsChart,
  intensityCaption,
  signed,
  swimChart,
  thresholdText,
  trainingView,
} from '@kinetic/shared/trainingPage'
import type { AnalyseFailure, AnalyseProgress, Dynamics, SwimMetric, ZoneMode } from '@kinetic/shared/trainingPage'
import type { TrainingOverview } from '@kinetic/shared/types'
import { Icon } from '../components/Icon'
import { useNotify } from '../components/Notify'
import { ChartView } from '../components/PlotView'
import { Table } from '../components/Table'
import { Button, Caption, Card, Loading, PageHeader, Screen, SectionHeading, Stat, StatGrid, T, Toggle, useColors } from '../components/ui'
import { postStream } from '../lib/api'
import { useApi } from '../lib/useApi'

const FORM_COLORS: Record<FormBand, string> = {
  Fresh: '#16a34a',
  Neutral: '#6b7280',
  Productive: '#f97316',
  Overreaching: '#c10015',
}

/** A chart card with optional controls above and a caption below. */
function ChartCard({ chart, height = 320, caption, controls, children }: {
  chart?: Chart | null
  height?: number
  caption?: string | null
  controls?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Card>
      {controls}
      {children}
      {chart && <ChartView chart={chart} height={height} />}
      {caption && <Caption>{caption}</Caption>}
    </Card>
  )
}

/** Banner offering to compute the metrics that are missing, with live progress. */
function AnalyseBanner({ pending, onDone }: { pending: number; onDone: () => void }) {
  const notify = useNotify()
  const c = useColors()
  const [progress, setProgress] = useState<AnalyseProgress | null>(null)
  const [running, setRunning] = useState(false)

  const analyse = async () => {
    setRunning(true)
    setProgress(null)
    try {
      await postStream('/training/analyse', {}, (message) => {
        if (message.type === 'progress') {
          setProgress({ done: message.done as number, total: message.total as number, name: (message.name as string) ?? '' })
        } else if (message.type === 'result') {
          const failed = (message.failures as AnalyseFailure[] | undefined) ?? []
          const summary = analyseSummary(message.computed as number, failed)
          if (!failed.length) notify(summary, 'success')
          else notify(`${summary}: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}`, 'warning', 15000)
        } else if (message.type === 'error') {
          notify(String(message.message), 'error', 8000)
        }
      })
    } catch (error) {
      notify((error as Error).message, 'error', 8000)
    } finally {
      setRunning(false)
      onDone()
    }
  }

  if (!pending && !running) return null
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Icon name="insights" color={c.primary} />
        <T style={{ flex: 1 }}>
          {running
            ? progress
              ? `Analysing ${progress.done} of ${progress.total}${progress.name ? ` · ${progress.name}` : ''}`
              : 'Starting analysis…'
            : `${pending} ${pending === 1 ? 'activity is' : 'activities are'} not analysed yet, so some charts are incomplete.`}
        </T>
      </View>
      {running && progress?.total ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: c.soft }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.primary, width: `${(progress.done / progress.total) * 100}%` }} />
        </View>
      ) : null}
      <Button title="Analyse now" onPress={analyse} busy={running} />
    </Card>
  )
}

export default function TrainingScreen() {
  const [range, setRange] = useState<Range>('12m')
  const [zoneMode, setZoneMode] = useState<ZoneMode>('hours')
  const [dynamics, setDynamics] = useState<Dynamics>('avg_cadence')
  const [swimMetric, setSwimMetric] = useState<SwimMetric>('swolf')
  const { data: overview, reload } = useApi<TrainingOverview>('/training')

  const view = useMemo(() => (overview ? trainingView(overview, range) : null), [overview, range])
  const zones = useMemo(() => view && zonesChart(view.zoneWeeks, zoneMode), [view, zoneMode])
  const dynamicsTrend = useMemo(() => view && dynamicsChart(view, dynamics), [view, dynamics])
  const swimTrend = useMemo(() => view && swimChart(view, swimMetric), [view, swimMetric])

  if (!overview || !view) return <Loading />
  const thresholds = thresholdText(overview.thresholds)
  const band = view.now ? formBand(view.now.tsb) : null

  return (
    <Screen onRefresh={reload}>
      <PageHeader kicker="Insights" title="Training" subtitle="Fitness, fatigue and form, and how you spread your effort.">
        <Toggle<Range>
          value={range}
          onChange={setRange}
          options={[
            ['3m', '3 months'],
            ['12m', '12 months'],
            ['all', 'All'],
          ]}
        />
      </PageHeader>

      <AnalyseBanner pending={overview.pending} onDone={reload} />

      <SectionHeading icon="trending_up" title="Fitness & form" />
      <ChartCard chart={view.fitness} height={380} caption={`${TRAINING_CAPTIONS.fitness}${thresholds ? ` ${thresholds}` : ''}`}>
        {view.now && band && (
          <StatGrid>
            <Stat label="Fitness" value={Math.round(view.now.ctl)} color="#f97316" />
            <Stat label="Fatigue" value={Math.round(view.now.atl)} />
            <Stat label={`Form · ${band}`} value={signed(view.now.tsb)} color={FORM_COLORS[band]} />
          </StatGrid>
        )}
      </ChartCard>
      <ChartCard chart={view.weeklyLoad} caption={TRAINING_CAPTIONS.weeklyLoad} />
      <ChartCard
        chart={zones}
        caption={intensityCaption(view.split)}
        controls={
          <Toggle<ZoneMode>
            value={zoneMode}
            onChange={setZoneMode}
            options={[
              ['hours', 'Hours'],
              ['pct', '% share'],
            ]}
          />
        }
      />

      <SectionHeading icon="donut_large" title="Discipline balance" />
      <ChartCard chart={view.balance} caption={TRAINING_CAPTIONS.balance} />
      <ChartCard chart={view.donut} />

      <SectionHeading icon="calendar_month" title="Consistency" />
      <ChartCard chart={view.calendar} height={240} caption={TRAINING_CAPTIONS.calendar}>
        <StatGrid>
          <Stat label="Current streak (days)" value={view.streaks.current} />
          <Stat label="Longest streak (days)" value={view.streaks.longest} />
          <Stat label="Weekly streak (weeks)" value={view.streaks.weekly} />
          <Stat label="Active days in range" value={view.streaks.active} />
        </StatGrid>
      </ChartCard>

      {view.hasRuns && (
        <>
          <SectionHeading icon="directions_run" title="Running" />
          <ChartCard chart={view.efficiency} caption={TRAINING_CAPTIONS.efficiency} />
          <ChartCard
            chart={dynamicsTrend}
            controls={
              <Toggle<Dynamics>
                value={dynamics}
                onChange={setDynamics}
                options={Object.entries(DYNAMICS).map(([key, config]): [Dynamics, string] => [key as Dynamics, config.label])}
              />
            }
          />
          <ChartCard chart={view.heat} caption={TRAINING_CAPTIONS.heat} />
          <ChartCard chart={view.gap} caption={TRAINING_CAPTIONS.gap} />
          {view.bricks.length ? (
            <ChartCard chart={view.brickChart} height={300} caption={TRAINING_CAPTIONS.bricks}>
              <Table
                rows={[...view.bricks].reverse()}
                rowKey={(b) => b.activity.id}
                onRowPress={(b) => router.push(`/activity/${b.activity.parent_id ?? b.activity.id}`)}
                columns={[
                  { label: 'Date', width: 84, render: (b) => formatDate(b.activity.date) },
                  { label: 'Run', width: 130, render: (b) => b.activity.name },
                  { label: 'Distance', width: 70, align: 'right', render: (b) => `${((b.activity.distance_meters ?? 0) / 1000).toFixed(1)} km` },
                  { label: 'Pace', width: 70, align: 'right', render: (b) => `${formatClock(b.pace)} /km` },
                  {
                    label: 'Normal',
                    width: 96,
                    align: 'right',
                    render: (b) => (b.normalPace !== null ? `${formatClock(b.normalPace)} /km (${b.normalCount})` : '–'),
                  },
                  { label: 'Diff', width: 70, align: 'right', render: (b) => (b.normalPace !== null ? `${signed(b.pace - b.normalPace)} s/km` : '–') },
                ]}
              />
            </ChartCard>
          ) : (
            <Card>
              <T style={{ fontWeight: '600' }}>Brick runs</T>
              <Caption>No brick runs yet{view.from ? ' in this period' : ''}.</Caption>
            </Card>
          )}
        </>
      )}

      {swimTrend && (
        <>
          <SectionHeading icon="pool" title="Swimming" />
          <ChartCard
            chart={swimTrend}
            caption={swimMetric === 'swolf' ? TRAINING_CAPTIONS.swolf : TRAINING_CAPTIONS.strokeRate}
            controls={
              <Toggle<SwimMetric>
                value={swimMetric}
                onChange={setSwimMetric}
                options={[
                  ['swolf', 'SWOLF'],
                  ['stroke_rate', 'Stroke rate'],
                ]}
              />
            }
          />
        </>
      )}

      <SectionHeading icon="favorite" title="Endurance" />
      <ChartCard chart={view.decoupling} caption={TRAINING_CAPTIONS.decoupling} />
    </Screen>
  )
}
