import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CSSProperties } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { Data, Layout, PlotHoverEvent, PlotlyHTMLElement } from 'plotly.js-dist-min'
import { noDataLayout, themedChart } from '@kinetic/shared/charts/theme'
import { pointLink } from '@kinetic/shared/chartLinks'
import type { ClickedPoint } from '@kinetic/shared/chartLinks'
import { useDarkMode } from '../theme'

interface PlotProps {
  data: Data[]
  layout: Partial<Layout>
  style?: CSSProperties
  /** Called while the pointer moves over the chart's data. */
  onHover?: (event: PlotHoverEvent) => void
  /** Called when the pointer leaves the chart's data. */
  onUnhover?: () => void
}

/**
 * A Plotly chart, like ui.plotly(); follows the light/dark theme (styling shared with mobile).
 * A point with a link (see chartLinks) opens it when clicked.
 */
export function Plot({ data, layout, style, onHover, onUnhover }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { dark } = useDarkMode()
  const navigate = useNavigate()
  const open = useRef(navigate)
  useEffect(() => {
    open.current = navigate
  })
  // Keep the latest callbacks without rebinding Plotly's listeners on every render
  const hover = useRef({ onHover, onUnhover })
  useEffect(() => {
    hover.current = { onHover, onUnhover }
  })
  const bound = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const themed = themedChart({ data, layout }, dark)
    Plotly.react(
      el,
      themed.data,
      themed.layout,
      // Static charts: no toolbar, scroll or double-click zoom (the layout locks the axes too)
      { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: false, doubleClick: false },
    ).then((plot: PlotlyHTMLElement) => {
      if (bound.current) return
      bound.current = true
      plot.on('plotly_hover', (event) => {
        // A pointer over points that open something
        plot.classList.toggle('plot-linked', !!pointLink(event.points[0] as ClickedPoint))
        hover.current.onHover?.(event)
      })
      plot.on('plotly_unhover', () => {
        plot.classList.remove('plot-linked')
        hover.current.onUnhover?.()
      })
      plot.on('plotly_click', (event) => {
        const link = pointLink(event.points[0] as ClickedPoint)
        if (link) open.current(link)
      })
    })
  }, [data, layout, dark])

  useEffect(() => {
    const el = ref.current
    return () => {
      // Removing a chart must never take the page down with it
      try {
        if (el) Plotly.purge(el)
      } catch (error) {
        console.error('Removing a chart failed', error)
      }
      bound.current = false // purge drops the hover listeners too
    }
  }, [])

  // Plotly draws an SVG screen readers cannot follow: name the chart after its title instead
  return <div ref={ref} role="img" aria-label={chartLabel(layout)} style={{ width: '100%', ...style }} />
}

/** The chart's title as plain text (Plotly titles may hold <b>, <br> and the like). */
function chartLabel(layout: Partial<Layout>): string {
  const title = typeof layout.title === 'string' ? layout.title : layout.title?.text
  const text = (title ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return text ? `Chart: ${text}` : 'Chart'

}

export { noDataLayout }
