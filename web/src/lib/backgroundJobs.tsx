// Syncs and uploads that keep running while you move between pages. The work lives here, above
// the routes, instead of in the page that started it; the pages and the header status only read it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { importAppleHealthExport } from './appleHealthExport'
import type { ImportProgress, ImportSummary } from './appleHealthExport'
import { activitiesFromFiles, activitiesFromZip, importStravaActivities } from './stravaExport'
import type { StravaProgress, StravaSummary } from './stravaExport'
import { useNotify } from '../components/Notify'

export interface SyncResult {
  imported: number
  skipped: number
  errors: string[]
}

export interface GarminRequest {
  since: string
  until: string | null
  email: string
  password: string
}

export interface GarminJob {
  /** Set when a sync starts, to tell runs apart. */
  id: number
  running: boolean
  /** The latest progress lines, oldest first. */
  log: string[]
  /** Activities handled so far and in total, from the "(3/12) Morning Run" lines. */
  done: number
  total: number
  result: SyncResult | null
  error: string | null
}

export interface AppleJob {
  id: number
  running: boolean
  fileName: string
  progress: ImportProgress | null
  summary: ImportSummary | null
  error: string | null
}

/** What to import from Strava: the export zip, or loose activity files. */
export type StravaSource = { kind: 'zip'; file: File } | { kind: 'files'; files: File[] }

export interface StravaJob {
  id: number
  running: boolean
  /** What is being imported, e.g. "export_123.zip" or "12 activity files". */
  label: string
  progress: StravaProgress | null
  summary: StravaSummary | null
  error: string | null
}

export interface UploadItem {
  key: number
  name: string
  status: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
}

interface Jobs {
  garmin: GarminJob
  apple: AppleJob
  uploads: UploadItem[]
  /** Goes up whenever a job imported activities, so lists can reload. */
  dataVersion: number
  startGarminSync: (request: GarminRequest) => void
  startAppleImport: (file: File, sinceMs: number | null) => void
  cancelAppleImport: () => void
  strava: StravaJob
  startStravaImport: (source: StravaSource) => void
  cancelStravaImport: () => void
  uploadFiles: (files: File[]) => void
  /** Drops the finished uploads from the list. */
  clearUploads: () => void
}

const IDLE_GARMIN: GarminJob = { id: 0, running: false, log: [], done: 0, total: 0, result: null, error: null }
const IDLE_APPLE: AppleJob = { id: 0, running: false, fileName: '', progress: null, summary: null, error: null }
const IDLE_STRAVA: StravaJob = { id: 0, running: false, label: '', progress: null, summary: null, error: null }
// Results of a sync or import stay on screen until closed, so they can't be missed
const STAY = null
const MAX_LOG_LINES = 50
// .fit files are parsed on the server; a few at a time keeps a big batch from flooding it
const UPLOAD_CONCURRENCY = 3

const JobsContext = createContext<Jobs | null>(null)

export function useBackgroundJobs(): Jobs {
  const jobs = useContext(JobsContext)
  if (!jobs) throw new Error('useBackgroundJobs needs a BackgroundJobsProvider')
  return jobs
}

/** Reads a newline-delimited JSON response, calling `onMessage` for each line. */
async function readJsonLines(response: Response, onMessage: (message: Record<string, unknown>) => void) {
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Request failed')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onMessage(JSON.parse(line))
  }
}

