import { useCallback, useMemo } from 'react'
import { formatDuration } from '@kinetic/shared/format'
import type { HoverBus } from '@kinetic/shared/hoverBus'
import type { Climb } from '@kinetic/shared/types'
import { DataTable } from '../DataTable'
import type { Column } from '../DataTable'
import { indexAtDistance } from '@kinetic/shared/streamIndex'

type Row = Climb & { number: number }

const formatLength = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`)

const COLUMNS: Column<Row>[] = [
  { name: 'number', label: '#', render: (c) => c.number },
  { name: 'start', label: 'Start (km)', align: 'right', sortValue: (c) => c.start_m, render: (c) => (c.start_m / 1000).toFixed(2) },
  { name: 'length', label: 'Length', align: 'right', sortValue: (c) => c.length_m, render: (c) => formatLength(c.length_m) },
  { name: 'gain', label: 'Gain (m)', align: 'right', sortValue: (c) => c.gain_m, render: (c) => Math.round(c.gain_m) },
  { name: 'grade', label: 'Avg grade (%)', align: 'right', sortValue: (c) => c.grade_pct, render: (c) => c.grade_pct.toFixed(1) },
  { name: 'time', label: 'Time', align: 'right', sortValue: (c) => c.seconds, render: (c) => formatDuration(c.seconds) },
  { name: 'vam', label: 'VAM (m/h)', align: 'right', sortValue: (c) => c.vam ?? 0, render: (c) => (c.vam === null ? '–' : Math.round(c.vam)) },
]

interface Props {
  climbs: Climb[]
  /** The stream distances in metres, to find where a climb is on the map. */
  distances: (number | null)[] | undefined
  hoverBus: HoverBus
}

/** The climbs of an activity; hovering one marks its middle on the map. */
export function ClimbsTable({ climbs, distances, hoverBus }: Props) {
  const rows = useMemo(() => climbs.map((c, i) => ({ ...c, number: i + 1 })), [climbs])
  const onRowHover = useCallback(
    (row: Row | null) => {
      if (!row || !distances) return hoverBus.set(null)
      hoverBus.set(indexAtDistance(distances, (row.start_m + row.end_m) / 2))
    },
    [distances, hoverBus],
  )
  if (!rows.length) return null
  return (
    <div className="card w-full gap-2" style={{ padding: '14px 14px 6px' }}>
      <div className="row items-center gap-2" style={{ paddingLeft: 2 }}>
        <span className="card-title">Climbs</span>
        <span className="kind-chip">{rows.length}</span>
      </div>
      <DataTable rows={rows} rowKey={(c) => c.number} columns={COLUMNS} onRowHover={onRowHover} />
    </div>
  )
}
