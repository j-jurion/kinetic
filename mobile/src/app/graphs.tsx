// The Graphs page. The charts, their order and their controls come from the shared registry
// (packages/shared/src/charts/graphsPage.ts), the same one the web app renders.
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { GRAPHS_PAGE, METRIC_OPTIONS, graphsPageRequests, resolveControls } from '@kinetic/shared/charts/graphsPage'
import type { GraphDefinition, GraphsData, GraphsFilters } from '@kinetic/shared/charts/graphsPage'
import type { Metric } from '@kinetic/shared/graphs'
import type { BestEffortRow, GraphStats } from '@kinetic/shared/types'
import { PlotView } from '../components/PlotView'
import { Card, Caption, FilterRow, PageHeader, Screen, Select, SportSelect, T, Toggle, YearSelect } from '../components/ui'
import { useApi } from '../lib/useApi'

function GraphCard({ graph, filters, data }: { graph: GraphDefinition; filters: GraphsFilters; data: GraphsData }) {
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const { values, options } = useMemo(() => resolveControls(graph, filters, data, chosen), [graph, filters, data, chosen])
  const content = useMemo(() => graph.build(filters, data, values), [graph, filters, data, values])
  const choose = (key: string) => (value: string) => setChosen((current) => ({ ...current, [key]: value }))

  return (
    <Card>
      {(graph.controls ?? [])
        .filter((control) => options[control.key].length > 0)
        .map((control) =>
          control.style === 'toggle' ? (
            <Toggle key={control.key} value={values[control.key]} options={options[control.key]} onChange={choose(control.key)} />
          ) : (
            <Select key={control.key} label={control.label} value={values[control.key]} options={options[control.key]} onChange={choose(control.key)} />
          ),
        )}
      {content?.kind === 'chart' && <PlotView data={content.chart.data} layout={content.chart.layout} height={graph.height} />}
      {content?.kind === 'message' && (
        <View style={{ alignItems: 'center', paddingVertical: 28, gap: 4 }}>
          <T style={{ fontSize: 16, fontWeight: '600' }}>{content.title}</T>
          <Caption>{content.message}</Caption>
        </View>
      )}
    </Card>
  )
}

export default function GraphsScreen() {
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [metric, setMetric] = useState<Metric>('distance')

  const filters = useMemo((): GraphsFilters => ({ sport, year, metric }), [sport, year, metric])
  const { data: stats } = useApi<GraphStats>(graphsPageRequests.stats(filters))
  const { data: efforts } = useApi<BestEffortRow[]>(graphsPageRequests.efforts(filters))
  const data = useMemo((): GraphsData => ({ stats, efforts }), [stats, efforts])

  return (
    <Screen>
      <PageHeader kicker="Insights" title="Graphs" subtitle="Volume, trends and progress over time.">
        <FilterRow>
          <SportSelect value={sport} onChange={setSport} />
          <YearSelect value={year} onChange={setYear} />
        </FilterRow>
        <Select label="Metric" value={metric} options={METRIC_OPTIONS} onChange={setMetric} />
      </PageHeader>
      {stats && GRAPHS_PAGE.map((graph) => <GraphCard key={graph.id} graph={graph} filters={filters} data={data} />)}
    </Screen>
  )
}
