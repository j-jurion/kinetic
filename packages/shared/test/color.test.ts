import { describe, expect, it } from 'vitest'
import { MIN_TEXT_CONTRAST, contrastRatio, readableColor } from '../src/color'
import { SPORT_COLORS } from '../src/format'

describe('colour contrast', () => {
  it('matches the WCAG formula', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#fff', '#ffffff')).toBe(1)
    expect(contrastRatio('#f97316', '#ffffff')).toBeCloseTo(2.8, 1)
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('red', '#ffffff')).toBe(1) // not a hex colour
  })

  it('keeps readable colours and darkens the rest just enough on light backgrounds', () => {
    expect(readableColor('#111827', '#ffffff')).toBe('#111827')
    const orange = readableColor('#f97316', '#ffffff')
    expect(orange).not.toBe('#f97316')
    expect(contrastRatio(orange, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    expect(contrastRatio(orange, '#ffffff')).toBeLessThan(6) // not darkened more than needed
  })

  it('lightens on dark backgrounds', () => {
    const blue = readableColor('#1d4ed8', '#0f1115')
    expect(contrastRatio(blue, '#0f1115')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    expect(contrastRatio(blue, '#ffffff')).toBeLessThan(contrastRatio('#1d4ed8', '#ffffff'))
  })

  it('makes every sport colour readable on the light page background', () => {
    for (const color of Object.values(SPORT_COLORS)) {
      expect(contrastRatio(readableColor(color, '#f5f6f8'), '#f5f6f8')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })

  it('leaves colours it cannot parse alone', () => {
    expect(readableColor('var(--primary)', '#ffffff')).toBe('var(--primary)')
    expect(readableColor('#abc', '#fff')).not.toBe('#abc')
  })
})
