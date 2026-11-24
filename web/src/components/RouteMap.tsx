import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { api } from '../lib/api'
import type { HoverBus } from '@kinetic/shared/hoverBus'
import type { RouteLeg } from '@kinetic/shared/performance'
import { PLAIN_ROUTE_COLOR, legendHtml, routeDrawing, routePositions, storedLegsDrawing } from '@kinetic/shared/routeMap'
import type { LatLng, RouteDrawing } from '@kinetic/shared/routeMap'
import type { ActivityStreams } from '@kinetic/shared/types'

// OpenStreetMap's standard tiles — free and keyless
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export function baseMap(el: HTMLElement): L.Map {
  const map = L.map(el, { center: [50.85, 4.35], zoom: 8 })
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
  // Leaflet measures its container once; re-measure whenever the layout resizes it.
  const observer = new ResizeObserver(() => map.invalidateSize())
  observer.observe(el)
  map.on('unload', () => observer.disconnect())
  return map
}

function marker(color: string, icon: string, title: string, at: L.LatLngExpression) {
  const html =
    `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
    `background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center">` +
    `<span class="material-icons" style="transform:rotate(45deg);font-size:15px;color:#fff">${icon}</span></div>`
  return L.marker(at, {
    title,
    icon: L.divIcon({ html, className: '', iconSize: [26, 26], iconAnchor: [3, 26] }),
  }).bindTooltip(title)
}

/** A legend box in the bottom-left corner of the map. */
function legend(html: string): L.Control {
  const control = new L.Control({ position: 'bottomleft' })
  control.onAdd = () => {
    const box = L.DomUtil.create('div')
    box.innerHTML = html
    return box
  }
  return control
}

interface Props {
  activityId: number
  sport: string
  /** Null while loading; positions and speeds colour the route when available. */
  streams: ActivityStreams | null
  /** Points hovered in the charts are marked on the map. */
  hoverBus: HoverBus
  /** For a multisport event: its legs, so the route is coloured per leg instead of by speed. */
  legs?: RouteLeg[]
}

/**
 * The GPS route of one activity with start and finish: coloured per leg for a multisport
 * event, otherwise by speed when known.
 */
export function RouteMap({ activityId, sport, streams, hoverBus, legs }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const map = baseMap(ref.current)
    mapRef.current = map
    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [activityId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || streams === null) return
    const layers = L.layerGroup().addTo(map)
    const controls: L.Control[] = []
    let cancelled = false

    const finish = (coords: L.LatLngTuple[]) => {
      map.fitBounds(L.latLngBounds(coords), { padding: [20, 20], animate: false })
      marker('#22c55e', 'play_arrow', 'Start', coords[0]).addTo(layers)
      marker('#ef4444', 'stop', 'Finish', coords[coords.length - 1]).addTo(layers)
    }

    const draw = (drawing: RouteDrawing) => {
      // A soft outline under the coloured route keeps it readable on any map background
      L.polyline(drawing.located, { color: '#ffffff', weight: 7, opacity: 0.6, interactive: false }).addTo(layers)
      for (const { from, to, color } of drawing.segments) {
        L.polyline([from, to], { color, weight: 4, opacity: 0.95, interactive: false }).addTo(layers)
      }
      const key = legend(legendHtml(drawing.legend))
      key.addTo(map)
      controls.push(key)
      finish(drawing.located)
    }

    const positions = routePositions(streams)
    const drawing = routeDrawing(streams, sport, legs)
    if (drawing) {
      draw(drawing)
    } else {
      // No per-second data: a multisport event's legs from their stored routes, each in its
      // leg's colour; otherwise the stored route in one colour
      const plain = () =>
        api.get<{ coords: [number, number][] }>(`/activities/${activityId}/route`).then(({ coords }) => {
          if (cancelled || coords.length < 2) return
          L.polyline(coords, { color: PLAIN_ROUTE_COLOR, weight: 3, opacity: 0.85 }).addTo(layers)
          finish(coords)
        })
      const legIds = legs && legs.length >= 2 && legs.every((leg) => leg.id !== undefined) ? legs.map((leg) => leg.id!) : null
      if (!legIds) {
        plain()
      } else {
        Promise.all(legIds.map((id) => api.get<{ coords: LatLng[] }>(`/activities/${id}/route`)))
          .then((routes) => storedLegsDrawing(routes.map(({ coords }, i) => ({ leg: legs![i], coords }))))
          .catch(() => null)
          .then((stored) => {
            if (cancelled) return
            if (stored) draw(stored)
            else plain()
          })
      }
    }

    // Where the point hovered in the charts was; nearby points fill in short GPS gaps
    const here = L.circleMarker([0, 0], {
      radius: 7,
      color: '#111827',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
      interactive: false,
    })
    const unsubscribe = hoverBus.subscribe((index) => {
      let at: L.LatLngTuple | null = null
      for (let offset = 0; index !== null && offset < 5 && !at; offset++) {
        at = positions[index - offset] ?? positions[index + offset] ?? null
      }
      if (at) {
        here.setLatLng(at)
        if (!map.hasLayer(here)) here.addTo(map)
        here.bringToFront()
      } else if (map.hasLayer(here)) {
        here.remove()
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
      here.remove()
      controls.forEach((c) => c.remove())
      layers.remove()
    }
  }, [streams, activityId, sport, hoverBus, legs])

  return <div ref={ref} style={{ width: '100%', height: 380 }} />
}
