// The app's sections and pages, shared by the web and mobile apps. The paths are the routes in
// both: web/src/main.tsx and mobile/src/app/.

/** [label, Material icon name, path] */
export type NavItem = [string, string, string]

export const NAV_SECTIONS: [string, NavItem[]][] = [
  [
    'Home',
    [['Dashboard', 'space_dashboard', '/']],
  ],
  [
    'Log',
    [
      ['Activities', 'list', '/activities'],
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

export const NAV_ITEMS = NAV_SECTIONS.flatMap(([, items]) => items)

/** The title of the page at a path. */
export function pageTitle(path: string): string {
  if (path === '/') return 'Dashboard'
  if (path.startsWith('/activity/')) return 'Activity'
  if (path.startsWith('/best-efforts')) return 'Best Efforts'
  if (path.startsWith('/sync')) return 'Sync'
  const item = NAV_ITEMS.find(([, , to]) => to !== '/' && path.startsWith(to))
  return item ? item[0] : ''
}
