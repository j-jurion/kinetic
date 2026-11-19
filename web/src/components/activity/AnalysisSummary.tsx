import { sportColor } from '../../lib/format'
import { formatSpeed } from '../../lib/speed'
import type { Activity, ActivityStreams } from '../../lib/types'

const POWER = '#3b82f6'
const DYNAMICS = '#8b5cf6'
const WARM = '#f59e0b'

interface Tile {
  label: string
  value: string
  color: string
  /** A short explanation under the label. */
  hint?: string
}

type Summary = NonNullable<ActivityStreams['summary']>

/** The tiles that have a value, in reading order: power, endurance, conditions, running form. */
function summaryTiles(activity: Activity, s: Summary): Tile[] {
  const tiles: Tile[] = []
  const has = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v)

  if (has(s.normalized_power)) tiles.push({ label: 'Normalized Power', value: `${Math.round(s.normalized_power)} W`, color: POWER })
  if (has(s.intensity_factor)) tiles.push({ label: 'Intensity Factor', value: s.intensity_factor.toFixed(2), color: POWER })
  // Power to weight from NP when known (it reflects the effort better), else the average power
  const watts = has(s.normalized_power) ? s.normalized_power : activity.avg_power
  if (has(watts) && has(s.weight) && s.weight > 0) {
    tiles.push({
      label: has(s.normalized_power) ? 'W/kg (NP)' : 'W/kg',
      value: (watts / s.weight).toFixed(2),
      color: POWER,
    })
  }
  if (has(s.decoupling_pct)) {
    tiles.push({
      label: 'Aerobic decoupling',
      value: `${s.decoupling_pct.toFixed(1)}%`,
      color: s.decoupling_pct < 5 ? '#22c55e' : '#f97316',
      hint: 'Under 5% = good endurance',
    })
  }
  if (has(s.grade_adjusted_speed) && s.grade_adjusted_speed > 0) {
    tiles.push({
      label: 'Grade-adjusted pace',
      value: formatSpeed(s.grade_adjusted_speed, activity.sport),
      color: sportColor(activity.sport, '#6b7280'),
    })
  }
  if (has(s.avg_temperature)) tiles.push({ label: 'Avg temperature', value: `${s.avg_temperature.toFixed(1)} °C`, color: WARM })
  if (has(s.avg_step_length)) tiles.push({ label: 'Step length', value: `${s.avg_step_length.toFixed(2)} m`, color: DYNAMICS })
  if (has(s.avg_ground_contact)) tiles.push({ label: 'Ground contact', value: `${Math.round(s.avg_ground_contact)} ms`, color: DYNAMICS })
  if (has(s.avg_vertical_oscillation)) {
    tiles.push({ label: 'Vertical oscillation', value: `${s.avg_vertical_oscillation.toFixed(1)} cm`, color: DYNAMICS })
  }
  if (has(s.avg_vertical_ratio)) tiles.push({ label: 'Vertical ratio', value: `${s.avg_vertical_ratio.toFixed(1)}%`, color: DYNAMICS })
  return tiles
}

/** Derived metrics of an activity as stat tiles; renders nothing when none are known. */
export function AnalysisSummary({ activity, streams }: { activity: Activity; streams: ActivityStreams }) {
  const tiles = streams.summary ? summaryTiles(activity, streams.summary) : []
  if (!tiles.length) return null
  return (
    <div className="column w-full gap-0">
      <div className="text-subtitle1 text-weight-bold q-mb-sm">Analysis</div>
      <div className="row flex-wrap gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="card q-pa-md items-center gap-0" style={{ minWidth: 96 }} title={t.hint}>
            <div className="text-h6 text-weight-bold" style={{ color: t.color }}>{t.value}</div>
            <div className="text-caption text-grey-6">{t.label}</div>
            {t.hint && <div className="text-caption text-grey-6" style={{ fontSize: 11, opacity: 0.8 }}>{t.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
