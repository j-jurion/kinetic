import { describe, expect, it } from 'vitest'
import { traceIds } from '../src/charts/traceIds'

describe('chart trace ids', () => {
  it('are safe inside a CSS selector, whatever the series is called', () => {
    const ids = traceIds(['Fitness (CTL)', 'Form (TSB)', 'Running', 'Trail running', 'Z2 · 60%', 'Ultimate/frisbee'])
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/)
    expect(ids).toEqual(['t-Fitness__CTL_', 't-Form__TSB_', 't-Running', 't-Trail_running', 't-Z2___60_', 't-Ultimate_frisbee'])
  })

  it('follow the name, stay unique and skip unnamed series', () => {
    expect(traceIds(['Running', undefined, 'Running', 'Running '])).toEqual(['t-Running', undefined, 't-Running-1', 't-Running_'])
  })
})
