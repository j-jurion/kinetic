// Reads a Strava bulk export zip on the phone and uploads each activity's original file
// (.fit, .gpx or .tcx, often gzipped) with its name, type and description from
// activities.csv. The zip can be gigabytes because of photos, so it is never loaded whole:
// expo-file-system reads just the byte ranges of the zip directory and of each activity file
// as it is uploaded, and fflate inflates them (Hermes has no DecompressionStream).

import { File, FileMode, Paths } from 'expo-file-system'
import { inflateSync, strFromU8 } from 'fflate'
import { entryDataRange, listZip, type ReadRange, type ZipEntry } from '@kinetic/shared/zip'
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
import { api } from './api'

export interface StravaActivity extends StravaFileInfo {
  name: string
  /** A file on the device to upload as is, or bytes read from the zip on demand. */
  source: { uri: string } | { bytes: () => Promise<Uint8Array> }
}

/** A picked file (its name and local uri). */
export interface PickedFile {
  name: string
  uri: string
}

/** An open Strava export zip; call close() once the import is done. */
export interface StravaZip {
  activities: StravaActivity[]
  close: () => void
}

/** Open a Strava export zip and list its activity files with their activities.csv details. */
export async function openStravaZip(uri: string): Promise<StravaZip> {
  const handle = new File(uri).open(FileMode.ReadOnly)
  const close = () => {
    try {
      handle.close()
    } catch {
      // already closed
    }
  }
  try {
    // Synchronous reads, so setting the offset and reading cannot interleave between uploads
    const read: ReadRange = async (start, end) => {
      handle.offset = start
      return handle.readBytesSync(end - start)
    }
    const entryBytes = async (entry: ZipEntry) => {
      const [start, end] = await entryDataRange(read, entry)
      const raw = await read(start, end)
      return entry.method === 0 ? raw : inflateSync(raw)
    }

    const entries = await listZip(read, handle.size ?? 0, (bytes) => strFromU8(bytes))
    const csvEntry = entries.find((e) => isActivitiesCsv(e.name))
    const csv = csvEntry ? readActivitiesCsv(strFromU8(await entryBytes(csvEntry))) : new Map()
    const files = entries.filter((e) => isActivityFile(e.name))
    if (!files.length) throw new Error(NO_ACTIVITY_FILES)
    const activities = files.map((entry) => ({
      name: fileName(entry.name),
      source: { bytes: () => entryBytes(entry) },
      ...csvInfoFor(csv, entry.name),
    }))
    return { activities, close }
  } catch (error) {
    close()
    throw error
  }
}

export function activitiesFromFiles(files: PickedFile[]): StravaActivity[] {
  return files.filter((f) => isActivityFile(f.name)).map((f) => ({ name: f.name, source: { uri: f.uri } }))
}

let counter = 0

async function send(activity: StravaActivity): Promise<ImportFileResult> {
  let temp: File | null = null
  let uri: string
  if ('uri' in activity.source) uri = activity.source.uri
  else {
    // React Native's FormData uploads files by uri, so zip entries go through the cache
    const bytes = await activity.source.bytes()
    temp = new File(Paths.cache, `strava-${Date.now()}-${counter++}-${activity.name}`)
    temp.create({ overwrite: true })
    await temp.write(bytes)
    uri = temp.uri
  }
  try {
    const form = new FormData()
    // React Native's FormData takes a file as { uri, name, type }
    form.append('file', { uri, name: activity.name, type: 'application/octet-stream' } as unknown as Blob)
    if (activity.title) form.append('name', activity.title)
    if (activity.type) form.append('activity_type', activity.type)
    if (activity.description) form.append('description', activity.description)
    return await api.upload<ImportFileResult>('/activities/import-file', form)
  } finally {
    try {
      temp?.delete()
    } catch {
      // the system clears the cache anyway
    }
  }
}

/** Upload the activities a couple at a time; duplicates are skipped by the server. */
export function importStravaActivities(
  activities: StravaActivity[],
  options: { onProgress: (p: ImportProgress) => void; signal?: AbortSignal },
): Promise<ImportSummary> {
  return runImports(activities, { ...options, send })
}
