import { describe, expect, it } from 'vitest'
import {
  FATIGUE_DAYS,
  FITNESS_DAYS,
  activeDays,
  addDays,
  aerobicEfficiency,
  brickRuns,
  calendarGrid,
  currentStreak,
  dailyLoads,
  dayKey,
  discipline,
  fitnessSeries,
  formBand,
  gradeAdjustedRuns,
  heatVsPace,
  intensitySplit,
  linearFit,
  longDecoupling,
  longestStreak,
  rangeStart,
  runField,
  speedOf,
  weeklyDisciplines,
  weeklyLoad,
  weeklyStreak,
  weeklyZones,
} from '../src/training'
import { at, trainingActivity as ta } from './factories'

const days = (...keys: string[]) => new Set(keys)

describe('dates across daylight saving time', () => {
  it('adds calendar days, staying at midnight through 23- and 25-hour days', () => {
    expect(addDays(at(2026, 3, 28, 15), 1)).toEqual(at(2026, 3, 29))
    expect(addDays(at(2026, 3, 29), 1)).toEqual(at(2026, 3, 30))
    expect(addDays(at(2026, 10, 25), 1)).toEqual(at(2026, 10, 26))
    expect(addDays(at(2026, 1, 1), -1)).toEqual(at(2025, 12, 31))
    expect(dayKey(at(2026, 3, 9))).toBe('2026-03-09')
  })

  it('starts ranges 3 or 12 months back, or not at all', () => {
    expect(rangeStart('3m', at(2026, 5, 20, 14))).toEqual(at(2026, 2, 20))
    // A shorter target month ends the range on its last day instead of rolling into the next
    expect(rangeStart('3m', at(2026, 5, 31, 14))).toEqual(at(2026, 2, 28))
    expect(rangeStart('3m', at(2024, 5, 31))).toEqual(at(2024, 2, 29))
    expect(rangeStart('3m', at(2026, 12, 31))).toEqual(at(2026, 9, 30))
    expect(rangeStart('12m', at(2024, 2, 29))).toEqual(at(2023, 2, 28))
    expect(rangeStart('12m', at(2026, 7, 15, 9))).toEqual(at(2025, 7, 15))
    expect(rangeStart('all')).toBeNull()
  })
})

describe('fitness, fatigue and form', () => {
  it('adds up the load per day of top-level activities only', () => {
    const loads = dailyLoads([
      ta({ id: 1, date: '2026-01-05T07:00:00', load: 40 }),
      ta({ date: '2026-01-05T18:00:00', load: 20 }),
      ta({ date: '2026-01-05T07:10:00', load: 15, parent_id: 1 }), // a leg of the first
      ta({ date: '2026-01-06T07:00:00', load: 0 }),
    ])
    expect(Object.fromEntries(loads)).toEqual({ '2026-01-05': 60, '2026-01-06': 0 })
  })

  it('uses exponentially weighted averages with form from the day before', () => {
    const series = fitnessSeries([ta({ date: '2026-01-05T08:00:00', load: 84 })], at(2026, 1, 7))
    expect(series.map((d) => dayKey(d.date))).toEqual(['2026-01-05', '2026-01-06', '2026-01-07'])
    const [first, second] = series
    expect(first.load).toBe(84)
    expect(first.ctl).toBeCloseTo(84 / FITNESS_DAYS)
    expect(first.atl).toBeCloseTo(84 / FATIGUE_DAYS)
    expect(first.tsb).toBe(0) // form is yesterday's fitness minus fatigue
    expect(second.tsb).toBeCloseTo(first.ctl - first.atl)
    expect(second.ctl).toBeCloseTo(first.ctl * (1 - 1 / FITNESS_DAYS))
  })

  it('converges to a steady daily load', () => {
    const activities = Array.from({ length: 400 }, (_, i) =>
      ta({ date: `${dayKey(addDays(at(2025, 1, 1), i))}T07:00:00`, load: 50 }),
    )
    const last = fitnessSeries(activities, at(2026, 2, 4)).at(-1)!
    expect(last.ctl).toBeCloseTo(50, 2)
    expect(last.atl).toBeCloseTo(50, 5)
    expect(last.tsb).toBeCloseTo(0, 2)
  })

  it('has one point per calendar day across a DST change', () => {
    const series = fitnessSeries([ta({ date: '2026-03-27T08:00:00', load: 10 })], at(2026, 3, 31, 20))
    expect(series.map((d) => dayKey(d.date))).toEqual([
      '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31',
    ])
  })

  it('is empty without dated activities', () => {
    expect(fitnessSeries([])).toEqual([])
  })

  it('names form bands at their boundaries', () => {
    expect([6, 5, -10, -10.1, -30, -31].map(formBand)).toEqual([
      'Fresh', 'Neutral', 'Neutral', 'Productive', 'Productive', 'Overreaching',
    ])
  })
})

