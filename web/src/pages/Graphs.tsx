import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  GRAPHS_PAGE,
  METRIC_OPTIONS,
  graphsPageRequests,
  resolveControls,
} from '@kinetic/shared/charts/graphsPage'
import type { GraphDefinition, GraphsData, GraphsFilters } from '@kinetic/shared/charts/graphsPage'
import type { Metric } from '@kinetic/shared/graphs'
import type { BestEffortRow, GraphStats } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { useLatestRequest } from '../lib/useLatestRequest'
import { ChartCard, Toggle } from '../components/ChartCard'
import { SelectField, SportSelect, YearSelect } from '../components/fields'
import { PageHeader } from '../components/PageHeader'
import { Plot } from '../components/Plot'

/** One chart from the shared Graphs page registry, in a card with its own controls. */
function GraphCard({ graph, filters, data }: { graph: GraphDefinition; filters: GraphsFilters; data: GraphsData }) {
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const { values, options } = useMemo(() => resolveControls(graph, filters, data, chosen), [graph, filters, data, chosen])
  const content = useMemo(() => graph.build(filters, data, values), [graph, filters, data, values])
  const choose = (key: string) => (value: string) => setChosen((current) => ({ ...current, [key]: value }))

  const controls = (graph.controls ?? [])
    .filter((control) => options[control.key].length > 0)
    .map((control) =>
      control.style === 'toggle' ? (
        <Toggle<string>
          key={control.key}
          label={control.label}
          value={values[control.key]}
          options={options[control.key]}
          onChange={choose(control.key)}
        />
      ) : (
        <SelectField
          key={control.key}
          label={control.label}
          width={160}
          value={values[control.key]}
          options={options[control.key]}
          onChange={choose(control.key)}
        />
      ),
    )

  return (
    <ChartCard controls={controls.length > 0 && controls}>
      {content?.kind === 'chart' && (
        <Plot data={content.chart.data} layout={content.chart.layout} style={{ height: graph.height }} />
      )}
      {content?.kind === 'message' && (
        <div className="column items-center w-full q-pa-xl gap-1 text-center">
          <div className="text-subtitle1 text-weight-medium">{content.title}</div>
          <div className="text-grey-6">{content.message}</div>
        </div>
      )}
    </ChartCard>
  )
}

export function GraphsPage() {
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [metric, setMetric] = useState<Metric>('distance')
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [efforts, setEfforts] = useState<BestEffortRow[] | null>(null)
  const latestStats = useLatestRequest()
  const latestEfforts = useLatestRequest()

  const filters = useMemo((): GraphsFilters => ({ sport, year, metric }), [sport, year, metric])
  const data = useMemo((): GraphsData => ({ stats, efforts }), [stats, efforts])
  const statsPath = graphsPageRequests.stats(filters)
  const effortsPath = graphsPageRequests.efforts(filters)

  useEffect(() => {
    latestStats(api.get<GraphStats>(statsPath), setStats)
  }, [statsPath, latestStats])
  useEffect(() => {
    latestEfforts(api.get<BestEffortRow[]>(effortsPath), setEfforts)
  }, [effortsPath, latestEfforts])

  // Consecutive charts of one group share a row
  const rows: GraphDefinition[][] = []
  for (const graph of GRAPHS_PAGE) {
    const last = rows[rows.length - 1]
    if (graph.group && last?.[0].group === graph.group) last.push(graph)
    else rows.push([graph])
  }
  const card = (graph: GraphDefinition): ReactNode => <GraphCard key={graph.id} graph={graph} filters={filters} data={data} />

  return (
    <>
      <PageHeader icon="bar_chart" kicker="Insights" title="Graphs" subtitle="Volume, trends and progress over time.">
        <SportSelect value={sport} onChange={setSport} />
        <YearSelect value={year} onChange={setYear} />
        <SelectField label="Metric" width={128} value={metric} options={METRIC_OPTIONS} onChange={(v) => setMetric(v as Metric)} />
      </PageHeader>

      {stats && (
        <div className="column w-full gap-4">
          {rows.map((row) =>
            row.length > 1 ? (
              <div key={row[0].id} className="w-full graphs-grid">
                {row.map(card)}
              </div>
            ) : (
              card(row[0])
            ),
          )}
        </div>
      )}
    </>
  )
}
