// The charts of one activity on mobile, from the same builders as the web
// (packages/shared/src/charts/activity.ts).
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { filled, lapsChart, lengthStats, lengthsChart, powerZonesChart, profileChart, summaryTiles, zonesChart } from '@kinetic/shared/charts/activity'
import type { XMode } from '@kinetic/shared/charts/activity'
import { formatDuration } from '@kinetic/shared/format'
import type { Activity, ActivityStreams, Climb, Lap } from '@kinetic/shared/types'
import { ChartView } from './PlotView'
import { Table } from './Table'
import { Card, CardTitle, Stat, StatGrid, Toggle } from './ui'

const formatLength = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`)

function Climbs({ climbs }: { climbs: Climb[] }) {
  return (
    <Card>
      <CardTitle>Climbs ({climbs.length})</CardTitle>
      <Table
        rows={climbs.map((climb, i) => ({ ...climb, number: i + 1 }))}
        rowKey={(r) => r.number}
        columns={[
          { label: '#', width: 32, render: (r) => String(r.number) },
          { label: 'Start (km)', width: 76, align: 'right', render: (r) => (r.start_m / 1000).toFixed(2) },
          { label: 'Length', width: 72, align: 'right', render: (r) => formatLength(r.length_m) },
          { label: 'Gain (m)', width: 66, align: 'right', render: (r) => String(Math.round(r.gain_m)) },
          { label: 'Grade (%)', width: 72, align: 'right', render: (r) => r.grade_pct.toFixed(1) },
          { label: 'Time', width: 66, align: 'right', render: (r) => formatDuration(r.seconds) },
          { label: 'VAM (m/h)', width: 76, align: 'right', render: (r) => (r.vam === null ? '–' : String(Math.round(r.vam))) },
        ]}
      />
    </Card>
  )
}

/** Analysis tiles, the profile over distance or time, zones, laps, pool lengths and climbs. */
export function ActivityCharts({ activity, laps, streams }: { activity: Activity; laps: Lap[]; streams: ActivityStreams | null }) {
  const [xMode, setXMode] = useState<XMode>('distance')
  const ready = streams?.available ? streams : null
  const profile = useMemo(() => (ready ? profileChart(activity, ready, xMode) : null), [activity, ready, xMode])
  const zones = useMemo(() => (ready ? zonesChart(ready) : null), [ready])
  const powerZones = useMemo(() => (ready ? powerZonesChart(ready) : null), [ready])
  const lapChart = useMemo(() => lapsChart(activity, laps, streams), [activity, laps, streams])
  const lengths = useMemo(() => (ready?.lengths ?? []).filter((l) => l.seconds > 0), [ready])
  const lengthChart = useMemo(() => (lengths.length ? lengthsChart(lengths) : null), [lengths])
  const tiles = ready?.summary ? summaryTiles(activity, ready.summary) : []
  const hasDistance = !!streams?.points && filled(streams.points.distance)
  const climbs = ready?.climbs ?? []

  const swim = lengths.length ? lengthStats(lengths) : null
  const swimTiles: [string, string][] = [['Lengths', String(lengths.length)]]
  if (swim?.swolf != null) swimTiles.push(['Avg SWOLF', swim.swolf.toFixed(0)])
  if (swim?.strokeRate != null) swimTiles.push(['Avg stroke rate', `${swim.strokeRate.toFixed(0)} spm`])
  if (swim?.totalStrokes != null) swimTiles.push(['Total strokes', String(swim.totalStrokes)])

  return (
    <View style={{ gap: 14 }}>
      {tiles.length > 0 && (
        <Card>
          <CardTitle>Analysis</CardTitle>
          <StatGrid>
            {tiles.map((t) => (
              <Stat key={t.label} label={t.label} value={t.value} color={t.color} hint={t.hint} />
            ))}
          </StatGrid>
        </Card>
      )}
      {profile && (
        <Card>
          <CardTitle
            right={
              hasDistance && (
                <Toggle<XMode>
                  value={xMode}
                  onChange={setXMode}
                  options={[
                    ['distance', 'Distance'],
                    ['time', 'Time'],
                  ]}
                />
              )
            }
          >
            Activity profile
          </CardTitle>
          <ChartView chart={profile.chart} height={profile.height} />
        </Card>
      )}
      {[zones, powerZones, lapChart].map(
        (chart, i) =>
          chart && (
            <Card key={i}>
              <ChartView chart={chart} height={320} />
            </Card>
          ),
      )}
      {lengthChart && (
        <Card>
          <CardTitle>Swim lengths</CardTitle>
          <StatGrid>
            {swimTiles.map(([label, value]) => (
              <Stat key={label} label={label} value={value} />
            ))}
          </StatGrid>
          <ChartView chart={lengthChart} height={320} />
        </Card>
      )}
      {climbs.length > 0 && <Climbs climbs={climbs} />}
    </View>
  )
}
