import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { IconButton } from '@mui/material'
import { Icon } from './icons'

export interface Column<T> {
  name: string
  label: string
  align?: 'left' | 'right' | 'center'
  /** Value used for sorting; the column is sortable when this is given. */
  sortValue?: (row: T) => number | string
  render: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  pageSize?: number
  bordered?: boolean
  className?: string
}

/** A dense table with optional sorting, pagination and row clicks, like ui.table(). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  pageSize,
  bordered,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ name: string; desc: boolean } | null>(null)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.name === sort.name)
    if (!column?.sortValue) return rows
    const get = column.sortValue
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      const order = x < y ? -1 : x > y ? 1 : 0
      return sort!.desc ? -order : order
    })
  }, [rows, columns, sort])

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const current = Math.min(page, pageCount - 1)
  const visible = pageSize ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted

  // Quasar cycles a sortable column through ascending, descending and unsorted
  const toggleSort = (name: string) => {
    setSort((s) => (s?.name !== name ? { name, desc: false } : !s.desc ? { name, desc: true } : null))
  }

  const classes = ['data-table', bordered ? 'bordered' : '', onRowClick ? 'clickable-rows' : '', className ?? '']
  return (
    <div className={classes.join(' ')}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => {
              const sorted = sort?.name === c.name
              return (
                <th
                  key={c.name}
                  className={`${c.sortValue ? 'sortable' : ''} ${sorted ? 'sorted' : ''} align-${c.align ?? 'left'}`}
                  onClick={c.sortValue ? () => toggleSort(c.name) : undefined}
                >
                  {c.align === 'right' && c.sortValue && (
                    <Icon name={sorted && sort?.desc ? 'arrow_downward' : 'arrow_upward'} className="sort-icon" />
                  )}
                  {c.label}
                  {c.align !== 'right' && c.sortValue && (
                    <Icon name={sorted && sort?.desc ? 'arrow_downward' : 'arrow_upward'} className="sort-icon" />
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              // Clickable rows are reachable with Tab and open with Enter or Space
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.name} className={`align-${c.align ?? 'left'}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pageSize && sorted.length > pageSize && (
        <div className="table-footer">
          <span>
            {current * pageSize + 1}-{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <IconButton size="small" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <Icon name="chevron_left" />
          </IconButton>
          <IconButton size="small" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
            <Icon name="chevron_right" />
          </IconButton>
        </div>
      )}
    </div>
  )
}
