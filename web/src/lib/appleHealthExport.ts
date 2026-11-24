// Reads an Apple Health export.zip in the browser and sends its workouts to the API in the
// Health Auto Export JSON format, so the server has one importer for both sources.
//
// export.xml can be gigabytes, so it is streamed and only the samples a workout chart needs
// are kept (heart rate, distance, power, cadence). Samples come before the workouts in the
// file, so they are collected first and cut into per-workout slices at the end.

import { listZip, openEntry, readEntryText, type ZipEntry } from './zip'

export interface ImportProgress {
  phase: 'reading' | 'sending' | 'done'
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

interface ApiResult {
  imported: number[]
  skipped: number
  errors: { index: number; name: string | null; error: string }[]
}

const SAMPLE_TYPES: Record<string, number> = {
  HKQuantityTypeIdentifierHeartRate: 0,
  HKQuantityTypeIdentifierDistanceWalkingRunning: 1,
  HKQuantityTypeIdentifierDistanceCycling: 2,
  HKQuantityTypeIdentifierDistanceSwimming: 3,
  HKQuantityTypeIdentifierRunningPower: 4,
  HKQuantityTypeIdentifierCyclingPower: 5,
  HKQuantityTypeIdentifierCyclingCadence: 6,
}
const HEART_RATE = 0
const KIND_COUNT = 7
// The JSON key each sample kind is sent under (heart rate is special-cased)
const SERIES_KEYS = ['heartRateData', 'walkingAndRunningDistance', 'cyclingDistance', 'swimDistance',
  'runningPower', 'cyclingPower', 'cyclingCadence']
const DISTANCE_KINDS = [1, 2, 3]
const LENGTH_TO_METRES: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, ft: 0.3048, yd: 0.9144, cm: 0.01 }
const BATCH_BYTES = 3 * 1024 * 1024
const BATCH_WORKOUTS = 50

/** Growable columns of samples: time (ms), value, kind and source. */
class Samples {
  time = new Float64Array(1 << 16)
  value = new Float64Array(1 << 16)
  kind = new Uint8Array(1 << 16)
  source = new Uint16Array(1 << 16)
  length = 0

  push(time: number, value: number, kind: number, source: number) {
    if (this.length === this.time.length) {
      const grow = <T extends Float64Array | Uint8Array | Uint16Array>(a: T): T => {
        const next = new (a.constructor as { new (n: number): T })(a.length * 2)
        next.set(a)
        return next
      }
      this.time = grow(this.time)
      this.value = grow(this.value)
      this.kind = grow(this.kind)
      this.source = grow(this.source)
    }
    const i = this.length++
    this.time[i] = time
    this.value[i] = value
    this.kind[i] = kind
    this.source[i] = source
  }

  /** Per kind, the sample indexes sorted by time. */
  index(): Uint32Array[] {
    const perKind: number[][] = Array.from({ length: KIND_COUNT }, () => [])
    for (let i = 0; i < this.length; i++) perKind[this.kind[i]].push(i)
    const time = this.time
    return perKind.map((list) => Uint32Array.from(list).sort((a, b) => time[a] - time[b]))
  }
}

/** One part of a multisport workout (a <WorkoutActivity>): a swim, ride, run or transition. */
interface RawLeg {
  type: string
  start: string
  end: string
  distance: { qty: number; units: string } | null
  indoor: boolean
  swimLocation: string | null
  lapLengthM: number | null
}

interface RawWorkout {
  type: string
  source: number
  start: string
  end: string
  startMs: number
  endMs: number
  duration: number | null
  distance: { qty: number; units: string } | null
  energy: { qty: number; units: string } | null
  avgHr: number | null
  maxHr: number | null
  indoor: boolean
  swimLocation: string | null
  ascentM: number | null
  lapLengthM: number | null
  routeFiles: string[]
  /** The legs of a multisport workout; empty for a workout of one sport. */
  legs: RawLeg[]
}

