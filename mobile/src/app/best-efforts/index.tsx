import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import type { Href } from 'expo-router'
import { Pressable, View } from 'react-native'
import { qs } from '@kinetic/shared/api'
import { curveChart, ftpChart } from '@kinetic/shared/charts/power'
import { recordTimelineChart } from '@kinetic/shared/charts/records'
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
import { formatImprovement, predictRaces, recordTimeline } from '@kinetic/shared/performance'
import type { PowerSport } from '@kinetic/shared/performance'
import { POWER_CAPTION, POWER_SPORT_NAMES, availablePowerSports, pickPowerSport, powerStats, wattsPerKg } from '@kinetic/shared/powerStats'
import { TOP_METRICS, topActivitiesUrl } from '@kinetic/shared/topMetrics'
import type { TopMetric } from '@kinetic/shared/topMetrics'
import type { BestEffortRow, BestEffortsOverview, TrainingOverview } from '@kinetic/shared/types'
import { Icon } from '../../components/Icon'
import { ChartView } from '../../components/PlotView'
import { Caption, Card, Empty, FilterRow, PageHeader, Screen, SectionHeading, SportSelect, Stat, StatGrid, T, Toggle, YearSelect, useColors } from '../../components/ui'
import { useApi } from '../../lib/useApi'
import { useFilters } from '../../lib/useFilters'

const GOLD_TEXT = '#b7791f'

