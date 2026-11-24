// Reads a Strava bulk export (export_123456.zip) in the browser and uploads each activity's
// original file (.fit, .gpx or .tcx, often gzipped) to the API, together with its name, type
// and description from activities.csv. The zip can be gigabytes because of photos, so it is
// never uploaded whole: only the activity files are read from it, one at a time.

import { listZip, openEntry, readEntryText, type ZipEntry } from './zip'

export interface StravaProgress {
  /** 0..1 */
  fraction: number
  message: string
}

export interface StravaSummary {
  found: number
  imported: number
  skipped: number
  errors: string[]
}

export interface StravaActivity {
  name: string
  file: Blob | (() => Promise<Blob>)
  title?: string
  type?: string
  description?: string
}

const ACTIVITY_FILE = /\.(fit|gpx|tcx)(\.gz)?$/i
const PARALLEL = 2

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

interface CsvInfo {
  title?: string
  type?: string
  description?: string
}

/** activities.csv keyed by the file path it names ("activities/123.fit.gz"). */
function readActivitiesCsv(text: string): Map<string, CsvInfo> {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  const byFile = new Map<string, CsvInfo>()
  if (!header) return byFile
  // Some column names appear twice (the export repeats "Distance", "Elapsed Time", …)
  const column = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name)
  const file = column('filename')
  const title = column('activity name')
  const type = column('activity type')
  const description = column('activity description')
  if (file < 0) return byFile
  for (const row of rows) {
    const path = row[file]?.trim()
    if (!path) continue
    byFile.set(path.toLowerCase(), {
      title: row[title]?.trim() || undefined,
      type: row[type]?.trim() || undefined,
      description: row[description]?.trim() || undefined,
    })
  }
  return byFile
}

/** The activity files of a Strava export zip, with their activities.csv details. */
export async function activitiesFromZip(zip: File): Promise<StravaActivity[]> {
  const entries = await listZip(zip)
  const csvEntry = entries.find((e) => /(^|\/)activities\.csv$/i.test(e.name))
  const csv = csvEntry ? readActivitiesCsv(await readEntryText(zip, csvEntry)) : new Map<string, CsvInfo>()
  const files = entries.filter((e) => ACTIVITY_FILE.test(e.name) && !e.name.startsWith('__MACOSX'))
  if (!files.length) {
    throw new Error('No activity files found — choose the export zip Strava emailed you')
  }
  // The CSV names files relative to the export root, which may sit in a folder of the zip
  const lookup = (entry: ZipEntry) => {
    const name = entry.name.toLowerCase()
    const at = name.lastIndexOf('activities/')
    return csv.get(at >= 0 ? name.slice(at) : name)
  }
  return files.map((entry) => {
    const info = lookup(entry)
    return {
      name: entry.name.split('/').pop() ?? entry.name,
      file: async () => new Response(await openEntry(zip, entry)).blob(),
      ...info,
    }
  })
}

/** Loose activity files chosen directly (for instance the unzipped activities folder). */
export function activitiesFromFiles(files: File[]): StravaActivity[] {
  return files
    .filter((f) => ACTIVITY_FILE.test(f.name))
    .map((f) => ({ name: f.name, file: f }))
}

interface ImportResult {
  status: 'imported' | 'skipped'
}

/** Upload the activities a few at a time; duplicates are skipped by the server. */
export async function importStravaActivities(
  activities: StravaActivity[],
  options: { onProgress: (p: StravaProgress) => void; signal?: AbortSignal },
): Promise<StravaSummary> {
  const { onProgress, signal } = options
  const summary: StravaSummary = { found: activities.length, imported: 0, skipped: 0, errors: [] }
  let next = 0
  let done = 0

  const report = () =>
    onProgress({
      fraction: activities.length ? done / activities.length : 1,
      message: `Importing activities… ${done} of ${activities.length} (${summary.imported} imported, ${summary.skipped} already present)`,
    })

  const send = async (activity: StravaActivity) => {
    const blob = typeof activity.file === 'function' ? await activity.file() : activity.file
    const form = new FormData()
    form.append('file', blob, activity.name)
    if (activity.title) form.append('name', activity.title)
    if (activity.type) form.append('activity_type', activity.type)
    if (activity.description) form.append('description', activity.description)
    const response = await fetch('/api/activities/import-file', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
      signal,
    })
    if (response.status === 401) {
      window.location.assign('/login')
      throw new DOMException('Signed out', 'AbortError')
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(typeof data.detail === 'string' ? data.detail : `Upload failed (${response.status})`)
    }
    return (await response.json()) as ImportResult
  }

  const worker = async () => {
    while (next < activities.length) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
      const activity = activities[next++]
      try {
        const result = await send(activity)
        if (result.status === 'imported') summary.imported++
        else summary.skipped++
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error
        summary.errors.push(`${activity.title ?? activity.name}: ${(error as Error).message}`)
      }
      done++
      report()
    }
  }

  report()
  await Promise.all(Array.from({ length: Math.min(PARALLEL, activities.length) }, worker))
  onProgress({ fraction: 1, message: 'Done' })
  return summary
}