describe('weekly totals', () => {
  it('computes weekly load, its 4-week average and the ramp rate', () => {
    const activities = [
      ta({ date: '2026-01-05T08:00:00', load: 100 }), // Monday of week 1
      ta({ date: '2026-01-11T20:00:00', load: 100 }), // Sunday, still week 1
      ta({ date: '2026-01-12T08:00:00', load: 200 }), // week 2
      ta({ date: '2026-01-26T08:00:00', load: 400 }), // week 4; week 3 is empty
    ]
    const weeks = weeklyLoad(activities, null, at(2026, 1, 28))
    expect(weeks.map((w) => [dayKey(w.start), w.load])).toEqual([
      ['2026-01-05', 200], ['2026-01-12', 200], ['2026-01-19', 0], ['2026-01-26', 400],
    ])
    expect(weeks.map((w) => w.average)).toEqual([50, 100, 100, 200])
    expect(weeks.map((w) => w.ramp)).toEqual([null, 100, 0, 100])
    // A later range still uses the history before it for the average
    expect(weeklyLoad(activities, at(2026, 1, 21), at(2026, 1, 28)).map((w) => w.average)).toEqual([100, 200])
  })

  it('sums heart-rate zones per week and splits intensity', () => {
    const weeks = weeklyZones(
      [
        ta({ date: '2026-01-05T08:00:00', zone_seconds: [600, 1200, 600, 300, 300] }),
        ta({ date: '2026-01-06T08:00:00', zone_seconds: null }),
        ta({ id: 9, date: '2026-01-07T08:00:00', zone_seconds: [0, 1200, 0, 0, 0] }),
        ta({ date: '2026-01-07T08:00:00', parent_id: 9, zone_seconds: [9999, 0, 0, 0, 0] }), // leg
      ],
      null,
      at(2026, 1, 8),
    )
    expect(weeks).toHaveLength(1)
    expect(weeks[0].value).toEqual([600, 2400, 600, 300, 300])
    const split = intensitySplit(weeks)
    expect(split.totalSeconds).toBe(4200)
    expect(split.easy).toBeCloseTo((3000 / 4200) * 100)
    expect(split.moderate).toBeCloseTo((600 / 4200) * 100)
    expect(split.hard).toBeCloseTo((600 / 4200) * 100)
    expect(intensitySplit([])).toEqual({ easy: 0, moderate: 0, hard: 0, totalSeconds: 0 })
  })

  it('counts multisport legs per discipline instead of their event', () => {
    const weeks = weeklyDisciplines(
      [
        ta({ id: 1, sport: 'triathlon', date: '2026-01-10T09:00:00', moving_seconds: 3 * 3600 }),
        ta({ sport: 'swimming', parent_id: 1, date: '2026-01-10T09:00:00', moving_seconds: 1800 }),
        ta({ sport: 'cycling', parent_id: 1, date: '2026-01-10T09:35:00', moving_seconds: 5400 }),
        ta({ sport: 'trail_running', date: '2026-01-11T09:00:00', moving_seconds: 3600 }),
        ta({ sport: 'yoga', date: '2026-01-11T18:00:00', moving_seconds: 1800 }),
      ],
      null,
      at(2026, 1, 11),
    )
    expect(weeks.map((w) => w.value)).toEqual([{ Swim: 0.5, Bike: 1.5, Run: 1, Other: 0.5 }])
    expect(['swimming', 'cycling', 'running', 'trail_running', 'hiking'].map(discipline)).toEqual([
      'Swim', 'Bike', 'Run', 'Run', 'Other',
    ])
  })
})

