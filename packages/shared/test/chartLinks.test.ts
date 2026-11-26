import { describe, expect, it } from 'vitest'
import { activityPagePath, activityTotalsPath, parseDayKey, periodActivitiesUrl, periodLabel } from '../src/activityList'
import { activityUrl, dayActivitiesUrl, dayUrl, pointLink, weekUrl, withLinks } from '../src/chartLinks'
import { activitiesByDay, dayActivityNames } from '../src/training'
import { trainingActivity as ta } from './factories'

describe('chart point links', () => {
  it('finds the link of a clicked point, or of a heatmap cell', () => {
    const trace = withLinks({ type: 'scatter', x: [1, 2] }, [activityUrl(7), null])
    expect(pointLink({ data: trace, pointIndex: 0 })).toBe('/activity/7')
    expect(pointLink({ data: trace, pointNumber: 1 })).toBeNull()
    const grid = withLinks({ type: 'heatmap' }, [[null, '/a'], ['/b', null]])
    expect(pointLink({ data: grid, pointIndex: [1, 0] })).toBe('/b')
    expect(pointLink({ data: { meta: 'something else' }, pointIndex: 0 })).toBeNull()
    expect(pointLink(undefined)).toBeNull()
  })

  it('links a day or a week to the activities list', () => {
    expect(dayUrl(new Date(2026, 10, 4))).toBe('/activities?from=2026-11-04&to=2026-11-04')
    // A week runs Monday to Sunday, across the end of a month
    expect(weekUrl(new Date(2026, 10, 30))).toBe('/activities?from=2026-11-30&to=2026-12-06')
    expect(periodActivitiesUrl(new Date(2026, 0, 5), new Date(2026, 0, 11), 'running')).toBe(
      '/activities?from=2026-01-05&to=2026-01-11&sport=running',
    )
  })
})

describe('activity list periods', () => {
  it('reads days from the URL and names the period', () => {
    expect(parseDayKey('2026-11-04')).toBe('2026-11-04')
    expect(parseDayKey('2026-13-45')).toBeNull()
    expect(parseDayKey('yesterday')).toBeNull()
    expect(periodLabel('2026-11-03', '2026-11-09')).toBe('03-11-2026 – 09-11-2026')
    expect(periodLabel('2026-11-04', '2026-11-04')).toBe('04-11-2026')
    expect(periodLabel(null, null)).toBe('')
  })

  it('asks the API for that period', () => {
    const filters = { sport: 'running', since: '2026-11-03', until: '2026-11-09' }
    expect(activityPagePath(filters)).toBe('/activities?sport=running&since=2026-11-03&until=2026-11-09&limit=50')
    expect(activityTotalsPath(filters)).toBe('/activities/totals?sport=running&since=2026-11-03&until=2026-11-09')
  })
})

describe('days with activities', () => {
  it('opens the activity of a day with one, the day list with more', () => {
    const day = new Date(2026, 10, 4)
    expect(dayActivitiesUrl(day, [])).toBeNull()
    expect(dayActivitiesUrl(day, [12])).toBe('/activity/12')
    expect(dayActivitiesUrl(day, [12, 13])).toBe('/activities?from=2026-11-04&to=2026-11-04')
  })

  it('groups the activities per day, leaving multisport legs out', () => {
    const byDay = activitiesByDay([
      ta({ id: 2, name: 'Evening ride', date: '2026-11-04T18:00:00' }),
      ta({ id: 1, name: 'Morning run', date: '2026-11-04T07:00:00' }),
      ta({ id: 3, name: 'Leg', date: '2026-11-04T07:10:00', parent_id: 9 }),
      ta({ id: 4, name: 'Swim', date: '2026-11-05T07:00:00' }),
    ])
    expect(byDay.get('2026-11-04')?.map((a) => a.id)).toEqual([1, 2])
    expect(dayActivityNames(byDay.get('2026-11-04')!)).toBe('Morning run, Evening ride')
    expect(dayActivityNames([{ name: 'A' }, { name: 'B' }, { name: 'C' }])).toBe('A, B +1 more')
  })
})
