import type { CSSProperties, ReactNode } from 'react'
import { InputAdornment, MenuItem, TextField } from '@mui/material'
import { sportFilterOptions, yearOptions } from '@kinetic/shared/format'
import { Icon } from './icons'

interface SelectFieldProps {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
  width?: number | string
  variant?: 'standard' | 'outlined'
  prependIcon?: string
  className?: string
}

/** A labelled dropdown, like ui.select(). */
export function SelectField({
  label,
  value,
  options,
  onChange,
  width = 144,
  variant = 'outlined',
  prependIcon,
  className = 'filter-field',
}: SelectFieldProps) {
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      variant={variant}
      size="small"
      className={className}
      sx={{ width }}
      slotProps={{
        // "All sports" is the empty value; still show it, with the label floated above
        select: {
          displayEmpty: true,
          MenuProps: { slotProps: { paper: { className: className ? `${className}-menu` : undefined } } },
        },
        inputLabel: { shrink: true },
        input: prependIcon
          ? {
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name={prependIcon} size={20} className="field-prepend" />
                </InputAdornment>
              ),
            }
          : undefined,
      }}
    >
      {options.map(([optionValue, optionLabel]) => (
        <MenuItem key={optionValue || '__all'} value={optionValue} dense={variant === 'outlined'}>
          {optionLabel}
        </MenuItem>
      ))}
    </TextField>
  )
}

const ALL_YEARS = 'All years'

export function YearSelect(props: {
  value: number | null
  onChange: (year: number | null) => void
  width?: number
  variant?: 'standard' | 'outlined'
  prependIcon?: string
  className?: string
}) {
  const options: [string, string][] = [
    [ALL_YEARS, ALL_YEARS],
    ...yearOptions().map((y): [string, string] => [String(y), String(y)]),
  ]
  return (
    <SelectField
      label="Year"
      width={props.width ?? 128}
      value={props.value ? String(props.value) : ALL_YEARS}
      options={options}
      onChange={(v) => props.onChange(v === ALL_YEARS ? null : Number(v))}
      variant={props.variant}
      prependIcon={props.prependIcon}
      className={props.className}
    />
  )
}

export function SportSelect(props: {
  value: string
  onChange: (sport: string) => void
  includeAllSports?: boolean
  width?: number
  variant?: 'standard' | 'outlined'
  prependIcon?: string
  className?: string
}) {
  return (
    <SelectField
      label="Sport"
      width={props.width ?? 144}
      value={props.value}
      options={sportFilterOptions(props.includeAllSports ?? true)}
      onChange={props.onChange}
      variant={props.variant}
      prependIcon={props.prependIcon}
      className={props.className}
    />
  )
}

/** Big number with a caption underneath, used in the best-effort summary cards. */
export function StatTile({ label, value, valueClass = 'text-primary' }: { label: string; value: ReactNode; valueClass?: string }) {
  return (
    <div className="column items-center gap-0">
      <div className={`text-h5 text-weight-bold ${valueClass}`}>{value}</div>
      <div className="text-caption text-grey-6">{label}</div>
    </div>
  )
}

/** A labelled number in a soft tile, used in summary rows (wrap several in a `.stat-grid`). */
export function Stat({ label, value, valueClass = '', style }: { label: string; value: ReactNode; valueClass?: string; style?: CSSProperties }) {
  return (
    <div className="stat" style={style}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${valueClass}`}>{value}</div>
    </div>
  )
}

/** A centred message card for empty states. */
export function EmptyCard({ icon, iconClass = '', children }: { icon: string; iconClass?: string; children: ReactNode }) {
  return (
    <div className="card w-full empty-state">
      <span className={`empty-state-icon ${iconClass}`}>
        <Icon name={icon} size={30} />
      </span>
      <div className="text-grey-6">{children}</div>
    </div>
  )
}
