import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { formatDate, formatDuration } from '../../lib/format'
import { segmentLabels, segmentSeconds, splitKind } from '../../lib/performance'
import type { BreakdownEvent, SplitKind } from '../../lib/performance'
import { formatClock } from '../../lib/speed'
import { Plot } from '../Plot'

type Chart = [Data[], Partial<Layout>]

const KIND_COLORS: Partial<Record<SplitKind, string>> = {
  swim: '#00a3ff',
  t1: '#9ca3af',
  bike: '#00c853',
  t2: '#6b7280',
  run: '#f97316',
}
// Labels that are not swim, bike, run or a first/second transition
const OTHER_COLORS = ['#7c4dff', '#ff4dd8', '#14b8a6', '#ffb300', '#ff2d55', '#64748b']
// Repeated disciplines (a duathlon's Run 1 and Run 2) get a lighter shade for the second one
const SECOND_SHADE: Partial<Record<SplitKind, string>> = { swim: '#66c7ff', bike: '#5ee08f', run: '#fdba74' }

const legendBelow: Partial<Layout['legend']> = { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.12, yanchor: 'top' }

const eventLabel = (e: BreakdownEvent) => `${e.name} · ${formatDate(e.date)}`

const isTransition = (label: string) => /^t\d+$/.test(splitKind(label)) || /^T\s*\d+$/i.test(label.trim())

/** Legend groups: the disciplines and transitions, each with its colour. */
const LEGEND: [string, string][] = [
  ['Swim', KIND_COLORS.swim!],
  ['Bike', KIND_COLORS.bike!],
  ['Run', KIND_COLORS.run!],
  ['Transition', KIND_COLORS.t1!],
  ['Other', OTHER_COLORS[0]],
]

/** Colour per segment of one event: by discipline, lighter for its second run/ride/swim. */
function segmentColors(event: BreakdownEvent): string[] {
  const used = new Map<SplitKind, number>()
  return event.segments.map(({ label }) => {
    if (isTransition(label)) return splitKind(label) === 't2' ? KIND_COLORS.t2! : KIND_COLORS.t1!
    const kind = splitKind(label)
    const base = KIND_COLORS[kind]
    if (!base) return OTHER_COLORS[0]
    const count = used.get(kind) ?? 0
    used.set(kind, count + 1)
    return count > 0 ? (SECOND_SHADE[kind] ?? base) : base
  })
}

/**
 * One horizontal bar per event, stacked by leg and transition.
 *
 * Plotly stacks series in one fixed order, so series are the 1st, 2nd, 3rd… segment of each
 * event rather than labels: that way a duathlon (run, bike, run) and a triathlon (swim, bike,
 * run) both stack in the order they happened. Colours come per point; the legend shows the
 * disciplines.
 */
function breakdownChart(events: BreakdownEvent[], single: boolean): Chart {
  const y = events.map(eventLabel)
  const colors = events.map(segmentColors)
  const positions = Math.max(...events.map((e) => e.segments.length))
  const traces: Data[] = []
  for (let i = 0; i < positions; i++) {
    const segments = events.map((e) => e.segments[i])
    traces.push({
      type: 'bar',
      orientation: 'h',
      name: `Segment ${i + 1}`,
      showlegend: false,
      y,
      x: segments.map((s) => (s ? s.seconds / 60 : null)),
      marker: { color: colors.map((c) => c[i] ?? 'transparent'), line: { color: 'rgba(0,0,0,0.25)', width: 0.5 } },
      // The time inside the segment when it fits; Plotly hides it otherwise
      text: segments.map((s) => (s ? formatClock(s.seconds) : '')),
      textposition: 'inside',
      insidetextanchor: 'middle',
      customdata: segments.map((s) => (s ? [s.label, formatDuration(s.seconds)] : ['', ''])) as never,
      hovertemplate: '<b>%{y}</b><br>%{customdata[0]}: %{customdata[1]}<extra></extra>',
    })
  }
  // Legend entries only, for the disciplines that occur
  const labels = segmentLabels(events)
  const present = (name: string) =>
    labels.some((label) =>
      name === 'Transition' ? isTransition(label)
        : name === 'Other' ? !isTransition(label) && !KIND_COLORS[splitKind(label)]
          : splitKind(label) === name.toLowerCase(),
    )
  for (const [name, color] of LEGEND.filter(([name]) => present(name))) {
    traces.push({ type: 'bar', orientation: 'h', name, x: [null], y: [y[0]], marker: { color }, hoverinfo: 'skip' })
  }
  const fromLegs = events.some((e) => e.source === 'legs')
  return [
    traces,
    {
      title: {
        text: single ? 'Event breakdown' : 'Triathlon & duathlon breakdown',
        subtitle: fromLegs
          ? { text: 'From the legs recorded by your watch; transitions are the gaps between legs', font: { size: 11, color: '#9e9e9e' } }
          : undefined,
      } as Partial<Layout['title']>,
      barmode: 'stack',
      xaxis: { ticksuffix: ' min', rangemode: 'tozero' },
      yaxis: { automargin: true, type: 'category', showticklabels: !single },
      legend: { ...legendBelow, traceorder: 'normal' },
      margin: { l: 20, r: 20, t: fromLegs ? 70 : 50, b: 50 },
      hovermode: 'closest',
    },
  ]
}

