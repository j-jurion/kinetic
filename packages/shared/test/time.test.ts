import { describe, expect, it } from 'vitest'
import { formatTimeInput, isValidTime, parseTimeInput } from '../src/time'

describe('race time input', () => {
  it('formats seconds as M:SS or H:MM:SS', () => {
    expect(formatTimeInput(65)).toBe('1:05')
    expect(formatTimeInput(3600)).toBe('1:00:00')
    expect(formatTimeInput(2 * 3600 + 3 * 60 + 4)).toBe('2:03:04')
    expect(formatTimeInput(null)).toBe('')
    expect(formatTimeInput(0)).toBe('')
  })

  it('keeps fractions without floating-point noise', () => {
    expect(formatTimeInput(65.4)).toBe('1:05.4')
    expect(formatTimeInput(65.40000001)).toBe('1:05.4')
    expect(formatTimeInput(65.25)).toBe('1:05.25')
    expect(formatTimeInput(59.999)).toBe('1:00')
  })

  it('accepts M:SS and H:MM:SS with seconds and minutes below 60', () => {
    for (const ok of ['0:59', '12:34', '1:02:03', '100:00', '1:05.4', ' 3:00 ']) expect(isValidTime(ok), ok).toBe(true)
    for (const bad of ['', '5', '1:60', '1:5', '1:60:00', '1:00:60', 'a:bc', '1:00:00:00', '-1:00']) {
      expect(isValidTime(bad), bad).toBe(false)
    }
  })

  it('parses valid times to seconds and rejects the rest', () => {
    expect(parseTimeInput('1:05')).toBe(65)
    expect(parseTimeInput('1:02:03')).toBe(3723)
    expect(parseTimeInput('1:05.5')).toBe(65.5)
    expect(parseTimeInput('90:00')).toBe(5400)
    expect(parseTimeInput('1:75')).toBeNull()
    expect(parseTimeInput('   ')).toBeNull()
  })

  it('round-trips every stored time unchanged', () => {
    for (const seconds of [1, 59, 60, 61.5, 599.99, 3599, 3600, 4242.3, 36000]) {
      expect(parseTimeInput(formatTimeInput(seconds))).toBeCloseTo(seconds, 6)
    }
  })
})
