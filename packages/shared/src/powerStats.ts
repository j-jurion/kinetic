// The numbers behind the power section on the Best Efforts page, shared by the web and mobile apps.
import {
  POWER_SPORTS,
  estimatedFtp,
  ftpSettingSteps,
  latestWeight,
  monthlyFtp,
  withPowerCurve,
} from './performance'
import type { PowerSport } from './performance'
import type { TrainingOverview } from './types'

export const POWER_SPORT_NAMES: Record<PowerSport, string> = { running: 'Running', cycling: 'Cycling' }

export const POWER_CAPTION =
  'Best average power per duration; FTP estimated as 95% of your best 20-minute power over the previous 6 weeks.'

/** The power sports that have at least one activity with a power curve. */
export function availablePowerSports(training: TrainingOverview): PowerSport[] {
  return (Object.keys(POWER_SPORTS) as PowerSport[]).filter((s) => withPowerCurve(training.activities, s).length > 0)
}

/** The chosen power sport while it has data, else the preferred one, else the first with data. */
export function pickPowerSport(available: PowerSport[], choice: PowerSport | null, preferRunning: boolean): PowerSport | undefined {
  const preferred: PowerSport = preferRunning ? 'running' : 'cycling'
  return choice && available.includes(choice) ? choice : available.includes(preferred) ? preferred : available[0]
}

/** Estimated and watch FTP, weight and the series for the power charts of one sport. */
export function powerStats(training: TrainingOverview, sport: PowerSport, today = new Date()) {
  const sports: readonly string[] = POWER_SPORTS[sport]
  const activities = withPowerCurve(training.activities, sport)
  const current = estimatedFtp(activities, today)
  const monthly = monthlyFtp(activities, today)
  const last = monthly[monthly.length - 1] ?? null
  const settings = ftpSettingSteps(training.activities.filter((a) => sports.includes(a.sport)))
  const weight = training.thresholds.weight_kg ?? latestWeight(training.activities)
  const backendFtp = sport === 'running' ? training.thresholds.ftp_running : training.thresholds.ftp_cycling
  return {
    activities,
    monthly,
    settings,
    weight,
    backendFtp,
    // Fall back to the most recent month with a 20-minute effort
    estimate: current ? { ...current, asOf: null } : last ? { ftp: last.ftp, activity: last.activity, asOf: last.month } : null,
    watchFtp: settings.length ? settings[settings.length - 1].ftp : null,
  }
}

export type PowerStats = ReturnType<typeof powerStats>

/** "3.45 W/kg", or a dash without watts or weight. */
export const wattsPerKg = (watts: number | null | undefined, weight: number | null) =>
  watts && weight ? `${(watts / weight).toFixed(2)} W/kg` : '–'
