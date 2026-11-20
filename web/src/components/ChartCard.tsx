import type { ReactNode } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'

/** A chart card with an optional row of controls above the chart and a caption below it. */
export function ChartCard({ controls, caption, children }: { controls?: ReactNode; caption?: ReactNode; children: ReactNode }) {
  return (
    <div className="card w-full chart-card">
      {controls && <div className="chart-card-controls">{controls}</div>}
      {children}
      {caption && <div className="chart-card-caption">{caption}</div>}
    </div>
  )
}

/** A small group of exclusive toggle buttons. */
export function Toggle<T extends string>({ value, options, onChange, label }: {
  value: T
  options: [T, string][]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      color="primary"
      value={value}
      aria-label={label}
      onChange={(_, next: T | null) => next && onChange(next)}
    >
      {options.map(([key, text]) => (
        <ToggleButton key={key} value={key} sx={{ px: 1.5, py: 0.25 }}>
          {text}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
