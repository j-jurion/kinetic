import { describe, expect, it } from 'vitest'
import { activityPagePath, activityTotalsPath, appendPage, byMonth, hours, km, monthSummary, monthTitle, nextPageCursor, totals } from '../src/activityList'
import { dashboardSince } from '../src/dashboard'
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

describe('paged activity lists', () => {
  const rows = (...ids: number[]) => ids.map((id) => activity({ id, date: `2026-01-${String(30 - id).padStart(2, '0')}T08:00:00` }))

  it('builds page and totals paths from the filters', () => {
    expect(activityPagePath({})).toBe('/activities?limit=50')
    expect(activityPagePath({ sport: 'running', year: 2026 }, '2026-01-05T08:00:00,12', 20)).toBe(
      '/activities?sport=running&year=2026&limit=20&before=2026-01-05T08%3A00%3A00%2C12',
    )
    expect(activityPagePath({ sport: '', year: null, friend: 3 })).toBe('/activities?friend=3&limit=50')
    expect(activityTotalsPath({ sport: 'cycling' })).toBe('/activities/totals?sport=cycling')
    expect(activityTotalsPath({})).toBe('/activities/totals')
  })

  it('continues after the last row of a full page, and stops after a short one', () => {
    const page = rows(1, 2, 3)
    expect(nextPageCursor(page, 3)).toBe(`${page[2].date},3`)
    expect(nextPageCursor(page, 4)).toBeNull()
    expect(nextPageCursor([], 3)).toBeNull()
  })

  it('appends pages without listing an activity twice', () => {
    const merged = appendPage(rows(1, 2, 3), rows(3, 4))
    expect(merged.map((r) => r.id)).toEqual([1, 2, 3, 4])
  })
})

describe('dashboard window', () => {
  it('starts on 1 January of last year', () => {
    expect(dashboardSince(new Date(2026, 10, 24))).toBe('2025-01-01')
    expect(dashboardSince(new Date(2026, 0, 1))).toBe('2025-01-01')
  })
})
