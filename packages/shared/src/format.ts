// Sport metadata and value formatting. Mirrors app/formatting.py on the backend.

export const SPORTS = [
  'running',
  'trail_running',
  'cycling',
  'swimming',
  'hiking',
  'walking',
  'triathlon',
  'duathlon',
  'multisport',
  'strength',
  'yoga',
  'other',
]

export const KINDS = [
  'race',
  'training',
  'easy',
  'social',
  'long_run',
  'tempo',
  'interval',
  'recovery',
  'other',
]

export const SPORT_COLORS: Record<string, string> = {
  running: '#ff2d55',
  trail_running: '#ff7a00',
  cycling: '#00c853',
  swimming: '#00a3ff',
  hiking: '#ffb300',
  walking: '#aeea00',
  triathlon: '#7c4dff',
  duathlon: '#ff4dd8',
  multisport: '#00bfa5',
  strength: '#ff2d8a',
  yoga: '#00e5ff',
  other: '#90a4ae',
}

// Filter groups: a single option that selects several sports at once
export const ALL_RUNNING = 'all_running'
export const SPORT_GROUPS: Record<string, string[]> = { [ALL_RUNNING]: ['running', 'trail_running'] }
const SPORT_GROUP_LABELS: Record<string, string> = { [ALL_RUNNING]: 'All running' }
// Sports that act as an umbrella over more specific ones when used as a filter
const SPORT_COVERS: Record<string, string[]> = { multisport: ['multisport', 'triathlon', 'duathlon'] }

export const DISTANCE_LABELS: Record<string, string> = {
  '100': '100 m',
  '200': '200 m',
  '400': '400 m',
  '800': '800 m',
  '1000': '1 km',
  '1500': '1500 m',
  '1609.34': '1 mile',
  '3000': '3 km',
  '5000': '5 km',
  '10000': '10 km',
  '15000': '15 km',
  '20000': '20 km',
  '21097.5': 'Half marathon',
  '30000': '30 km',
  '40000': '40 km',
  '42195': 'Marathon',
  '100000': '100 km',
}

export const GOLD = '#d4af37'
export const SILVER = '#a8a9ad'
export const BRONZE = '#cd7f32'
export const MEDAL_COLORS: Record<number, string> = { 1: GOLD, 2: SILVER, 3: BRONZE }
export const MEDAL_LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' }

