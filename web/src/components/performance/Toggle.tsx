import { ToggleButton, ToggleButtonGroup } from '@mui/material'

/** A small exclusive toggle, like the ones on the Graphs page. */
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
