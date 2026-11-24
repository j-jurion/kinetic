// A Leaflet map on mobile: the same Leaflet and OpenStreetMap tiles as the web app, in a WebView.
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import type { LatLng } from '@kinetic/shared/routeMap'
import { ORIGIN } from '../lib/api'

// Same Leaflet version as web/package.json
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet'

export interface MapLine {
  coords: LatLng[]
  color: string
  weight?: number
  opacity?: number
  /** Lines with an id can be tapped; the map reports every id under the finger. */
  id?: number
}

export interface MapMarker {
  at: LatLng
  color: string
  label: string
}

export interface MapSpec {
  lines: MapLine[]
  markers?: MapMarker[]
  /** HTML of a legend box in the bottom-left corner. */
  legend?: string | null
}

const HTML = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET}.css">
<script src="${LEAFLET}.js"></script>
<style>html, body, #map { margin: 0; height: 100%; }</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { center: [50.85, 4.35], zoom: 8, zoomControl: false })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map)
  var layers = L.layerGroup().addTo(map)
  var legend = null
  var tappable = []
  var highlighted = []

  function pin(color, label, at) {
    var html = '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
      'background:' + color + ';border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>'
    return L.marker(at, { title: label, icon: L.divIcon({ html: html, className: '', iconSize: [22, 22], iconAnchor: [3, 22] }) })
  }

  window.renderMap = function (spec) {
    layers.clearLayers()
    if (legend) legend.remove()
    tappable = []
    highlighted = []
    var bounds = []
    spec.lines.forEach(function (line) {
      var drawn = L.polyline(line.coords, {
        color: line.color, weight: line.weight || 3, opacity: line.opacity == null ? 0.85 : line.opacity, interactive: false,
      }).addTo(layers)
      if (line.id != null) tappable.push({ id: line.id, line: drawn, coords: line.coords, weight: line.weight || 3 })
      for (var i = 0; i < line.coords.length; i++) bounds.push(line.coords[i])
    })
    ;(spec.markers || []).forEach(function (m) { pin(m.color, m.label, m.at).addTo(layers) })
    if (spec.legend) {
      legend = new L.Control({ position: 'bottomleft' })
      legend.onAdd = function () { var box = L.DomUtil.create('div'); box.innerHTML = spec.legend; return box }
      legend.addTo(map)
    }
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [20, 20], animate: false })
  }

  // Every tappable route within a finger's width of the tap, not just the topmost one
  map.on('click', function (e) {
    if (!tappable.length) return
    var at = e.layerPoint
    var hits = tappable.filter(function (t) {
      for (var i = 1; i < t.coords.length; i++) {
        var a = map.latLngToLayerPoint(t.coords[i - 1])
        var b = map.latLngToLayerPoint(t.coords[i])
        if (L.LineUtil.pointToSegmentDistance(at, a, b) <= 14) return true
      }
      return false
    })
    highlighted.forEach(function (t) { t.line.setStyle({ weight: t.weight }) })
    highlighted = hits
    hits.forEach(function (t) { t.line.setStyle({ weight: 7 }); t.line.bringToFront() })
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tap', ids: hits.map(function (t) { return t.id }) }))
  })

  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }))
</script>
</body>
</html>`

export function LeafletView({ spec, height, onTap }: { spec: MapSpec; height: number | `${number}%`; onTap?: (ids: number[]) => void }) {
  const web = useRef<WebView<object>>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.renderMap(${JSON.stringify(spec)}); true;`)
  }, [ready, spec])

  const onMessage = (event: WebViewMessageEvent) => {
    const message = JSON.parse(event.nativeEvent.data)
    if (message.type === 'ready') setReady(true)
    else if (message.type === 'tap') onTap?.(message.ids)
  }

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }}>
      <WebView<object>
        ref={web}
        originWhitelist={['*']}
        // OpenStreetMap's tile policy asks for a Referer: send the app's own origin
        source={{ html: HTML, baseUrl: ORIGIN || 'https://localhost' }}
        onMessage={onMessage}
        nestedScrollEnabled
      />
    </View>
  )
}
