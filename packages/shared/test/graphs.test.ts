import { describe, expect, it } from 'vitest'
import {
  cumulativeByYear,
  inYear,
  metricConfig,
  monthlyTotals,
  paceAsTime,
  paceTrend,
  personalBestProgression,
  rollingAverage,
  totalsBy,
  weekStart,
  weeklyTotals,
  yearlyTotals,
} from '../src/graphs'
import { dayKey } from '../src/training'
import { at, graphPoint as gp } from './factories'

describe('weeks', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart(at(2026, 1, 5, 12))).toEqual(at(2026, 1, 5)) // Monday
    expect(weekStart(at(2026, 1, 11, 23, 59))).toEqual(at(2026, 1, 5)) // Sunday
    expect(weekStart(at(2026, 1, 1))).toEqual(at(2025, 12, 29)) // across a year
    expect(weekStart(at(2026, 3, 29, 12))).toEqual(at(2026, 3, 23)) // DST Sunday
  })

  it('totals the last 52 weeks without gaps when no year is selected', () => {
    const weeks = weeklyTotals(
      [gp({ date: '2026-01-07T08:00:00', distance_meters: 8000 }), gp({ date: '2026-01-08T08:00:00', distance_meters: 2000 })],
      null,
      at(2026, 1, 8),
    )
    expect(weeks).toHaveLength(52)
    expect(dayKey(weeks[0].start)).toBe('2025-01-13')
    expect(weeks.at(-1)).toMatchObject({ count: 2, distance_meters: 10000 })
    expect(new Set(weeks.map((w) => w.start.getHours()))).toEqual(new Set([0])) // all midnight, despite DST
  })

  it('covers a selected year up to the current week', () => {
    const past = weeklyTotals([], 2025, at(2026, 6, 1))
    expect(dayKey(past[0].start)).toBe('2024-12-30')
    expect(dayKey(past.at(-1)!.start)).toBe('2025-12-29')
    const current = weeklyTotals([], 2026, at(2026, 1, 20))
    expect(current.map((w) => dayKey(w.start))).toEqual(['2025-12-29', '2026-01-05', '2026-01-12', '2026-01-19'])
  })
})

describe('months and years', () => {
  const points = [
    gp({ date: '2024-11-03T08:00:00', distance_meters: 5000, duration_seconds: 1500, elevation_meters: 50 }),
    gp({ date: '2026-02-01T08:00:00', distance_meters: 10000, duration_seconds: 3000, elevation_meters: null }),
    gp({ date: '2026-02-28T08:00:00', distance_meters: null, duration_seconds: 600 }),
  ]

  it('totals every month from the first activity to this month', () => {
    const months = monthlyTotals(points, null, at(2026, 3, 15))
    expect(months).toHaveLength(17) // Nov 2024 … Mar 2026
    expect(months[0]).toMatchObject({ count: 1, distance_meters: 5000, elevation_meters: 50 })
    expect(months[15]).toMatchObject({ count: 2, distance_meters: 10000, duration_seconds: 3600 })
    expect(months[16].count).toBe(0)
    expect(monthlyTotals([], null)).toEqual([])
  })

  it('limits a selected year to the months so far', () => {
    expect(monthlyTotals(points, 2026, at(2026, 3, 15))).toHaveLength(3)
    expect(monthlyTotals(points, 2024, at(2026, 3, 15))).toHaveLength(12)
  })

  it('totals every year, including empty years in between', () => {
    expect(yearlyTotals(points).map((y) => [y.year, y.count])).toEqual([[2024, 1], [2025, 0], [2026, 2]])
    expect(yearlyTotals([])).toEqual([])
  })

  it('filters points to a year', () => {
    expect(inYear(points, 2026)).toHaveLength(2)
    expect(inYear(points, null)).toBe(points)
  })
})

describe('metrics and aggregates', () => {
  it('switches distance to metres for swimming', () => {
    const totals = { count: 3, distance_meters: 12345, duration_seconds: 5400, elevation_meters: 99.6 }
    expect(metricConfig('distance', 'running').value(totals)).toBe(12.3)
    expect(metricConfig('distance', 'swimming')).toMatchObject({ unit: 'm' })
    expect(metricConfig('distance', 'swimming').value(totals)).toBe(12345)
    expect(metricConfig('time', '').value(totals)).toBe(1.5)
    expect(metricConfig('elevation', '').value(totals)).toBe(100)
    expect(metricConfig('count', '').value(totals)).toBe(3)
  })

  it('averages over a trailing window', () => {
    expect(rollingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7])
    expect(rollingAverage([], 4)).toEqual([])
  })

  it('accumulates each year on a shared Jan–Dec axis', () => {
    const metric = metricConfig('distance', 'running')
    const years = cumulativeByYear(
      [
        gp({ date: '2025-03-01T08:00:00', distance_meters: 5000 }),
        gp({ date: '2024-02-29T08:00:00', distance_meters: 10000 }),
        gp({ date: '2025-01-15T08:00:00', distance_meters: 2500 }),
      ],
      metric,
    )
    expect(years.map((y) => y.year)).toEqual([2024, 2025])
    expect(years[0]).toEqual({ year: 2024, x: ['2000-01-01T00:00:00', '2000-02-29T08:00:00'], y: [0, 10] })
    expect(years[1].y).toEqual([0, 2.5, 7.5])
    const many = cumulativeByYear(
      Array.from({ length: 8 }, (_, i) => gp({ date: `${2018 + i}-06-01T08:00:00` })),
      metric,
      3,
    )
    expect(many.map((y) => y.year)).toEqual([2023, 2024, 2025])
  })

  it('computes pace per km or per 100 m, oldest first', () => {
    const trend = paceTrend(
      [
        gp({ date: '2026-02-01T08:00:00', distance_meters: 2000, duration_seconds: 2400 }),
        gp({ date: '2026-01-01T08:00:00', distance_meters: 1000, duration_seconds: 1100 }),
        gp({ date: '2026-01-15T08:00:00', distance_meters: 0, duration_seconds: 1100 }),
      ],
      'swimming',
    )
    expect(trend.map((t) => t.pace)).toEqual([110, 120])
    expect(paceAsTime(272)).toBe('1970-01-01T00:04:32.000Z')
  })

  it('totals by sport or kind, largest first, dropping zeros', () => {
    const metric = metricConfig('distance', '')
    const result = totalsBy(
      [
        gp({ sport: 'cycling', distance_meters: 40000 }),
        gp({ sport: 'running', distance_meters: 10000 }),
        gp({ sport: 'running', distance_meters: 12000 }),
        gp({ sport: 'yoga', distance_meters: null }),
      ],
      'sport',
      metric,
    )
    expect(result).toEqual([{ key: 'cycling', value: 40 }, { key: 'running', value: 22 }])
  })

  it('tracks the fastest time so far', () => {
    expect(personalBestProgression([300, 290, 295, 280])).toEqual([300, 290, 290, 280])
  })
})
