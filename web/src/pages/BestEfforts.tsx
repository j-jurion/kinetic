import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, qs } from '../lib/api'
import {
  ALL_RUNNING,
  distanceLabel,
  distanceSlug,
  filteredUrl,
  formatDate,
  formatDistance,
  formatDuration,
  formatPace,
  resolveSports,
  sportLabel,
} from '@kinetic/shared/format'
import { TOP_METRICS, topActivitiesUrl } from '@kinetic/shared/topMetrics'
import type { TopMetric } from '@kinetic/shared/topMetrics'
import type { BestEffortRow, BestEffortsOverview } from '@kinetic/shared/types'
import { useFilters } from '../lib/useFilters'
import { useLatestRequest } from '../lib/useLatestRequest'
import { SportSelect, StatTile, YearSelect } from '../components/fields'
import { Icon } from '../components/icons'
import { PowerSection } from '../components/performance/PowerSection'
import { RacePredictor } from '../components/performance/RacePredictor'
import { RecordTimeline } from '../components/performance/RecordTimeline'
import '../styles/trophy.css'

interface TileProps {
  title: string
  icon?: string
  value: string
  activityName: string
  activityDate: string
  url: string
  detail?: string
}

function TrophyTile({ title, icon, value, activityName, activityDate, url, detail }: TileProps) {
  const navigate = useNavigate()
  return (
    <div
      className="card w-full q-pa-md trophy-tile clickable"
      role="link"
      tabIndex={0}
      onClick={() => navigate(url)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(url)}
    >
      <div className="row items-center justify-between no-wrap trophy-tile-heading">
        <div className="row items-center no-wrap gap-2 flex-1 min-w-0">
          <Icon name={icon ?? 'emoji_events'} size={18} className="trophy-record-icon shrink-0" />
          <span className={icon ? 'trophy-record-label trophy-record-label--metric' : 'trophy-record-label'}>{title}</span>
        </div>
      </div>
      <div className="trophy-value q-mt-sm">{value}</div>
      {detail && <div className="trophy-detail q-mt-sm">{detail}</div>}
      <div className="column w-full gap-0 trophy-tile-footer">
        <div className="separator q-mb-sm" />
        <div className="text-body2 ellipsis trophy-activity w-full">{activityName}</div>
        <div className="row items-center no-wrap gap-1 q-mt-xs">
          <Icon name="event" size={15} className="trophy-date" />
          <span className="text-caption trophy-date">{formatDate(activityDate)}</span>
        </div>
      </div>
    </div>
  )
}