/** T1 and T2 times per event over time. */
function transitionChart(events: BreakdownEvent[]): Chart {
  const traces: Data[] = (['t1', 't2'] as const).flatMap((kind): Data[] => {
    const rows = events
      .map((e) => ({ event: e, seconds: segmentSeconds(e, kind) }))
      .filter((p): p is { event: BreakdownEvent; seconds: number } => p.seconds !== null)
    if (!rows.length) return []
    const name = kind.toUpperCase()
    return [
      {
        type: 'scatter',
        mode: 'lines+markers',
        name,
        x: rows.map((p) => p.event.date),
        y: rows.map((p) => p.seconds),
        line: { color: KIND_COLORS[kind], width: 2 },
        marker: { color: KIND_COLORS[kind], size: 8 },
        customdata: rows.map((p) => [formatClock(p.seconds), p.event.name]) as never,
        hovertemplate: `<b>${name}: %{customdata[0]}</b><br>%{customdata[1]} · %{x|%d-%m-%Y}<extra></extra>`,
      },
    ]
  })
  const all = events
    .flatMap((e) => [segmentSeconds(e, 't1'), segmentSeconds(e, 't2')])
    .filter((s): s is number => s !== null)
  const top = Math.max(...all, 60)
  // Labels as m:ss, one per 30 s, 1, 2 or 5 min depending on the range
  const step = [30, 60, 120, 300].find((s) => top / s <= 6) ?? 600
  const tickvals: number[] = []
  for (let t = 0; t <= top + step; t += step) tickvals.push(t)
  return [
    traces,
    {
      title: { text: 'Transition times' },
      xaxis: { type: 'date', tickformat: '%b %Y' },
      yaxis: { title: { text: 'Time' }, range: [0, top * 1.15], tickvals, ticktext: tickvals.map(formatClock) },
      legend: legendBelow,
      margin: { l: 60, r: 20, t: 50, b: 40 },
      hovermode: 'closest',
    },
  ]
}

interface Props {
  events: BreakdownEvent[]
  /** One event on its own activity page: a compact bar without the transition trend. */
  single?: boolean
}

/** Multisport charts: the breakdown per event and, with two or more events, transition trends. */
export default function RaceBreakdownCharts({ events, single = false }: Props) {
  const breakdown = useMemo(() => breakdownChart(events, single), [events, single])
  const transitions = useMemo(() => {
    if (single) return null
    const withTransitions = events.filter((e) => segmentSeconds(e, 't1') !== null || segmentSeconds(e, 't2') !== null)
    return withTransitions.length >= 2 ? transitionChart(withTransitions) : null
  }, [events, single])
  const height = (single ? 170 : 160) + 44 * events.length
  return (
    <div className="column w-full gap-3">
      <div className="card w-full q-pa-sm races-chart-card">
        <Plot data={breakdown[0]} layout={breakdown[1]} style={{ height }} />
      </div>
      {transitions && (
        <div className="card w-full q-pa-sm races-chart-card">
          <Plot data={transitions[0]} layout={transitions[1]} style={{ height: 320 }} />
        </div>
      )}
    </div>
  )
}