// What a leg is, from the distance it counts, for exports whose <WorkoutActivity> has no type
const LEG_BY_DISTANCE: Record<string, string> = {
  HKQuantityTypeIdentifierDistanceSwimming: 'Swimming',
  HKQuantityTypeIdentifierDistanceCycling: 'Cycling',
  HKQuantityTypeIdentifierDistanceWalkingRunning: 'Running',
}

function metadataOf(block: string): Record<string, string> {
  const metadata: Record<string, string> = {}
  for (const match of block.matchAll(/<MetadataEntry ([^>]*?)\/?>/g)) {
    const entry = attributes(match[1])
    if (entry.key && !(entry.key in metadata)) metadata[entry.key] = entry.value ?? ''
  }
  return metadata
}

/** The legs of a workout block; a workout of one sport has at most one and gets none. */
function legsOf(block: string): RawLeg[] {
  const legs: RawLeg[] = []
  for (const match of block.matchAll(/<WorkoutActivity ([^>]*?)(\/>|>([\s\S]*?)<\/WorkoutActivity>)/g)) {
    const attrs = attributes(match[1])
    const inner = match[3] ?? ''
    if (!attrs.startDate || !attrs.endDate) continue
    let type = (attrs.workoutActivityType ?? '').replace('HKWorkoutActivityType', '')
    let distance: RawLeg['distance'] = null
    for (const stat of inner.matchAll(/<WorkoutStatistics ([^>]*?)\/?>/g)) {
      const values = attributes(stat[1])
      const sum = number(values.sum)
      const kind = values.type ? LEG_BY_DISTANCE[values.type] : undefined
      if (kind && sum !== null) {
        distance = { qty: sum, units: values.unit ?? 'km' }
        type ||= kind
      }
    }
    const metadata = metadataOf(inner)
    legs.push({
      // Without a type or a distance it is the time between two legs
      type: type || 'Transition',
      start: attrs.startDate,
      end: attrs.endDate,
      distance,
      indoor: metadata.HKIndoorWorkout === '1',
      swimLocation: metadata.HKSwimmingLocationType ?? null,
      lapLengthM: lengthMetres(metadata.HKLapLength),
    })
  }
  return legs.filter((leg) => leg.type !== 'Transition').length >= 2 ? legs : []
}

const ATTRIBUTE = /([\w:]+)="([^"]*)"/g

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(ATTRIBUTE)) result[match[1]] = match[2]
  return result
}

function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#\d+);/g, (_, code: string) => {
    switch (code) {
      case 'lt': return '<'
      case 'gt': return '>'
      case 'amp': return '&'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return String.fromCharCode(Number(code.slice(1)))
    }
  })
}

/** "2024-01-01 07:00:00 +0100" as epoch milliseconds. */
export function appleDateMs(text: string): number {
  if (text.length >= 25 && text[10] === ' ') {
    return Date.parse(`${text.slice(0, 10)}T${text.slice(11, 19)}${text.slice(20, 23)}:${text.slice(23, 25)}`)
  }
  return Date.parse(text)
}

/** "4500 cm" or "25 m" as metres. */
function lengthMetres(text: string | undefined): number | null {
  if (!text) return null
  const match = /^\s*([\d.]+)\s*([a-z]+)\s*$/i.exec(text)
  if (!match) return null
  const factor = LENGTH_TO_METRES[match[2].toLowerCase()]
  return factor ? Number(match[1]) * factor : null
}

