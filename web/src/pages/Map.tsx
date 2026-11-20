import { useEffect, useState } from 'react'
import { Button, Chip } from '@mui/material'
import { api, qs } from '../lib/api'
import { sportColor, sportLabel } from '../lib/format'
import type { MapData } from '../lib/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ActivitiesMap } from '../components/ActivitiesMap'
import { Icon, SportIcon } from '../components/icons'

export function MapPage() {
  const [available, setAvailable] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [data, setData] = useState<MapData | null>(null)
  const latest = useLatestRequest()

  // First load: every sport that has GPS data is selected.
  useEffect(() => {
    latest(api.get<MapData>('/map'), (result) => {
      setAvailable(result.available)
      setSelected(result.available)
      setData(result)
    })
  }, [latest])

  const select = (next: string[]) => {
    setSelected(next)
    // Each selection supersedes the previous one, even when nothing needs loading, so a
    // slow response for an earlier selection can never replace the routes shown now.
    latest(next.length ? api.get<MapData>(`/map${qs({ sports: next.join(',') })}`) : Promise.resolve(null), setData)
  }

  const toggle = (sport: string) =>
    select(selected.includes(sport) ? selected.filter((s) => s !== sport) : (available ?? []).filter((s) => s === sport || selected.includes(s)))

  if (!available) return null

  let summary = 'No activity types selected.'
  if (selected.length && data) {
    const parts = [`${data.counts.drawn} of ${data.counts.total} activities drawn`]
    if (data.counts.without_gps) parts.push(`${data.counts.without_gps} have no GPS data`)
    parts.push('hover a route for its stats; overlapping routes are listed together')
    summary = parts.join(' · ')
  }

  return (
    <>
      <div className="row items-center justify-between w-full q-mb-md flex-wrap gap-3">
        <div className="text-h5 text-weight-bold">Map</div>
        <div className="row items-center gap-2 flex-wrap">
          <Button size="small" color="inherit" onClick={() => select(available)}>
            All
          </Button>
          <Button size="small" color="inherit" onClick={() => select([])}>
            None
          </Button>
        </div>
      </div>

      <div className="row items-center gap-2 w-full q-mb-md flex-wrap">
        {available.map((sport) => {
          const color = sportColor(sport, '#6b7280')
          const on = selected.includes(sport)
          return (
            <Chip
              key={sport}
              label={sportLabel(sport)}
              size="small"
              variant="outlined"
              icon={on ? <Icon name="check" size={16} color={color} /> : <SportIcon sport={sport} size={16} color={color} />}
              onClick={() => toggle(sport)}
              sx={{ color, borderColor: color, '& .MuiChip-icon': { color, ml: '6px' } }}
            />
          )
        })}
      </div>

      <div className="card w-full" style={{ padding: 0, height: '70vh', minHeight: 420, overflow: 'hidden' }}>
        {!available.length ? (
          <div className="text-grey-6 text-center w-full q-pa-xl">No activities with GPS data yet.</div>
        ) : !selected.length ? (
          <div className="text-grey-6 text-center w-full q-pa-xl">Select at least one activity type to show routes.</div>
        ) : (
          data && <ActivitiesMap routes={data.routes} />
        )}
      </div>
      <div className="text-caption text-grey-6 q-mt-sm">{summary}</div>
    </>
  )
}
