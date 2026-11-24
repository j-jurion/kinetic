import { describe, expect, it } from 'vitest'
import { byMonth, hours, km, monthSummary, monthTitle, totals } from '../src/activityList'
import { activity } from './factories'

describe('activity list', () => {
  it('counts a multisport leg only when its event is not listed', () => {
    const event = activity({ id: 500, sport: 'triathlon', distance_meters: 51500, duration_seconds: 9000 })
    const leg = activity({ parent_id: 500, sport: 'running', distance_meters: 10000, duration_seconds: 2400 })
    const orphanLeg = activity({ parent_id: 999, distance_meters: 1000, duration_seconds: 300, elevation_gain_meters: 12 })
    expect(totals([event, leg, orphanLeg])).toEqual({ count: 2, meters: 52500, seconds: 9300, climb: 12 })
    expect(totals([leg])).toMatchObject({ count: 1, meters: 10000 })
  })

  it('groups by month in arrival order and summarises', () => {
    const rows = [
      activity({ date: '2026-03-02T08:00:00', distance_meters: 1500, duration_seconds: 5400 }),
      activity({ date: '2026-02-27T08:00:00' }),
      activity({ date: '2026-03-01T08:00:00', distance_meters: 1000, duration_seconds: 0 }),
    ]
    const groups = byMonth(rows)
    expect(groups.map(([key, list]) => [key, list.length])).toEqual([['2026-03', 2], ['2026-02', 1]])
    expect(monthSummary(groups[0][1])).toBe('2 activities · 3 km · 2 h')
    expect(monthSummary(groups[1][1])).toBe('1 activity · 10 km · 1 h')
    expect(monthTitle('2026-03')).toBe('March 2026')
    expect(km(1234567)).toBe('1,235 km')
    expect(hours(1800)).toBe('1 h')
  })
})
