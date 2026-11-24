import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Badge, Button, IconButton, Tooltip } from '@mui/material'
import { NAV_SECTIONS, pageTitle } from '@kinetic/shared/navigation'
import { api } from '../lib/api'
import { useIncomingFriendRequests } from '../lib/friendRequests'
import { jobStatuses, useBackgroundJobs } from '../lib/backgroundJobs'
import { useDarkMode } from '../theme'
import { Icon } from './icons'
import { useNotify } from './Notify'
import { SyncStatus } from './SyncStatus'

/** The shared app shell: header, navigation drawer and page content. */
export function Layout() {
  const { dark, toggle } = useDarkMode()
  const location = useLocation()
  const navigate = useNavigate()
  const notify = useNotify()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const title = pageTitle(location.pathname)
  const friendRequests = useIncomingFriendRequests()
  const syncing = jobStatuses(useBackgroundJobs()).some((s) => s.state === 'running')
  const requestsLabel = `${friendRequests} friend ${friendRequests === 1 ? 'request' : 'requests'} waiting`

  useEffect(() => setDrawerOpen(false), [location.pathname])
  useEffect(() => {
    document.title = title ? `${title} · Kinetic` : 'Kinetic'
  }, [title])

  const signOut = async () => {
    try {
      await api.post('/auth/logout')
      navigate('/login')
    } catch {
      notify('Sign out failed', 'error')
    }
  }

  return (
    <>
      <header className="app-header">
        <div className="row items-center no-wrap gap-3">
          <IconButton className="menu-button" size="small" onClick={() => setDrawerOpen((o) => !o)} aria-label="Menu">
            <Badge color="primary" variant="dot" invisible={friendRequests === 0}>
              <Icon name="menu" />
            </Badge>
          </IconButton>
          <NavLink to="/" className="brand" aria-label="Kinetic home">
            <span className="brand-mark">
              <Icon name="bolt" size={22} />
            </span>
            <span className="brand-name">Kinetic</span>
          </NavLink>
          {title && (
            <>
              <Icon name="chevron_right" size={18} className="text-grey-5 header-crumb-sep" />
              <span className="header-crumb">{title}</span>
            </>
          )}
        </div>
        <div className="row items-center no-wrap gap-2">
          <SyncStatus />
          {friendRequests > 0 && (
            <Tooltip title={requestsLabel}>
              <IconButton size="small" color="inherit" aria-label={requestsLabel} onClick={() => navigate('/friends')}>
                <Badge color="primary" badgeContent={friendRequests} max={9}>
                  <Icon name="person_add" size={20} />
                </Badge>
              </IconButton>
            </Tooltip>
          )}
          <IconButton size="small" onClick={toggle} aria-label={dark ? 'Light mode' : 'Dark mode'} color="inherit">
            <Icon name={dark ? 'light_mode' : 'dark_mode'} size={20} />
          </IconButton>
          <Button color="inherit" size="small" startIcon={<Icon name="logout" size={18} />} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <nav className={`app-drawer ${drawerOpen ? 'open' : ''}`} aria-label="Main navigation">
        {NAV_SECTIONS.map(([section, items]) => (
          <div key={section}>
            <div className="nav-section-label">{section}</div>
            {items.map(([label, icon, to]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => {
                  const active =
                    isActive || (to === '/activities' && location.pathname.startsWith('/activity/'))
                  return `nav-item ${active ? 'active' : ''}`
                }}
              >
                <Icon name={icon} />
                <span>{label}</span>
                {to === '/friends' && friendRequests > 0 && (
                  <span className="nav-badge" aria-label={requestsLabel}>
                    {friendRequests}
                  </span>
                )}
                {to === '/sync' && syncing && <span className="nav-sync-dot" aria-label="Syncing" />}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className={`drawer-backdrop ${drawerOpen ? 'open' : ''}`} onClick={() => setDrawerOpen(false)} />

      <main className="app-main">
        <div className="app-content column gap-4">
          <Outlet />
        </div>
      </main>
    </>
  )
}
