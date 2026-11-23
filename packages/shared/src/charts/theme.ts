// Plotly styling shared by the web and mobile apps, so a chart looks the same on both.
import type { Data, Layout } from 'plotly.js-dist-min'

/** A Plotly chart as a [traces, layout] pair, as the chart builders return it. */
export type Chart = [Data[], Partial<Layout>]

/** A Plotly chart: its traces and layout. */
export interface ChartSpec {
  data: Data[]
  layout: Partial<Layout>
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

/** The chart with the app's light or dark styling applied to its traces and layout. */
export function themedChart({ data, layout }: ChartSpec, dark: boolean): ChartSpec {
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
  return {
    data: data.map((trace) => modernTrace(trace, theme.surface)),
    layout: {
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
  }
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
