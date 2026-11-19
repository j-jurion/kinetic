import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { Data, Layout } from 'plotly.js-dist-min'
import { useDarkMode } from '../theme'

interface PlotProps {
  data: Data[]
  layout: Partial<Layout>
  style?: CSSProperties
}

/** A Plotly chart, like ui.plotly(); follows the light/dark theme. */
export function Plot({ data, layout, style }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { dark } = useDarkMode()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fontColor = dark ? '#e5e7eb' : '#444'
    const gridColor = dark ? 'rgba(255,255,255,0.12)' : '#eee'
    // Theme every axis, including extra ones such as yaxis2 in stacked or dual-axis charts
    const axes: Record<string, object> = { xaxis: {}, yaxis: {} }
    for (const [key, value] of Object.entries(layout)) {
      if (/^[xy]axis\d*$/.test(key)) axes[key] = value as object
    }
    const themedAxes = Object.fromEntries(
      Object.entries(axes).map(([key, value]) => [key, { gridcolor: gridColor, ...value }]),
    )
    Plotly.react(
      el,
      data,
      {
        plot_bgcolor: 'rgba(0,0,0,0)',
        paper_bgcolor: 'rgba(0,0,0,0)',
        ...layout,
        ...themedAxes,
        font: { family: 'Inter, sans-serif', color: fontColor, ...(layout.font ?? {}) },
        autosize: true,
      },
      // No "share chart" button: it would upload the chart's data to Plotly's cloud service
      { responsive: true, displaylogo: false, showSendToCloud: false },
    )
  }, [data, layout, dark])

  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) Plotly.purge(el)
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
