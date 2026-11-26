import { describe, expect, it } from 'vitest'
import {
  measuredShortNote,
  distanceLabel,
  distanceSlug,
  filteredUrl,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPace,
  isSwimming,
  kindLabel,
  markYearBests,
  ordinal,
  parseDate,
  inDateRange,
  parseDateInput,
  parseDateRange,
  resolveSports,
  sportColor,
  sportLabel,
  stepsPerMinute,
  toIsoLocal,
} from '../src/format'
import { at } from './factories'

describe('dates', () => {
  it('parses API dates as local wall-clock time', () => {
    expect(parseDate('2026-03-29T02:30:00')).toEqual(at(2026, 3, 29, 3, 30)) // DST gap: 02:30 does not exist
    expect(parseDate('2026-07-01T18:05:09')).toEqual(new Date(2026, 6, 1, 18, 5, 9))
    expect(parseDate('2026-07-01')).toEqual(at(2026, 7, 1))
    expect(parseDate('2026-07-01 18:05')).toEqual(at(2026, 7, 1, 18, 5))
  })

  it('ignores a time zone suffix instead of converting', () => {
    expect(parseDate('2026-07-01T18:05:00Z')).toEqual(at(2026, 7, 1, 18, 5))
    expect(parseDate('2026-07-01T18:05:00+02:00')).toEqual(at(2026, 7, 1, 18, 5))
  })

  it('returns null for missing or malformed dates', () => {
    expect(parseDate(null)).toBeNull()
    expect(parseDate(undefined)).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate('01-07-2026')).toBeNull()
  })

  it('formats as dd-mm-yyyy and dd-mm-yyyy HH:MM', () => {
    expect(formatDate('2026-07-01T18:05:00')).toBe('01-07-2026')
    expect(formatDate(at(2026, 12, 31))).toBe('31-12-2026')
    expect(formatDateTime('2026-07-01T08:05:00')).toBe('01-07-2026 08:05')
    expect(formatDate(null)).toBe('')
    expect(formatDateTime('nonsense')).toBe('')
  })

  it('reads user-entered dates in dd-mm-yyyy[ HH:MM] or ISO', () => {
    expect(parseDateInput('1-7-2026')).toBe('2026-07-01T00:00:00')
    expect(parseDateInput(' 01-07-2026 8:05 ')).toBe('2026-07-01T08:05:00')
    expect(parseDateInput('2026-07-01T08:05')).toBe('2026-07-01T08:05:00')
    expect(parseDateInput('2026-07-01')).toBe('2026-07-01T00:00:00')
  })

  it('rejects impossible user-entered dates', () => {
    expect(parseDateInput('31-02-2026')).toBeNull()
    expect(parseDateInput('29-02-2025')).toBeNull()
    expect(parseDateInput('29-02-2024')).toBe('2024-02-29T00:00:00')
    expect(parseDateInput('13-13-2026')).toBeNull()
    expect(parseDateInput('yesterday')).toBeNull()
    expect(parseDateInput('')).toBeNull()
  })

  it('round-trips through the form format', () => {
    const iso = '2026-10-25T02:30:00' // the repeated hour when DST ends
    expect(parseDateInput(formatDateTime(iso))).toBe(iso)
    expect(toIsoLocal(parseDate(iso)!)).toBe(iso)
  })
})

describe('durations, distances and paces', () => {
  it('formats durations as m:ss or h mm ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(59.9)).toBe('0:59')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3600)).toBe('1h 00m 00s')
    expect(formatDuration(3 * 3600 + 25 * 60 + 7)).toBe('3h 25m 07s')
  })

  it('shows swimming in metres and other sports in kilometres', () => {
    expect(formatDistance(1500, 'swimming')).toBe('1500 m')
    expect(formatDistance(21097.5, 'running')).toBe('21.10 km')
    expect(formatDistance(1234)).toBe('1.23 km')
  })

  it('names the standard distances', () => {
    expect(distanceLabel(42195)).toBe('Marathon')
    expect(distanceLabel(21097.5)).toBe('Half marathon')
    expect(distanceLabel(1609.34)).toBe('1 mile')
    expect(distanceLabel(7500)).toBe('7.5 km')
    expect(distanceLabel(400, 'swimming')).toBe('400 m')
  })

  it('gives pace per km, or per 100 m for swimming', () => {
    expect(formatPace(10000, 2700)).toBe('4:30 /km')
    expect(formatPace(5000, 1499, 'running')).toBe('4:59 /km')
    expect(formatPace(1000, 1050, 'swimming')).toBe('1:45 /100m')
    expect(formatPace(0, 100)).toBe('-')
  })

  it('turns stored distances into URL slugs', () => {
    expect(distanceSlug(5000)).toBe('5000')
    expect(distanceSlug(21097.5)).toBe('21097.5')
    expect(distanceSlug(1609.34)).toBe('1609.34')
  })
})

