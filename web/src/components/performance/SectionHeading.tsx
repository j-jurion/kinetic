import type { ReactNode } from 'react'
import { Icon } from '../icons'

/** A section heading in the trophy-case style: icon, title and a short explanation. */
export function SectionHeading({ icon, title, caption, children }: {
  icon: string
  title: string
  caption?: ReactNode
  /** Controls shown on the right, e.g. a toggle. */
  children?: ReactNode
}) {
  return (
    <div className="row items-center justify-between w-full gap-3 perf-section-heading">
      <div className="column gap-0 min-w-0">
        <div className="row items-center no-wrap gap-2">
          <Icon name={icon} size={20} className="trophy-category-icon" />
          <span className="text-subtitle1 text-weight-bold">{title}</span>
        </div>
        {caption && <span className="text-caption trophy-date">{caption}</span>}
      </div>
      {children && <div className="row items-center gap-2">{children}</div>}
    </div>
  )
}
