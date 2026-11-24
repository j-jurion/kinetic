import { describe, expect, it } from 'vitest'
import {
  FTP_FACTOR,
  KIND_COLORS,
  OTHER_COLORS,
  bestCurve,
  breakdownEvents,
  durationLabel,
  estimatedFtp,
  fastestPerDistance,
  formatImprovement,
  monthsBefore,
  ftpSettingSteps,
  isTransition,
  latestWeight,
  monthlyFtp,
  predictRaces,
  recordTimeline,
  riegel,
  routeLegs,
  segmentColors,
  segmentLabels,
  segmentSeconds,
  splitKind,
  withPowerCurve,
} from '../src/performance'
import { availablePowerSports, pickPowerSport, wattsPerKg } from '../src/powerStats'
import type { MultisportEvent, RaceRow } from '../src/types'
import { activity, at, bestEffort as be, trainingActivity as ta } from './factories'

describe('months before a date', () => {
  it('keeps the day and time, or clamps to the end of a shorter month', () => {
    expect(monthsBefore(at(2026, 6, 15, 9, 30), 12)).toEqual(at(2025, 6, 15, 9, 30))
    expect(monthsBefore(at(2026, 5, 31, 23, 59), 3)).toEqual(at(2026, 2, 28, 23, 59))
    expect(monthsBefore(at(2026, 3, 31), 1)).toEqual(at(2026, 2, 28))
    expect(monthsBefore(at(2026, 1, 31), 2)).toEqual(at(2025, 11, 30))
    expect(monthsBefore(at(2024, 2, 29), 12)).toEqual(at(2023, 2, 28))
    expect(monthsBefore(at(2028, 2, 29), 48)).toEqual(at(2024, 2, 29))
  })

  it('is not shifted by daylight saving time', () => {
    // 31 Oct is after the clocks go back; 31 Jul (summer time) minus 3 months is 30 Apr
    expect(monthsBefore(at(2026, 10, 31, 12), 3)).toEqual(at(2026, 7, 31, 12))
    expect(monthsBefore(at(2026, 7, 31, 0, 30), 3)).toEqual(at(2026, 4, 30, 0, 30))
  })

  it('does not change the date it is given', () => {
    const date = at(2026, 5, 31)
    monthsBefore(date, 3)
    expect(date).toEqual(at(2026, 5, 31))
  })
})

