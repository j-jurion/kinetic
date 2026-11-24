import { describe, expect, it } from 'vitest'
import { sportColor } from '../src/format'
import { UNKNOWN_SPORT_COLOR, mapRouteLines } from '../src/routeMap'
import type { MapRoute } from '../src/types'
import { activity } from './factories'

const route = (fields: Partial<MapRoute>): MapRoute => ({ ...activity(), coords: [[51, 4], [51, 4.01]], ...fields })

describe('lines on the all-activities map', () => {
  it('draws a multisport event as its legs in their own sport colours', () => {
    const lines = mapRouteLines(
      route({
        sport: 'triathlon',
        legs: [
          { sport: 'swimming', coords: [[51, 4], [51, 4.001]] },
          { sport: 'cycling', coords: [[51, 4.001], [51, 4.005]] },
          { sport: 'running', coords: [[51, 4.005], [51, 4.01]] },
        ],
      }),
    )
    expect(lines.map((l) => l.color)).toEqual([sportColor('swimming'), sportColor('cycling'), sportColor('running')])
    expect(lines[1].coords).toEqual([[51, 4.001], [51, 4.005]])
  })

  it('draws other activities, and events with fewer than two legs, as one line', () => {
    expect(mapRouteLines(route({ sport: 'running' }))).toEqual([{ coords: [[51, 4], [51, 4.01]], color: sportColor('running') }])
    const oneLeg = route({ sport: 'triathlon', legs: [{ sport: 'swimming', coords: [[51, 4], [51, 4.001]] }] })
    expect(mapRouteLines(oneLeg).map((l) => l.color)).toEqual([sportColor('triathlon')])
    expect(mapRouteLines(route({ sport: 'curling' }))[0].color).toBe(UNKNOWN_SPORT_COLOR)
  })
})
