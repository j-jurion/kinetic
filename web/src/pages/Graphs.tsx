import { useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { api, qs } from '../lib/api'
import {
  ALL_RUNNING,
  GOLD,
  distanceLabel,
  formatDate,
  formatDuration,
  formatPace,
  isSwimming,
  kindLabel,
  sportColor,
  sportLabel,
  toIsoLocal,
} from '../lib/format'
import {
  KIND_COLORS,
  cumulativeByYear,
  inYear,
  metricConfig,
  monthlyTotals,
  paceAsTime,
  paceTrend,
  personalBestProgression,
  rollingAverage,
  totalsBy,
  weeklyTotals,
  yearlyTotals,
} from '../lib/graphs'
import type { Metric, MetricConfig } from '../lib/graphs'
import { formatClock, heartRateAxis, paceAxis } from '../lib/speed'
import type { BestEffortRow, GraphPoint, GraphStats } from '../lib/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ChartCard, Toggle } from '../components/ChartCard'
import { SelectField, SportSelect, YearSelect } from '../components/fields'
import { PageHeader } from '../components/PageHeader'
import { Plot, noDataLayout } from '../components/Plot'

// Colours for the earlier years on the year-over-year chart; the highlighted year uses the sport colour
const YEAR_COLORS = ['#94a3b8', '#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6']
// Activities averaged together in the pace trend line
const PACE_WINDOW = 10

type Chart = [Data[], Partial<Layout>]
type Period = 'weekly' | 'monthly' | 'yearly'
type Breakdown = 'sport' | 'kind'

const hoverFor = (mc: MetricConfig, x: string) =>
  `<b>${x}</b><br>${mc.label}: %{y:${mc.fmt}}${mc.unit ? ` ${mc.unit}` : ''}<extra></extra>`

/** Weekly, monthly or yearly volume as bars with an average line. */
function volumeChart(points: GraphPoint[], period: Period, mc: MetricConfig, color: string, title: string, year: number | null): Chart {
  const unit = mc.unit ? ` ${mc.unit}` : ''
  let x: string[]
  let y: number[]
  let average: number[]
  let averageName: string
  let xaxis: Partial<Layout['xaxis']>
  let hoverX: string
  let heading: string

  if (period === 'weekly') {
    const weeks = weeklyTotals(points, year)
    x = weeks.map((w) => toIsoLocal(w.start))
    y = weeks.map(mc.value)
    average = rollingAverage(y, 4)
    averageName = '4-week average'
    xaxis = { type: 'date', tickformat: '%d %b' }
    hoverX = 'Week of %{x|%d-%m-%Y}'
    heading = `Weekly ${mc.label} – ${title}${year ? ` (${year})` : ' (last 52 weeks)'}`
  } else if (period === 'monthly') {
    const months = monthlyTotals(points, year)
    x = months.map((m) => toIsoLocal(m.start))
    y = months.map(mc.value)
    average = rollingAverage(y, 3)
    averageName = '3-month average'
    xaxis = { type: 'date', tickformat: '%b %Y', dtick: year ? 'M1' : undefined }
    hoverX = '%{x|%b %Y}'
    heading = `Monthly ${mc.label} – ${title}${year ? ` (${year})` : ''}`
  } else {
    const years = yearlyTotals(points)
    x = years.map((t) => String(t.year))
    y = years.map(mc.value)
    const mean = y.length ? y.reduce((s, v) => s + v, 0) / y.length : 0
    average = y.map(() => mean)
    averageName = 'Average per year'
    xaxis = { type: 'category' }
    hoverX = '%{x}'
    heading = `Yearly ${mc.label} – ${title}`
  }

  if (!y.some((v) => v > 0)) return [[], noDataLayout(heading)]
  return [
    [
      { type: 'bar', x, y, name: mc.label, marker: { color }, opacity: 0.85, hovertemplate: hoverFor(mc, hoverX) },
      {
        type: 'scatter',
        mode: 'lines',
        x,
        y: average,
        name: averageName,
        line: { color: '#6b7280', width: 2, dash: 'dot', shape: period === 'yearly' ? 'linear' : 'spline' },
        hovertemplate: `${averageName}: %{y:.1f}${unit}<extra></extra>`,
      },
    ],
    {
      title: { text: heading },
      xaxis,
      yaxis: { title: { text: mc.label } },
      legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.12 },
      margin: { l: 50, r: 20, t: 60, b: 50 },
      bargap: 0.15,
    },
  ]
}

