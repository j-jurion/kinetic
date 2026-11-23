// How speed is shown per sport, and the slow-to-fast colour scale used on the route map.

import { isSwimming } from './format'

/** Sports shown as pace (time per km or per 100 m); everything else as speed in km/h. */
export const PACE_SPORTS = new Set(['running', 'trail_running', 'walking', 'hiking', 'swimming'])

// Slow (blue) → green → yellow → fast (red)
const STOPS: [number, number, number][] = [
  [37, 99, 235],
  [34, 197, 94],
  [234, 179, 8],
  [239, 68, 68],
]

/** Colour for a position 0 (slowest) … 1 (fastest) on the scale. */
export function speedColor(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const [r, g, b] = STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f))
  return `rgb(${r}, ${g}, ${b})`
}

/** CSS gradient of the whole scale, for the legend. */
export const SPEED_GRADIENT = `linear-gradient(90deg, ${[0, 1 / 3, 2 / 3, 1].map(speedColor).join(', ')})`

export interface SpeedScale {
  low: number
  high: number
  /** Position of a speed (m/s) on the scale, 0 … 1. */
  position: (speed: number) => number
}

/**
 * Scale between the 5th and 95th percentile of the moving speeds, so a few GPS spikes or
 * standstills do not wash out the colours of the rest of the route.
 */
export function speedScale(speeds: (number | null)[]): SpeedScale | null {
  const moving = speeds.filter((s): s is number => s !== null && s > 0.3).sort((a, b) => a - b)
  if (moving.length < 2) return null
  const low = moving[Math.floor(moving.length * 0.05)]
  const high = moving[Math.min(moving.length - 1, Math.floor(moving.length * 0.95))]
  const span = Math.max(high - low, 0.01)
  return { low, high, position: (speed) => (speed - low) / span }
}

/** A tick step of 1, 2 or 5 × 10ⁿ close to the given size, at least 1. */
export function niceStep(size: number): number {
  if (!(size > 1)) return 1
  const power = 10 ** Math.floor(Math.log10(size))
  const scaled = size / power
  return (scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : 5) * power
}

/** A heart-rate axis with whole-number labels and room above the highest value. */
export function heartRateAxis(rates: number[]): { dtick: number; range: [number, number] } | null {
  const values = rates.filter((r) => r > 0)
  if (!values.length) return null
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const step = niceStep((highest - lowest) / 4)
  return { dtick: step, range: [lowest - step, highest + step * 1.5] }
}

/** Seconds as m:ss (or h:mm:ss). */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export interface PaceAxis {
  /** Slow → fast, which reverses the axis so faster paces sit higher. */
  range: [number, number]
  tickvals: number[]
  ticktext: string[]
  /** The slow end of the range, where pace bars start. */
  slow: number
}

/**
 * A pace axis (seconds per km or per 100 m) with evenly spaced m:ss labels.
 *
 * The range ignores the slowest and fastest 2% of the values, so a few standstills or GPS
 * jumps do not squash the rest of the activity into a thin band.
 */
export function paceAxis(paces: number[], labelBaseline = true, maxSteps = 4): PaceAxis | null {
  const sorted = paces.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  const fastest = sorted[Math.floor((sorted.length - 1) * 0.02)]
  const slowest = sorted[Math.ceil((sorted.length - 1) * 0.98)]
  // A few labels, 0:05, 0:10, 0:15, 0:20, 0:30, 1:00, 2:00 or 5:00 apart
  const step = [5, 10, 15, 20, 30, 60, 120, 300].find((s) => (slowest - fastest) / s <= maxSteps) ?? 600
  const fast = Math.floor(fastest / step) * step - step / 2
  const slow = Math.ceil(slowest / step) * step + (labelBaseline ? step / 2 : step)
  const tickvals: number[] = []
  for (let t = Math.ceil(fast / step) * step; t < slow; t += step) tickvals.push(t)
  return { range: [slow, fast], tickvals, ticktext: tickvals.map(formatClock), slow }
}

/** A speed in m/s as the sport shows it: pace (4:35 /km, 1:52 /100m) or km/h. */
export function formatSpeed(speed: number, sport: string): string {
  if (!PACE_SPORTS.has(sport)) return `${(speed * 3.6).toFixed(1)} km/h`
  const reference = isSwimming(sport) ? 100 : 1000
  const seconds = reference / speed
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')} /${reference === 100 ? '100m' : 'km'}`
}
