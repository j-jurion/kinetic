import { describe, expect, it } from 'vitest'
import { activityForm, activityPayload, formatRank, raceForm, racePayload, rankItems } from '../src/forms'
import type { RaceResult } from '../src/types'
import { activity } from './factories'

const raceResult = (fields: Partial<RaceResult> = {}): RaceResult => ({
  official_time_seconds: null, bib_number: null, age_group: null, overall_rank: null, overall_total: null,
  gender_rank: null, gender_total: null, age_group_rank: null, age_group_total: null, results_url: null, notes: null,
  splits: [],
  ...fields,
})

describe('activity form', () => {
  it('round-trips an activity through the form', () => {
    const a = activity({
      name: 'Long run', date: '2026-03-29T09:15:00', sport: 'trail_running', kind: 'long_run',
      duration_seconds: 7200, distance_meters: 21000, avg_heart_rate: 142, calories: 1500,
      elevation_gain_meters: 640, avg_speed_ms: 2.9, notes: 'Muddy',
    })
    const result = activityPayload(activityForm(a), [3, 4])
    expect(result).toEqual({
      payload: {
        name: 'Long run', sport: 'trail_running', kind: 'long_run', date: '2026-03-29T09:15:00',
        duration_seconds: 7200, distance_meters: 21000, avg_heart_rate: 142, calories: 1500,
        elevation_gain_meters: 640, avg_speed_ms: 2.9, notes: 'Muddy', friend_ids: [3, 4],
      },
    })
  })

  it('sends empty and zero numbers as null and rounds whole-number fields', () => {
    const form = { ...activityForm(null), date: '01-02-2026 07:30', distance: '', avgHr: '151.6', calories: '0', avgSpeed: ' ' }
    const result = activityPayload(form, null)
    expect(result).toMatchObject({
      payload: { date: '2026-02-01T07:30:00', distance_meters: null, avg_heart_rate: 152, calories: null, avg_speed_ms: null, notes: null },
    })
    expect('friend_ids' in (result as { payload: object }).payload).toBe(false)
  })

  it('rejects an invalid date', () => {
    expect(activityPayload({ ...activityForm(null), date: '30-02-2026' }, null)).toEqual({
      error: 'Invalid date — use dd-mm-yyyy HH:MM',
    })
  })

  it('starts new activities as a running training today', () => {
    expect(activityForm(null)).toMatchObject({ name: '', sport: 'running', kind: 'training', duration: '0' })
  })
})

describe('race result form', () => {
  it('pre-fills the usual splits of a new triathlon or duathlon', () => {
    expect(raceForm(null, 'triathlon').splits.map((s) => s.label)).toEqual(['Swim', 'T1', 'Bike', 'T2', 'Run'])
    expect(raceForm(null, 'duathlon').splits.map((s) => s.label)).toEqual(['Run 1', 'T1', 'Bike', 'T2', 'Run 2'])
    expect(raceForm(null, 'running').splits).toEqual([])
  })

  it('round-trips a stored result without rounding times', () => {
    const stored = raceResult({
      official_time_seconds: 4523.4, bib_number: '17', age_group: 'M35', overall_rank: 12, overall_total: 340,
      gender_rank: 0, age_group_rank: 3, results_url: 'https://results.example', notes: 'Windy',
      splits: [
        { label: 'Swim', duration_seconds: 1650.25, rank: 20 },
        { label: 'T1', duration_seconds: null, rank: null },
      ],
    })
    const { fields, splits } = raceForm(stored, 'triathlon')
    expect(fields.official).toBe('1:15:23.4')
    expect(racePayload(fields, splits)).toEqual({
      payload: {
        official_time_seconds: 4523.4, bib_number: '17', age_group: 'M35', overall_rank: 12, overall_total: 340,
        gender_rank: 0, gender_total: null, age_group_rank: 3, age_group_total: null,
        results_url: 'https://results.example', notes: 'Windy',
        splits: [
          { label: 'Swim', duration_seconds: 1650.25, rank: 20 },
          { label: 'T1', duration_seconds: null, rank: null },
        ],
      },
    })
  })

  it('names the field with an invalid time', () => {
    const { fields, splits } = raceForm(null, 'triathlon')
    expect(racePayload({ ...fields, official: '1:75' }, splits)).toEqual({
      error: 'Invalid official time; use M:SS or H:MM:SS, with seconds from 00 to 59.',
    })
    splits[2].time = '61:00:7'
    expect(racePayload(fields, splits)).toMatchObject({ error: expect.stringMatching(/^Invalid time for Bike;/) })
  })

  it('drops unlabelled splits and ignores non-numeric ranks', () => {
    const { fields } = raceForm(null, 'running')
    const result = racePayload(fields, [
      { key: 0, label: 'Lap 1', time: '5:00', rank: ' 4 ' },
      { key: 1, label: '  ', time: '5:00', rank: '' },
      { key: 2, label: 'Lap 2', time: '', rank: 'first' },
    ])
    expect(result).toMatchObject({
      payload: {
        official_time_seconds: null,
        splits: [
          { label: 'Lap 1', duration_seconds: 300, rank: 4 },
          { label: 'Lap 2', duration_seconds: null, rank: null },
        ],
      },
    })
  })

  it('shows ranks with their totals', () => {
    expect(formatRank(12, 340)).toBe('12/340')
    expect(formatRank(12, null)).toBe('12')
    expect(formatRank(null, 340)).toBeNull()
    expect(rankItems(raceResult({ overall_rank: 5, overall_total: 50, age_group_rank: 1, age_group: 'M35' }))).toEqual([
      ['Overall', 5, 50],
      ['M35', 1, null],
    ])
    expect(rankItems(null)).toEqual([])
  })
})
