import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Badge, IconButton, ListItemIcon, Menu, MenuItem, Tooltip } from '@mui/material'
import { NAV_SECTIONS, pageTitle } from '@kinetic/shared/navigation'
import { api } from '../lib/api'
import { useIncomingFriendRequests } from '../lib/friendRequests'
import { jobStatuses, useBackgroundJobs } from '../lib/backgroundJobs'
import { useDarkMode } from '../theme'
import { DeleteAccountDialog } from './DeleteAccountDialog'
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
  const [accountMenu, setAccountMenu] = useState<HTMLElement | null>(null)
  const [deleting, setDeleting] = useState(false)
  const title = pageTitle(location.pathname)
  const friendRequests = useIncomingFriendRequests()
  const syncing = jobStatuses(useBackgroundJobs()).some((s) => s.state === 'running')
  const requestsLabel = `${friendRequests} friend ${friendRequests === 1 ? 'request' : 'requests'} waiting`

  useEffect(() => setDrawerOpen(false), [location.pathname])
  // Escape closes the navigation drawer on small screens
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])
  useEffect(() => {
    document.title = title ? `${title} · Kinetic` : 'Kinetic'
  }, [title])

  const signOut = async () => {
    setAccountMenu(null)
    try {
      await api.post('/auth/logout')
      navigate('/login')
    } catch {
      notify('Sign out failed', 'error')
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="row items-center no-wrap gap-3">
          <IconButton
            className="menu-button"
            size="small"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={drawerOpen}
            aria-controls="app-navigation"
          >
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
          <Tooltip title="Account">
            <IconButton
              size="small"
              color="inherit"
              aria-label="Account"
              aria-haspopup="menu"
              aria-expanded={Boolean(accountMenu)}
              onClick={(e) => setAccountMenu(e.currentTarget)}
            >
              <Icon name="account_circle" size={22} />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={accountMenu}
            open={Boolean(accountMenu)}
            onClose={() => setAccountMenu(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem onClick={signOut}>
              <ListItemIcon>
                <Icon name="logout" size={20} />
              </ListItemIcon>
              Sign out
            </MenuItem>
            <MenuItem
              onClick={() => {
                setAccountMenu(null)
                setDeleting(true)
              }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>
                <Icon name="delete_forever" size={20} />
              </ListItemIcon>
              Delete account…
            </MenuItem>
          </Menu>
        </div>
      </header>
      <DeleteAccountDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onDeleted={() => window.location.assign('/login')}
      />

      <nav id="app-navigation" className={`app-drawer ${drawerOpen ? 'open' : ''}`} aria-label="Main navigation">
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

      <main id="main" tabIndex={-1} className="app-main">
        <div className="app-content column gap-4">
          <Outlet />
        </div>
      </main>
    </>
  )
}
