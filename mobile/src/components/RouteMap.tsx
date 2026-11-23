import { useEffect, useMemo, useState } from 'react'
import type { RouteLeg } from '@kinetic/shared/performance'
import { PLAIN_ROUTE_COLOR, legendHtml, routeDrawing } from '@kinetic/shared/routeMap'
import type { LatLng } from '@kinetic/shared/routeMap'
import type { ActivityStreams } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { LeafletView } from './LeafletView'
import type { MapSpec } from './LeafletView'

const START = '#22c55e'
const FINISH = '#ef4444'

/**
 * The GPS route of one activity with start and finish, coloured like on the web
 * (packages/shared/src/routeMap.ts): per leg for a multisport event, otherwise by speed.
 */
export function RouteMap({ activityId, sport, streams, legs }: {
  activityId: number
  sport: string
  /** Null while loading. */
  streams: ActivityStreams | null
  legs?: RouteLeg[]
}) {
  const drawing = useMemo(() => routeDrawing(streams, sport, legs), [streams, sport, legs])
  const [plain, setPlain] = useState<LatLng[] | null>(null)

  // No per-second data: the stored route, in one colour
  useEffect(() => {
    if (streams === null || drawing) return
    let cancelled = false
    api.get<{ coords: LatLng[] }>(`/activities/${activityId}/route`).then(({ coords }) => !cancelled && setPlain(coords))
    return () => {
      cancelled = true
    }
  }, [streams, drawing, activityId])

  const spec = useMemo((): MapSpec | null => {
    const ends = (coords: LatLng[]) => [
      { at: coords[0], color: START, label: 'Start' },
      { at: coords[coords.length - 1], color: FINISH, label: 'Finish' },
    ]
    if (drawing) {
      return {
        lines: [
          { coords: drawing.located, color: '#ffffff', weight: 7, opacity: 0.6 },
          ...drawing.segments.map((s) => ({ coords: [s.from, s.to], color: s.color, weight: 4, opacity: 0.95 })),
        ],
        markers: ends(drawing.located),
        legend: legendHtml(drawing.legend),
      }
    }
    if (plain && plain.length > 1) return { lines: [{ coords: plain, color: PLAIN_ROUTE_COLOR, weight: 3 }], markers: ends(plain) }
    return null
  }, [drawing, plain])

  if (!spec) return null
  return <LeafletView spec={spec} height={320} />
}
