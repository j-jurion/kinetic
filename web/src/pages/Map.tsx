import { useEffect, useRef, useState } from 'react'
import { Button } from '@mui/material'
import { api, qs } from '../lib/api'
import { sportColor, sportLabel } from '@kinetic/shared/format'
import type { MapData } from '@kinetic/shared/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ActivitiesMap } from '../components/ActivitiesMap'
import { FilterChip } from '../components/FilterChip'
import { Icon, SportIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/PageLoading'

export function MapPage() {
  const [available, setAvailable] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [data, setData] = useState<MapData | null>(null)
  const latest = useLatestRequest()
  const lastData = useRef<MapData | null>(null)

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

  if (!available) return <PageLoading />
  // The last routes loaded; selecting no sports clears data but keeps the map on screen
  const shown = data ?? lastData.current
  if (data) lastData.current = data

  let summary = 'No activity types selected.'
  if (selected.length && data) {
    const parts = [`${data.counts.drawn} of ${data.counts.total} activities drawn`]
    if (data.counts.without_gps) parts.push(`${data.counts.without_gps} have no GPS data`)
    parts.push('hover a route for its stats; overlapping routes are listed together')
    summary = parts.join(' · ')
  }

  return (
    <>
      <PageHeader icon="map" kicker="Where you've been" title="Map" subtitle="Every route you've recorded, coloured by sport." />

      <div className="card w-full map-toolbar">
        <span className="card-label">Sports</span>
        <div className="row items-center gap-2 flex-wrap flex-1">
        {available.map((sport) => {
          const color = sportColor(sport, '#6b7280')
          const on = selected.includes(sport)
          return (
            <FilterChip
              key={sport}
              label={sportLabel(sport)}
              on={on}
              color={color}
              icon={<SportIcon sport={sport} size={16} color={color} />}
              title={on ? `Hide ${sportLabel(sport)} routes` : `Show ${sportLabel(sport)} routes`}
              onClick={() => toggle(sport)}
            />
          )
        })}
        </div>
        <div className="row items-center no-wrap gap-1">
          <Button size="small" onClick={() => select(available)}>
            All
          </Button>
          <Button size="small" color="inherit" onClick={() => select([])}>
            None
          </Button>
        </div>
      </div>

      <div className="card w-full" style={{ padding: 0, height: '70vh', minHeight: 420, overflow: 'hidden', position: 'relative' }}>
        {!available.length ? (
          <div className="text-grey-6 text-center w-full q-pa-xl">No activities with GPS data yet.</div>
        ) : (
          // The map stays mounted while the filter changes, so it keeps its place
          shown && <ActivitiesMap routes={selected.length ? shown.routes : []} />
        )}
        {available.length > 0 && !selected.length && (
          <div className="map-empty-note">Select at least one activity type to show routes.</div>
        )}
      </div>
      <div className="row items-center no-wrap gap-1 text-caption text-grey-6" style={{ marginTop: -8 }}>
        <Icon name="info_outline" size={15} />
        <span>{summary}</span>
      </div>
    </>
  )
}
