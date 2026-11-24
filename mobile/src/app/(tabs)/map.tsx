import { useEffect, useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import { qs } from '@kinetic/shared/api'
import { formatDate, formatDistance, formatDuration, sportColor, sportLabel } from '@kinetic/shared/format'
import { mapRouteLines } from '@kinetic/shared/routeMap'
import type { MapData, MapRoute } from '@kinetic/shared/types'
import { Icon, SportIcon } from '../../components/Icon'
import { LeafletView } from '../../components/LeafletView'
import type { MapSpec } from '../../components/LeafletView'
import { Button, Caption, Card, T, useColors } from '../../components/ui'
import { api } from '../../lib/api'

/** Every route on one map, coloured by sport; tap a route to list the activities under it. */
export default function MapScreen() {
  const c = useColors()
  const [available, setAvailable] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [data, setData] = useState<MapData | null>(null)
  const [tapped, setTapped] = useState<MapRoute[]>([])

  useEffect(() => {
    api.get<MapData>('/map').then((result) => {
      setAvailable(result.available)
      setSelected(result.available)
      setData(result)
    })
  }, [])

  // Each selection supersedes the previous one, so a slow answer never replaces newer routes
  const latest = useRef(0)
  const select = (next: string[]) => {
    const id = ++latest.current
    setSelected(next)
    setTapped([])
    if (!next.length) return setData(null)
    api.get<MapData>(`/map${qs({ sports: next.join(',') })}`).then((result) => id === latest.current && setData(result))
  }
  const toggle = (sport: string) =>
    select(selected.includes(sport) ? selected.filter((s) => s !== sport) : (available ?? []).filter((s) => s === sport || selected.includes(s)))

  const spec = useMemo(
    (): MapSpec => ({
      // A multisport event is drawn as its legs, each in its sport's colour, all with the event's id
      lines: (selected.length ? data?.routes ?? [] : []).flatMap((r) =>
        mapRouteLines(r).map((part) => ({ coords: part.coords, color: part.color, weight: 3, opacity: 0.75, id: r.id })),
      ),
    }),
    [data, selected],
  )
  const byId = useMemo(() => new Map((data?.routes ?? []).map((r) => [r.id, r])), [data])

  if (!available) return null
  const summary =
    selected.length && data
      ? [`${data.counts.drawn} of ${data.counts.total} activities drawn`, data.counts.without_gps ? `${data.counts.without_gps} have no GPS data` : '']
          .filter(Boolean)
          .join(' · ')
      : 'No activity types selected.'

  return (
    <View style={{ flex: 1, backgroundColor: c.background, padding: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {available.map((sport) => {
          const color = sportColor(sport, '#6b7280')
          const on = selected.includes(sport)
          return (
            <Pressable
              key={sport}
              onPress={() => toggle(sport)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: color, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: on ? `${color}22` : 'transparent' }}
            >
              {on ? <Icon name="check" size={14} color={color} /> : <SportIcon sport={sport} size={14} color={color} />}
              <T style={{ color, fontWeight: '600', fontSize: 12 }}>{sportLabel(sport)}</T>
            </Pressable>
          )
        })}
        <Button title="All" variant="text" onPress={() => select(available)} />
        <Button title="None" variant="text" color={c.muted} onPress={() => select([])} />
      </View>

      {!available.length ? (
        <Caption>No activities with GPS data yet.</Caption>
      ) : !selected.length ? (
        <Caption>Select at least one activity type to show routes.</Caption>
      ) : (
        <View style={{ flex: 1 }}>
          <LeafletView spec={spec} height="100%" onTap={(ids) => setTapped([...new Set(ids)].map((id) => byId.get(id)).filter((r): r is MapRoute => !!r))} />
        </View>
      )}
      <Caption>{summary} · tap a route for its activities</Caption>

      {tapped.length > 0 && (
        <Card style={{ position: 'absolute', left: 12, right: 12, bottom: 12, maxHeight: '45%', gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T style={{ fontWeight: '700' }}>{tapped.length === 1 ? '1 activity' : `${tapped.length} overlapping activities`}</T>
            <Pressable onPress={() => setTapped([])} hitSlop={10}>
              <Icon name="close" size={20} color={c.muted} />
            </Pressable>
          </View>
          {tapped.slice(0, 15).map((r) => (
            <Pressable key={r.id} onPress={() => router.push(`/activity/${r.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sportColor(r.sport, '#6b7280') }} />
              <View style={{ flex: 1 }}>
                <T numberOfLines={1} style={{ fontWeight: '600' }}>{r.name}</T>
                <T muted style={{ fontSize: 12 }}>
                  {[formatDate(r.date), r.distance_meters ? formatDistance(r.distance_meters, r.sport) : '', formatDuration(r.duration_seconds || 0)].filter(Boolean).join(' · ')}
                </T>
              </View>
              <Icon name="chevron_right" size={20} color={c.muted} />
            </Pressable>
          ))}
          {tapped.length > 15 && <Caption>+{tapped.length - 15} more · zoom in to narrow down</Caption>}
        </Card>
      )}
    </View>
  )
}
