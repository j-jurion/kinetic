// A Leaflet map on mobile: the same Leaflet and OpenStreetMap tiles as the web app, in a WebView.
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import type { LatLng } from '@kinetic/shared/routeMap'
import { ORIGIN } from '../lib/api'

// Same Leaflet and marker-cluster versions as web/package.json
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet'
const CLUSTER = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist'

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
  /**
   * Draw tappable lines too small to see at the current zoom as pins, grouped into numbered
   * bubbles, so routes far from the rest stay findable when zoomed out.
   */
  pinSmall?: boolean
}

const HTML = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET}.css">
<script src="${LEAFLET}.js"></script>
<link rel="stylesheet" href="${CLUSTER}/MarkerCluster.css">
<script src="${CLUSTER}/leaflet.markercluster.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; }
  .kin-pin { width: 14px; height: 14px; margin: 2px; border-radius: 50%; box-sizing: border-box;
    border: 2.5px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.45); transition: transform .1s ease; }
  .is-hl > .kin-pin { transform: scale(1.4); }
  .kin-cluster { display: grid; place-items: center; border-radius: 50%; box-sizing: border-box;
    color: #fff; font: 700 12px -apple-system, Roboto, sans-serif;
    border: 2.5px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.45); }
</style>
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
  // A route smaller than this on screen becomes a pin (see MapSpec.pinSmall)
  var PIN_PX = 24
  var clusters = L.markerClusterGroup({
    showCoverageOnHover: false, spiderfyOnMaxZoom: false, maxClusterRadius: 45,
    iconCreateFunction: function (cluster) {
      var markers = cluster.getAllChildMarkers()
      var counts = {}
      markers.forEach(function (m) { counts[m.options.color] = (counts[m.options.color] || 0) + 1 })
      var color = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] })[0]
      var n = markers.length
      var size = n < 10 ? 26 : n < 100 ? 32 : 38
      return L.divIcon({ className: '', iconSize: [size, size],
        html: '<div class="kin-cluster" style="width:' + size + 'px;height:' + size + 'px;background:' + color + '">' + n + '</div>' })
    },
  }).addTo(map)
  var pinSmall = false

  // Swap routes between line and pin to match their size at this zoom
  function layout() {
    if (!pinSmall) return
    var toPins = []
    var fromPins = []
    tappable.forEach(function (t) {
      var a = map.latLngToLayerPoint(t.bounds.getNorthWest())
      var b = map.latLngToLayerPoint(t.bounds.getSouthEast())
      var pinned = Math.max(b.x - a.x, b.y - a.y) < PIN_PX
      if (pinned === t.pinned) return
      t.pinned = pinned
      if (pinned) { t.line.remove(); toPins.push(t.pin) } else { t.line.addTo(layers); fromPins.push(t.pin) }
    })
    if (fromPins.length) clusters.removeLayers(fromPins)
    if (toPins.length) clusters.addLayers(toPins)
  }
  map.on('zoomend', layout)

  function pin(color, label, at) {
    var html = '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
      'background:' + color + ';border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>'
    return L.marker(at, { title: label, icon: L.divIcon({ html: html, className: '', iconSize: [22, 22], iconAnchor: [3, 22] }) })
  }

  window.renderMap = function (spec) {
    layers.clearLayers()
    clusters.clearLayers()
    pinSmall = !!spec.pinSmall
    if (legend) legend.remove()
    tappable = []
    highlighted = []
    var bounds = []
    spec.lines.forEach(function (line) {
      var drawn = L.polyline(line.coords, {
        color: line.color, weight: line.weight || 3, opacity: line.opacity == null ? 0.85 : line.opacity, interactive: false,
      }).addTo(layers)
      if (line.id != null) {
        var mid = line.coords[Math.floor(line.coords.length / 2)]
        tappable.push({
          id: line.id, line: drawn, coords: line.coords, weight: line.weight || 3, pinned: false,
          bounds: L.latLngBounds(line.coords),
          // Pins are found by the same hit-testing as lines, so they let taps through
          pin: L.marker(mid, { color: line.color, interactive: false, keyboard: false,
            icon: L.divIcon({ className: '', iconSize: [18, 18], html: '<div class="kin-pin" style="background:' + line.color + '"></div>' }) }),
        })
      }
      for (var i = 0; i < line.coords.length; i++) bounds.push(line.coords[i])
    })
    ;(spec.markers || []).forEach(function (m) { pin(m.color, m.label, m.at).addTo(layers) })
    if (spec.legend) {
      legend = new L.Control({ position: 'bottomleft' })
      legend.onAdd = function () { var box = L.DomUtil.create('div'); box.innerHTML = spec.legend; return box }
      legend.addTo(map)
    }
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [20, 20], animate: false })
    layout()
  }

  // Every tappable route within a finger's width of the tap, not just the topmost one
  map.on('click', function (e) {
    if (!tappable.length) return
    var at = e.layerPoint
    var hits = tappable.filter(function (t) {
      if (t.pinned) {
        // Only a pin shown on its own counts; one inside a bubble is reached by zooming in
        return clusters.getVisibleParent(t.pin) === t.pin && map.latLngToLayerPoint(t.pin.getLatLng()).distanceTo(at) <= 14
      }
      for (var i = 1; i < t.coords.length; i++) {
        var a = map.latLngToLayerPoint(t.coords[i - 1])
        var b = map.latLngToLayerPoint(t.coords[i])
        if (L.LineUtil.pointToSegmentDistance(at, a, b) <= 14) return true
      }
      return false
    })
    highlighted.forEach(function (t) {
      t.line.setStyle({ weight: t.weight })
      var el = t.pin.getElement()
      if (el) el.classList.remove('is-hl')
    })
    highlighted = hits
    hits.forEach(function (t) {
      t.line.setStyle({ weight: 7 })
      if (!t.pinned) t.line.bringToFront()
      var el = t.pin.getElement()
      if (el) el.classList.add('is-hl')
    })
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tap', ids: hits.map(function (t) { return t.id }) }))
  })

  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }))
</script>
</body>
</html>`

/**
 * A Leaflet map in a web view. Screen readers cannot explore the map, so it is one element
 * read as `label`; say where the same information can be found without the map.
 */
export function LeafletView({ spec, height, onTap, label }: {
  spec: MapSpec
  height: number | `${number}%`
  onTap?: (ids: number[]) => void
  label: string
}) {
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
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }} accessible accessibilityRole="image" accessibilityLabel={label}>
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
