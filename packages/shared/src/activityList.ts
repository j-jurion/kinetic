// Totals and month groups for the activity list, shared by the web and mobile apps.
import { qs } from './api'
import { formatDate } from './format'
import { dayKey } from './training'
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

// ── Paged lists ──────────────────────────────────────────────────────────────

/** Activities per page of a paged list. */
export const ACTIVITY_PAGE_SIZE = 50

export interface ActivityFilters {
  sport?: string | null
  year?: number | null
  friend?: number | null
  /** First and last day listed ("YYYY-MM-DD", both included), e.g. a week clicked on a chart. */
  since?: string | null
  until?: string | null
}

function filterParams(f: ActivityFilters) {
  return { sport: f.sport || null, year: f.year, friend: f.friend, since: f.since || null, until: f.until || null }
}

/** The API path of one page of activities, newest first; `before` continues after a page. */
export function activityPagePath(filters: ActivityFilters, before: string | null = null, limit = ACTIVITY_PAGE_SIZE): string {
  return `/activities${qs({ ...filterParams(filters), limit, before })}`
}

/** The API path of the totals of every activity the filters list (`GET` returns `Totals`). */
export function activityTotalsPath(filters: ActivityFilters): string {
  return `/activities/totals${qs(filterParams(filters))}`
}

/** Where the next page starts ("<date>,<id>" of the last row), or null after the last page. */
export function nextPageCursor(page: ActivityRow[], limit = ACTIVITY_PAGE_SIZE): string | null {
  const last = page[page.length - 1]
  return page.length >= limit && last ? `${last.date},${last.id}` : null
}

/** The rows so far with a new page added, skipping any already listed. */
export function appendPage(rows: ActivityRow[], page: ActivityRow[]): ActivityRow[] {
  const seen = new Set(rows.map((r) => r.id))
  return [...rows, ...page.filter((r) => !seen.has(r.id))]
}

// ── Periods (a week or day clicked on a chart) ───────────────────────────────

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** A "YYYY-MM-DD" from a URL, or null when it is not one. */
export function parseDayKey(text: string | null | undefined): string | null {
  return text && DAY_KEY.test(text) && !Number.isNaN(Date.parse(text)) ? text : null
}

/** The web path of the activities list for the days from `first` to `last` (both included). */
export function periodActivitiesUrl(first: Date, last: Date, sport?: string | null): string {
  return `/activities${qs({ from: dayKey(first), to: dayKey(last), sport: sport || null })}`
}

/** "03-11-2026 – 09-11-2026", or one date for a single day. */
export function periodLabel(since: string | null, until: string | null): string {
  const show = (key: string) => formatDate(new Date(`${key}T12:00:00`))
  if (since && until) return since === until ? show(since) : `${show(since)} – ${show(until)}`
  if (since) return `From ${show(since)}`
  return until ? `Until ${show(until)}` : ''
}
