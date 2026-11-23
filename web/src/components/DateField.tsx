import { useRef } from 'react'
import { IconButton, InputAdornment, TextField } from '@mui/material'
import { formatDate, parseDateInput } from '@kinetic/shared/format'
import { Icon } from './icons'

/** A dd-mm-yyyy text field with a calendar picker. */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const iso = parseDateInput(value)?.slice(0, 10) ?? ''
  return (
    <TextField
      label={label}
      value={value}
      variant="outlined"
      size="small"
      onChange={(e) => onChange(e.target.value)}
      sx={{ flex: '1 1 220px', minWidth: 0 }}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => picker.current?.showPicker?.()} aria-label="Pick a date">
                <Icon name="edit_calendar" size={20} />
              </IconButton>
              <input
                ref={picker}
                type="date"
                value={iso}
                tabIndex={-1}
                aria-hidden
                onChange={(e) => e.target.value && onChange(formatDate(e.target.value))}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none', right: 0, bottom: 0 }}
              />
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