export function BackgroundJobsProvider({ children }: { children: ReactNode }) {
  const notify = useNotify()
  const [garmin, setGarmin] = useState<GarminJob>(IDLE_GARMIN)
  const [apple, setApple] = useState<AppleJob>(IDLE_APPLE)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [dataVersion, setDataVersion] = useState(0)
  const appleAbort = useRef<AbortController | null>(null)
  const [strava, setStrava] = useState<StravaJob>(IDLE_STRAVA)
  const stravaAbort = useRef<AbortController | null>(null)
  const garminRunning = useRef(false)
  const queue = useRef<{ key: number; file: File }[]>([])
  const active = useRef(0)
  const batch = useRef({ done: 0, failed: 0 })

  const imported = useCallback((count: number) => {
    if (count > 0) setDataVersion((v) => v + 1)
  }, [])

  const startGarminSync = useCallback(
    (request: GarminRequest) => {
      if (garminRunning.current) {
        notify('Sync already in progress', 'warning')
        return
      }
      garminRunning.current = true
      setGarmin({ ...IDLE_GARMIN, id: Date.now(), running: true })
      const run = async () => {
        let result: SyncResult | null = null
        try {
          const response = await fetch('/api/garmin/sync', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          })
          await readJsonLines(response, (message) => {
            if (message.type === 'progress') {
              const line = String(message.message)
              const counter = /^\((\d+)\/(\d+)\)/.exec(line)
              setGarmin((job) => ({
                ...job,
                log: [...job.log, line].slice(-MAX_LOG_LINES),
                ...(counter ? { done: Number(counter[1]), total: Number(counter[2]) } : {}),
              }))
            } else if (message.type === 'result') {
              result = message as unknown as SyncResult
              setGarmin((job) => ({ ...job, result }))
            } else if (message.type === 'error') {
              const error = String(message.message)
              setGarmin((job) => ({ ...job, error }))
              notify(error, 'error', STAY)
            }
          })
          if (result) {
            const r: SyncResult = result
            notify(
              `Garmin sync complete: ${r.imported} imported${r.errors.length ? `, ${r.errors.length} failed` : ''}`,
              r.errors.length ? 'warning' : 'success',
              STAY,
            )
            imported(r.imported)
          }
        } catch (error) {
          const message = (error as Error).message
          setGarmin((job) => ({ ...job, error: message }))
          notify(message, 'error', STAY)
        } finally {
          garminRunning.current = false
          setGarmin((job) => ({ ...job, running: false }))
        }
      }
      void run()
    },
    [notify, imported],
  )

  const startAppleImport = useCallback(
    (file: File, sinceMs: number | null) => {
      if (appleAbort.current) {
        notify('An import is already running', 'warning')
        return
      }
      const controller = new AbortController()
      appleAbort.current = controller
      setApple({
        ...IDLE_APPLE,
        id: Date.now(),
        running: true,
        fileName: file.name,
        progress: { phase: 'reading', fraction: 0, message: 'Opening export…' },
      })
      const run = async () => {
        try {
          const summary = await importAppleHealthExport(file, {
            sinceMs,
            signal: controller.signal,
            onProgress: (progress) => setApple((job) => ({ ...job, progress })),
          })
          setApple((job) => ({ ...job, summary }))
          notify(
            `Apple Health import complete: ${summary.imported} imported${summary.errors.length ? `, ${summary.errors.length} failed` : ''}`,
            summary.errors.length ? 'warning' : 'success',
            STAY,
          )
          imported(summary.imported)
        } catch (error) {
          const cancelled = (error as Error).name === 'AbortError'
          const message = cancelled ? 'Import cancelled' : (error as Error).message
          setApple((job) => ({ ...job, error: cancelled ? null : message }))
          notify(message, cancelled ? 'info' : 'error', cancelled ? 5000 : STAY)
        } finally {
          appleAbort.current = null
          setApple((job) => ({ ...job, running: false, progress: null }))
        }
      }
      void run()
    },
    [notify, imported],
  )

  const cancelAppleImport = useCallback(() => appleAbort.current?.abort(), [])

  const startStravaImport = useCallback(
    (source: StravaSource) => {
      if (stravaAbort.current) {
        notify('A Strava import is already running', 'warning')
        return
      }
      const controller = new AbortController()
      stravaAbort.current = controller
      const count = source.kind === 'files' ? source.files.length : 0
      setStrava({
        ...IDLE_STRAVA,
        id: Date.now(),
        running: true,
        label: source.kind === 'zip' ? source.file.name : `${count} activity file${count === 1 ? '' : 's'}`,
        progress: { fraction: 0, message: 'Reading export…' },
      })
      const run = async () => {
        try {
          const activities =
            source.kind === 'zip' ? await activitiesFromZip(source.file) : activitiesFromFiles(source.files)
          if (!activities.length) throw new Error('No .fit, .gpx or .tcx files chosen')
          const summary = await importStravaActivities(activities, {
            signal: controller.signal,
            onProgress: (progress) => setStrava((job) => ({ ...job, progress })),
          })
          setStrava((job) => ({ ...job, summary }))
          notify(
            `Strava import complete: ${summary.imported} imported${summary.errors.length ? `, ${summary.errors.length} failed` : ''}`,
            summary.errors.length ? 'warning' : 'success',
            STAY,
          )
          imported(summary.imported)
        } catch (error) {
          const cancelled = (error as Error).name === 'AbortError'
          const message = cancelled ? 'Import cancelled' : (error as Error).message
          setStrava((job) => ({ ...job, error: cancelled ? null : message }))
          notify(message, cancelled ? 'info' : 'error', cancelled ? 5000 : STAY)
        } finally {
          stravaAbort.current = null
          setStrava((job) => ({ ...job, running: false, progress: null }))
        }
      }
      void run()
    },
    [notify, imported],
  )

  const cancelStravaImport = useCallback(() => stravaAbort.current?.abort(), [])

  const setUpload = useCallback((key: number, change: Partial<UploadItem>) => {
    setUploads((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item)))
  }, [])

  // Starts queued uploads while there is room; reports once the whole batch is through
  const pump = useCallback(() => {
    while (active.current < UPLOAD_CONCURRENCY && queue.current.length) {
      const { key, file } = queue.current.shift()!
      active.current += 1
      setUpload(key, { status: 'uploading' })
      const form = new FormData()
      form.append('file', file)
      api
        .upload('/activities/upload-fit', form)
        .then(() => {
          batch.current.done += 1
          setUpload(key, { status: 'done' })
        })
        .catch((error: Error) => {
          batch.current.failed += 1
          setUpload(key, { status: 'error', error: error.message })
        })
        .finally(() => {
          active.current -= 1
          if (active.current === 0 && queue.current.length === 0) {
            const { done, failed } = batch.current
            batch.current = { done: 0, failed: 0 }
            notify(
              `Upload complete: ${done} ${done === 1 ? 'activity' : 'activities'} imported${failed ? `, ${failed} failed` : ''}`,
              failed ? 'warning' : 'success',
              STAY,
            )
            imported(done)
          } else {
            pump()
          }
        })
    }
  }, [notify, imported, setUpload])

  const uploadFiles = useCallback(
    (files: File[]) => {
      const added = files.map((file) => ({ key: Math.random(), file }))
      queue.current.push(...added)
      setUploads((items) => [...items, ...added.map(({ key, file }) => ({ key, name: file.name, status: 'queued' as const }))])
      pump()
    },
    [pump],
  )

  const clearUploads = useCallback(() => {
    setUploads((items) => items.filter((item) => item.status === 'queued' || item.status === 'uploading'))
  }, [])

  // Reloading or closing the tab would stop the work, so ask first
  const busy = garmin.running || apple.running || strava.running || uploads.some((u) => u.status === 'queued' || u.status === 'uploading')
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const value = useMemo<Jobs>(
    () => ({
      garmin,
      apple,
      uploads,
      dataVersion,
      startGarminSync,
      startAppleImport,
      cancelAppleImport,
      strava,
      startStravaImport,
      cancelStravaImport,
      uploadFiles,
      clearUploads,
    }),
    [
      garmin,
      apple,
      strava,
      uploads,
      dataVersion,
      startGarminSync,
      startAppleImport,
      cancelAppleImport,
      startStravaImport,
      cancelStravaImport,
      uploadFiles,
      clearUploads,
    ],
  )
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export interface JobStatus {
  /** Changes with each run, so a dismissed status comes back for the next one. */
  key: string
  state: 'running' | 'done' | 'error'
  /** Short text for the header, e.g. "Garmin 3/12". */
  label: string
  /** Longer text for the tooltip. */
  detail: string
  /** 0..1 when known. */
  fraction: number | null
  /** The page that shows this job. */
  href: string
}