export function BestEffortsPage() {
  const { sport, year, setSport, setYear } = useFilters(ALL_RUNNING)
  const [overview, setOverview] = useState<BestEffortsOverview | null>(null)
  // Every effort of the sport over all seasons: predictions and record progressions need history
  const [efforts, setEfforts] = useState<BestEffortRow[] | null>(null)
  const latest = useLatestRequest()
  const latestEfforts = useLatestRequest()

  useEffect(() => {
    latest(api.get<BestEffortsOverview>(`/best-efforts/overview${qs({ sport, year })}`), setOverview)
  }, [sport, year, latest])

  useEffect(() => {
    latestEfforts(api.get<BestEffortRow[]>(`/best-efforts${qs({ sport })}`), setEfforts)
  }, [sport, latestEfforts])

  const sports = resolveSports(sport || ALL_RUNNING) ?? []
  const running = sports.length > 0 && sports.every((s) => s === 'running' || s === 'trail_running')

  const standouts = overview
    ? (Object.keys(TOP_METRICS) as TopMetric[]).filter((m) => overview.standouts[m])
    : []

  return (
    <>
      <div className="card w-full q-pa-lg trophy-hero">
        <div className="row w-full items-center justify-between no-wrap gap-4">
          <div className="column gap-2 trophy-hero-content trophy-hero-copy">
            <div className="trophy-kicker">YOUR PERSONAL RECORDS</div>
            <h1 className="text-h3 text-weight-bold trophy-hero-title q-ma-none">Your trophy case</h1>
            <div className="text-body1 trophy-hero-subtitle">Every distance. Every climb. Your best, celebrated.</div>
          </div>
          <Icon name="emoji_events" size={76} className="trophy-hero-icon trophy-hero-content trophy-hero-art" />
        </div>
      </div>

      <div className="card w-full q-pa-md trophy-filters">
        <div className="row items-center w-full gap-4">
          <div className="column gap-1 trophy-filter-heading">
            <div className="row items-center gap-2">
              <Icon name="tune" size={20} className="trophy-category-icon" />
              <span className="text-subtitle1 text-weight-bold">Explore your records</span>
            </div>
            <span className="text-caption trophy-date">Choose your discipline and season.</span>
          </div>
          <div className="row trophy-filter-controls">
            <SportSelect
              value={sport}
              onChange={setSport}
              includeAllSports={false}
              variant="outlined"
              prependIcon="category"
              className="trophy-filter"
              width={180}
            />
            <YearSelect
              value={year}
              onChange={setYear}
              variant="outlined"
              prependIcon="event"
              className="trophy-filter"
              width={180}
            />
          </div>
        </div>
      </div>

      {overview && (
        <div className="column w-full gap-4">
          <div className="w-full trophy-grid">
            {overview.records.length === 0 ? (
              <div className="trophy-grid-empty">
                <div className="card w-full q-pa-lg items-center gap-0">
                  <Icon name="emoji_events" size={48} color="#ffca28" />
                  <div className="text-grey-6 q-mt-sm">No {sportLabel(sport || ALL_RUNNING).toLowerCase()} records yet.</div>
                </div>
              </div>
            ) : (
              overview.records.map((best) => (
                <div key={best.distance_meters} className="trophy-grid-item">
                  <TrophyTile
                    title={distanceLabel(best.distance_meters, sport)}
                    value={formatDuration(best.duration_seconds)}
                    activityName={best.activity_name}
                    activityDate={best.date}
                    url={filteredUrl(`/best-efforts/${distanceSlug(best.distance_meters)}`, sport, year)}
                    detail={formatPace(best.distance_meters, best.duration_seconds, best.sport)}
                  />
                </div>
              ))
            )}

            {standouts.length > 0 && (
              <div className="row items-center no-wrap gap-3 trophy-section-divider">
                <div className="separator" />
                <span className="text-caption text-weight-bold trophy-date">Standout Achievements</span>
                <div className="separator" />
              </div>
            )}
            {standouts.map((metric) => {
              const config = TOP_METRICS[metric]
              const best = overview.standouts[metric]!
              return (
                <div key={metric} className="trophy-grid-item">
                  <TrophyTile
                    title={config.cardTitle}
                    icon={config.icon}
                    value={config.format(best[config.field] ?? 0, best.sport)}
                    activityName={best.name}
                    activityDate={best.date}
                    url={topActivitiesUrl(metric, sport, year)}
                  />
                </div>
              )
            })}
          </div>

          <div className="card w-full q-pa-md trophy-summary">
            <div className="row items-center gap-2">
              <Icon name="insights" className="text-grey-6" />
              <span className="text-subtitle1 text-weight-bold">Your training, at a glance</span>
            </div>
            <div className="row gap-8 flex-wrap">
              <StatTile label="Total Activities" value={overview.summary.count} />
              <StatTile label="Total Distance" value={formatDistance(overview.summary.distance_meters, sport)} />
              <StatTile label="Total Time" value={formatDuration(overview.summary.duration_seconds)} />
            </div>
          </div>
        </div>
      )}

      <div className="column w-full gap-6 q-mt-lg">
        {running && efforts && <RacePredictor efforts={efforts} sport={sport || ALL_RUNNING} />}
        {efforts && <RecordTimeline efforts={efforts} sport={sport || ALL_RUNNING} year={year} />}
        <PowerSection preferRunning={running} />
      </div>
    </>
  )
}