describe('consistency', () => {
  it('counts the current streak up to today, or yesterday while today is empty', () => {
    const active = days('2026-01-03', '2026-01-04', '2026-01-05')
    expect(currentStreak(active, at(2026, 1, 5, 21))).toBe(3)
    expect(currentStreak(active, at(2026, 1, 6, 7))).toBe(3)
    expect(currentStreak(active, at(2026, 1, 7, 7))).toBe(0)
  })

  it('finds the longest streak, also across months and DST', () => {
    expect(longestStreak(days())).toBe(0)
    expect(longestStreak(days('2026-01-01', '2026-01-03'))).toBe(1)
    expect(longestStreak(days('2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-10'))).toBe(5)
  })

  it('counts consecutive active weeks', () => {
    const active = days('2025-12-29', '2026-01-07', '2026-01-18') // three consecutive weeks
    expect(weeklyStreak(active, at(2026, 1, 18))).toBe(3)
    expect(weeklyStreak(active, at(2026, 1, 21))).toBe(3) // this week is still empty
    expect(weeklyStreak(active, at(2026, 1, 28))).toBe(0)
  })

  it('collects active days from top-level activities', () => {
    const active = activeDays([
      ta({ id: 5, date: '2026-01-05T23:30:00' }),
      ta({ date: '2026-01-06T00:10:00', parent_id: 5 }),
    ])
    expect([...active]).toEqual(['2026-01-05'])
  })

  it('lays the calendar out per weekday and week, blank after today', () => {
    const grid = calendarGrid(new Map([['2026-01-06', 80]]), days('2026-01-06', '2026-01-07'), at(2026, 1, 6), at(2026, 1, 14))
    expect(grid.weeks.map(dayKey)).toEqual(['2026-01-05', '2026-01-12'])
    // Monday 5 Jan is before `from`, Tuesday has load, Wednesday is active without load
    expect(grid.z.map((row) => row[0])).toEqual([null, 80, 1, 0, 0, 0, 0])
    // Second week: Monday and Tuesday are past, Wednesday is today, the rest is future
    expect(grid.z.map((row) => row[1])).toEqual([0, 0, 0, null, null, null, null])
    expect(grid.keys[6][1]).toBe('2026-01-18')
  })
})

