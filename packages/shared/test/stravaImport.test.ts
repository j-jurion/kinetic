import { describe, expect, it } from 'vitest'
import {
  csvInfoFor,
  fileName,
  isActivitiesCsv,
  isActivityFile,
  parseCsv,
  readActivitiesCsv,
  runImports,
  type ImportFileResult,
  type ImportProgress,
} from '../src/stravaImport'

describe('activities.csv', () => {
  it('parses quoted fields with commas, quotes and newlines', () => {
    const text = 'a,b,c\r\n1,"two, three","say ""hi""\nthere"\n,,\nlast'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'two, three', 'say "hi"\nthere'],
      ['', '', ''],
      ['last'],
    ])
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('x\n')).toEqual([['x']])
  })

  it('maps file names to title, type and description', () => {
    const csv = readActivitiesCsv(
      '﻿Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Filename,Distance\n' +
        '1,"Jan 1, 2026",Morning Run,Run,"Easy, with friends",1800,5.0,activities/1.fit.gz,5000\n' +
        '2,"Jan 2, 2026",  ,Ride,,3600,20,Activities/2.GPX,20000\n' +
        '3,"Jan 3, 2026",Manual,Workout,,600,0,,0\n',
    )
    expect([...csv.keys()]).toEqual(['activities/1.fit.gz', 'activities/2.gpx'])
    expect(csv.get('activities/1.fit.gz')).toEqual({ title: 'Morning Run', type: 'Run', description: 'Easy, with friends' })
    expect(csv.get('activities/2.gpx')).toEqual({ title: undefined, type: 'Ride', description: undefined })
    expect(readActivitiesCsv('Name,Type\nx,y').size).toBe(0) // no Filename column
    expect(readActivitiesCsv('').size).toBe(0)
  })

  it('finds the CSV details when the export sits in a folder of the zip', () => {
    const csv = readActivitiesCsv('Filename,Activity Name\nactivities/1.fit.gz,Run')
    expect(csvInfoFor(csv, 'export_123/Activities/1.FIT.gz')).toEqual({ title: 'Run', type: undefined, description: undefined })
    expect(csvInfoFor(csv, 'activities/2.fit')).toBeUndefined()
  })

  it('recognises activity files and the CSV', () => {
    expect(['a/1.fit', 'a/1.FIT.GZ', 'a/1.gpx.gz', 'a/1.tcx'].every(isActivityFile)).toBe(true)
    expect(['a/1.fit.zip', 'a/1.json', '__MACOSX/a/1.fit', 'a/1.fitx'].some(isActivityFile)).toBe(false)
    expect(isActivitiesCsv('export/activities.csv')).toBe(true)
    expect(isActivitiesCsv('export/my_activities.csv')).toBe(false)
    expect(fileName('a/b/c.fit')).toBe('c.fit')
  })
})

describe('running the uploads', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `${i}.fit`, title: i === 2 ? 'Third' : undefined }))

  it('counts imported, skipped and failed files without stopping', async () => {
    const progress: ImportProgress[] = []
    const summary = await runImports(items(5), {
      send: async (item): Promise<ImportFileResult> => {
        if (item.name === '2.fit') throw new Error('Corrupt gzip file')
        return { status: item.name === '4.fit' ? 'skipped' : 'imported' }
      },
      onProgress: (p) => progress.push(p),
    })
    expect(summary).toEqual({ found: 5, imported: 3, skipped: 1, errors: ['Third: Corrupt gzip file'] })
    expect(progress[0].fraction).toBe(0)
    expect(progress.at(-1)).toEqual({ fraction: 1, message: 'Done' })
    expect(progress.map((p) => p.fraction)).toEqual([...progress.map((p) => p.fraction)].sort((a, b) => a - b))
  })

  it('runs at most `parallel` uploads at a time', async () => {
    let running = 0
    let peak = 0
    await runImports(items(7), {
      parallel: 3,
      onProgress: () => {},
      send: async () => {
        peak = Math.max(peak, ++running)
        await new Promise((r) => setTimeout(r, 1))
        running--
        return { status: 'imported' }
      },
    })
    expect(peak).toBe(3)
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    let sent = 0
    const run = runImports(items(10), {
      parallel: 1,
      signal: controller.signal,
      onProgress: () => {},
      send: async () => {
        if (++sent === 2) controller.abort()
        return { status: 'imported' }
      },
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(sent).toBe(2)
  })

  it('finishes at once with nothing to send', async () => {
    const progress: ImportProgress[] = []
    const summary = await runImports([], { send: async () => ({ status: 'imported' }), onProgress: (p) => progress.push(p) })
    expect(summary).toEqual({ found: 0, imported: 0, skipped: 0, errors: [] })
    expect(progress.map((p) => p.fraction)).toEqual([1, 1])
  })
})
