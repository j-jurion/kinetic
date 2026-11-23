// The activity and race-result forms' values and payloads, shared by the web and mobile apps so
// both send the backend exactly the same data.
import { formatDateTime, parseDateInput } from './format'
import { TIME_RULE, formatTimeInput, isValidTime, parseTimeInput } from './time'
import type { Activity, RaceResult } from './types'

// ── Activity ──

export type ActivityForm = Record<
  'name' | 'date' | 'sport' | 'kind' | 'duration' | 'distance' | 'avgHr' | 'calories' | 'elevation' | 'avgSpeed' | 'notes',
  string
>

/** The form values for an activity, or for a new one. */
export function activityForm(a: Activity | null): ActivityForm {
  return {
    name: a?.name ?? '',
    date: formatDateTime(a?.date ?? new Date()),
    sport: a?.sport ?? 'running',
    kind: a?.kind ?? 'training',
    duration: String(a?.duration_seconds ?? 0),
    distance: String(a?.distance_meters ?? 0),
    avgHr: String(a?.avg_heart_rate ?? 0),
    calories: String(a?.calories ?? 0),
    elevation: String(a?.elevation_gain_meters ?? 0),
    avgSpeed: String(a?.avg_speed_ms ?? 0),
    notes: a?.notes ?? '',
  }
}

const numberOrNull = (value: string) => (value.trim() === '' || Number(value) === 0 ? null : Number(value))

/**
 * The request body for saving the form, or an error message. Friends are sent only when the
 * account has friends to pick from.
 */
export function activityPayload(
  form: ActivityForm,
  friendIds: number[] | null,
): { payload: Record<string, unknown> } | { error: string } {
  const date = parseDateInput(form.date)
  if (!date) return { error: 'Invalid date — use dd-mm-yyyy HH:MM' }
  return {
    payload: {
      name: form.name,
      sport: form.sport,
      kind: form.kind,
      date,
      duration_seconds: Number(form.duration || 0),
      distance_meters: numberOrNull(form.distance),
      avg_heart_rate: numberOrNull(form.avgHr) === null ? null : Math.round(Number(form.avgHr)),
      calories: numberOrNull(form.calories) === null ? null : Math.round(Number(form.calories)),
      elevation_gain_meters: numberOrNull(form.elevation),
      avg_speed_ms: numberOrNull(form.avgSpeed),
      notes: form.notes || null,
      ...(friendIds ? { friend_ids: friendIds } : {}),
    },
  }
}

// ── Race result ──

export type RaceFields = Record<
  'official' | 'bib' | 'ageGroup' | 'overallRank' | 'overallTotal' | 'genderRank' | 'genderTotal' | 'agRank' | 'agTotal' | 'url' | 'notes',
  string
>

export interface SplitRow {
  key: number
  label: string
  time: string
  rank: string
}

const DEFAULT_SPLITS: Record<string, string[]> = {
  triathlon: ['Swim', 'T1', 'Bike', 'T2', 'Run'],
  duathlon: ['Run 1', 'T1', 'Bike', 'T2', 'Run 2'],
}

/** The form values for a race result; a new triathlon or duathlon starts with its usual splits. */
export function raceForm(rr: RaceResult | null, sport: string): { fields: RaceFields; splits: SplitRow[] } {
  const num = (v: number | null | undefined) => (v == null ? '' : String(v))
  return {
    fields: {
      official: formatTimeInput(rr?.official_time_seconds),
      bib: rr?.bib_number ?? '',
      ageGroup: rr?.age_group ?? '',
      overallRank: num(rr?.overall_rank),
      overallTotal: num(rr?.overall_total),
      genderRank: num(rr?.gender_rank),
      genderTotal: num(rr?.gender_total),
      agRank: num(rr?.age_group_rank),
      agTotal: num(rr?.age_group_total),
      url: rr?.results_url ?? '',
      notes: rr?.notes ?? '',
    },
    splits: rr?.splits.length
      ? rr.splits.map((s, i) => ({
          key: i,
          label: s.label,
          time: formatTimeInput(s.duration_seconds),
          rank: s.rank ? String(s.rank) : '',
        }))
      : (DEFAULT_SPLITS[sport] ?? []).map((label, i) => ({ key: i, label, time: '', rank: '' })),
  }
}

/** True when a time field holds something that is not a valid time. */
export const invalidTime = (value: string | undefined) => !!value?.trim() && !isValidTime(value)

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`

/** The request body for saving a race result, or an error message. */
export function racePayload(fields: RaceFields, splits: SplitRow[]): { payload: Record<string, unknown> } | { error: string } {
  if (invalidTime(fields.official)) return { error: `Invalid official time; ${lowerFirst(TIME_RULE)}.` }
  const invalid = splits.find((r) => invalidTime(r.time))
  if (invalid) return { error: `Invalid time for ${invalid.label || 'split'}; ${lowerFirst(TIME_RULE)}.` }
  const intOrNull = (v: string | undefined) => (v && v.trim() !== '' ? Math.round(Number(v)) : null)
  return {
    payload: {
      official_time_seconds: parseTimeInput(fields.official ?? ''),
      bib_number: fields.bib || null,
      age_group: fields.ageGroup || null,
      overall_rank: intOrNull(fields.overallRank),
      overall_total: intOrNull(fields.overallTotal),
      gender_rank: intOrNull(fields.genderRank),
      gender_total: intOrNull(fields.genderTotal),
      age_group_rank: intOrNull(fields.agRank),
      age_group_total: intOrNull(fields.agTotal),
      results_url: fields.url || null,
      notes: fields.notes || null,
      splits: splits
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label,
          duration_seconds: parseTimeInput(r.time),
          rank: /^\d+$/.test(r.rank.trim()) ? Number(r.rank) : null,
        })),
    },
  }
}

/** "12/340", or just the rank without a total; null without a rank. */
export function formatRank(rank: number | null, total: number | null): string | null {
  if (!rank) return null
  return total ? `${rank}/${total}` : String(rank)
}

/** The overall, gender and age-group ranks that are set, as [label, rank, total]. */
export function rankItems(result: RaceResult | null): [string, number, number | null][] {
  const items: [string, number, number | null][] = []
  if (result?.overall_rank) items.push(['Overall', result.overall_rank, result.overall_total])
  if (result?.gender_rank) items.push(['Gender', result.gender_rank, result.gender_total])
  if (result?.age_group_rank) items.push([result.age_group || 'Age group', result.age_group_rank, result.age_group_total])
  return items
}
