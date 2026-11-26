import { describe, expect, it } from 'vitest'
import { distanceKm, recentArea } from '../src/mapView'
import type { LatLng } from '../src/routeMap'

const LEUVEN: LatLng = [50.88, 4.7]
const HERENT: LatLng = [50.907, 4.676]
const BRUSSELS: LatLng = [50.85, 4.35]
const VOSGES: LatLng = [48.0, 7.0]

const route = (id: number, date: string, at: LatLng) => ({ id, date, coords: [at, [at[0] + 0.01, at[1]] as LatLng, at] })

describe('map opening view', () => {
  it('measures distances on the globe', () => {
    expect(distanceKm(LEUVEN, BRUSSELS)).toBeCloseTo(24.9, 0)
    expect(distanceKm(LEUVEN, LEUVEN)).toBe(0)
  })

  it('opens on the routes near the latest one', () => {
    const routes = [
      route(1, '2026-09-22T09:00:00', VOSGES),
      route(2, '2026-10-01T09:00:00', LEUVEN),
      route(3, '2026-10-16T09:00:00', HERENT),
      route(4, '2026-08-01T09:00:00', [50.5, 5.5]),
    ]
    const area = recentArea(routes)
    expect(area).toHaveLength(6)
    expect(area).toContainEqual(LEUVEN)
    expect(area).toContainEqual(HERENT)
    expect(area).not.toContainEqual(VOSGES)
  })

  it('follows a trip while it is the latest activity', () => {
    const area = recentArea([route(1, '2026-10-01T09:00:00', LEUVEN), route(2, '2026-10-02T09:00:00', VOSGES)])
    expect(area).toEqual(route(2, '', VOSGES).coords)
  })

  it('breaks a tie on date by the newest id and skips routes without points', () => {
    const area = recentArea([
      route(1, '2026-10-01T09:00:00', LEUVEN),
      route(2, '2026-10-01T09:00:00', VOSGES),
      { id: 3, date: '2026-12-01T09:00:00', coords: [] },
    ])
    expect(area).toEqual(route(2, '', VOSGES).coords)
    expect(recentArea([])).toEqual([])
  })
})