describe('race predictor', () => {
  it('applies Riegel with exponent 1.06', () => {
    expect(riegel(1200, 5000, 5000)).toBe(1200)
    expect(riegel(1200, 5000, 10000)).toBeCloseTo(1200 * 2 ** 1.06)
  })

  it('keeps the fastest effort per distance', () => {
    const fast = be({ distance_meters: 5000, duration_seconds: 1190 })
    const result = fastestPerDistance([be({ distance_meters: 10000, duration_seconds: 2500 }), be({ duration_seconds: 1250 }), fast])
    expect(result.map((e) => e.distance_meters)).toEqual([5000, 10000])
    expect(result[0]).toBe(fast)
  })

  it('predicts from the recent effort closest on a log scale', () => {
    const today = at(2026, 6, 1)
    const fiveK = be({ distance_meters: 5000, duration_seconds: 1200, date: '2026-04-01T08:00:00' })
    const half = be({ distance_meters: 21097.5, duration_seconds: 5400, date: '2026-05-01T08:00:00' })
    const oldTenK = be({ distance_meters: 10000, duration_seconds: 2300, date: '2024-04-01T08:00:00' })
    const mile = be({ distance_meters: 1609.34, duration_seconds: 300, date: '2026-05-01T08:00:00' })
    const { predictions, allTime } = predictRaces([fiveK, half, oldTenK, mile], today)
    expect(allTime).toBe(false)
    expect(predictions.map((p) => [p.target, p.source])).toEqual([
      [5000, fiveK],
      [10000, fiveK], // 10 km is closer to 5 km (×2) than to the half (×2.1)
      [21097.5, half],
      [42195, half],
    ])
    expect(predictions[1].seconds).toBeCloseTo(riegel(1200, 5000, 10000))
    // Records come from all efforts, old ones included
    expect(predictions[1].record).toBe(oldTenK)
    expect(predictions[3].record).toBeNull()
  })

  it('falls back to all-time efforts and ignores sprints', () => {
    const today = at(2026, 6, 1)
    const old = be({ distance_meters: 10000, duration_seconds: 2400, date: '2023-01-01T08:00:00' })
    const result = predictRaces([old, be({ distance_meters: 1000, duration_seconds: 180, date: '2026-05-01T08:00:00' })], today)
    expect(result.allTime).toBe(true)
    expect(result.predictions.every((p) => p.source === old)).toBe(true)
    expect(predictRaces([be({ distance_meters: 400, duration_seconds: 60 })], today)).toEqual({ predictions: [], allTime: true })
  })

  it('counts an effort exactly 12 months back on a month end as recent', () => {
    // 12 months before 29 Feb 2028 is 28 Feb 2027; setMonth rolled it over to 1 March, which
    // dropped an effort from 28 February
    const today = at(2028, 2, 29, 12)
    const edge = be({ duration_seconds: 1300, date: '2027-02-28T12:00:00' })
    expect(predictRaces([edge], today).allTime).toBe(false)
  })

  it('ignores efforts dated after today', () => {
    const today = at(2026, 6, 1)
    const future = be({ duration_seconds: 900, date: '2026-07-01T08:00:00' })
    const recent = be({ duration_seconds: 1300, date: '2026-05-01T08:00:00' })
    expect(predictRaces([future, recent], today).predictions[0].source).toBe(recent)
  })
})

describe('personal-record timeline', () => {
  it('keeps each new record with how much faster it was', () => {
    const efforts = [
      be({ distance_meters: 10000, duration_seconds: 2700, date: '2025-01-01T08:00:00' }),
      be({ duration_seconds: 1500, date: '2025-02-01T08:00:00' }),
      be({ duration_seconds: 1520, date: '2025-03-01T08:00:00' }), // slower: not a record
      be({ duration_seconds: 1458, date: '2025-04-01T08:00:00' }),
      be({ duration_seconds: 1458, date: '2025-05-01T08:00:00' }), // equal: not a record
    ]
    const timeline = recordTimeline(efforts)
    expect(timeline.map((h) => h.distance)).toEqual([5000, 10000])
    expect(timeline[0].steps.map((s) => [s.effort.duration_seconds, s.improvement])).toEqual([
      [1500, null],
      [1458, 42],
    ])
  })

  it('formats improvements with a minus sign', () => {
    expect(formatImprovement(42)).toBe('−0:42')
    expect(formatImprovement(62.4)).toBe('−1:02')
    expect(formatImprovement(3723)).toBe('−1:02:03')
  })
})

