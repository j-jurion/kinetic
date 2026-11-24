import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { km } from '@kinetic/shared/activityList'
import type { Totals } from '@kinetic/shared/activityList'
import { change, dashboardSummary, greeting, latestRecords } from '@kinetic/shared/dashboard'
import type { Period } from '@kinetic/shared/dashboard'
import { distanceLabel, distanceSlug, filteredUrl, formatDate, formatDuration, sportLabel } from '@kinetic/shared/format'
import { formBand } from '@kinetic/shared/training'
import type { FormBand } from '@kinetic/shared/training'
import { TRAINING_CAPTIONS, signed, trainingView } from '@kinetic/shared/trainingPage'
import type { ActivityRow, BestEffortRow, TrainingOverview } from '@kinetic/shared/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { useBackgroundJobs } from '../lib/backgroundJobs'
import { ActivityRowCard } from '../components/ActivityMonths'
import { ChartCard } from '../components/ChartCard'
import { EmptyCard, Stat } from '../components/fields'
import { Icon, SportIcon } from '../components/icons'
import { PageHeader, SectionHeading } from '../components/PageHeader'
import { Plot } from '../components/Plot'

const FORM_CLASS: Record<FormBand, string> = {
  Fresh: 'text-positive',
  Neutral: 'text-grey-7',
  Productive: 'text-primary',
  Overreaching: 'text-negative',
}

const FORM_ADVICE: Record<FormBand, string> = {
  Fresh: 'You are rested: a good moment for a hard session or a race.',
  Neutral: 'Fitness and fatigue are in balance.',
  Productive: 'You are building fitness. Keep recovery in mind.',
  Overreaching: 'Fatigue is high: plan some easy days to recover.',
}

/** "2h 23m": hours and minutes, without the seconds. */
function hoursMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  return h ? `${h.toLocaleString('en')}h ${minutes % 60}m` : `${minutes}m`
}

/** A total with its change against the previous period underneath. */
function CompareStat({ label, value, current, previous, unit }: {
  label: string
  value: string
  current: number
  previous: number
  /** How the previous period's value reads, e.g. "12 km last week". */
  unit: (n: number) => string
}) {
  const pct = change(current, previous)
  const up = pct !== null && pct >= 0
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {/* Nothing to compare to (e.g. no activities logged back then): no comparison line */}
      {previous > 0 && (
        <div className="stat-delta">
          {pct !== null && (
            <span className={up ? 'text-positive' : 'text-negative'}>
              <Icon name={up ? 'arrow_upward' : 'arrow_downward'} size={13} /> {Math.abs(Math.round(pct))}%
            </span>
          )}
          <span>{unit(previous)}</span>
        </div>
      )}
    </div>
  )
}

function PeriodStats({ period, previousLabel }: { period: Period; previousLabel: string }) {
  const { current, previous }: { current: Totals; previous: Totals } = period
  return (
    <div className="stat-grid">
      <CompareStat
        label="Activities"
        value={current.count.toLocaleString('en')}
        current={current.count}
        previous={previous.count}
        unit={(n) => `${n} ${previousLabel}`}
      />
      <CompareStat
        label="Distance"
        value={km(current.meters)}
        current={current.meters}
        previous={previous.meters}
        unit={(n) => `${km(n)} ${previousLabel}`}
      />
      <CompareStat
        label="Moving time"
        value={hoursMinutes(current.seconds)}
        current={current.seconds}
        previous={previous.seconds}
        unit={(n) => `${hoursMinutes(n)} ${previousLabel}`}
      />
      <CompareStat
        label="Climbing"
        value={`${Math.round(current.climb).toLocaleString('en')} m`}
        current={current.climb}
        previous={previous.climb}
        unit={(n) => `${Math.round(n).toLocaleString('en')} m ${previousLabel}`}
      />
    </div>
  )
}

/** A card with a title row and an optional link to the page with more. */
function Panel({ icon, title, more, children }: { icon: string; title: string; more?: [string, string]; children: ReactNode }) {
  return (
    <div className="card w-full dashboard-panel">
      <div className="row items-center justify-between no-wrap w-full gap-2">
        <div className="row items-center no-wrap gap-2">
          <Icon name={icon} size={20} className="text-primary" />
          <span className="card-title">{title}</span>
        </div>
        {more && (
          <Link to={more[1]} className="dashboard-more">
            {more[0]} <Icon name="chevron_right" size={16} />
          </Link>
        )}
      </div>
      {children}
    </div>
  )
}

