import { describe, expect, it } from 'vitest'
import { analyseSummary } from '../src/analyse'

describe('analyseSummary', () => {
  it('counts what was analysed and what could not be', () => {
    expect(analyseSummary(5)).toBe('Analysed 5 activities')
    expect(analyseSummary(1, [])).toBe('Analysed 1 activity')
    const failure = { id: 3, name: 'Swim Bike Run', reason: 'its FIT file is damaged and cannot be read' }
    expect(analyseSummary(0, [failure])).toBe('Analysed 0 activities; 1 could not be analysed')
    expect(analyseSummary(2, [failure, { ...failure, id: 4 }])).toBe('Analysed 2 activities; 2 could not be analysed')
  })
})
