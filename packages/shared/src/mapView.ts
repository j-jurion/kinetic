// Where the all-activities map opens, shared by the web and mobile maps.
import type { LatLng } from './routeMap'

/** Routes this far from the latest one are left out of the opening view. */
export const RECENT_AREA_KM = 25
/** The opening view never zooms in closer than this, even for one short route. */
export const RECENT_AREA_MAX_ZOOM = 13

interface Located {
  id: number
  date: string
  coords: LatLng[]
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad
  const dLng = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function middle(coords: LatLng[]): LatLng {
  return coords[Math.floor(coords.length / 2)]
}

/**
 * The points the map opens on: every route within `km` of the most recent one, so it shows the
 * area you are active in now (home, or the place you are travelling) instead of every country
 * you ever recorded a route in. Empty when there are no routes.
 */
export function recentArea<T extends Located>(routes: T[], km = RECENT_AREA_KM): LatLng[] {
  const located = routes.filter((r) => r.coords.length > 0)
  if (!located.length) return []
  const latest = located.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.id > a.id) ? b : a))
  const centre = middle(latest.coords)
  return located.filter((r) => distanceKm(centre, middle(r.coords)) <= km).flatMap((r) => r.coords)
}
