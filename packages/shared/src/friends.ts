// Friend helpers shared by the web and mobile apps.
import { formatDate } from './format'
import type { ActivityRow, Friend } from './types'

/** Avatar colours; the web app draws each as a gradient ending in this colour. */
export const AVATAR_COLORS = ['#ea580c', '#2563eb', '#059669', '#7c3aed', '#db2777', '#0f766e']

/** A stable index into AVATAR_COLORS per name, so each friend keeps the same avatar. */
export function avatarIndex(name: string): number {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash) % AVATAR_COLORS.length
}

export const avatarColor = (name: string) => AVATAR_COLORS[avatarIndex(name)]

export const initial = (name: string) => name.trim()[0]?.toUpperCase() ?? '?'

/** "@joeri" for a friend on Kinetic, "No account" otherwise. */
export function accountLabel(friend: Pick<Friend, 'username'>): string {
  return friend.username ? `@${friend.username}` : 'No account'
}

/** "3 activities together · last 22-11-2026" from the counts in the friends list. */
export function togetherLabel(friend: Pick<Friend, 'activity_count' | 'last_activity_date'>): string {
  const count = friend.activity_count ?? 0
  if (!count) return 'No activities together yet'
  return `${count} ${count === 1 ? 'activity' : 'activities'} together · last ${formatDate(friend.last_activity_date)}`
}

/** How many of the activities are of each sport, most first. */
export function sportCounts(activities: ActivityRow[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const a of activities) counts.set(a.sport, (counts.get(a.sport) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}
