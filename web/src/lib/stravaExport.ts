// Reads a Strava bulk export (export_123456.zip) in the browser and uploads each activity's
// original file (.fit, .gpx or .tcx, often gzipped) to the API, together with its name, type
// and description from activities.csv. The zip can be gigabytes because of photos, so it is
// never uploaded whole: only the activity files are read from it, one at a time.

import {
  csvInfoFor,
  fileName,
  isActivitiesCsv,
  isActivityFile,
  NO_ACTIVITY_FILES,
  readActivitiesCsv,
  runImports,
  type ImportFileResult,
  type ImportProgress,
  type ImportSummary,
  type StravaFileInfo,
} from '@kinetic/shared/stravaImport'
import { listZip, openEntry, readEntryText } from './zip'

export type { ImportProgress as StravaProgress, ImportSummary as StravaSummary }

export interface StravaActivity extends StravaFileInfo {
  name: string
  file: Blob | (() => Promise<Blob>)
}

/** The activity files of a Strava export zip, with their activities.csv details. */
export async function activitiesFromZip(zip: File): Promise<StravaActivity[]> {
  const entries = await listZip(zip)
  const csvEntry = entries.find((e) => isActivitiesCsv(e.name))
  const csv = csvEntry ? readActivitiesCsv(await readEntryText(zip, csvEntry)) : new Map()
  const files = entries.filter((e) => isActivityFile(e.name))
  if (!files.length) throw new Error(NO_ACTIVITY_FILES)
  return files.map((entry) => ({
    name: fileName(entry.name),
    file: async () => new Response(await openEntry(zip, entry)).blob(),
    ...csvInfoFor(csv, entry.name),
  }))
}

/** Loose activity files chosen directly (for instance the unzipped activities folder). */
export function activitiesFromFiles(files: File[]): StravaActivity[] {
  return files.filter((f) => isActivityFile(f.name)).map((f) => ({ name: f.name, file: f }))
}

async function send(activity: StravaActivity, signal?: AbortSignal): Promise<ImportFileResult> {
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
  return (await response.json()) as ImportFileResult
}

/** Upload the activities a couple at a time; duplicates are skipped by the server. */
export function importStravaActivities(
  activities: StravaActivity[],
  options: { onProgress: (p: ImportProgress) => void; signal?: AbortSignal },
): Promise<ImportSummary> {
  return runImports(activities, { ...options, send: (a) => send(a, options.signal) })
}
