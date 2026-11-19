export interface Activity {
  id: number
  name: string
  sport: string
  kind: string
  date: string
  duration_seconds: number
  distance_meters: number | null
  elevation_gain_meters: number | null
  avg_heart_rate: number | null
  max_heart_rate: number | null
  avg_speed_ms: number | null
  max_speed_ms: number | null
  avg_cadence: number | null
  avg_power: number | null
  calories: number | null
  notes: string | null
  parent_id: number | null
  garmin_activity_id: number | null
  has_route: boolean
}

export interface ActivityRow extends Activity {
  has_race_result?: boolean
  parent_sport?: string | null
}

export interface Lap {
  id: number
  lap_number: number
  duration_seconds: number | null
  distance_meters: number | null
  avg_speed_ms: number | null
  avg_heart_rate: number | null
  elevation_gain: number | null
}

export interface BestEffort {
  id: number
  activity_id: number
  sport: string
  distance_meters: number
  duration_seconds: number
  date: string
  year: number
}

export interface RankedBestEffort extends BestEffort {
  rank: number
}

export interface BestEffortRow extends BestEffort {
  activity_name: string
  kind: string
  /** Marked as a race, or has an official race result. */
  is_race: boolean
  elevation_gain_meters: number | null
  parent_sport: string | null
}

export interface Friend {
  id: number
  name: string
  email: string | null
}

export interface RaceSplit {
  id?: number
  label: string
  order?: number
  duration_seconds: number | null
  rank: number | null
}

export interface RaceResult {
  id?: number
  activity_id?: number
  official_time_seconds: number | null
  bib_number: string | null
  age_group: string | null
  overall_rank: number | null
  overall_total: number | null
  gender_rank: number | null
  gender_total: number | null
  age_group_rank: number | null
  age_group_total: number | null
  results_url: string | null
  notes: string | null
  splits: RaceSplit[]
}

export interface RaceRow extends RaceResult {
  activity: Activity
  parent_sport: string | null
}

export interface ActivityDetail {
  activity: Activity
  laps: Lap[]
  best_efforts: RankedBestEffort[]
  children: Activity[]
  parent: Activity | null
  race_result: RaceResult | null
  friends: Friend[]
}

/** A climb found in an activity's elevation profile. */
export interface Climb {
  start_m: number
  end_m: number
  length_m: number
  gain_m: number
  grade_pct: number
  seconds: number
  /** Metres climbed per hour. */
  vam: number | null
}

/** One pool length of a swim. */
export interface SwimLength {
  length: number
  seconds: number
  strokes: number | null
  /** Strokes per minute. */
  stroke_rate: number | null
  stroke: string | null
  /** Seconds plus strokes for the length; lower is more efficient. */
  swolf: number | null
}

/** Per-second data of an activity, averaged into a few hundred points. */
export interface ActivityStreams {
  available: boolean
  points?: {
    t: number[]
    distance: (number | null)[]
    heart_rate: (number | null)[]
    speed: (number | null)[]
    altitude: (number | null)[]
    cadence: (number | null)[]
    power: (number | null)[]
    lat: (number | null)[]
    lon: (number | null)[]
    /** °C, from the watch (reads warm from body heat). */
    temperature: (number | null)[]
    /** Metres. */
    step_length: (number | null)[]
    /** Ground contact time in milliseconds. */
    ground_contact: (number | null)[]
    /** Centimetres. */
    vertical_oscillation: (number | null)[]
    /** Percent. */
    vertical_ratio: (number | null)[]
    /** Equivalent flat running speed in m/s (running sports only). */
    grade_adjusted_speed: (number | null)[]
  }
  zones?: { zone: string; low: number; high: number; seconds: number }[]
  /** The maximum heart rate the zones are based on. */
  zone_max_hr?: number | null
  /** "watch" when the zones use the watch's own maximum heart rate. */
  zone_source?: 'watch' | 'estimate'
  /** Coggan power zones, when the activity has power and an FTP is known. */
  power_zones?: { zone: string; name: string; low: number; high: number | null; seconds: number }[]
  ftp?: number | null
  climbs?: Climb[]
  lengths?: SwimLength[]
  summary?: {
    normalized_power: number | null
    /** Normalized Power / FTP. */
    intensity_factor: number | null
    /** Drop in output per heartbeat from the first to the second half; under 5% is good. */
    decoupling_pct: number | null
    avg_temperature: number | null
    /** Average grade-adjusted speed in m/s. */
    grade_adjusted_speed: number | null
    avg_step_length: number | null
    avg_ground_contact: number | null
    avg_vertical_oscillation: number | null
    avg_vertical_ratio: number | null
    weight: number | null
  }
}

