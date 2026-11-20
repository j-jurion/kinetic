import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button, IconButton } from '@mui/material'
import { api } from '../lib/api'
import { useDarkMode } from '../theme'
import { Icon } from './icons'
import { useNotify } from './Notify'

const NAV_SECTIONS: [string, [string, string, string][]][] = [
  [
    'Log',
    [
      ['Activities', 'list', '/'],
      ['Races', 'flag', '/races'],
      ['Map', 'map', '/map'],
    ],
  ],
  [
    'Insights',
    [
      ['Graphs', 'bar_chart', '/graphs'],
      ['Training', 'monitor_heart', '/training'],
      ['Best Efforts', 'emoji_events', '/best-efforts'],
    ],
  ],
  [
    'Account',
    [
      ['Friends', 'people', '/friends'],
      ['Sync', 'sync', '/sync'],
    ],
  ],
]
const NAV_ITEMS = NAV_SECTIONS.flatMap(([, items]) => items)

function pageTitle(path: string): string {
  if (path === '/') return 'Activities'
  if (path.startsWith('/activity/')) return 'Activity'
  if (path.startsWith('/best-efforts')) return 'Best Efforts'
  if (path.startsWith('/sync')) return 'Garmin Sync'
  const item = NAV_ITEMS.find(([, , to]) => to !== '/' && path.startsWith(to))
  return item ? item[0] : ''
}

/** The shared app shell: header, navigation drawer and page content. */
export function Layout() {
  const { dark, toggle } = useDarkMode()
  const location = useLocation()
  const navigate = useNavigate()
  const notify = useNotify()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const title = pageTitle(location.pathname)

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
            <Icon name="menu" />
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
                    isActive || (to === '/' && location.pathname.startsWith('/activity/'))
                  return `nav-item ${active ? 'active' : ''}`
                }}
              >
                <Icon name={icon} />
                <span>{label}</span>
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
