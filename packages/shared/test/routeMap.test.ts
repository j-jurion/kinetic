import { describe, expect, it } from 'vitest'
import type { RouteLeg } from '../src/performance'
import { routeLegs } from '../src/performance'
import { MAX_STORED_LEG_POINTS, storedLegsDrawing } from '../src/routeMap'
import type { LatLng } from '../src/routeMap'

const leg = (label: string, color: string): RouteLeg => ({ label, color, start: 0, end: 0 })
const line = (n: number, lon = 4): LatLng[] => Array.from({ length: n }, (_, i) => [51 + i / 1000, lon])

describe('a multisport route without per-second data', () => {
  it('draws each leg from its stored route in the leg colour', () => {
    const drawing = storedLegsDrawing([
      { leg: leg('Swim', 'blue'), coords: line(3) },
      { leg: leg('Bike', 'green'), coords: line(4, 5) },
      { leg: leg('Run', 'orange'), coords: line(2, 6) },
    ])!
    expect(drawing.legend).toEqual({ kind: 'legs', items: [['Swim', 'blue'], ['Bike', 'green'], ['Run', 'orange']] })
    expect(drawing.segments.map((s) => s.color)).toEqual(['blue', 'blue', 'green', 'green', 'green', 'orange'])
    expect(drawing.located).toHaveLength(9)
    // Legs are not joined to each other: no segment runs from one leg to the next
    expect(drawing.segments.every((s) => s.from[1] === s.to[1])).toBe(true)
  })

  it('leaves out legs without a route, and gives up below two legs', () => {
    const drawing = storedLegsDrawing([
      { leg: leg('Swim', 'blue'), coords: [] },
      { leg: leg('Bike', 'green'), coords: line(2) },
      { leg: leg('Run', 'orange'), coords: line(2, 6) },
    ])!
    expect(drawing.legend).toEqual({ kind: 'legs', items: [['Bike', 'green'], ['Run', 'orange']] })
    expect(storedLegsDrawing([{ leg: leg('Bike', 'green'), coords: line(5) }, { leg: leg('Run', 'orange'), coords: line(1) }])).toBeNull()
  })

  it('thins long routes but keeps their ends', () => {
    const coords = line(5000)
    const drawing = storedLegsDrawing([
      { leg: leg('Bike', 'green'), coords },
      { leg: leg('Run', 'orange'), coords: line(2, 6) },
    ])!
    expect(drawing.located).toHaveLength(MAX_STORED_LEG_POINTS + 2)
    expect(drawing.located[0]).toEqual(coords[0])
    expect(drawing.located[MAX_STORED_LEG_POINTS - 1]).toEqual(coords[4999])
  })

  it('keeps the leg activity ids from routeLegs', () => {
    const legs = routeLegs(
      '2026-05-01T10:00:00',
      [
        { id: 12, sport: 'swimming', date: '2026-05-01T10:00:00', duration_seconds: 600 },
        { id: 13, sport: 'cycling', date: '2026-05-01T10:12:00', duration_seconds: 3600 },
      ],
      () => 'Other',
    )
    expect(legs.map((l) => [l.label, l.id])).toEqual([['Swim', 12], ['Bike', 13]])
    expect('id' in routeLegs('2026-05-01T10:00:00', [{ sport: 'running', date: '2026-05-01T10:00:00', duration_seconds: 1 }], () => '')[0]).toBe(false)
  })
})