/** Every best-effort time at one distance over time, with races and the personal-best line. */
function DistanceResultsCard({ sport, year }: { sport: string; year: number | null }) {
  // Distances only compare within one sport, so "All sports" shows running
  const resultsSport = sport || ALL_RUNNING
  const [efforts, setEfforts] = useState<BestEffortRow[] | null>(null)
  const [distance, setDistance] = useState<number | null>(null)
  const latest = useLatestRequest()

  useEffect(() => {
    latest(api.get<BestEffortRow[]>(`/best-efforts${qs({ sport: resultsSport, year })}`), setEfforts)
  }, [resultsSport, year, latest])

  const distances = useMemo(
    () => [...new Set((efforts ?? []).map((e) => e.distance_meters))].sort((a, b) => a - b),
    [efforts],
  )
  // Keep the chosen distance while it exists for the sport; otherwise prefer 5 km
  const selected =
    distance !== null && distances.includes(distance) ? distance : distances.includes(5000) ? 5000 : (distances[0] ?? null)

  const chart = useMemo((): Chart | null => {
    if (!efforts || selected === null) return null
    const label = distanceLabel(selected, resultsSport)
    const color = sportColor(resultsSport)
    const rows = efforts
      .filter((e) => e.distance_meters === selected)
      .sort((a, b) => a.date.localeCompare(b.date))
    const times = rows.map((r) => r.duration_seconds)
    const tickformat = Math.max(...times) >= 3600 ? '%-H:%M:%S' : '%-M:%S'
    const custom = (list: BestEffortRow[]) =>
      list.map((r) => [
        r.activity_name,
        formatDate(r.date),
        formatDuration(r.duration_seconds),
        formatPace(r.distance_meters, r.duration_seconds, r.sport),
      ]) as never
    const hover = '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Time: %{customdata[2]} (%{customdata[3]})<extra></extra>'
    const isRace = (r: BestEffortRow) => r.is_race ?? r.kind === 'race'
    const races = rows.filter(isRace)
    const others = rows.filter((r) => !isRace(r))

    return [
      [
        {
          type: 'scatter',
          mode: 'markers',
          x: others.map((r) => r.date),
          y: others.map((r) => paceAsTime(r.duration_seconds)),
          name: 'Training',
          marker: { color, size: 8, opacity: 0.6 },
          customdata: custom(others),
          hovertemplate: hover,
        },
        {
          type: 'scatter',
          mode: 'markers',
          x: races.map((r) => r.date),
          y: races.map((r) => paceAsTime(r.duration_seconds)),
          name: 'Race',
          marker: { color: GOLD, size: 12, symbol: 'diamond', line: { color: '#7e4a18', width: 1 } },
          customdata: custom(races),
          hovertemplate: hover,
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: rows.map((r) => r.date),
          y: personalBestProgression(times).map(paceAsTime),
          name: 'Personal best',
          line: { color: '#6b7280', width: 2, shape: 'hv', dash: 'dot' },
          hovertemplate: `Personal best: %{y|${tickformat}}<extra></extra>`,
        },
      ],
      {
        title: { text: `${label} results – ${sportLabel(resultsSport)}${year ? ` (${year})` : ''}` },
        xaxis: { type: 'date', tickformat: '%b %Y' },
        // Faster times higher up
        yaxis: { title: { text: 'Time' }, type: 'date', tickformat, autorange: 'reversed' },
        legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.12 },
        margin: { l: 70, r: 20, t: 60, b: 40 },
      },
    ]
  }, [efforts, selected, resultsSport, year])

  return (
    <ChartCard
      controls={
        distances.length > 0 && (
          <SelectField
            label="Distance"
            width={160}
            value={String(selected)}
            options={distances.map((d): [string, string] => [String(d), distanceLabel(d, resultsSport)])}
            onChange={(v) => setDistance(Number(v))}
          />
        )
      }
    >
      {chart ? (
        <Plot data={chart[0]} layout={chart[1]} style={{ height: 360 }} />
      ) : (
        efforts && (
          <div className="column items-center w-full q-pa-xl gap-1 text-center">
            <div className="text-subtitle1 text-weight-medium">Distance results</div>
            <div className="text-grey-6">
              No {sportLabel(resultsSport).toLowerCase()} best efforts{year ? ` in ${year}` : ''} yet.
            </div>
          </div>
        )
      )}
    </ChartCard>
  )
}