function TrophyTile({ title, icon, value, detail, activityName, activityDate, url }: {
  title: string
  icon?: string
  value: string
  detail?: string
  activityName: string
  activityDate: string
  url: string
}) {
  const c = useColors()
  return (
    <Card onPress={() => router.push(url as Href)} style={{ flexBasis: '47%', flexGrow: 1, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon ?? 'emoji_events'} size={16} color={GOLD_TEXT} />
        <T style={{ fontSize: 12, fontWeight: '700', color: GOLD_TEXT, flexShrink: 1 }} numberOfLines={1}>{title}</T>
      </View>
      <T style={{ fontSize: 22, fontWeight: '800' }}>{value}</T>
      {detail && <Caption>{detail}</Caption>}
      <View style={{ borderTopWidth: 1, borderColor: c.cardBorder, paddingTop: 6, marginTop: 4 }}>
        <T style={{ fontSize: 12 }} numberOfLines={1}>{activityName}</T>
        <Caption>{formatDate(activityDate)}</Caption>
      </View>
    </Card>
  )
}

/** Riegel race-time predictions from the best efforts of the last 12 months. */
function RacePredictor({ efforts, sport }: { efforts: BestEffortRow[]; sport: string }) {
  const { predictions, allTime } = useMemo(() => predictRaces(efforts), [efforts])
  if (!predictions.length) return null
  return (
    <>
      <SectionHeading
        icon="speed"
        title="Race predictor"
        caption={
          allTime
            ? 'No efforts of 3 km or more in the last 12 months, so these use your all-time bests.'
            : "Riegel's formula on your best efforts of 3 km or more from the last 12 months."
        }
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {predictions.map(({ target, seconds, source, record }) => {
          const margin = record ? record.duration_seconds - seconds : null
          return (
            <Card key={target} style={{ flexBasis: '47%', flexGrow: 1, gap: 4 }}>
              <T style={{ fontSize: 12, fontWeight: '700', color: GOLD_TEXT }}>{distanceLabel(target, sport)}</T>
              <T style={{ fontSize: 22, fontWeight: '800' }}>{formatDuration(seconds)}</T>
              <Caption>{formatPace(target, seconds, sport)}</Caption>
              <Pressable onPress={() => record && router.push(`/activity/${record.activity_id}`)}>
                <Caption>Current PR: {record ? formatDuration(record.duration_seconds) : 'none yet'}</Caption>
              </Pressable>
              {margin !== null && Math.round(margin) > 0 && (
                <T style={{ fontSize: 12, color: '#16a34a' }}>Prediction is {formatImprovement(margin).slice(1)} faster than your PR</T>
              )}
              <Pressable onPress={() => router.push(`/activity/${source.activity_id}`)}>
                <Caption>
                  from your {distanceLabel(source.distance_meters, sport)} of {formatDate(source.date)} ({formatDuration(source.duration_seconds)})
                </Caption>
              </Pressable>
            </Card>
          )
        })}
      </View>
    </>
  )
}

const COLLAPSED = 4

/** When each personal record was set, per distance; as a list or a chart. */
function RecordTimeline({ efforts, sport, year }: { efforts: BestEffortRow[]; sport: string; year: number | null }) {
  const c = useColors()
  const [view, setView] = useState<'list' | 'chart'>('list')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const histories = useMemo(
    () =>
      recordTimeline(efforts)
        .map((h) => ({ ...h, steps: year ? h.steps.filter((s) => s.effort.year === year) : h.steps }))
        .filter((h) => h.steps.length > 0),
    [efforts, year],
  )
  const chart = useMemo(() => (view === 'chart' && histories.length ? recordTimelineChart(histories, sport) : null), [view, histories, sport])
  if (!histories.length) return null
  return (
    <>
      <SectionHeading
        icon="trending_up"
        title="Personal-record timeline"
        caption={year ? `Every new personal record set in ${year}.` : 'Every time you set a new personal record.'}
        right={
          <Toggle
            value={view}
            onChange={setView}
            options={[
              ['list', 'List'],
              ['chart', 'Chart'],
            ]}
          />
        }
      />
      {chart ? (
        <Card>
          <ChartView chart={chart} height={420} />
        </Card>
      ) : (
        histories.map(({ distance, steps }) => {
          const newest = [...steps].reverse()
          const open = expanded.has(distance)
          return (
            <Card key={distance} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T style={{ fontWeight: '700' }}>{distanceLabel(distance, sport)}</T>
                <Caption>
                  {steps.length} {steps.length === 1 ? 'record' : 'records'}
                </Caption>
              </View>
              {(open ? newest : newest.slice(0, COLLAPSED)).map(({ effort, improvement }) => (
                <Pressable key={effort.id} onPress={() => router.push(`/activity/${effort.activity_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Caption>{formatDate(effort.date)}</Caption>
                  <T style={{ fontWeight: '700' }}>{formatDuration(effort.duration_seconds)}</T>
                  <T muted style={{ flex: 1, fontSize: 12 }} numberOfLines={1}>{effort.activity_name}</T>
                  <T style={{ fontSize: 12, color: improvement !== null ? '#16a34a' : c.muted }}>{improvement !== null ? formatImprovement(improvement) : 'first'}</T>
                </Pressable>
              ))}
              {newest.length > COLLAPSED && (
                <Pressable
                  onPress={() =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(distance)) next.delete(distance)
                      else next.add(distance)
                      return next
                    })
                  }
                >
                  <T style={{ color: c.primary, fontSize: 12 }}>{open ? 'Show fewer' : `Show all ${newest.length}`}</T>
                </Pressable>
              )}
            </Card>
          )
        })
      )}
    </>
  )
}

/** Power curve, FTP history and W/kg; hidden when no activity has a power curve. */
function PowerSection({ preferRunning }: { preferRunning: boolean }) {
  const { data: training } = useApi<TrainingOverview>('/training')
  const [choice, setChoice] = useState<PowerSport | null>(null)
  const available = useMemo(() => (training ? availablePowerSports(training) : []), [training])
  const sport = pickPowerSport(available, choice, preferRunning)
  const stats = useMemo(() => (training && sport ? powerStats(training, sport) : null), [training, sport])
  const charts = useMemo(
    () => (stats && sport ? [curveChart(stats.activities, stats.weight, POWER_SPORT_NAMES[sport]), ftpChart(stats.monthly, stats.settings, stats.weight, POWER_SPORT_NAMES[sport])] : []),
    [stats, sport],
  )
  if (!sport || !stats) return null
  const { estimate, weight, watchFtp, backendFtp } = stats
  return (
    <>
      <SectionHeading
        icon="bolt"
        title="Power curve & FTP"
        caption={POWER_CAPTION}
        right={
          available.length > 1 && <Toggle<PowerSport> value={sport} onChange={setChoice} options={available.map((s): [PowerSport, string] => [s, POWER_SPORT_NAMES[s]])} />
        }
      />
      <Card>
        <StatGrid>
          <Stat label="Estimated FTP" value={estimate ? `${Math.round(estimate.ftp)} W` : '–'} />
          <Stat label="Per kg" value={wattsPerKg(estimate?.ftp, weight)} />
          <Stat label="Watch FTP" value={watchFtp ? `${Math.round(watchFtp)} W` : '–'} />
          <Stat label="Watch per kg" value={wattsPerKg(watchFtp, weight)} />
          {backendFtp != null && <Stat label="FTP for zones" value={`${Math.round(backendFtp)} W`} />}
          <Stat label="Weight" value={weight ? `${weight.toFixed(1)} kg` : '–'} />
        </StatGrid>
        {estimate && (
          <Pressable onPress={() => router.push(`/activity/${estimate.activity.id}`)}>
            <Caption>
              {estimate.asOf
                ? `No 20-minute effort in the last 6 weeks; latest estimate is from ${estimate.asOf.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}, based on `
                : 'Based on '}
              {estimate.activity.name} of {formatDate(estimate.activity.date)}.
            </Caption>
          </Pressable>
        )}
      </Card>
      {charts.map((chart, i) => (
        <Card key={i}>
          <ChartView chart={chart} height={380} />
        </Card>
      ))}
    </>
  )
}

export default function BestEffortsScreen() {
  const { sport, year, setSport, setYear } = useFilters(ALL_RUNNING)
  const { data: overview } = useApi<BestEffortsOverview>(`/best-efforts/overview${qs({ sport, year })}`)
  // Every effort of the sport over all seasons: predictions and record progressions need history
  const { data: efforts } = useApi<BestEffortRow[]>(`/best-efforts${qs({ sport })}`)
  const sports = resolveSports(sport || ALL_RUNNING) ?? []
  const running = sports.length > 0 && sports.every((s) => s === 'running' || s === 'trail_running')
  const standouts = overview ? (Object.keys(TOP_METRICS) as TopMetric[]).filter((m) => overview.standouts[m]) : []

  return (
    <Screen>
      <PageHeader kicker="Your personal records" title="Your trophy case" subtitle="Every distance. Every climb. Your best, celebrated.">
        <FilterRow>
          <SportSelect value={sport} onChange={setSport} includeAllSports={false} />
          <YearSelect value={year} onChange={setYear} />
        </FilterRow>
      </PageHeader>

      {overview && (
        <>
          {overview.records.length === 0 ? (
            <Empty icon="emoji_events">No {sportLabel(sport || ALL_RUNNING).toLowerCase()} records yet.</Empty>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {overview.records.map((best) => (
                <TrophyTile
                  key={best.distance_meters}
                  title={distanceLabel(best.distance_meters, sport)}
                  value={formatDuration(best.duration_seconds)}
                  detail={formatPace(best.distance_meters, best.duration_seconds, best.sport)}
                  activityName={best.activity_name}
                  activityDate={best.date}
                  url={filteredUrl(`/best-efforts/${distanceSlug(best.distance_meters)}`, sport, year)}
                />
              ))}
            </View>
          )}
          {standouts.length > 0 && (
            <>
              <SectionHeading icon="military_tech" title="Standout achievements" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {standouts.map((metric) => {
                  const config = TOP_METRICS[metric]
                  const best = overview.standouts[metric]!
                  return (
                    <TrophyTile
                      key={metric}
                      title={config.cardTitle}
                      icon={config.icon}
                      value={config.format(best[config.field] ?? 0, best.sport)}
                      activityName={best.name}
                      activityDate={best.date}
                      url={topActivitiesUrl(metric, sport, year)}
                    />
                  )
                })}
              </View>
            </>
          )}
          <Card>
            <T style={{ fontWeight: '700' }}>Your training, at a glance</T>
            <StatGrid>
              <Stat label="Activities" value={overview.summary.count} />
              <Stat label="Distance" value={formatDistance(overview.summary.distance_meters, sport)} />
              <Stat label="Time" value={formatDuration(overview.summary.duration_seconds)} />
            </StatGrid>
          </Card>
        </>
      )}

      {running && efforts && <RacePredictor efforts={efforts} sport={sport || ALL_RUNNING} />}
      {efforts && <RecordTimeline efforts={efforts} sport={sport || ALL_RUNNING} year={year} />}
      <PowerSection preferRunning={running} />
    </Screen>
  )
}
