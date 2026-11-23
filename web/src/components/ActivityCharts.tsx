import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { PlotHoverEvent } from 'plotly.js-dist-min'
import { isSwimming } from '@kinetic/shared/format'
import type { HoverBus } from '@kinetic/shared/hoverBus'
import { filled, lapsChart, powerZonesChart, profileChart, zonesChart } from '@kinetic/shared/charts/activity'
import type { XMode } from '@kinetic/shared/charts/activity'
import type { Activity, ActivityStreams, Lap } from '@kinetic/shared/types'
import { Plot } from './Plot'
import { AnalysisSummary } from './activity/AnalysisSummary'
import { ClimbsTable } from './activity/ClimbsTable'
import { SwimLengths } from './activity/SwimLengths'
import { indexAtDistance } from '@kinetic/shared/streamIndex'

interface Props {
  activity: Activity
  laps: Lap[]
  /** Null while loading. */
  streams: ActivityStreams | null
  /** Receives the hovered stream point, so the map can show where it was. */
  hoverBus: HoverBus
}

/**
 * Charts of one activity: derived metrics, the profile over distance or time, heart-rate and
 * power zones, laps, pool lengths and climbs. Each part is left out when its data is missing.
 */
export default function ActivityCharts({ activity, laps, streams, hoverBus }: Props) {
  const [xMode, setXMode] = useState<XMode>('distance')

  const ready = streams?.available ? streams : null
  const profile = useMemo(() => (ready ? profileChart(activity, ready, xMode) : null), [activity, ready, xMode])
  const zones = useMemo(() => (ready ? zonesChart(ready) : null), [ready])
  const powerZones = useMemo(() => (ready ? powerZonesChart(ready) : null), [ready])
  const lapChart = useMemo(() => lapsChart(activity, laps, streams), [activity, laps, streams])
  const hasDistance = !!streams?.points && filled(streams.points.distance)
  const lengths = ready?.lengths ?? []
  const climbs = ready?.climbs ?? []

  // Every profile row is drawn from the stream points, so a point's index is the stream index
  const onProfileHover = useCallback(
    (event: PlotHoverEvent) => hoverBus.set(event.points[0]?.pointIndex ?? null),
    [hoverBus],
  )
  // The laps chart is on a distance axis; prefer the elevation trace, which follows the pointer
  const onLapsHover = useCallback(
    (event: PlotHoverEvent) => {
      const distances = streams?.points?.distance
      if (!distances) return
      const point = event.points.find((p) => p.data.name === 'Elevation') ?? event.points[0]
      if (!point || typeof point.x !== 'number') return
      const unit = isSwimming(activity.sport) ? 1 : 1000
      hoverBus.set(indexAtDistance(distances, point.x * unit))
    },
    [hoverBus, streams, activity.sport],
  )
  const onUnhover = useCallback(() => hoverBus.set(null), [hoverBus])

  if (!ready && !lapChart) return null

  const zoneCards = (
    [
      ['heart-rate', zones],
      ['power', powerZones],
    ] as const
  ).flatMap(([key, chart]) =>
    chart
      ? [
          <div key={key} className="card w-full chart-card">
            <Plot data={chart[0]} layout={chart[1]} style={{ height: 340 }} />
          </div>,
        ]
      : [],
  )
  const lapCard = lapChart && (
    <div key="laps" className="card w-full chart-card">
      <Plot data={lapChart[0]} layout={lapChart[1]} style={{ height: 340 }} onHover={onLapsHover} onUnhover={onUnhover} />
    </div>
  )
  // Two zone charts sit side by side with the laps full width below; otherwise one zone chart
  // and the laps share a row
  const grid = (cards: ReactNode[]) =>
    cards.length > 0 && <div className={`w-full ${cards.length === 2 ? 'graphs-grid' : ''}`}>{cards}</div>

  return (
    <div className="column w-full gap-4 q-mb-md">
      {ready && <AnalysisSummary activity={activity} streams={ready} />}
      {profile && (
        <div className="card w-full chart-card">
          <div className="row items-center justify-between no-wrap w-full q-pa-xs">
            <span className="card-title" style={{ paddingLeft: 4 }}>Activity profile</span>
            {hasDistance && (
              <ToggleButtonGroup
                exclusive
                size="small"
                color="primary"
                value={xMode}
                aria-label="X-axis"
                onChange={(_, next: XMode | null) => next && setXMode(next)}
              >
                <ToggleButton value="distance" sx={{ px: 1.5, py: 0.25 }}>Distance</ToggleButton>
                <ToggleButton value="time" sx={{ px: 1.5, py: 0.25 }}>Time</ToggleButton>
              </ToggleButtonGroup>
            )}
          </div>
          <Plot
            data={profile.chart[0]}
            layout={profile.chart[1]}
            style={{ height: profile.height }}
            onHover={onProfileHover}
            onUnhover={onUnhover}
          />
        </div>
      )}
      {zoneCards.length === 2 ? (
        <>
          {grid(zoneCards)}
          {lapCard}
        </>
      ) : (
        grid(lapCard ? [...zoneCards, lapCard] : zoneCards)
      )}
      {lengths.length > 0 && <SwimLengths lengths={lengths} />}
      {climbs.length > 0 && <ClimbsTable climbs={climbs} distances={ready?.points?.distance} hoverBus={hoverBus} />}
    </div>
  )
}