/** One line per job that is running or has just finished, for the header status. */
export function jobStatuses({
  garmin,
  apple,
  strava,
  uploads,
}: Pick<Jobs, 'garmin' | 'apple' | 'strava' | 'uploads'>): JobStatus[] {
  const statuses: JobStatus[] = []
  if (garmin.running) {
    statuses.push({
      key: `garmin-${garmin.id}`,
      href: '/sync?source=garmin',
      state: 'running',
      label: garmin.total ? `Garmin ${garmin.done}/${garmin.total}` : 'Garmin sync',
      detail: garmin.log[garmin.log.length - 1] ?? 'Starting Garmin sync…',
      fraction: garmin.total ? garmin.done / garmin.total : null,
    })
  } else if (garmin.error) {
    statuses.push({ key: `garmin-${garmin.id}`,
      href: '/sync?source=garmin', state: 'error', label: 'Garmin sync failed', detail: garmin.error, fraction: null })
  } else if (garmin.result) {
    const { imported, skipped, errors } = garmin.result
    statuses.push({
      key: `garmin-${garmin.id}`,
      href: '/sync?source=garmin',
      state: errors.length ? 'error' : 'done',
      label: `Garmin: ${imported} new`,
      detail: `Garmin sync complete: ${imported} imported, ${skipped} skipped${errors.length ? `, ${errors.length} failed` : ''}`,
      fraction: 1,
    })
  }

  if (apple.running) {
    statuses.push({
      key: `apple-${apple.id}`,
      href: '/sync?source=apple',
      state: 'running',
      label: `Apple Health ${Math.round((apple.progress?.fraction ?? 0) * 100)}%`,
      detail: apple.progress?.message ?? 'Importing Apple Health export…',
      fraction: apple.progress?.fraction ?? null,
    })
  } else if (apple.error) {
    statuses.push({ key: `apple-${apple.id}`,
      href: '/sync?source=apple', state: 'error', label: 'Apple Health failed', detail: apple.error, fraction: null })
  } else if (apple.summary) {
    const { imported, skipped, errors } = apple.summary
    statuses.push({
      key: `apple-${apple.id}`,
      href: '/sync?source=apple',
      state: errors.length ? 'error' : 'done',
      label: `Apple Health: ${imported} new`,
      detail: `Apple Health import complete: ${imported} imported, ${skipped} skipped${errors.length ? `, ${errors.length} failed` : ''}`,
      fraction: 1,
    })
  }

  if (strava.running) {
    statuses.push({
      key: `strava-${strava.id}`,
      href: '/sync?source=strava',
      state: 'running',
      label: `Strava ${Math.round((strava.progress?.fraction ?? 0) * 100)}%`,
      detail: strava.progress?.message ?? 'Importing Strava activities…',
      fraction: strava.progress?.fraction ?? null,
    })
  } else if (strava.error) {
    statuses.push({ key: `strava-${strava.id}`, href: '/sync?source=strava', state: 'error', label: 'Strava import failed', detail: strava.error, fraction: null })
  } else if (strava.summary) {
    const { imported, skipped, errors } = strava.summary
    statuses.push({
      key: `strava-${strava.id}`,
      href: '/sync?source=strava',
      state: errors.length ? 'error' : 'done',
      label: `Strava: ${imported} new`,
      detail: `Strava import complete: ${imported} imported, ${skipped} skipped${errors.length ? `, ${errors.length} failed` : ''}`,
      fraction: 1,
    })
  }

  if (uploads.length) {
    const finished = uploads.filter((u) => u.status === 'done' || u.status === 'error').length
    const failed = uploads.filter((u) => u.status === 'error').length
    const running = finished < uploads.length
    statuses.push({
      // The newest file names the batch: adding files brings a dismissed status back
      key: `uploads-${uploads[uploads.length - 1].key}`,
      href: '/activities',
      state: running ? 'running' : failed ? 'error' : 'done',
      label: running ? `Uploading ${finished}/${uploads.length}` : `Uploaded ${uploads.length - failed}`,
      detail: running
        ? `Uploading .fit files: ${finished} of ${uploads.length} done`
        : `Upload complete: ${uploads.length - failed} imported${failed ? `, ${failed} failed` : ''}`,
      fraction: finished / uploads.length,
    })
  }
  return statuses
}
