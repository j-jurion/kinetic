// Links from chart points: clicking a point opens its activity, or the activities of its day
// or week. A trace keeps one link per point in Plotly's free-form `meta` field (a grid of links
// for a heatmap), so the chart specs stay plain data the web and mobile apps can both draw.
// No Plotly import, so the shared tests can type-check it.

import { periodActivitiesUrl } from './activityList'

/** One link per point (null: the point opens nothing); rows of them for a heatmap. */
export type PointLinks = (string | null)[] | (string | null)[][]

interface LinkMeta {
  links: PointLinks
}

/** The trace with a link per point. */
export function withLinks<T extends object>(trace: T, links: PointLinks): T & { meta: LinkMeta } {
  return { ...trace, meta: { links } }
}

export const activityUrl = (id: number) => `/activity/${id}`

/** The activities list for one day. */
export const dayUrl = (day: Date) => periodActivitiesUrl(day, day)

/** The activities list for the week that starts on `start`. */
export function weekUrl(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return periodActivitiesUrl(start, end)
}

/** The point Plotly reports on a click or hover, as far as links need it. */
export interface ClickedPoint {
  data?: { meta?: unknown }
  pointIndex?: number | number[]
  pointNumber?: number | number[]
}

/** Where a clicked point links to, or null. */
export function pointLink(point: ClickedPoint | undefined): string | null {
  const meta = point?.data?.meta as Partial<LinkMeta> | undefined
  if (!meta || !Array.isArray(meta.links)) return null
  const index = point?.pointIndex ?? point?.pointNumber
  if (index === undefined) return null
  // A heatmap reports [row, column]
  const link = Array.isArray(index)
    ? (meta.links as (string | null)[][])[index[0]]?.[index[1]]
    : (meta.links as (string | null)[])[index]
  return typeof link === 'string' ? link : null
}
