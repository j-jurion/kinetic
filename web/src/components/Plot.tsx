import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { Data, Layout, PlotHoverEvent, PlotlyHTMLElement } from 'plotly.js-dist-min'
import { noDataLayout, themedChart } from '@kinetic/shared/charts/theme'
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

/** A Plotly chart, like ui.plotly(); follows the light/dark theme (styling shared with mobile). */
export function Plot({ data, layout, style, onHover, onUnhover }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { dark } = useDarkMode()
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
      // No "share chart" button: it would upload the chart's data to Plotly's cloud service
      { responsive: true, displaylogo: false, showSendToCloud: false },
    ).then((plot: PlotlyHTMLElement) => {
      if (bound.current) return
      bound.current = true
      plot.on('plotly_hover', (event) => hover.current.onHover?.(event))
      plot.on('plotly_unhover', () => hover.current.onUnhover?.())
    })
  }, [data, layout, dark])

  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) Plotly.purge(el)
      bound.current = false // purge drops the hover listeners too
    }
  }, [])

  return <div ref={ref} style={{ width: '100%', ...style }} />
}

export { noDataLayout }