describe('power and FTP', () => {
  const ride = (date: string, curve: Record<string, number>, fields = {}) =>
    ta({ sport: 'cycling', date, power_curve: curve, ...fields })

  it('labels durations', () => {
    expect([5, 60, 1200, 3600].map(durationLabel)).toEqual(['5s', '1m', '20m', '60m'])
  })

  it('keeps activities of the power sport that have a curve', () => {
    const run = ta({ sport: 'trail_running', power_curve: { '60': 300 } })
    const bike = ride('2026-01-01T08:00:00', { '60': 400 })
    expect(withPowerCurve([run, bike, ta({ sport: 'running' })], 'running')).toEqual([run])
    expect(withPowerCurve([run, bike], 'cycling')).toEqual([bike])
  })

  it('takes the best power per duration since a date', () => {
    const a = ride('2026-01-01T08:00:00', { '5': 900, '60': 400, '1200': 250 })
    const b = ride('2026-02-01T08:00:00', { '5': 800, '60': 420, junk: 999, '300': 0 })
    expect(bestCurve([a, b]).map((p) => [p.duration, p.watts, p.activity])).toEqual([
      [5, 900, a],
      [60, 420, b],
      [1200, 250, a],
    ])
    expect(bestCurve([a, b], at(2026, 1, 15)).map((p) => p.duration)).toEqual([5, 60])
  })

  it('estimates FTP from the best 20 minutes of the last 42 days', () => {
    const old = ride('2026-01-01T08:00:00', { '1200': 320 })
    const recent = ride('2026-02-01T08:00:00', { '1200': 280 })
    expect(estimatedFtp([old, recent], at(2026, 2, 10))).toEqual({ ftp: 320 * FTP_FACTOR, activity: old })
    expect(estimatedFtp([old, recent], at(2026, 2, 20))).toEqual({ ftp: 280 * FTP_FACTOR, activity: recent })
    expect(estimatedFtp([old, recent], at(2026, 4, 1))).toBeNull()
  })

  it('gives a monthly FTP series, skipping months without a 20-minute effort', () => {
    const points = monthlyFtp(
      [ride('2026-01-20T08:00:00', { '1200': 300 }), ride('2026-04-02T08:00:00', { '1200': 310 })],
      at(2026, 4, 15),
    )
    expect(points.map((p) => [dayKey(p.month), p.ftp])).toEqual([
      ['2026-01-01', 285],
      ['2026-02-01', 285], // 20 Jan is within 42 days of the end of February, not of March
      ['2026-04-01', 294.5],
    ])
  })

  it('follows the watch FTP setting and the latest weight', () => {
    const acts = [
      ta({ date: '2026-03-01T08:00:00', ftp_setting: 260, weight_kg: 70 }),
      ta({ date: '2026-01-01T08:00:00', ftp_setting: 250, weight_kg: 72 }),
      ta({ date: '2026-02-01T08:00:00', ftp_setting: 250 }),
      ta({ date: '2026-04-01T08:00:00', ftp_setting: null }),
    ]
    expect(ftpSettingSteps(acts)).toEqual([
      { date: '2026-01-01T08:00:00', ftp: 250 },
      { date: '2026-03-01T08:00:00', ftp: 260 },
    ])
    expect(latestWeight(acts)).toBe(70)
    expect(latestWeight([])).toBeNull()
  })

  it('picks the power sport to show', () => {
    expect(pickPowerSport(['cycling', 'running'], 'cycling', true)).toBe('cycling')
    expect(pickPowerSport(['cycling', 'running'], null, true)).toBe('running')
    expect(pickPowerSport(['cycling'], 'running', true)).toBe('cycling')
    expect(pickPowerSport([], null, false)).toBeUndefined()
    const training = {
      activities: [ride('2026-01-01T08:00:00', { '60': 300 })],
      thresholds: { max_hr: null, max_hr_source: null, threshold_hr: null, threshold_hr_source: null, ftp_running: null, ftp_cycling: null, weight_kg: null },
      pending: 0,
      zones: [],
    }
    expect(availablePowerSports(training)).toEqual(['cycling'])
  })

  it('formats watts per kilogram', () => {
    expect(wattsPerKg(276, 80)).toBe('3.45 W/kg')
    expect(wattsPerKg(null, 80)).toBe('–')
    expect(wattsPerKg(276, null)).toBe('–')
  })
})