describe('sports', () => {
  it('labels sports and kinds', () => {
    expect(sportLabel('trail_running')).toBe('Trail running')
    expect(sportLabel('all_running')).toBe('All running')
    expect(kindLabel('long_run')).toBe('Long Run')
  })

  it('resolves filter values to the sports they cover', () => {
    expect(resolveSports('')).toBeNull()
    expect(resolveSports(null)).toBeNull()
    expect(resolveSports('all_running')).toEqual(['running', 'trail_running'])
    expect(resolveSports('multisport')).toEqual(['multisport', 'triathlon', 'duathlon'])
    expect(resolveSports('cycling')).toEqual(['cycling'])
  })

  it('does not let callers mutate the shared sport groups', () => {
    resolveSports('all_running')!.push('cycling')
    expect(resolveSports('all_running')).toEqual(['running', 'trail_running'])
  })

  it('treats only a pure swimming selection as swimming', () => {
    expect(isSwimming('swimming')).toBe(true)
    expect(isSwimming('triathlon')).toBe(false)
    expect(isSwimming('')).toBe(false)
    expect(isSwimming(null)).toBe(false)
  })

  it('doubles the one-foot cadence for sports on foot only', () => {
    expect(stepsPerMinute(85, 'running')).toBe(170)
    expect(stepsPerMinute(55, 'hiking')).toBe(110)
    expect(stepsPerMinute(90, 'cycling')).toBe(90)
  })

  it('colours groups like their first sport and falls back for unknown sports', () => {
    expect(sportColor('all_running')).toBe(sportColor('running'))
    expect(sportColor('curling', '#000')).toBe('#000')
    expect(sportColor(null, '#111')).toBe('#111')
  })
})

describe('small helpers', () => {
  it('writes English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th',
    ])
  })

  it('marks the first (best) entry of each year', () => {
    expect(markYearBests([2026, 2025, 2026, 2024, 2025])).toEqual([true, true, false, true, false])
  })

  it('carries the sport and year filter into URLs', () => {
    expect(filteredUrl('/best-efforts')).toBe('/best-efforts')
    expect(filteredUrl('/best-efforts', 'running', 2026)).toBe('/best-efforts?sport=running&year=2026')
    expect(filteredUrl('/x', null, 2026)).toBe('/x?year=2026')
  })
})

describe('date ranges', () => {
  it('covers whole local days, both inclusive', () => {
    const range = parseDateRange('01-03-2025', '31-03-2025')
    expect(range).toEqual({ sinceMs: at(2025, 3, 1).getTime(), untilMs: at(2025, 4, 1).getTime() })
    expect(inDateRange(at(2025, 3, 31, 23, 59).getTime(), range)).toBe(true)
    expect(inDateRange(at(2025, 4, 1).getTime(), range)).toBe(false)
    expect(inDateRange(at(2025, 2, 28, 23, 59).getTime(), range)).toBe(false)
  })

  it('leaves out empty bounds and rejects bad input', () => {
    expect(parseDateRange('', ' ')).toEqual({ sinceMs: null, untilMs: null })
    expect(inDateRange(0, parseDateRange('', ''))).toBe(true)
    expect(parseDateRange('', '05-03-2025').sinceMs).toBeNull()
    expect(() => parseDateRange('31-02-2025', '')).toThrow('Invalid date')
    expect(() => parseDateRange('05-03-2025', '01-03-2025')).toThrow('before the start')
  })
})

describe('measuredShortNote', () => {
  it('notes how far short a race counted at its distance measured', () => {
    expect(measuredShortNote({ source: 'race', distance_meters: 42195, measured_meters: 42150 })).toBe('GPS measured 45 m short')
    expect(measuredShortNote({ source: 'gps', distance_meters: 42195, measured_meters: null })).toBeNull()
    expect(measuredShortNote({ distance_meters: 5000 })).toBeNull()
    expect(measuredShortNote({ source: 'official', distance_meters: 42195, measured_meters: 42600 })).toBe('Official race time')
  })
})
