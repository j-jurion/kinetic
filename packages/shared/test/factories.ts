// Minimal objects of the API types for tests: every field has a neutral default.
import type { Activity, ActivityRow, BestEffortRow, GraphPoint, TrainingActivity } from '../src/types'

let nextId = 1

export function trainingActivity(fields: Partial<TrainingActivity> = {}): TrainingActivity {
  return {
    id: nextId++,
    name: 'Run',
    date: '2026-01-05T08:00:00',
    sport: 'running',
    kind: 'training',
    parent_id: null,
    duration_seconds: 3600,
    moving_seconds: 3600,
    distance_meters: 10000,
    elevation_gain_meters: null,
    avg_heart_rate: null,
    avg_speed_ms: null,
    avg_cadence: null,
    avg_power: null,
    load: 0,
    load_source: 'duration',
    zone_seconds: null,
    zones_estimated: false,
    has_metrics: false,
    power_curve: null,
    normalized_power: null,
    ftp_setting: null,
    weight_kg: null,
    avg_temperature: null,
    grade_adjusted_speed: null,
    decoupling_pct: null,
    avg_step_length: null,
    avg_ground_contact: null,
    avg_vertical_oscillation: null,
    avg_vertical_ratio: null,
    avg_swolf: null,
    avg_stroke_rate: null,
    ...fields,
  }
}

export function activity(fields: Partial<ActivityRow> = {}): ActivityRow {
  const base: Activity = {
    id: nextId++,
    name: 'Run',
    sport: 'running',
    kind: 'training',
    date: '2026-01-05T08:00:00',
    duration_seconds: 3600,
    distance_meters: 10000,
    elevation_gain_meters: null,
    avg_heart_rate: null,
    max_heart_rate: null,
    avg_speed_ms: null,
    max_speed_ms: null,
    avg_cadence: null,
    avg_power: null,
    calories: null,
    notes: null,
    parent_id: null,
    garmin_activity_id: null,
    has_route: false,
  }
  return { ...base, ...fields }
}

export function graphPoint(fields: Partial<GraphPoint> = {}): GraphPoint {
  return {
    id: nextId++,
    name: 'Run',
    date: '2026-01-05T08:00:00',
    sport: 'running',
    kind: 'training',
    distance_meters: 10000,
    duration_seconds: 3600,
    elevation_meters: 0,
    avg_heart_rate: null,
    ...fields,
  }
}

export function bestEffort(fields: Partial<BestEffortRow> = {}): BestEffortRow {
  const id = nextId++
  return {
    id,
    activity_id: id,
    sport: 'running',
    distance_meters: 5000,
    duration_seconds: 1500,
    date: '2026-01-05T08:00:00',
    year: 2026,
    activity_name: 'Run',
    kind: 'training',
    is_race: false,
    elevation_gain_meters: null,
    parent_sport: null,
    ...fields,
  }
}

/** A local date-time, like the API's dates once parsed. */
export const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
