import { useEffect, useMemo, useState } from 'react'
import type { RouteLeg } from '@kinetic/shared/performance'
import { PLAIN_ROUTE_COLOR, legendHtml, routeDrawing, storedLegsDrawing } from '@kinetic/shared/routeMap'
import type { LatLng, RouteDrawing } from '@kinetic/shared/routeMap'
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
  const fromStreams = useMemo(() => routeDrawing(streams, sport, legs), [streams, sport, legs])
  const [stored, setStored] = useState<RouteDrawing | null>(null)
  const [plain, setPlain] = useState<LatLng[] | null>(null)
  const drawing = fromStreams ?? stored

  // No per-second data: a multisport event's legs from their stored routes, each in its leg's
  // colour; otherwise the stored route in one colour
  useEffect(() => {
    setStored(null)
    setPlain(null)
    if (streams === null || fromStreams) return
    let cancelled = false
    const loadPlain = () =>
      api.get<{ coords: LatLng[] }>(`/activities/${activityId}/route`).then(({ coords }) => !cancelled && setPlain(coords))
    const legIds = legs && legs.length >= 2 && legs.every((leg) => leg.id !== undefined) ? legs.map((leg) => leg.id!) : null
    if (!legIds) {
      loadPlain()
    } else {
      Promise.all(legIds.map((id) => api.get<{ coords: LatLng[] }>(`/activities/${id}/route`)))
        .then((routes) => storedLegsDrawing(routes.map(({ coords }, i) => ({ leg: legs![i], coords }))))
        .catch(() => null)
        .then((result) => {
          if (cancelled) return
          if (result) setStored(result)
          else loadPlain()
        })
    }
    return () => {
      cancelled = true
    }
  }, [streams, fromStreams, activityId, legs])

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
  return <LeafletView spec={spec} height={320} label={routeMapLabel(drawing)} />
}

/** What the route map shows, for screen readers. */
function routeMapLabel(drawing: RouteDrawing | null): string {
  if (drawing?.legend.kind === 'legs') {
    return `Route map, coloured per leg: ${drawing.legend.items.map(([label]) => label).join(', ')}`
  }
  if (drawing?.legend.kind === 'speed') return `Route map, coloured by speed from ${drawing.legend.slow} to ${drawing.legend.fast}`
  return 'Route map'
}