describe('multisport breakdown', () => {
  it('recognises split labels in English and Dutch', () => {
    const labels = ['Swim 1.9 km', 'T1', 'transition 2', 'Fietsen', 'Bike', 'Run 2', 'Lopen', 'Hardlopen', 'Zwemmen', 'T 2', 'Swim-to-bike', 'Kayak']
    expect(labels.map(splitKind)).toEqual(['swim', 't1', 't2', 'bike', 'bike', 'run', 'run', 'run', 'swim', 't2', 't1', 'other'])
    expect(isTransition('T1')).toBe(true)
    expect(isTransition('Run')).toBe(false)
  })

  it('colours repeated disciplines lighter the second time', () => {
    const colors = segmentColors(['Run 1', 'T1', 'Bike', 'T2', 'Run 2', 'Kayak'])
    expect(colors[0]).toBe(KIND_COLORS.run)
    expect(colors[1]).toBe(KIND_COLORS.t1)
    expect(colors[3]).toBe(KIND_COLORS.t2)
    expect(colors[4]).not.toBe(colors[0])
    expect(colors[5]).toBe(OTHER_COLORS[0])
  })

  it('places legs on the event timeline and numbers repeated ones', () => {
    const legs = routeLegs(
      '2026-05-01T10:00:00',
      [
        { sport: 'cycling', date: '2026-05-01T10:20:00', duration_seconds: 3600 },
        { sport: 'running', date: '2026-05-01T10:00:00', duration_seconds: 1150 },
        { sport: 'running', date: '2026-05-01T11:22:00', duration_seconds: null },
        { sport: 'transition', date: 'bad', duration_seconds: 60 },
      ],
      () => 'Other',
    )
    expect(legs.map((l) => [l.label, l.start, l.end])).toEqual([
      ['Run 1', 0, 1150],
      ['Bike', 1200, 4800],
      ['Run 2', 4920, 4920],
    ])
    expect(routeLegs('nope', [], () => '')).toEqual([])
  })

  const race = (id: number, date: string, splits: [string, number | null, number][]): RaceRow => ({
    official_time_seconds: null, bib_number: null, age_group: null, overall_rank: null, overall_total: null,
    gender_rank: null, gender_total: null, age_group_rank: null, age_group_total: null, results_url: null, notes: null,
    splits: splits.map(([label, duration_seconds, order]) => ({ label, duration_seconds, order, rank: null })),
    activity: activity({ id, date, sport: 'triathlon' }),
    parent_sport: null,
  })
  const multisport = (id: number, date: string, segments: [string, number][]): MultisportEvent =>
    ({
      id, name: `Event ${id}`, date, sport: 'triathlon', is_race: false, duration_seconds: 0,
      segments: segments.map(([label, seconds]) => ({ label, kind: splitKind(label), seconds })),
    }) as MultisportEvent

  it('prefers official race splits over recorded legs and sorts by date', () => {
    const events = breakdownEvents(
      [
        race(1, '2026-06-01T09:00:00', [['Run', 2700, 4], ['Swim', 1800, 0], ['  ', 60, 1], ['Bike', 5400, 2], ['T2', null, 3]]),
        race(2, '2026-01-01T09:00:00', [['Swim', 1800, 0]]), // one split is not a breakdown
      ],
      [multisport(1, '2026-06-01T09:00:00', [['Swim', 1900]]), multisport(3, '2025-09-01T09:00:00', [['Swim', 1000], ['Run', 900]])],
    )
    expect(events.map((e) => [e.id, e.source])).toEqual([[3, 'legs'], [1, 'splits']])
    expect(events[1].segments).toEqual([
      { label: 'Swim', seconds: 1800 },
      { label: 'Bike', seconds: 5400 },
      { label: 'Run', seconds: 2700 },
    ])
    expect(segmentSeconds(events[1], 'bike')).toBe(5400)
    expect(segmentSeconds(events[1], 't1')).toBeNull()
  })

  it('stacks segment labels in the order they happened', () => {
    const events = [
      { id: 1, name: '', date: '', source: 'legs' as const, segments: [{ label: 'Run 1', seconds: 1 }, { label: 'T1', seconds: 1 }, { label: 'Bike', seconds: 1 }, { label: 'T2', seconds: 1 }, { label: 'Run 2', seconds: 1 }] },
      { id: 2, name: '', date: '', source: 'legs' as const, segments: [{ label: 'Swim', seconds: 1 }, { label: 'T1', seconds: 1 }, { label: 'Bike', seconds: 1 }] },
    ]
    expect(segmentLabels(events)).toEqual(['Swim', 'Run 1', 'T1', 'Bike', 'T2', 'Run 2'])
  })
})

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
