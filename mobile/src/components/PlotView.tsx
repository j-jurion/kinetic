// A Plotly chart on mobile: the same plotly.js as the web app, running in a WebView, so the
// shared chart definitions render identically on both.
import { useEffect, useRef, useState } from 'react'
import { useColorScheme, View } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import { themedChart } from '@kinetic/shared/charts/theme'
import type { ChartSpec } from '@kinetic/shared/charts/theme'

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
    Plotly.react('chart', spec.data, spec.layout, { responsive: true, displaylogo: false, displayModeBar: false })
  }
  window.ReactNativeWebView.postMessage('ready')
</script>
</body>
</html>`

export function PlotView({ chart, height }: { chart: ChartSpec; height: number }) {
  const web = useRef<WebView<object>>(null)
  const [ready, setReady] = useState(false)
  const dark = useColorScheme() === 'dark'

  useEffect(() => {
    if (!ready) return
    const spec = themedChart(chart, dark)
    web.current?.injectJavaScript(`window.renderChart(${JSON.stringify(spec)}); true;`)
  }, [ready, chart, dark])

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
      />
    </View>
  )
}
