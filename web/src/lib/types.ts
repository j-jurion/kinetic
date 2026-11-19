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
