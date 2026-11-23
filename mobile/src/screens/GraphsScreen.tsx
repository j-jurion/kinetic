// The Graphs page on mobile. The charts, their order and their controls come from the shared
// registry (packages/shared/src/charts/graphsPage.ts), the same one the web app renders.
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  GRAPHS_PAGE,
  METRIC_OPTIONS,
  graphsPageRequests,
  resolveControls,
} from '@kinetic/shared/charts/graphsPage'
import type { GraphDefinition, GraphsData, GraphsFilters } from '@kinetic/shared/charts/graphsPage'
import { sportFilterOptions, yearOptions } from '@kinetic/shared/format'
import type { Metric } from '@kinetic/shared/graphs'
import type { BestEffortRow, GraphStats } from '@kinetic/shared/types'
import { api } from '../api'
import { PlotView } from '../components/PlotView'
import { Card, ChipRow, useColors } from '../components/ui'

/** Loads the path, ignoring answers to requests that a newer one replaced. */
function useLatest<T>(path: string): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let current = true
    api.get<T>(path).then(
      (result) => current && setValue(result),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [path])
  return value
}

function GraphCard({ graph, filters, data }: { graph: GraphDefinition; filters: GraphsFilters; data: GraphsData }) {
  const c = useColors()
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const { values, options } = useMemo(() => resolveControls(graph, filters, data, chosen), [graph, filters, data, chosen])
  const content = useMemo(() => graph.build(filters, data, values), [graph, filters, data, values])

  return (
    <Card>
      {(graph.controls ?? [])
        .filter((control) => options[control.key].length > 0)
        .map((control) => (
          <ChipRow
            key={control.key}
            label={control.label}
            value={values[control.key]}
            options={options[control.key]}
            onChange={(value) => setChosen((current) => ({ ...current, [control.key]: value }))}
          />
        ))}
      {content?.kind === 'chart' && <PlotView chart={content.chart} height={graph.height} />}
      {content?.kind === 'message' && (
        <View style={styles.message}>
          <Text style={[styles.messageTitle, { color: c.text }]}>{content.title}</Text>
          <Text style={{ color: c.muted, textAlign: 'center' }}>{content.message}</Text>
        </View>
      )}
    </Card>
  )
}

const ALL_YEARS = 'all'

export function GraphsScreen() {
  const c = useColors()
  const [sport, setSport] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [metric, setMetric] = useState<Metric>('distance')

  const filters = useMemo((): GraphsFilters => ({ sport, year, metric }), [sport, year, metric])
  const stats = useLatest<GraphStats>(graphsPageRequests.stats(filters))
  const efforts = useLatest<BestEffortRow[]>(graphsPageRequests.efforts(filters))
  const data = useMemo((): GraphsData => ({ stats, efforts }), [stats, efforts])

  const years: [string, string][] = [[ALL_YEARS, 'All years'], ...yearOptions().map((y): [string, string] => [String(y), String(y)])]

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.page}>
      <Text style={[styles.title, { color: c.text }]}>Graphs</Text>
      <ChipRow label="Sport" value={sport} options={sportFilterOptions()} onChange={setSport} />
      <ChipRow
        label="Year"
        value={year === null ? ALL_YEARS : String(year)}
        options={years}
        onChange={(value) => setYear(value === ALL_YEARS ? null : Number(value))}
      />
      <ChipRow label="Metric" value={metric} options={METRIC_OPTIONS} onChange={setMetric} />
      {stats && GRAPHS_PAGE.map((graph) => <GraphCard key={graph.id} graph={graph} filters={filters} data={data} />)}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700' },
  message: { alignItems: 'center', paddingVertical: 32, gap: 4 },
  messageTitle: { fontSize: 16, fontWeight: '600' },
})
