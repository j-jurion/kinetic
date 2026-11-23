import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { api } from '../lib/api'
import type { HoverBus } from '@kinetic/shared/hoverBus'
import { KIND_COLORS } from '@kinetic/shared/performance'
import type { RouteLeg } from '@kinetic/shared/performance'
import { SPEED_GRADIENT, formatSpeed, speedColor, speedScale } from '@kinetic/shared/speed'
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

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** A small "slow ▬▬▬ fast" legend in the corner of the map. */
function legend(slow: string, fast: string): L.Control {
  const control = new L.Control({ position: 'bottomleft' })
  control.onAdd = () => {
    const box = L.DomUtil.create('div')
    box.style.cssText =
      'background:rgba(255,255,255,.92);color:#111827;padding:6px 10px;border-radius:8px;' +
      'box-shadow:0 1px 5px rgba(0,0,0,.25);font:12px Inter,Roboto,sans-serif;min-width:170px'
    box.innerHTML =
      `<div style="height:8px;border-radius:4px;background:${SPEED_GRADIENT}"></div>` +
      `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:3px">` +
      `<span>${escapeHtml(slow)}</span><span>${escapeHtml(fast)}</span></div>`
    return box
  }
  return control
}

/** A legend of the legs of a multisport event, one colour per leg (and the transitions). */
function legLegend(legs: RouteLeg[], transitions: boolean): L.Control {
  const control = new L.Control({ position: 'bottomleft' })
  control.onAdd = () => {
    const box = L.DomUtil.create('div')
    box.style.cssText =
      'background:rgba(255,255,255,.92);color:#111827;padding:6px 10px;border-radius:8px;' +
      'box-shadow:0 1px 5px rgba(0,0,0,.25);font:12px Inter,Roboto,sans-serif;' +
      'display:flex;flex-wrap:wrap;gap:4px 12px;max-width:320px'
    const items: [string, string][] = legs.map((leg) => [leg.label, leg.color])
    if (transitions) items.push(['Transition', TRANSITION_COLOR])
    box.innerHTML = items
      .map(
        ([label, color]) =>
          `<span style="display:inline-flex;align-items:center;gap:5px">` +
          `<span style="width:14px;height:4px;border-radius:2px;background:${color}"></span>${escapeHtml(label)}</span>`,
      )
      .join('')
    return box
  }
  return control
}

const TRANSITION_COLOR = KIND_COLORS.t1!

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

    const p = streams.available ? streams.points : undefined
    const positions: (L.LatLngTuple | null)[] = p
      ? p.lat.map((lat, i) => (lat !== null && p.lon[i] !== null ? [lat, p.lon[i]!] : null))
      : []
    const located = positions.filter((c): c is L.LatLngTuple => c !== null)
    const scale = p ? speedScale(p.speed) : null
    const byLeg = !!legs && legs.length >= 2

    if (p && byLeg && located.length > 1) {
      // Each point takes the colour of the leg it falls in; points between legs are transitions
      const legAt = (t: number) => legs!.find((leg) => t >= leg.start && t <= leg.end)
      let transitions = false
      L.polyline(located, { color: '#ffffff', weight: 7, opacity: 0.6, interactive: false }).addTo(layers)
      for (let i = 1; i < positions.length; i++) {
        const from = positions[i - 1]
        const to = positions[i]
        if (!from || !to) continue
        const leg = legAt((p.t[i - 1] + p.t[i]) / 2)
        if (!leg) transitions = true
        L.polyline([from, to], {
          color: leg ? leg.color : TRANSITION_COLOR,
          weight: 4,
          opacity: 0.95,
          interactive: false,
        }).addTo(layers)
      }
      const key = legLegend(legs!, transitions)
      key.addTo(map)
      controls.push(key)
      finish(located)
    } else if (p && scale && located.length > 1) {
      // A soft outline under the coloured route keeps it readable on any map background
      L.polyline(located, { color: '#ffffff', weight: 7, opacity: 0.6, interactive: false }).addTo(layers)
      for (let i = 1; i < positions.length; i++) {
        const from = positions[i - 1]
        const to = positions[i]
        if (!from || !to) continue
        const speeds = [p.speed[i - 1], p.speed[i]].filter((s): s is number => s !== null)
        const speed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null
        L.polyline([from, to], {
          color: speed === null ? '#9ca3af' : speedColor(scale.position(speed)),
          weight: 4,
          opacity: 0.95,
          interactive: false,
        }).addTo(layers)
      }
      const key = legend(`Slow · ${formatSpeed(scale.low, sport)}`, `${formatSpeed(scale.high, sport)} · Fast`)
      key.addTo(map)
      controls.push(key)
      finish(located)
    } else {
      // No per-second data: the stored route, in one colour
      api.get<{ coords: [number, number][] }>(`/activities/${activityId}/route`).then(({ coords }) => {
        if (cancelled || coords.length < 2) return
        L.polyline(coords, { color: '#3b82f6', weight: 3, opacity: 0.85 }).addTo(layers)
        finish(coords)
      })
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