describe('running trends', () => {
  it('prefers the recorded speed, else distance over moving time', () => {
    expect(speedOf(ta({ avg_speed_ms: 3.2 }))).toBe(3.2)
    expect(speedOf(ta({ distance_meters: 9000, moving_seconds: 3000 }))).toBe(3)
    expect(speedOf(ta({ distance_meters: null }))).toBeNull()
    expect(speedOf(ta({ moving_seconds: 0 }))).toBeNull()
  })

  it('computes aerobic efficiency for steady runs only', () => {
    const steady = ta({ avg_speed_ms: 3, avg_heart_rate: 150 })
    const results = aerobicEfficiency([
      steady,
      ta({ avg_speed_ms: 4, avg_heart_rate: 170, kind: 'race' }),
      ta({ avg_speed_ms: 4, avg_heart_rate: 170, kind: 'interval' }),
      ta({ avg_speed_ms: 3, avg_heart_rate: null }),
      ta({ avg_speed_ms: 3, avg_heart_rate: 140, moving_seconds: 300 }),
      ta({ sport: 'cycling', avg_speed_ms: 8, avg_heart_rate: 140 }),
    ])
    expect(results).toEqual([{ activity: steady, value: (3 * 60) / 150 }])
  })

  it('reports running dynamics with cadence in steps per minute', () => {
    const run = ta({ avg_cadence: 86 })
    expect(runField([run, ta({ avg_cadence: null }), ta({ sport: 'cycling', avg_cadence: 90 })], 'avg_cadence')).toEqual([
      { activity: run, value: 172 },
    ])
  })

  it('pairs temperature with pace for runs', () => {
    const run = ta({ avg_temperature: 0, avg_speed_ms: 4 })
    expect(heatVsPace([run, ta({ avg_temperature: null, avg_speed_ms: 4 })])).toEqual([
      { activity: run, temperature: 0, pace: 250 },
    ])
  })

  it('fits a least-squares line', () => {
    expect(linearFit([1, 2, 3, 4], [3, 5, 7, 9])).toEqual({ slope: 2, intercept: 1 })
    expect(linearFit([1, 2], [1, 2])).toBeNull()
    expect(linearFit([2, 2, 2], [1, 2, 3])).toBeNull()
  })

  it('keeps trail and hilly runs for grade-adjusted pace', () => {
    const trail = ta({ sport: 'trail_running', avg_speed_ms: 2.5, grade_adjusted_speed: 3.125 })
    const hilly = ta({ avg_speed_ms: 3, grade_adjusted_speed: 3.2, elevation_gain_meters: 150, distance_meters: 10000 })
    const flat = ta({ avg_speed_ms: 3, grade_adjusted_speed: 3.05, elevation_gain_meters: 100, distance_meters: 10000 })
    expect(gradeAdjustedRuns([trail, hilly, flat]).map((r) => r.activity)).toEqual([trail, hilly])
    expect(gradeAdjustedRuns([trail])[0]).toMatchObject({ pace: 400, gradeAdjustedPace: 320 })
  })

  it('keeps long sessions with decoupling, without multisport events', () => {
    const long = ta({ moving_seconds: 3600, decoupling_pct: 4 })
    const event = ta({ sport: 'triathlon', moving_seconds: 7200, decoupling_pct: 6 })
    expect(longDecoupling([long, event, ta({ moving_seconds: 3599, decoupling_pct: 2 })])).toEqual([long])
  })
})

describe('brick runs', () => {
  it('finds run legs after a ride and runs right after a ride, and compares them', () => {
    const event = ta({ id: 100, sport: 'triathlon', date: '2026-06-07T09:00:00' })
    const legs = [
      ta({ sport: 'swimming', parent_id: 100, date: '2026-06-07T09:00:00' }),
      ta({ sport: 'cycling', parent_id: 100, date: '2026-06-07T09:30:00' }),
      ta({ sport: 'other', parent_id: 100, date: '2026-06-07T11:00:00' }), // transition
      ta({ id: 101, sport: 'running', parent_id: 100, date: '2026-06-07T11:02:00', distance_meters: 10000, avg_speed_ms: 3 }),
    ]
    const ride = ta({ sport: 'cycling', date: '2026-06-10T07:00:00', duration_seconds: 3600 })
    const offTheBike = ta({ id: 102, date: '2026-06-10T08:10:00', distance_meters: 5000, avg_speed_ms: 3.2 })
    const tooLate = ta({ id: 103, date: '2026-06-10T08:45:00', distance_meters: 10000, avg_speed_ms: 3.5 })
    const normal = ta({ id: 104, date: '2026-06-12T07:00:00', distance_meters: 11000, avg_speed_ms: 3.6 })

    const bricks = brickRuns([event, ...legs, ride, offTheBike, tooLate, normal])
    expect(bricks.map((b) => b.activity.id)).toEqual([101, 102])
    const leg = bricks[0]
    expect(leg.pace).toBeCloseTo(1000 / 3)
    // 10 km and 11 km runs are within ±30% of 10 km; the 5 km one is not
    expect(leg.normalCount).toBe(2)
    expect(leg.normalPace).toBeCloseTo((1000 / 3.5 + 1000 / 3.6) / 2)
    expect(bricks[1]).toMatchObject({ normalPace: null, normalCount: 0 })
  })
})
