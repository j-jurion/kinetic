import { describe, expect, it } from 'vitest'
import { formatClock, formatSpeed, heartRateAxis, niceStep, paceAxis, speedColor, speedScale } from '../src/speed'

describe('speed display', () => {
  it('shows pace for sports on foot and swimming, km/h otherwise', () => {
    expect(formatSpeed(1000 / 275, 'running')).toBe('4:35 /km')
    expect(formatSpeed(100 / 112, 'swimming')).toBe('1:52 /100m')
    expect(formatSpeed(10, 'cycling')).toBe('36.0 km/h')
  })

  it('formats clock times', () => {
    expect(formatClock(59.6)).toBe('1:00')
    expect(formatClock(3725)).toBe('1:02:05')
  })

  it('colours from blue (slow) to red (fast), clamped', () => {
    expect(speedColor(0)).toBe('rgb(37, 99, 235)')
    expect(speedColor(1)).toBe('rgb(239, 68, 68)')
    expect(speedColor(-5)).toBe(speedColor(0))
    expect(speedColor(7)).toBe(speedColor(1))
    expect(speedColor(0.5)).toBe('rgb(134, 188, 51)')
  })

  it('scales between the 5th and 95th percentile of moving speeds', () => {
    const speeds = [null, 0, 0.2, ...Array.from({ length: 100 }, (_, i) => 2 + i / 100), 50]
    const scale = speedScale(speeds)!
    expect(scale.low).toBeCloseTo(2.05)
    expect(scale.high).toBeCloseTo(2.95) // the 50 m/s GPS spike is above the 95th percentile
    expect(scale.position(scale.low)).toBe(0)
    expect(scale.position(scale.high)).toBeCloseTo(1)
    expect(speedScale([3, null, 0])).toBeNull()
    expect(speedScale([3, 3])!.position(3)).toBe(0) // no division by zero
  })
})

describe('axes', () => {
  it('rounds tick steps to 1, 2 or 5 × 10ⁿ', () => {
    expect([0, 1, 1.4, 1.6, 3.4, 3.6, 14, 26, 70, 140].map(niceStep)).toEqual([1, 1, 1, 2, 2, 5, 10, 20, 50, 100])
    expect(niceStep(Number.NaN)).toBe(1)
  })

  it('pads the heart-rate axis around the values', () => {
    expect(heartRateAxis([0, 120, 160])).toEqual({ dtick: 10, range: [110, 175] })
    expect(heartRateAxis([0])).toBeNull()
  })

  it('builds a reversed pace axis that ignores outliers', () => {
    const paces = [...Array.from({ length: 98 }, (_, i) => 270 + i * 0.5), 30, 2000]
    const axis = paceAxis(paces)!
    expect(axis.range[0]).toBeGreaterThan(axis.range[1]) // slow at the bottom
    expect(axis.range[0]).toBeLessThan(400)
    expect(axis.range[1]).toBeGreaterThan(200)
    expect(axis.ticktext).toEqual(axis.tickvals.map(formatClock))
    expect(axis.tickvals.length).toBeGreaterThanOrEqual(2)
    expect(axis.tickvals.every((t) => t % 30 === 0 || t % 20 === 0 || t % 15 === 0)).toBe(true)
    expect(paceAxis([Number.NaN, -1, Infinity])).toBeNull()
  })
})
