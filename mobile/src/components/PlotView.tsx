// A Plotly chart on mobile: the same plotly.js as the web app, running in a WebView, so the
// shared chart builders render identically on both.
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import type { Data, Layout } from 'plotly.js-dist-min'
import { themedChart } from '@kinetic/shared/charts/theme'
import type { Chart } from '@kinetic/shared/charts/theme'
import { useColors } from '../lib/theme'

// Same plotly.js version as web/package.json
const PLOTLY_URL = 'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@4.3.0/plotly.min.js'

const HTML = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html, body, #chart { margin: 0; height: 100%; background: transparent; }</style>
<script src="${PLOTLY_URL}"></script>
</head>
<body>
<div id="chart"></div>
<script>
  window.renderChart = function (spec) {
    Plotly.react('chart', spec.data, spec.layout, { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: false, doubleClick: false })
  }
  window.ReactNativeWebView.postMessage('ready')
</script>
</body>
</html>`

/** Narrow screens get smaller side margins than the web layouts ask for. */
function compact(layout: Partial<Layout>): Partial<Layout> {
  const margin = layout.margin ?? {}
  return {
    ...layout,
    margin: { ...margin, l: Math.min(margin.l ?? 50, 52), r: Math.min(margin.r ?? 20, 46) },
  }
}

export function PlotView({ data, layout, height }: { data: Data[]; layout: Partial<Layout>; height: number }) {
  const web = useRef<WebView<object>>(null)
  const [ready, setReady] = useState(false)
  const c = useColors()

  useEffect(() => {
    if (!ready) return
    const spec = themedChart({ data, layout: compact(layout) }, c.dark)
    web.current?.injectJavaScript(`window.renderChart(${JSON.stringify(spec)}); true;`)
  }, [ready, data, layout, c.dark])

  return (
    <View style={{ height }}>
      {/* <object>: the default type argument (undefined) turns the props into never */}
      <WebView<object>
        ref={web}
        originWhitelist={['*']}
        source={{ html: HTML }}
        onMessage={(event: WebViewMessageEvent) => event.nativeEvent.data === 'ready' && setReady(true)}
        style={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
        nestedScrollEnabled
      />
    </View>
  )
}

/** A [traces, layout] chart from the shared builders. */
export function ChartView({ chart, height = 320 }: { chart: Chart; height?: number }) {
  const [data, layout] = useMemo(() => chart, [chart])
  return <PlotView data={data} layout={layout} height={height} />
}
