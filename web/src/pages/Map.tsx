import { useEffect, useState } from 'react'
import { Button, Chip } from '@mui/material'
import { api, qs } from '../lib/api'
import { sportColor, sportLabel } from '@kinetic/shared/format'
import type { MapData } from '@kinetic/shared/types'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ActivitiesMap } from '../components/ActivitiesMap'
import { Icon, SportIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/PageLoading'

// Icon colour of a hidden sport's chip
const MUTED = '#9ca3af'

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

  if (!available) return <PageLoading />

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
            // Shown sports are filled in their colour with a check; hidden ones are grey and
            // dashed, so the difference does not rest on colour alone
            <Chip
              key={sport}
              label={sportLabel(sport)}
              size="small"
              variant="outlined"
              aria-pressed={on}
              title={on ? `Hide ${sportLabel(sport)} routes` : `Show ${sportLabel(sport)} routes`}
              icon={on ? <Icon name="check" size={16} color={color} /> : <SportIcon sport={sport} size={16} color={MUTED} />}
              onClick={() => toggle(sport)}
              sx={
                on
                  ? {
                      color,
                      borderColor: color,
                      fontWeight: 600,
                      bgcolor: `${color}26`,
                      '&&:hover': { bgcolor: `${color}40` },
                      '& .MuiChip-icon': { color, ml: '6px' },
                    }
                  : {
                      color: 'text.secondary',
                      borderColor: 'divider',
                      borderStyle: 'dashed',
                      fontWeight: 500,
                      bgcolor: 'transparent',
                      '&&:hover': { bgcolor: 'action.hover', borderColor: color },
                      '& .MuiChip-icon': { ml: '6px', opacity: 0.7 },
                    }
              }
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

      <div className="card w-full" style={{ padding: 0, height: '70vh', minHeight: 420, overflow: 'hidden' }}>
        {!available.length ? (
          <div className="text-grey-6 text-center w-full q-pa-xl">No activities with GPS data yet.</div>
        ) : !selected.length ? (
          <div className="text-grey-6 text-center w-full q-pa-xl">Select at least one activity type to show routes.</div>
        ) : (
          data && <ActivitiesMap routes={data.routes} />
        )}
      </div>
      <div className="row items-center no-wrap gap-1 text-caption text-grey-6" style={{ marginTop: -8 }}>
        <Icon name="info_outline" size={15} />
        <span>{summary}</span>
      </div>
    </>
  )
}
