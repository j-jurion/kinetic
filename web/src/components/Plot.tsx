import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { Data, Layout, PlotHoverEvent, PlotlyHTMLElement } from 'plotly.js-dist-min'
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

const LIGHT = {
  text: '#111827',
  muted: '#6b7280',
  grid: '#eef0f3',
  zeroline: '#d1d5db',
  tooltip: '#ffffff',
  tooltipBorder: '#e5e7eb',
  surface: '#ffffff',
}
const DARK = {
  text: '#f3f4f6',
  muted: '#9ca3af',
  grid: 'rgba(255,255,255,0.07)',
  zeroline: 'rgba(255,255,255,0.2)',
  tooltip: '#1d2129',
  tooltipBorder: 'rgba(255,255,255,0.12)',
  surface: '#171a21',
}

/**
 * Bars without outlines, so the rounded corners stay clean, and pie slices split by a thin
 * line in the card colour. An explicit outline is kept.
 */
function modernTrace(trace: Data, surface: string): Data {
  if (trace.type !== 'bar' && trace.type !== 'pie') return trace
  const marker = (trace.marker ?? {}) as { line?: { width?: number } }
  if (marker.line?.width) return trace
  const line = trace.type === 'bar' ? { width: 0 } : { color: surface, width: 2 }
  return { ...trace, marker: { ...marker, line: { ...marker.line, ...line } } } as Data
}

/** A Plotly chart, like ui.plotly(); follows the light/dark theme. */
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
    const theme = dark ? DARK : LIGHT
    // Theme every axis, including extra ones such as yaxis2 in stacked or dual-axis charts
    const axes: Record<string, object> = { xaxis: {}, yaxis: {} }
    for (const [key, value] of Object.entries(layout)) {
      if (/^[xy]axis\d*$/.test(key)) axes[key] = value as object
    }
    const themedAxes = Object.fromEntries(
      Object.entries(axes).map(([key, value]) => [
        key,
        {
          gridcolor: theme.grid,
          zerolinecolor: theme.zeroline,
          linecolor: theme.grid,
          tickfont: { color: theme.muted, size: 11 },
          title: { font: { color: theme.muted, size: 12 } },
          ...value,
        },
      ]),
    )
    // A chart title, left-aligned and bolder, like the card titles around it
    const title =
      typeof layout.title === 'object' && layout.title?.text
        ? { x: 0.01, xanchor: 'left' as const, ...layout.title, font: { size: 15, weight: 600, color: theme.text, ...layout.title.font } }
        : layout.title
    Plotly.react(
      el,
      data.map((trace) => modernTrace(trace, theme.surface)),
      {
        plot_bgcolor: 'rgba(0,0,0,0)',
        paper_bgcolor: 'rgba(0,0,0,0)',
        // Rounded bars with some air between them; stacks are rounded at their ends only
        barcornerradius: 5,
        bargap: 0.3,
        hoverlabel: {
          bgcolor: theme.tooltip,
          bordercolor: theme.tooltipBorder,
          font: { family: 'Inter, sans-serif', size: 12, color: theme.text },
        },
        ...layout,
        ...themedAxes,
        title,
        legend: { font: { size: 11, color: theme.muted }, ...layout.legend },
        font: { family: 'Inter, sans-serif', color: theme.text, ...(layout.font ?? {}) },
        autosize: true,
      },
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

/** An empty chart that says "No data". */
export const noDataLayout = (title?: string): Partial<Layout> => ({
  title: title ? { text: title } : undefined,
  xaxis: { visible: false },
  yaxis: { visible: false },
  annotations: [
    { text: 'No data', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 16 } },
  ],
})
