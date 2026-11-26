import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { formatDate, formatDistance, formatDuration, formatPace, sportColor } from '@kinetic/shared/format'
import { RECENT_AREA_MAX_ZOOM, recentArea } from '@kinetic/shared/mapView'
import type { MapRoute } from '@kinetic/shared/types'
import { baseMap } from './RouteMap'
import '../styles/map.css'

// Routes are drawn as non-interactive polylines; hit-testing is done by hand so that every
// route under the cursor is found, not just the topmost one.
const TOL = 10
// A route smaller than this on screen becomes a pin, so routes far from home stay findable when
// zoomed out; nearby pins are grouped into a bubble with their count.
const PIN_PX = 12
const MAX_LIST = 15
const CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="kin-chev"><polyline points="9 18 15 12 9 6"></polyline></svg>'
const OPEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>'
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'

function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** The compact stat list shown for a route. */
function statRows(a: MapRoute): [string, string][] {
  const rows: [string, string][] = [['Date', formatDate(a.date)]]
  if (a.distance_meters) rows.push(['Distance', formatDistance(a.distance_meters, a.sport)])
  rows.push(['Duration', formatDuration(a.duration_seconds || 0)])
  if (a.distance_meters && a.duration_seconds) rows.push(['Pace', formatPace(a.distance_meters, a.duration_seconds, a.sport)])
  if (a.elevation_gain_meters) rows.push(['Elevation', `${a.elevation_gain_meters.toFixed(0)} m`])
  if (a.avg_heart_rate) rows.push(['Avg HR', `${a.avg_heart_rate} bpm`])
  return rows
}

interface Item {
  r: MapRoute
  color: string
  line: L.Polyline
  pin: L.Marker
  pinned: boolean
  pts: L.Point[]
  bb: [number, number, number, number]
}

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    html: `<div class="kin-pin" style="background:${esc(color)}"></div>`,
    className: '',
    iconSize: [18, 18],
  })
}

/** A bubble for several pins, in the colour of its most common sport. */
function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const markers = cluster.getAllChildMarkers()
  const counts = new Map<string, number>()
  for (const m of markers) {
    const color = (m.options as { color?: string }).color ?? '#6b7280'
    counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  const color = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  const n = markers.length
  const size = n < 10 ? 26 : n < 100 ? 32 : 38
  return L.divIcon({
    html:
      `<div class="kin-cluster" title="${n} activities · click to zoom in" ` +
      `style="width:${size}px;height:${size}px;background:${esc(color)}">${n}</div>`,
    className: '',
    iconSize: [size, size],
  })
}

