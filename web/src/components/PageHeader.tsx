import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Icon } from './icons'

/**
 * The header at the top of a page: icon badge, kicker, title, subtitle and actions on the right.
 * The best-effort pages have their own trophy hero; races use the teal `race` variant.
 */
export function PageHeader({
  icon,
  title,
  kicker,
  subtitle,
  variant = 'default',
  children,
}: {
  icon: string
  title: string
  kicker?: string
  subtitle?: ReactNode
  variant?: 'default' | 'race'
  /** Filters and buttons shown on the right. */
  children?: ReactNode
}) {
  return (
    <header className={`page-header ${variant === 'race' ? 'page-header--race' : ''}`}>
      <div className="page-header-main">
        <div className="page-header-icon">
          <Icon name={icon} size={26} />
        </div>
        <div className="column gap-0 min-w-0">
          {kicker && <div className="page-header-kicker">{kicker}</div>}
          <h1 className="page-header-title">{title}</h1>
          {subtitle && <div className="page-header-subtitle">{subtitle}</div>}
        </div>
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  )
}

/** A heading between sections of a page: icon, title and a rule filling the rest of the line. */
/** A section title with a rule after it; ``more`` adds a link at the end ([label, path]). */
export function SectionHeading({ icon, more, children }: { icon: string; more?: [string, string]; children: ReactNode }) {
  return (
    <div className="section-heading">
      <span className="section-heading-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="section-heading-title">{children}</span>
      <span className="section-heading-line" />
      {more && (
        <Link to={more[1]} className="dashboard-more">
          {more[0]} <Icon name="chevron_right" size={16} />
        </Link>
      )}
    </div>
  )
}
