import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { api } from '../lib/api'

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

/** The GPS route of one activity with start and finish markers. */
export function RouteMap({ activityId }: { activityId: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const map = baseMap(ref.current)
    let cancelled = false
    api.get<{ coords: [number, number][] }>(`/activities/${activityId}/route`).then(({ coords }) => {
      if (cancelled || coords.length < 2) return
      const line = L.polyline(coords, { color: '#3b82f6', weight: 3, opacity: 0.85 }).addTo(map)
      map.fitBounds(line.getBounds(), { padding: [20, 20], animate: false })
      marker('#22c55e', 'play_arrow', 'Start', coords[0]).addTo(map)
      marker('#ef4444', 'stop', 'Finish', coords[coords.length - 1]).addTo(map)
    })
    return () => {
      cancelled = true
      map.remove()
    }
  }, [activityId])

  return <div ref={ref} style={{ width: '100%', height: 380 }} />
}