/** Every route on one map; hovering lists all routes under the cursor. */
export function ActivitiesMap({ routes }: { routes: MapRoute[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    const container = ref.current
    if (!container) return
    const map = baseMap(container)

    const clusters = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      maxClusterRadius: 35,
      iconCreateFunction: clusterIcon,
    }).addTo(map)

    const items: Item[] = routes.map((r) => {
      const color = sportColor(r.sport, '#6b7280')
      const line = L.polyline(r.coords, { color, weight: 3, opacity: 0.75, interactive: false })
      const mid = r.coords[Math.floor(r.coords.length / 2)]
      // Pins are found by the same hand-made hit-testing as lines, so they let events through
      const pin = L.marker(mid, { icon: pinIcon(color), interactive: false, keyboard: false, color } as L.MarkerOptions)
      return { r, color, line, pin, pinned: false, pts: [], bb: [0, 0, 0, 0] }
    })
    // Open on the area of the latest activity; the button below zooms out to every route
    const area = recentArea(routes)
    if (area.length) {
      map.fitBounds(L.latLngBounds(area), { padding: [20, 20], maxZoom: RECENT_AREA_MAX_ZOOM, animate: false })
      const showAll = new L.Control({ position: 'topleft' })
      showAll.onAdd = () => {
        const bar = L.DomUtil.create('div', 'leaflet-bar')
        const btn = L.DomUtil.create('a', 'kin-show-all', bar)
        btn.href = '#'
        btn.role = 'button'
        btn.title = 'Show all routes'
        btn.setAttribute('aria-label', 'Show all routes')
        btn.innerHTML = '<span class="material-icons" aria-hidden="true">zoom_out_map</span>'
        L.DomEvent.disableClickPropagation(bar)
        L.DomEvent.on(btn, 'click', (ev) => {
          L.DomEvent.preventDefault(ev)
          map.fitBounds(L.latLngBounds(routes.flatMap((r) => r.coords)), { padding: [20, 20] })
        })
        return bar
      }
      showAll.addTo(map)
    }

    const project = () => {
      for (const it of items) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        it.pts = it.r.coords.map((c) => {
          const p = map.latLngToLayerPoint(L.latLng(c[0], c[1]))
          minX = Math.min(minX, p.x)
          minY = Math.min(minY, p.y)
          maxX = Math.max(maxX, p.x)
          maxY = Math.max(maxY, p.y)
          return p
        })
        it.bb = [minX, minY, maxX, maxY]
      }
      // Swap routes between line and pin to match their size at this zoom
      const toPins: L.Marker[] = []
      const fromPins: L.Marker[] = []
      for (const it of items) {
        const pinned = Math.max(it.bb[2] - it.bb[0], it.bb[3] - it.bb[1]) < PIN_PX
        if (pinned === it.pinned && (pinned || map.hasLayer(it.line))) continue
        it.pinned = pinned
        if (pinned) {
          it.line.remove()
          toPins.push(it.pin)
        } else {
          it.line.addTo(map)
          fromPins.push(it.pin)
        }
      }
      if (fromPins.length) clusters.removeLayers(fromPins)
      if (toPins.length) clusters.addLayers(toPins)
    }
    project()
    map.on('zoomend moveend', project)

    const hitsAt = (p: L.Point) =>
      items.filter((it) => {
        if (it.pinned) {
          // Only a pin shown on its own counts; one inside a bubble is reached by zooming in
          if (clusters.getVisibleParent(it.pin) !== it.pin) return false
          return map.latLngToLayerPoint(it.pin.getLatLng()).distanceTo(p) <= TOL
        }
        const bb = it.bb
        if (p.x < bb[0] - TOL || p.x > bb[2] + TOL || p.y < bb[1] - TOL || p.y > bb[3] + TOL) return false
        for (let j = 1; j < it.pts.length; j++) {
          if (L.LineUtil.pointToSegmentDistance(p, it.pts[j - 1], it.pts[j]) <= TOL) return true
        }
        return false
      })

    const panel = L.DomUtil.create('div', 'kin-hover')
    const closeBtn = L.DomUtil.create('button', 'kin-close', panel)
    closeBtn.type = 'button'
    closeBtn.title = 'Close (Esc)'
    closeBtn.innerHTML = CLOSE_ICON
    const body = L.DomUtil.create('div', 'kin-body', panel)
    container.appendChild(panel)
    L.DomEvent.disableClickPropagation(panel)
    L.DomEvent.disableScrollPropagation(panel)

    // Clicking a route pins the card open so the cursor can travel to its links.
    let locked = false
    const setLocked = (value: boolean) => {
      locked = value
      panel.classList.toggle('is-locked', value)
    }

    let highlighted: Item[] = []
    const highlight = (list: Item[]) => {
      highlighted.forEach((it) => {
        it.line.setStyle({ weight: 3, opacity: 0.75 })
        it.pin.getElement()?.classList.remove('is-hl')
      })
      highlighted = list
      highlighted.forEach((it) => {
        it.line.setStyle({ weight: 7, opacity: 1 })
        if (map.hasLayer(it.line)) it.line.bringToFront()
        it.pin.getElement()?.classList.add('is-hl')
      })
    }

    const statsTable = (r: MapRoute) =>
      '<table class="kin-stats">' +
      statRows(r)
        .map(([k, v]) => `<tr><td class="kin-k">${esc(k)}</td><td class="kin-v">${esc(v)}</td></tr>`)
        .join('') +
      '</table>'

    const singleHtml = (it: Item) =>
      `<div class="kin-title">${esc(it.r.name)}</div>` +
      `<div class="kin-sport" style="color:${esc(it.color)}">${esc(it.r.sport)}</div>` +
      statsTable(it.r) +
      `<a class="kin-link" href="/activity/${it.r.id}" data-activity="${it.r.id}">View activity →</a>`

    const listHtml = (list: Item[]) => {
      const shown = list.slice(0, MAX_LIST)
      let html =
        `<div class="kin-head">${list.length} overlapping activities</div>` +
        shown
          .map(
            (it, i) =>
              `<div class="kin-row" data-i="${i}">` +
              `<span class="kin-dot" style="background:${esc(it.color)}"></span>` +
              `<span class="kin-name" title="${esc(it.r.name)}">${esc(it.r.name)}` +
              `<span class="kin-date"> · ${esc(formatDate(it.r.date))}</span></span>` +
              `<button type="button" class="kin-btn kin-expand" title="Show details">${CHEVRON}</button>` +
              `<a class="kin-btn" title="Open activity" href="/activity/${it.r.id}" data-activity="${it.r.id}">${OPEN_ICON}</a>` +
              `</div>` +
              `<div class="kin-detail" data-i="${i}" hidden>${statsTable(it.r)}</div>`,
          )
          .join('')
      if (list.length > shown.length) {
        html += `<div class="kin-more">+${list.length - shown.length} more · zoom in to narrow down</div>`
      }
      return html
    }

    let current: Item[] = []
    const sameAs = (list: Item[]) => list.length === current.length && list.every((it, i) => it === current[i])

    const show = (list: Item[], at: L.Point) => {
      if (!sameAs(list)) {
        current = list
        body.innerHTML = list.length === 1 ? singleHtml(list[0]) : listHtml(list)
        highlight(list)
      }
      panel.style.display = 'block'
      const box = container.getBoundingClientRect()
      const x = Math.min(at.x + 14, box.width - panel.offsetWidth - 8)
      const y = Math.min(at.y + 14, box.height - panel.offsetHeight - 8)
      panel.style.left = `${Math.max(8, x)}px`
      panel.style.top = `${Math.max(8, y)}px`
    }

    const hide = () => {
      setLocked(false)
      panel.style.display = 'none'
      body.innerHTML = ''
      current = []
      highlight([])
    }

    let hideTimer: number | undefined
    const scheduleHide = () => {
      if (locked) return
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(hide, 250)
    }
    const cancelHide = () => window.clearTimeout(hideTimer)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const list = hitsAt(e.layerPoint)
      if (list.length) {
        cancelHide()
        setLocked(true)
        show(list, e.containerPoint)
      } else if (locked) {
        hide()
      }
    })
    closeBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      hide()
    })
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && locked) hide()
    }
    document.addEventListener('keydown', onKey)

    panel.addEventListener('mouseenter', cancelHide)
    panel.addEventListener('mouseleave', scheduleHide)
    panel.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement
      const link = target.closest<HTMLAnchorElement>('a[data-activity]')
      if (link && !(ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
        ev.preventDefault()
        navigateRef.current(`/activity/${link.dataset.activity}`)
        return
      }
      const btn = target.closest('.kin-expand')
      if (!btn) return
      ev.preventDefault()
      const row = btn.closest<HTMLElement>('.kin-row')!
      const detail = panel.querySelector(`.kin-detail[data-i="${row.dataset.i}"]`)!
      const open = detail.hasAttribute('hidden')
      if (open) detail.removeAttribute('hidden')
      else detail.setAttribute('hidden', '')
      row.classList.toggle('is-open', open)
      ;(btn as HTMLElement).title = open ? 'Hide details' : 'Show details'
    })

    let throttled = false
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (locked || panel.contains(e.originalEvent.target as Node) || throttled) return
      throttled = true
      window.setTimeout(() => (throttled = false), 40)
      const list = hitsAt(e.layerPoint)
      container.style.cursor = list.length ? 'pointer' : ''
      if (list.length) {
        cancelHide()
        show(list, e.containerPoint)
      } else if (current.length) {
        scheduleHide()
      }
    })
    map.on('mouseout', scheduleHide)
    // Bubbles keep their mouse events to themselves, so the map would not notice the cursor leaving a route
    clusters.on('mouseover', scheduleHide)
    map.on('movestart zoomstart', () => {
      if (!locked) hide()
    })

    return () => {
      window.clearTimeout(hideTimer)
      document.removeEventListener('keydown', onKey)
      map.remove()
      panel.remove()
    }
  }, [routes])

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Map of all activities; the activities are also listed on the Activities page"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  )
}