function RecordRow({ effort }: { effort: BestEffortRow }) {
  const sport = effort.sport === 'trail_running' ? 'running' : effort.sport
  return (
    <Link
      to={filteredUrl(`/best-efforts/${distanceSlug(effort.distance_meters)}`, effort.sport === 'trail_running' ? 'all_running' : sport)}
      className="row items-center no-wrap gap-3 w-full card-link dashboard-record"
    >
      <SportIcon sport={effort.sport} size={20} />
      <div className="column gap-0 min-w-0 flex-1">
        <span className="text-weight-bold ellipsis">
          {distanceLabel(effort.distance_meters, sport)} · {sportLabel(sport)}
        </span>
        <span className="text-caption text-grey-6 ellipsis">
          {effort.activity_name} · {formatDate(effort.date)}
        </span>
      </div>
      <span className="dashboard-record-time">{formatDuration(effort.duration_seconds)}</span>
    </Link>
  )
}

export function DashboardPage() {
  const [activities, setActivities] = useState<ActivityRow[] | null>(null)
  const [training, setTraining] = useState<TrainingOverview | null>(null)
  const [efforts, setEfforts] = useState<BestEffortRow[] | null>(null)
  const latestActivities = useLatestRequest()
  const latestTraining = useLatestRequest()
  const latestEfforts = useLatestRequest()
  // Reload when a background sync or upload brings in activities
  const { dataVersion } = useBackgroundJobs()

  useEffect(() => {
    latestActivities(api.get<ActivityRow[]>('/activities'), setActivities)
    latestTraining(api.get<TrainingOverview>('/training'), setTraining)
    latestEfforts(api.get<BestEffortRow[]>('/best-efforts'), setEfforts)
  }, [latestActivities, latestTraining, latestEfforts, dataVersion])

  const summary = useMemo(() => (activities ? dashboardSummary(activities) : null), [activities])
  const view = useMemo(() => (training ? trainingView(training, '3m') : null), [training])
  const records = useMemo(() => (efforts ? latestRecords(efforts) : null), [efforts])
  const band = view?.now ? formBand(view.now.tsb) : null

  const today = new Date()
  const dateText = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <PageHeader icon="space_dashboard" kicker={greeting(today)} title="Dashboard" subtitle={`${dateText}. Here is where your training stands.`} />

      {activities && activities.length === 0 && (
        <EmptyCard icon="directions_run">
          No activities yet. <Link to="/sync">Sync with Garmin or Apple Health</Link> or{' '}
          <Link to="/activities">add one</Link> to fill your dashboard.
        </EmptyCard>
      )}

      {summary && activities && activities.length > 0 && (
        <>
          <SectionHeading icon="date_range">This week</SectionHeading>
          <PeriodStats period={summary.week} previousLabel="last week" />
        </>
      )}

      {view && (
        <>
          <SectionHeading icon="trending_up">Fitness &amp; form</SectionHeading>
          <div className="w-full graphs-grid">
            <ChartCard caption={band ? FORM_ADVICE[band] : TRAINING_CAPTIONS.fitness}>
              {view.now && band && (
                <div className="stat-grid q-mb-sm">
                  <Stat label="Fitness" value={Math.round(view.now.ctl)} valueClass="text-primary" />
                  <Stat label="Fatigue" value={Math.round(view.now.atl)} valueClass="text-grey-7" />
                  <Stat label={`Form · ${band}`} value={signed(view.now.tsb)} valueClass={FORM_CLASS[band]} />
                </div>
              )}
              <Plot data={view.fitness[0]} layout={view.fitness[1]} style={{ height: 300 }} />
            </ChartCard>
            <ChartCard caption={TRAINING_CAPTIONS.balance}>
              <div className="stat-grid q-mb-sm">
                <Stat label="Day streak" value={view.streaks.current} />
                <Stat label="Week streak" value={view.streaks.weekly} />
                <Stat label="Active days · 3 mo" value={view.streaks.active} />
              </div>
              <Plot data={view.balance[0]} layout={view.balance[1]} style={{ height: 300 }} />
            </ChartCard>
          </div>
        </>
      )}

      {summary && activities && activities.length > 0 && (
        <div className="w-full dashboard-grid">
          <Panel icon="history" title="Recent activities" more={['All activities', '/activities']}>
            <div className="column w-full gap-2">
              {summary.recent.map((a) => (
                <ActivityRowCard key={a.id} activity={a} />
              ))}
            </div>
          </Panel>
          <div className="column w-full gap-4">
            <Panel icon="calendar_today" title={`${today.getFullYear()} so far`} more={['Graphs', '/graphs']}>
              <PeriodStats period={summary.year} previousLabel={`by now in ${today.getFullYear() - 1}`} />
            </Panel>
            {records && records.length > 0 && (
              <Panel icon="emoji_events" title="Latest records" more={['Best efforts', '/best-efforts']}>
                <div className="column w-full gap-1">
                  {records.map((effort) => (
                    <RecordRow key={effort.id} effort={effort} />
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </>
  )
}