export function GraphsPage() {
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [metric, setMetric] = useState<Metric>('distance')
  const [period, setPeriod] = useState<Period>('monthly')
  const [breakdown, setBreakdown] = useState<Breakdown>('sport')
  const [stats, setStats] = useState<GraphStats | null>(null)
  const latest = useLatestRequest()

  // The year filter is applied in the browser, so only the sport triggers a request
  useEffect(() => {
    latest(api.get<GraphStats>(`/stats/graphs${qs({ sport })}`), setStats)
  }, [sport, latest])

  const charts = useMemo(() => {
    if (!stats) return null
    const points = stats.activities
    const yearPoints = inYear(points, year)
    const mc = metricConfig(metric, sport)
    const color = sportColor(sport)
    const unit = mc.unit ? ` ${mc.unit}` : ''
    const sportTitle = sport ? sportLabel(sport) : 'All Sports'
    const yearSuffix = year ? ` (${year})` : ''

    const volume = volumeChart(points, period, mc, color, sportTitle, year)

    // ── Breakdown by sport or by training type ──
    const parts = totalsBy(yearPoints, breakdown, mc)
    const breakdownTitle = `${mc.label} by ${breakdown === 'sport' ? 'Sport' : 'Training Type'}${yearSuffix}`
    const pie: Chart = parts.length
      ? [
          [
            {
              type: 'pie',
              hole: 0.45,
              sort: false,
              labels: parts.map((p) => (breakdown === 'sport' ? sportLabel(p.key) : kindLabel(p.key))),
              values: parts.map((p) => p.value),
              marker: {
                colors: parts.map((p) =>
                  breakdown === 'sport' ? sportColor(p.key, '#6b7280') : (KIND_COLORS[p.key] ?? '#94a3b8'),
                ),
              },
              hovertemplate: `<b>%{label}</b><br>%{value:${mc.fmt}}${unit} (%{percent})<extra></extra>`,
            },
          ],
          { title: { text: breakdownTitle }, margin: { l: 20, r: 20, t: 50, b: 20 } },
        ]
      : [[], noDataLayout(breakdownTitle)]

    // ── Year-over-year running total ──
    const progress = cumulativeByYear(points, mc)
    const highlighted = year ?? progress[progress.length - 1]?.year
    const cumulative: Chart = progress.length
      ? [
          progress.map((p, i): Data => {
            const main = p.year === highlighted
            return {
              type: 'scatter',
              mode: 'lines',
              x: p.x,
              y: p.y,
              name: String(p.year),
              line: { color: main ? color : YEAR_COLORS[i % YEAR_COLORS.length], width: main ? 3.5 : 1.5, shape: 'hv' },
              opacity: main ? 1 : 0.7,
              hovertemplate: `<b>${p.year}</b> · %{x|%d %b}<br>${mc.label}: %{y:${mc.fmt}}${unit}<extra></extra>`,
            }
          }),
          {
            title: { text: `${mc.label} through the year – ${sportTitle}` },
            xaxis: { type: 'date', tickformat: '%b', range: ['2000-01-01', '2000-12-31'], dtick: 'M1' },
            yaxis: { title: { text: `Total ${mc.label.toLowerCase()}` } },
            legend: { orientation: 'h', y: -0.15 },
            margin: { l: 55, r: 20, t: 50, b: 40 },
          },
        ]
      : [[], noDataLayout()]

    // ── Pace and heart-rate trend (only meaningful within one sport) ──
    let pace: Chart | null = null
    if (sport) {
      const trend = paceTrend(yearPoints, sport)
      const per = isSwimming(sport) ? '/100m' : '/km'
      if (trend.length) {
        const x = trend.map((t) => t.point.date)
        const withHr = trend.filter((t) => t.point.avg_heart_rate)
        const average = rollingAverage(trend.map((t) => t.pace), PACE_WINDOW)
        const axis = paceAxis(trend.map((t) => t.pace))
        pace = [
          [
            {
              type: 'scatter',
              mode: 'markers',
              x,
              y: trend.map((t) => t.pace),
              name: `Pace (${per.slice(1)})`,
              marker: { color, size: 7, opacity: 0.55 },
              customdata: trend.map((t) => [
                t.point.name,
                formatDate(t.point.date),
                formatPace(t.point.distance_meters!, t.point.duration_seconds, sport),
              ]) as never,
              hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Pace: %{customdata[2]}<extra></extra>',
            },
            {
              type: 'scatter',
              mode: 'lines',
              x,
              y: average,
              customdata: average.map((s) => `${formatClock(s)} ${per}`) as never,
              name: `Pace, ${PACE_WINDOW}-activity average`,
              line: { color, width: 3, shape: 'spline' },
              hovertemplate: 'Average pace: %{customdata}<extra></extra>',
            },
            {
              type: 'scatter',
              mode: 'lines',
              x: withHr.map((t) => t.point.date),
              y: rollingAverage(withHr.map((t) => t.point.avg_heart_rate!), PACE_WINDOW),
              name: `Avg HR, ${PACE_WINDOW}-activity average`,
              yaxis: 'y2',
              line: { color: '#ef4444', width: 2, dash: 'dot', shape: 'spline' },
              hovertemplate: 'Average HR: %{y:.0f} bpm<extra></extra>',
            },
          ],
          {
            title: { text: `Pace & Heart Rate – ${sportTitle}${yearSuffix}` },
            xaxis: { type: 'date', tickformat: '%b %Y' },
            // Faster paces higher up, with evenly spaced m:ss labels
            yaxis: {
              title: { text: `Pace (min${per})` },
              ...(axis ? { range: axis.range, tickvals: axis.tickvals, ticktext: axis.ticktext } : { autorange: 'reversed' }),
            },
            yaxis2: {
              title: { text: 'Avg HR (bpm)' },
              overlaying: 'y',
              side: 'right',
              showgrid: false,
              ...heartRateAxis(rollingAverage(withHr.map((t) => t.point.avg_heart_rate!), PACE_WINDOW)),
            },
            legend: { orientation: 'h', y: -0.18 },
            margin: { l: 60, r: 60, t: 50, b: 40 },
          },
        ]
      } else {
        pace = [[], noDataLayout(`Pace & Heart Rate – ${sportTitle}`)]
      }
    }

    return { volume, pie, cumulative, pace }
  }, [stats, metric, sport, year, period, breakdown])

  return (
    <>
      <PageHeader icon="bar_chart" kicker="Insights" title="Graphs" subtitle="Volume, trends and progress over time.">
          <SportSelect value={sport} onChange={setSport} />
          <YearSelect value={year} onChange={setYear} />
          <SelectField
            label="Metric"
            width={128}
            value={metric}
            options={[
              ['distance', 'Distance'],
              ['count', 'Activities'],
              ['time', 'Time'],
              ['elevation', 'Elevation'],
            ]}
            onChange={(v) => setMetric(v as Metric)}
          />
      </PageHeader>

      {charts && (
        <div className="column w-full gap-4">
          <ChartCard
            controls={
              <Toggle<Period>
                label="Period"
                value={period}
                onChange={setPeriod}
                options={[
                  ['weekly', 'Weekly'],
                  ['monthly', 'Monthly'],
                  ['yearly', 'Yearly'],
                ]}
              />
            }
          >
            <Plot data={charts.volume[0]} layout={charts.volume[1]} style={{ height: 340 }} />
          </ChartCard>

          <div className="w-full graphs-grid">
            <ChartCard>
              <Plot data={charts.cumulative[0]} layout={charts.cumulative[1]} style={{ height: 360 }} />
            </ChartCard>
            <ChartCard
              controls={
                <Toggle<Breakdown>
                  label="Breakdown"
                  value={breakdown}
                  onChange={setBreakdown}
                  options={[
                    ['sport', 'Sport'],
                    ['kind', 'Training type'],
                  ]}
                />
              }
            >
              <Plot data={charts.pie[0]} layout={charts.pie[1]} style={{ height: 320 }} />
            </ChartCard>
          </div>

          <DistanceResultsCard sport={sport} year={year} />

          <ChartCard>
            {charts.pace ? (
              <Plot data={charts.pace[0]} layout={charts.pace[1]} style={{ height: 360 }} />
            ) : (
              <div className="column items-center w-full q-pa-xl gap-1 text-center">
                <div className="text-subtitle1 text-weight-medium">Pace &amp; Heart Rate</div>
                <div className="text-grey-6">Pick a sport to see how your pace and heart rate develop.</div>
              </div>
            )}
          </ChartCard>
        </div>
      )}
    </>
  )
}