/** A triathlon, duathlon or other multisport event built from its legs (GET /api/multisport). */
export interface MultisportEvent {
  id: number
  name: string
  date: string
  sport: string
  /** Marked as a race, or has an official race result. */
  is_race: boolean
  duration_seconds: number
  /** Legs and the transitions between them, in order. */
  segments: {
    label: string
    /** swim, bike, run, other, or t1, t2, … for transitions. */
    kind: string
    seconds: number
    distance_meters: number | null
    /** The leg's activity; null for transitions. */
    activity_id: number | null
  }[]
}

/** One activity in the training overview (GET /api/training). */
export interface TrainingActivity {
  id: number
  name: string
  date: string
  sport: string
  kind: string
  /** Set for the legs of a multisport event; the parent covers the whole event. */
  parent_id: number | null
  duration_seconds: number
  /** Moving time; use for totals (recorded durations can be broken). 0 when implausible. */
  moving_seconds: number
  distance_meters: number | null
  elevation_gain_meters: number | null
  avg_heart_rate: number | null
  avg_speed_ms: number | null
  avg_cadence: number | null
  avg_power: number | null
  /** Training load; one hour at threshold is 100. */
  load: number
  load_source: string
  /** Seconds in heart-rate zones Z1–Z5, or null without heart rate. */
  zone_seconds: number[] | null
  /** True when the zones come from the average heart rate instead of per-second data. */
  zones_estimated: boolean
  has_metrics: boolean
  /** Best average power per duration in seconds, e.g. {"300": 310}. */
  power_curve: Record<string, number> | null
  normalized_power: number | null
  ftp_setting: number | null
  weight_kg: number | null
  avg_temperature: number | null
  grade_adjusted_speed: number | null
  decoupling_pct: number | null
  avg_step_length: number | null
  avg_ground_contact: number | null
  avg_vertical_oscillation: number | null
  avg_vertical_ratio: number | null
  avg_swolf: number | null
  avg_stroke_rate: number | null
}

export interface TrainingOverview {
  activities: TrainingActivity[]
  thresholds: {
    max_hr: number | null
    max_hr_source: string | null
    threshold_hr: number | null
    threshold_hr_source: string | null
    /** FTPs only appear when activities of that sport recorded power. */
    ftp_running: number | null
    ftp_cycling: number | null
    weight_kg: number | null
  }
  /** Activities whose metrics still need to be computed (POST /api/training/analyse). */
  pending: number
  /** Heart-rate zones as fractions of the maximum heart rate. */
  zones: { zone: string; name: string; low: number; high: number }[]
}

export interface Totals {
  count: number
  distance_meters: number
  duration_seconds: number
}

export interface BestEffortsOverview {
  records: BestEffortRow[]
  standouts: Partial<Record<'elevation' | 'distance', ActivityRow>>
  summary: Totals
}

export interface GraphTotals extends Totals {
  elevation_meters: number
}

/** One activity, reduced to what the Graphs page charts need. */
export interface GraphPoint {
  id: number
  name: string
  date: string
  sport: string
  kind: string
  distance_meters: number | null
  duration_seconds: number
  elevation_meters: number | null
  avg_heart_rate: number | null
}

export interface GraphStats {
  activities: GraphPoint[]
}

export interface MapRoute extends Activity {
  coords: [number, number][]
}

export interface MapData {
  available: string[]
  routes: MapRoute[]
  counts: { drawn: number; total: number; without_gps: number }
}
