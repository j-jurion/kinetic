// The numbers on the dashboard (home page), shared by the web and mobile apps.
import { totals } from './activityList'
import type { Totals } from './activityList'
import { parseDate } from './format'
import { weekStart } from './graphs'
import type { ActivityRow, BestEffortRow } from './types'

export interface Period {
  current: Totals
  /** The period before it, for comparison. */
  previous: Totals
}

export interface DashboardSummary {
  /** This week (Monday to now) and all of last week. */
  week: Period
  /** This year so far, and last year up to the same day. */
  year: Period
  recent: ActivityRow[]
}

function between(activities: ActivityRow[], from: Date, to: Date): Totals {
  return totals(
    activities.filter((a) => {
      const date = parseDate(a.date)
      return date !== null && date >= from && date < to
    }),
  )
}

/**
 * The first day the dashboard looks at (1 January of last year, for the year-on-year
 * comparison), as yyyy-mm-dd: it only needs the activities since then (`/activities?since=`).
 */
export function dashboardSince(today = new Date()): string {
  return `${today.getFullYear() - 1}-01-01`
}

/** Weekly and year-to-date totals, and the latest activities. Expects top-level activities, newest first. */
export function dashboardSummary(activities: ActivityRow[], today = new Date(), recentCount = 5): DashboardSummary {
  const monday = weekStart(today)
  const lastMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const year = today.getFullYear()
  const sameDayLastYear = new Date(year - 1, today.getMonth(), today.getDate() + 1)
  return {
    week: {
      current: between(activities, monday, tomorrow),
      previous: between(activities, lastMonday, monday),
    },
    year: {
      current: between(activities, new Date(year, 0, 1), tomorrow),
      previous: between(activities, new Date(year - 1, 0, 1), sameDayLastYear),
    },
    recent: activities.slice(0, recentCount),
  }
}

/** Percentage change from `previous` to `current`, or null when there is nothing to compare to. */
export function change(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

/**
 * The personal records (the fastest effort per sport and distance) that were set most recently.
 * Running and trail running share their records, like on the best efforts page.
 */
export function latestRecords(efforts: BestEffortRow[], count = 4): BestEffortRow[] {
  const best = new Map<string, BestEffortRow>()
  for (const effort of efforts) {
    const family = effort.sport === 'trail_running' ? 'running' : effort.sport
    const key = `${family}:${effort.distance_meters}`
    const current = best.get(key)
    if (!current || effort.duration_seconds < current.duration_seconds) best.set(key, effort)
  }
  return [...best.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, count)
}

/** "Good morning" and friends, by the hour of the day. */
export function greeting(today = new Date()): string {
  const hour = today.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