export function sportLabel(sport: string): string {
  if (SPORT_GROUP_LABELS[sport]) return SPORT_GROUP_LABELS[sport]
  const text = sport.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

/** "long_run" → "Long Run" (Python's str.title()). */
export function kindLabel(kind: string): string {
  return kind
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

/** Options for a sport filter, as [value, label] pairs. */
export function sportFilterOptions(includeAllSports = true): [string, string][] {
  const options: [string, string][] = []
  if (includeAllSports) options.push(['', 'All sports'])
  for (const group of Object.keys(SPORT_GROUPS)) options.push([group, SPORT_GROUP_LABELS[group]])
  for (const sport of SPORTS) options.push([sport, sportLabel(sport)])
  return options
}

export function resolveSports(value: string | null | undefined): string[] | null {
  if (!value) return null
  if (SPORT_GROUPS[value]) return [...SPORT_GROUPS[value]]
  return [...(SPORT_COVERS[value] ?? [value])]
}

export function sportColor(sport: string | null | undefined, fallback = '#f97316'): string {
  if (!sport) return fallback
  if (SPORT_GROUPS[sport]) return SPORT_COLORS[SPORT_GROUPS[sport][0]] ?? fallback
  return SPORT_COLORS[sport] ?? fallback
}

// Sports on foot: the watch's average cadence counts one foot
const STEP_SPORTS = new Set(['running', 'trail_running', 'walking', 'hiking'])

/** Average cadence as shown: steps per minute on foot (twice the stored value), rpm otherwise. */
export function stepsPerMinute(cadence: number, sport: string): number {
  return STEP_SPORTS.has(sport) ? cadence * 2 : cadence
}

export const cadenceUnit = (sport: string) => (STEP_SPORTS.has(sport) ? 'spm' : 'rpm')

export function isSwimming(sport: string | null | undefined): boolean {
  const sports = resolveSports(sport)
  return !!sports && sports.length > 0 && sports.every((s) => s === 'swimming')
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Parse an ISO date-time from the API as local wall-clock time. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
}

/** dd-mm-yyyy */
export function formatDate(value: string | Date | null | undefined): string {
  const d = typeof value === 'string' || value == null ? parseDate(value as string) : value
  return d ? `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}` : ''
}

/** dd-mm-yyyy HH:MM */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = typeof value === 'string' || value == null ? parseDate(value as string) : value
  return d ? `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''
}

/** Parse a user-entered dd-mm-yyyy[ HH:MM] value (ISO is accepted too) into a local ISO string. */
export function parseDateInput(value: string): string | null {
  const text = value.trim()
  let m = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text)
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0))
    if (d.getDate() !== +m[1] || d.getMonth() !== +m[2] - 1) return null
    return toIsoLocal(d)
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text)
  if (m) return toIsoLocal(new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)))
  return null
}

export function toIsoLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`
  return `${m}:${pad(s)}`
}

/** Swimming distances are shown in metres, every other sport in kilometres. */
export function formatDistance(meters: number, sport?: string | null): string {
  if (isSwimming(sport)) return `${meters.toFixed(0)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

export function distanceLabel(distance: number, sport?: string | null): string {
  if (isSwimming(sport)) return `${distance.toFixed(0)} m`
  return DISTANCE_LABELS[String(distance)] ?? `${(distance / 1000).toFixed(1)} km`
}

/** Pace per 100 m for swimming, per kilometre for every other sport. */
export function formatPace(distanceM: number, durationS: number, sport?: string | null): string {
  if (distanceM <= 0) return '-'
  const reference = isSwimming(sport) ? 100 : 1000
  const pace = durationS / (distanceM / reference)
  const m = Math.floor(pace / 60)
  const s = Math.floor(pace % 60)
  return `${m}:${pad(s)} /${reference === 100 ? '100m' : 'km'}`
}

export function ordinal(n: number): string {
  let suffix = 'th'
  if (![11, 12, 13].includes(n % 100)) {
    if (n % 10 === 1) suffix = 'st'
    else if (n % 10 === 2) suffix = 'nd'
    else if (n % 10 === 3) suffix = 'rd'
  }
  return `${n}${suffix}`
}

/** Flag the first entry of each year in a list that is already ranked best-first. */
export function markYearBests(years: number[]): boolean[] {
  const seen = new Set<number>()
  return years.map((year) => {
    const first = !seen.has(year)
    seen.add(year)
    return first
  })
}

export function yearOptions(): number[] {
  const years: number[] = []
  for (let y = new Date().getFullYear(); y >= 2010; y--) years.push(y)
  return years
}

/** Carry the shared sport/year filter over to another page. */
export function filteredUrl(path: string, sport?: string | null, year?: number | null): string {
  const params = new URLSearchParams()
  if (sport) params.set('sport', sport)
  if (year) params.set('year', String(year))
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** A stored best-effort distance as it appears in a URL, e.g. 21097.5 or 5000. */
export function distanceSlug(distance: number): string {
  return distance.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/** An optional range of days, as epoch ms: from the start of `since` to the end of `until`. */
export interface DateRange {
  sinceMs: number | null
  /** Exclusive: midnight after the last day. */
  untilMs: number | null
}

/**
 * The range of two optional dd-mm-yyyy fields (local days, both inclusive). Throws an Error
 * with a message for the user when a date is invalid or the end comes before the start.
 */
export function parseDateRange(since: string, until: string): DateRange {
  const day = (text: string) => {
    if (!text.trim()) return null
    const iso = parseDateInput(text)
    if (!iso) throw new Error('Invalid date — use dd-mm-yyyy')
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const from = day(since)
  const to = day(until)
  if (from && to && to < from) throw new Error('The end date is before the start date')
  return {
    sinceMs: from ? from.getTime() : null,
    untilMs: to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime() : null,
  }
}

/** Whether a moment falls in the range; no range bounds means everything matches. */
export function inDateRange(ms: number, range: DateRange): boolean {
  return (range.sinceMs === null || ms >= range.sinceMs) && (range.untilMs === null || ms < range.untilMs)
}
