import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Tooltip } from '@mui/material'
import { GOLD, filteredUrl } from '@kinetic/shared/format'
import { Icon, SportIcon } from './icons'

/** "Best Efforts" back button, sport icon and title shown above ranking pages. */
export function RankingToolbar({
  sport,
  year,
  title,
  children,
}: {
  sport: string
  year: number | null
  title: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="row items-center justify-between w-full q-mb-md flex-wrap gap-3">
      <div className="row items-center gap-2">
        <Button
          size="small"
          startIcon={<Icon name="arrow_back" size={18} />}
          sx={{ textTransform: 'none' }}
          onClick={() => navigate(filteredUrl('/best-efforts', sport, year))}
        >
          Best Efforts
        </Button>
        <SportIcon sport={sport} color="var(--grey-7)" />
        <div className="text-h5 text-weight-bold">{title}</div>
      </div>
      <div className="row gap-2">{children}</div>
    </div>
  )
}

/** A date that gets a gold medal when it is the best result of its year. */
export function YearBestDate({ date, year, best }: { date: string; year: number; best: boolean }) {
  return (
    <span className="row items-center no-wrap gap-0" style={{ display: 'inline-flex' }}>
      {date}
      {best && (
        <Tooltip title={`Best of ${year}`}>
          <span style={{ display: 'inline-flex', marginLeft: 4 }}>
            <Icon name="military_tech" size={16} color={GOLD} />
          </span>
        </Tooltip>
      )}
    </span>
  )
}