function number(text: string | undefined): number | null {
  if (text === undefined || text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

class ExportParser {
  samples = new Samples()
  sources: string[] = []
  sourceIds = new Map<string, number>()
  workouts: RawWorkout[] = []

  sourceId(name: string): number {
    let id = this.sourceIds.get(name)
    if (id === undefined) {
      id = this.sources.length
      this.sources.push(name)
      this.sourceIds.set(name, id)
    }
    return id
  }

  record(tag: string) {
    // Most records are of types we do not need; check the type before parsing the rest
    const typeEnd = tag.indexOf('"', 6)
    if (!tag.startsWith('type="')) return
    const kind = SAMPLE_TYPES[tag.slice(6, typeEnd)]
    if (kind === undefined) return
    const attrs = attributes(tag)
    let value = number(attrs.value)
    if (value === null) return
    if (DISTANCE_KINDS.includes(kind)) {
      const factor = LENGTH_TO_METRES[(attrs.unit ?? 'm').toLowerCase()]
      if (!factor) return
      value *= factor
    }
    // Distance is cumulative at the end of the sample; the rest are instants
    const time = appleDateMs(DISTANCE_KINDS.includes(kind) ? attrs.endDate : attrs.startDate)
    if (!Number.isFinite(time)) return
    this.samples.push(time, value, kind, this.sourceId(unescapeXml(attrs.sourceName ?? '')))
  }

  workout(block: string) {
    const open = block.indexOf('>')
    const attrs = attributes(block.slice(0, open))
    const startMs = appleDateMs(attrs.startDate ?? '')
    const endMs = appleDateMs(attrs.endDate ?? '')
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return

    // The workout's own statistics and metadata, not those of its legs (<WorkoutActivity>),
    // which would otherwise overwrite them; older exports only have the workout's own
    const own = block.replace(/<WorkoutActivity [^>]*?(\/>|>[\s\S]*?<\/WorkoutActivity>)/g, '')
    const metadata = { ...metadataOf(block), ...metadataOf(own) }
    let distance: RawWorkout['distance'] = null
    let energy: RawWorkout['energy'] = null
    let avgHr: number | null = null
    let maxHr: number | null = null
    const statistics = /<WorkoutStatistics /.test(own) ? own : block
    for (const match of statistics.matchAll(/<WorkoutStatistics ([^>]*?)\/?>/g)) {
      const stat = attributes(match[1])
      const sum = number(stat.sum)
      if (stat.type?.startsWith('HKQuantityTypeIdentifierDistance') && sum !== null) {
        // A multisport workout has a total per kind (swim, ride, run): add them up
        distance = distance && distance.units === (stat.unit ?? 'km')
          ? { qty: distance.qty + sum, units: distance.units }
          : { qty: sum, units: stat.unit ?? 'km' }
      } else if (stat.type === 'HKQuantityTypeIdentifierActiveEnergyBurned' && sum !== null) {
        energy = { qty: sum, units: stat.unit ?? 'kcal' }
      } else if (stat.type === 'HKQuantityTypeIdentifierHeartRate') {
        avgHr = number(stat.average)
        maxHr = number(stat.maximum)
      }
    }
    // Exports from before iOS 16 keep the totals on the workout itself
    if (!distance && number(attrs.totalDistance)) {
      distance = { qty: Number(attrs.totalDistance), units: attrs.totalDistanceUnit ?? 'km' }
    }
    if (!energy && number(attrs.totalEnergyBurned)) {
      energy = { qty: Number(attrs.totalEnergyBurned), units: attrs.totalEnergyBurnedUnit ?? 'kcal' }
    }
    // A multisport workout can have a route per leg
    const routeFiles = [...block.matchAll(/<FileReference path="([^"]+)"/g)]
      .map((match) => match[1].split('/').pop() ?? '')
      .filter(Boolean)
    const durationUnit = attrs.durationUnit ?? 'min'
    const rawDuration = number(attrs.duration)
    const duration = rawDuration === null ? null
      : rawDuration * (durationUnit === 'min' ? 60 : durationUnit === 'hr' ? 3600 : 1)

    this.workouts.push({
      type: (attrs.workoutActivityType ?? '').replace('HKWorkoutActivityType', ''),
      source: this.sourceId(unescapeXml(attrs.sourceName ?? '')),
      start: attrs.startDate,
      end: attrs.endDate,
      startMs,
      endMs,
      duration,
      distance,
      energy,
      avgHr,
      maxHr,
      indoor: metadata.HKIndoorWorkout === '1',
      swimLocation: metadata.HKSwimmingLocationType ?? null,
      ascentM: lengthMetres(metadata.HKElevationAscended),
      lapLengthM: lengthMetres(metadata.HKLapLength),
      routeFiles,
      legs: legsOf(block),
    })
  }

  /** Feed the next piece of export.xml; returns the unconsumed tail. */
  feed(text: string): string {
    let pos = 0
    for (;;) {
      const lt = text.indexOf('<', pos)
      if (lt < 0) return ''
      if (text.startsWith('<Record ', lt)) {
        const gt = text.indexOf('>', lt)
        if (gt < 0) return text.slice(lt)
        this.record(text.slice(lt + 8, gt))
        pos = gt + 1
      } else if (text.startsWith('<Workout ', lt)) {
        const end = text.indexOf('</Workout>', lt)
        if (end < 0) return text.slice(lt)
        this.workout(text.slice(lt, end))
        pos = end + 10
      } else {
        const gt = text.indexOf('>', lt)
        if (gt < 0 || text.length - lt < 9) return text.slice(lt)
        pos = gt + 1
      }
    }
  }
}

/** The display name Apple's Fitness app would use, e.g. "Outdoor Run". */
function workoutName(w: Pick<RawWorkout, 'type' | 'indoor' | 'swimLocation'>): string {
  const place = w.indoor ? 'Indoor' : 'Outdoor'
  switch (w.type) {
    case 'Running': return `${place} Run`
    case 'Cycling': return `${place} Cycle`
    case 'Walking': return `${place} Walk`
    case 'Swimming': return w.swimLocation === '2' ? 'Open Water Swim' : 'Pool Swim'
    default: return w.type.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Workout'
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function lowerBound(order: Uint32Array, time: Float64Array, target: number): number {
  let lo = 0
  let hi = order.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (time[order[mid]] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function parseGpx(text: string) {
  const points = []
  for (const match of text.matchAll(/<trkpt ([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
    const attrs = attributes(match[1])
    const inner = match[2]
    const time = /<time>([^<]+)<\/time>/.exec(inner)
    if (!time) continue
    const ele = /<ele>([^<]+)<\/ele>/.exec(inner)
    const speed = /<speed>([^<]+)<\/speed>/.exec(inner)
    points.push({
      latitude: Number(attrs.lat),
      longitude: Number(attrs.lon),
      altitude: ele ? Number(ele[1]) : null,
      speed: speed ? Number(speed[1]) : null,
      timestamp: time[1],
    })
  }
  return points
}

export async function importAppleHealthExport(
  file: File,
  options: { sinceMs?: number | null; onProgress: (p: ImportProgress) => void; signal?: AbortSignal },
): Promise<ImportSummary> {
  const { onProgress, signal } = options
  const entries = await listZip(file)
  // export.xml is localised (e.g. "Exporteren.xml"); it is the biggest XML that is not the CDA one
  const xml = entries
    .filter((e) => /^([^/]+\/)?[^/]+\.xml$/i.test(e.name) && !/cda/i.test(e.name))
    .sort((a, b) => b.size - a.size)[0]
  if (!xml) throw new Error('No export.xml found — choose the export.zip from the Health app')
  const gpx = new Map<string, ZipEntry>()
  for (const e of entries) if (/\.gpx$/i.test(e.name)) gpx.set(e.name.split('/').pop()!, e)

  // ── Pass over export.xml ──
  const parser = new ExportParser()
  const reader = (await openEntry(file, xml)).pipeThrough(new TextDecoderStream()).getReader()
  let tail = ''
  let readChars = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
    const { done, value } = await reader.read()
    if (done) break
    readChars += value.length
    tail = parser.feed(tail + value)
    onProgress({
      phase: 'reading',
      fraction: xml.size ? Math.min(1, readChars / xml.size) : 0,
      message: `Reading export… ${parser.workouts.length} workouts found`,
    })
  }

  const workouts = parser.workouts
    .filter((w) => !options.sinceMs || w.startMs >= options.sinceMs)
    .sort((a, b) => a.startMs - b.startMs)
  const { samples } = parser
  const order = samples.index()

  const slice = (kind: number, w: RawWorkout, anySource: boolean) => {
    const list = order[kind]
    const out: { date: string; qty: number }[] = []
    for (let i = lowerBound(list, samples.time, w.startMs - 5000); i < list.length; i++) {
      const s = list[i]
      if (samples.time[s] > w.endMs + 5000) break
      if (anySource || samples.source[s] === w.source) out.push({ date: iso(samples.time[s]), qty: samples.value[s] })
    }
    return out
  }

  const summary: ImportSummary = { found: workouts.length, imported: 0, skipped: 0, errors: [] }
  let batch: string[] = []
  let batchBytes = 0
  let sent = 0

  const flush = async () => {
    if (!batch.length) return
    const body = `{"data":{"workouts":[${batch.join(',')}]}}`
    const count = batch.length
    batch = []
    batchBytes = 0
    const response = await fetch('/api/integrations/apple-health/import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(typeof data.detail === 'string' ? data.detail : `Import failed (${response.status})`)
    }
    const result = (await response.json()) as ApiResult
    summary.imported += result.imported.length
    summary.skipped += result.skipped
    for (const error of result.errors) summary.errors.push(`${error.name ?? 'Workout'}: ${error.error}`)
    sent += count
  }

  for (const w of workouts) {
    if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
    const heart = slice(HEART_RATE, w, false)
    const payload: Record<string, unknown> = {
      name: workoutName(w),
      start: w.start,
      end: w.end,
      duration: w.duration,
      isIndoor: w.indoor,
      location: w.type === 'Swimming' ? (w.swimLocation === '2' ? 'Open Water' : 'Pool') : w.indoor ? 'Indoor' : 'Outdoor',
      distance: w.distance,
      activeEnergyBurned: w.energy,
      elevationUp: w.ascentM === null ? null : { qty: w.ascentM, units: 'm' },
      lapLength: w.lapLengthM === null ? null : { qty: w.lapLengthM, units: 'm' },
      heartRate: { avg: w.avgHr === null ? null : { qty: w.avgHr }, max: w.maxHr === null ? null : { qty: w.maxHr } },
      // Heart rate from another source (a chest strap paired to the phone) is better than none
      heartRateData: (heart.length ? heart : slice(HEART_RATE, w, true)).map((s) => ({ date: s.date, Avg: s.qty })),
    }
    for (let kind = 1; kind < KIND_COUNT; kind++) {
      const series = slice(kind, w, false)
      if (series.length) {
        payload[SERIES_KEYS[kind]] = DISTANCE_KINDS.includes(kind)
          ? series.map((s) => ({ ...s, units: 'm' }))
          : series
      }
    }
    if (w.legs.length) {
      // The server makes it an event with a leg per part, like a watch's triathlon
      payload.legs = w.legs.map((leg) => ({
        name: workoutName(leg),
        start: leg.start,
        end: leg.end,
        distance: leg.distance,
        isIndoor: leg.indoor,
        location: leg.type === 'Swimming' ? (leg.swimLocation === '2' ? 'Open Water' : 'Pool') : leg.indoor ? 'Indoor' : 'Outdoor',
        lapLength: leg.lapLengthM === null ? null : { qty: leg.lapLengthM, units: 'm' },
      }))
    }
    const route = []
    for (const name of w.routeFiles) {
      const routeEntry = gpx.get(name)
      if (!routeEntry) continue
      try {
        route.push(...parseGpx(await readEntryText(file, routeEntry)))
      } catch {
        // A damaged route file still leaves the rest of the workout
      }
    }
    if (route.length) payload.route = route.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    const json = JSON.stringify(payload)
    if (batch.length && (batchBytes + json.length > BATCH_BYTES || batch.length >= BATCH_WORKOUTS)) {
      await flush()
    }
    batch.push(json)
    batchBytes += json.length
    onProgress({
      phase: 'sending',
      fraction: workouts.length ? sent / workouts.length : 1,
      message: `Importing workouts… ${sent} of ${workouts.length} sent`,
    })
  }
  await flush()
  onProgress({ phase: 'done', fraction: 1, message: 'Done' })
  return summary
}
