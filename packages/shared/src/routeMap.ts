// How an activity's route is coloured, shared by the web and mobile maps: per leg for a
// multisport event, otherwise by speed when the per-second data has it.
import { sportColor } from './format'
import { KIND_COLORS } from './performance'
import type { RouteLeg } from './performance'
import { SPEED_GRADIENT, formatSpeed, speedColor, speedScale } from './speed'
import type { ActivityStreams, MapRoute } from './types'

export type LatLng = [number, number]

export const TRANSITION_COLOR = KIND_COLORS.t1!
/** The route colour when there is no per-second data. */
export const PLAIN_ROUTE_COLOR = '#3b82f6'

export interface RouteSegment {
  from: LatLng
  to: LatLng
  color: string
}

export type RouteLegend =
  | { kind: 'speed'; gradient: string; slow: string; fast: string }
  | { kind: 'legs'; items: [string, string][] }

export interface RouteDrawing {
  /** Every located point, in order: the outline under the segments and the map bounds. */
  located: LatLng[]
  segments: RouteSegment[]
  legend: RouteLegend
}

/** The position of each stream point, or null where the GPS had no fix. */
export function routePositions(streams: ActivityStreams | null): (LatLng | null)[] {
  const p = streams?.available ? streams.points : undefined
  return p ? p.lat.map((lat, i) => (lat !== null && p.lon[i] !== null ? [lat, p.lon[i]!] : null)) : []
}

/**
 * The coloured route from the per-second data, or null when it cannot be coloured (no
 * positions, or no speeds outside a multisport event): then the stored route is drawn plain.
 */
export function routeDrawing(streams: ActivityStreams | null, sport: string, legs?: RouteLeg[]): RouteDrawing | null {
  const p = streams?.available ? streams.points : undefined
  if (!p) return null
  const positions = routePositions(streams)
  const located = positions.filter((c): c is LatLng => c !== null)
  if (located.length < 2) return null
  const segments: RouteSegment[] = []

  if (legs && legs.length >= 2) {
    // Each point takes the colour of the leg it falls in; points between legs are transitions
    const legAt = (t: number) => legs.find((leg) => t >= leg.start && t <= leg.end)
    let transitions = false
    for (let i = 1; i < positions.length; i++) {
      const from = positions[i - 1]
      const to = positions[i]
      if (!from || !to) continue
      const leg = legAt((p.t[i - 1] + p.t[i]) / 2)
      if (!leg) transitions = true
      segments.push({ from, to, color: leg ? leg.color : TRANSITION_COLOR })
    }
    const items: [string, string][] = legs.map((leg) => [leg.label, leg.color])
    if (transitions) items.push(['Transition', TRANSITION_COLOR])
    return { located, segments, legend: { kind: 'legs', items } }
  }

  const scale = speedScale(p.speed)
  if (!scale) return null
  for (let i = 1; i < positions.length; i++) {
    const from = positions[i - 1]
    const to = positions[i]
    if (!from || !to) continue
    const speeds = [p.speed[i - 1], p.speed[i]].filter((s): s is number => s !== null)
    const speed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null
    segments.push({ from, to, color: speed === null ? '#9ca3af' : speedColor(scale.position(speed)) })
  }
  return {
    located,
    segments,
    legend: {
      kind: 'speed',
      gradient: SPEED_GRADIENT,
      slow: `Slow · ${formatSpeed(scale.low, sport)}`,
      fast: `${formatSpeed(scale.high, sport)} · Fast`,
    },
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The legend as the HTML of a small box in the corner of the map. */
export function legendHtml(legend: RouteLegend): string {
  const box =
    'background:rgba(255,255,255,.92);color:#111827;padding:6px 10px;border-radius:8px;' +
    'box-shadow:0 1px 5px rgba(0,0,0,.25);font:12px Inter,Roboto,sans-serif;'
  if (legend.kind === 'speed') {
    return (
      `<div style="${box}min-width:170px">` +
      `<div style="height:8px;border-radius:4px;background:${legend.gradient}"></div>` +
      `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:3px">` +
      `<span>${escapeHtml(legend.slow)}</span><span>${escapeHtml(legend.fast)}</span></div></div>`
    )
  }
  return (
    `<div style="${box}display:flex;flex-wrap:wrap;gap:4px 12px;max-width:320px">` +
    legend.items
      .map(
        ([label, color]) =>
          `<span style="display:inline-flex;align-items:center;gap:5px">` +
          `<span style="width:14px;height:4px;border-radius:2px;background:${color}"></span>${escapeHtml(label)}</span>`,
      )
      .join('') +
    '</div>'
  )
}

/** The colour of routes whose sport has none. */
export const UNKNOWN_SPORT_COLOR = '#6b7280'

/**
 * The lines that draw one route on the all-activities map: a multisport event as its legs,
 * each in its own sport's colour, and any other activity as one line in its sport's colour.
 */
export function mapRouteLines(route: MapRoute): { coords: LatLng[]; color: string }[] {
  if (route.legs && route.legs.length >= 2) {
    return route.legs.map((leg) => ({ coords: leg.coords, color: sportColor(leg.sport, UNKNOWN_SPORT_COLOR) }))
  }
  return [{ coords: route.coords, color: sportColor(route.sport, UNKNOWN_SPORT_COLOR) }]
}
