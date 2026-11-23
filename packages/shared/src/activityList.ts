// Totals and month groups for the activity list, shared by the web and mobile apps.
import type { ActivityRow } from './types'

export interface Totals {
  count: number
  meters: number
  seconds: number
  climb: number
}

/** Totals over the activities, counting a multisport leg only when its event is not listed too. */
export function totals(activities: ActivityRow[]): Totals {
  const ids = new Set(activities.map((a) => a.id))
  const t: Totals = { count: 0, meters: 0, seconds: 0, climb: 0 }
  for (const a of activities) {
    if (a.parent_id !== null && ids.has(a.parent_id)) continue
    t.count += 1
    t.meters += a.distance_meters ?? 0
    t.seconds += a.duration_seconds ?? 0
    t.climb += a.elevation_gain_meters ?? 0
  }
  return t
}

export const km = (meters: number) => `${Math.round(meters / 1000).toLocaleString('en')} km`
export const hours = (seconds: number) => `${Math.round(seconds / 3600).toLocaleString('en')} h`

/** "March 2026" for a "2026-03" month key. */
export function monthTitle(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })
}

/** Activities grouped per calendar month, in the order they arrive (newest first). */
export function byMonth(activities: ActivityRow[]): [string, ActivityRow[]][] {
  const groups = new Map<string, ActivityRow[]>()
  for (const a of activities) {
    const key = a.date.slice(0, 7)
    const group = groups.get(key)
    if (group) group.push(a)
    else groups.set(key, [a])
  }
  return [...groups.entries()]
}

/** "12 activities · 340 km · 28 h" under a month heading. */
export function monthSummary(group: ActivityRow[]): string {
  const t = totals(group)
  return `${t.count} ${t.count === 1 ? 'activity' : 'activities'} · ${km(t.meters)} · ${hours(t.seconds)}`
}
