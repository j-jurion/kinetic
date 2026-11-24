// Importing a Strava bulk export: the parts both apps share. Each app reads the zip its own way
// (see zip.ts) and uploads files its own way; this module knows which files to send, what
// activities.csv says about them, and runs the uploads a few at a time with progress.

import { inDateRange, type DateRange } from './format'

export interface ImportProgress {
  /** 0..1 */
  fraction: number
  message: string
}

export interface ImportSummary {
  found: number
  imported: number
  skipped: number
  errors: string[]
}

/** What activities.csv says about one activity file. */
export interface StravaFileInfo {
  title?: string
  type?: string
  description?: string
  /** Start time (epoch ms) from the "Activity Date" column, when it could be read. */
  startMs?: number
}

/** The API's answer for one uploaded file (POST /activities/import-file). */
export interface ImportFileResult {
  status: 'imported' | 'skipped'
}

export const ACTIVITY_FILE = /\.(fit|gpx|tcx)(\.gz)?$/i

/** Whether a zip entry or picked file is an activity file the API accepts. */
export function isActivityFile(path: string): boolean {
  return ACTIVITY_FILE.test(path) && !path.startsWith('__MACOSX')
}

export const isActivitiesCsv = (path: string) => /(^|\/)activities\.csv$/i.test(path)

/** Rows of a CSV file (RFC 4180: quoted fields may hold commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export type ActivitiesCsv = Map<string, StravaFileInfo>

/** activities.csv keyed by the lower-cased file path it names ("activities/123.fit.gz"). */
export function readActivitiesCsv(text: string): ActivitiesCsv {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''))
  const byFile: ActivitiesCsv = new Map()
  if (!header) return byFile
  // Some column names appear twice (the export repeats "Distance", "Elapsed Time", …)
  const column = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name)
  const file = column('filename')
  const title = column('activity name')
  const type = column('activity type')
  const description = column('activity description')
  const date = column('activity date')
  if (file < 0) return byFile
  for (const row of rows) {
    const path = row[file]?.trim()
    if (!path) continue
    byFile.set(path.toLowerCase(), {
      title: row[title]?.trim() || undefined,
      type: row[type]?.trim() || undefined,
      description: row[description]?.trim() || undefined,
      startMs: parseStravaDate(row[date]),
    })
  }
  return byFile
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * activities.csv dates, in UTC: "Mar 18, 2025, 4:53:59 PM" (English exports; also without the
 * comma before the time, or 24-hour). Parsed by hand because Hermes' Date.parse does not read
 * them. Undefined when the format is not recognised.
 */
export function parseStravaDate(text: string | undefined): number | undefined {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i.exec(text?.trim() ?? '')
  if (!m) return undefined
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return undefined
  let hour = Number(m[4])
  if (m[7]) hour = (hour % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0)
  return Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0))
}

/**
 * The activities that may fall in the range. Those without a known date are kept: the server
 * checks the date in the file itself (see dateRangeFields).
 */
export function filterByDate<T extends { startMs?: number }>(activities: T[], range: DateRange): T[] {
  return activities.filter((a) => a.startMs === undefined || inDateRange(a.startMs, range))
}

/** The form fields that make the server skip a file starting outside the range. */
export function dateRangeFields(range: DateRange): [string, string][] {
  const fields: [string, string][] = []
  if (range.sinceMs !== null) fields.push(['since', new Date(range.sinceMs).toISOString()])
  if (range.untilMs !== null) fields.push(['until', new Date(range.untilMs).toISOString()])
  return fields
}

/** The CSV details of a zip entry; the export root may sit in a folder of the zip. */
export function csvInfoFor(csv: ActivitiesCsv, entryName: string): StravaFileInfo | undefined {
  const name = entryName.toLowerCase()
  const at = name.lastIndexOf('activities/')
  return csv.get(at >= 0 ? name.slice(at) : name)
}

export const fileName = (path: string) => path.split('/').pop() ?? path

export const NO_ACTIVITY_FILES = 'No activity files found — choose the export zip Strava emailed you'

/**
 * Upload every item with `send`, `parallel` at a time; one failure does not stop the rest.
 * Duplicates are skipped by the server and counted as skipped.
 */
export async function runImports<T extends { name: string; title?: string }>(
  items: T[],
  options: {
    send: (item: T) => Promise<ImportFileResult>
    onProgress: (progress: ImportProgress) => void
    signal?: AbortSignal
    parallel?: number
  },
): Promise<ImportSummary> {
  const { send, onProgress, signal, parallel = 2 } = options
  const summary: ImportSummary = { found: items.length, imported: 0, skipped: 0, errors: [] }
  let next = 0
  let done = 0
  const report = () =>
    onProgress({
      fraction: items.length ? done / items.length : 1,
      message: `Importing activities… ${done} of ${items.length} (${summary.imported} imported, ${summary.skipped} already present)`,
    })
  const cancelled = () => {
    const error = new Error('Import cancelled')
    error.name = 'AbortError'
    return error
  }

  const worker = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw cancelled()
      const item = items[next++]
      try {
        const result = await send(item)
        if (result.status === 'imported') summary.imported++
        else summary.skipped++
      } catch (error) {
        if ((error as Error).name === 'AbortError' || signal?.aborted) throw cancelled()
        summary.errors.push(`${item.title ?? item.name}: ${(error as Error).message}`)
      }
      done++
      report()
    }
  }

  report()
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker))
  onProgress({ fraction: 1, message: 'Done' })
  return summary
}
