import type { ReactNode } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'

/** A chart card with an optional row of controls above the chart and a caption below it. */
export function ChartCard({ controls, caption, children }: { controls?: ReactNode; caption?: ReactNode; children: ReactNode }) {
  return (
    <div className="card w-full q-pa-sm gap-0">
      {controls && <div className="row items-center justify-end w-full gap-2 q-pa-xs">{controls}</div>}
      {children}
      {caption && <div className="text-caption text-grey-6" style={{ padding: '0 8px 4px' }}>{caption}</div>}
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
