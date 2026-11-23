import { useCallback, useEffect, useMemo, useState } from 'react'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import {
  MEDAL_COLORS,
  cadenceUnit,
  distanceLabel,
  formatDate,
  formatDistance,
  formatDuration,
  formatPace,
  ordinal,
  sportColor,
  sportLabel,
  stepsPerMinute,
} from '@kinetic/shared/format'
import { rankItems } from '@kinetic/shared/forms'
import { routeLegs } from '@kinetic/shared/performance'
import type { Activity, ActivityDetail, ActivityStreams, Friend, RaceResult } from '@kinetic/shared/types'
import { ActivityCharts } from '../../components/ActivityCharts'
import { ActivityEditSheet, confirmDelete } from '../../components/ActivitySheets'
import { Icon, Medal, SportIcon } from '../../components/Icon'
import { useNotify } from '../../components/Notify'
import { ActivityBreakdown } from '../../components/RaceBreakdown'
import { RaceResultSheet } from '../../components/RaceResultSheet'
import { RouteMap } from '../../components/RouteMap'
import { Table } from '../../components/Table'
import { Button, Caption, Card, CardTitle, Empty, IconButton, KindChip, Loading, Screen, Select, Stat, StatGrid, T, useColors } from '../../components/ui'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'

function RaceResultCard({ result, onEdit, onDelete }: { result: RaceResult | null; onEdit: () => void; onDelete: () => void }) {
  const c = useColors()
  return (
    <Card>
      <CardTitle
        right={
          result ? (
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="edit" onPress={onEdit} />
              <IconButton icon="delete" color={c.negative} onPress={onDelete} />
            </View>
          ) : (
            <Button title="Add result" icon="add" variant="text" onPress={onEdit} />
          )
        }
      >
        Race result
      </CardTitle>
      {!result ? (
        <Caption>No official results yet. Add a finish time, rankings and race splits.</Caption>
      ) : (
        <>
          <View style={[styles.hero, { backgroundColor: 'rgba(20, 184, 166, 0.12)' }]}>
            <T muted style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>OFFICIAL FINISH</T>
            <T style={{ fontSize: 30, fontWeight: '800' }}>
              {result.official_time_seconds ? formatDuration(result.official_time_seconds) : 'Result recorded'}
            </T>
            {(result.bib_number || result.age_group) && (
              <T muted>{[result.bib_number ? `Bib #${result.bib_number}` : '', result.age_group ?? ''].filter(Boolean).join(' · ')}</T>
            )}
          </View>
          {rankItems(result).length > 0 && (
            <StatGrid>
              {rankItems(result).map(([label, rank, total]) => (
                <Stat
                  key={label}
                  label={label}
                  value={
                    <>
                      {ordinal(rank)} {MEDAL_COLORS[rank] ? <Medal rank={rank} size={18} /> : null}
                    </>
                  }
                  hint={total ? `of ${total} · top ${Math.round((rank / total) * 100)}%` : undefined}
                />
              ))}
            </StatGrid>
          )}
          {result.splits.length > 0 && (
            <Table
              rows={result.splits.map((s, i) => ({ ...s, index: i + 1 }))}
              rowKey={(s) => s.index}
              columns={[
                { label: '#', width: 30, render: (s) => String(s.index) },
                { label: 'Split', width: 110, render: (s) => s.label },
                { label: 'Time', width: 80, align: 'right', render: (s) => (s.duration_seconds ? formatDuration(s.duration_seconds) : '–') },
                { label: 'Rank', width: 60, align: 'right', render: (s) => (s.rank && MEDAL_COLORS[s.rank] ? <Medal rank={s.rank} /> : s.rank ? ordinal(s.rank) : '–') },
              ]}
            />
          )}
          {result.results_url && <Button title="Official results" icon="link" variant="text" onPress={() => Linking.openURL(result.results_url!)} />}
          {result.notes && <Caption>{result.notes}</Caption>}
        </>
      )}
    </Card>
  )
}

function FriendsCard({ activityId, current, onChange }: { activityId: number; current: Friend[]; onChange: () => void }) {
  const c = useColors()
  const { data: all } = useApi<Friend[]>('/friends')
  const currentIds = new Set(current.map((f) => f.id))
  const available = (all ?? []).filter((f) => !currentIds.has(f.id))
  const add = async (id: string) => {
    await api.put(`/activities/${activityId}/friends/${id}`)
    onChange()
  }
  const remove = async (id: number) => {
    await api.delete(`/activities/${activityId}/friends/${id}`)
    onChange()
  }
  return (
    <Card>
      <CardTitle>Friends</CardTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {current.map((f) => (
          <Pressable key={f.id} onPress={() => remove(f.id)} style={[styles.pill, { backgroundColor: c.soft }]}>
            <T style={{ fontWeight: '500' }}>{f.name}</T>
            <Icon name="close" size={14} color={c.muted} />
          </Pressable>
        ))}
      </View>
      {available.length > 0 ? (
        <Select label="Add friend" value={undefined} options={available.map((f): [string, string] => [String(f.id), f.name])} onChange={add} />
      ) : (
        current.length === 0 && <Caption>No friends yet — add some on the Friends page.</Caption>
      )}
    </Card>
  )
}

export default function ActivityScreen() {
  const c = useColors()
  const notify = useNotify()
  const activityId = Number(useLocalSearchParams<{ id: string }>().id)
  const [editing, setEditing] = useState(false)
  const [raceSheet, setRaceSheet] = useState(false)
  const { data: detail, error, reload } = useApi<ActivityDetail>(`/activities/${activityId}/detail`)

  // Per-second data for the map and the charts (null while loading)
  const [streams, setStreams] = useState<ActivityStreams | null>(null)
  useEffect(() => {
    let cancelled = false
    setStreams(null)
    api.get<ActivityStreams>(`/activities/${activityId}/streams`).then(
      (s) => !cancelled && setStreams(s),
      () => !cancelled && setStreams({ available: false }),
    )
    return () => {
      cancelled = true
    }
  }, [activityId])

  // A multisport event's route is coloured per leg, like its breakdown bar
  const legs = useMemo(
    () => (detail && detail.children.length >= 2 ? routeLegs(detail.activity.date, detail.children, sportLabel) : undefined),
    [detail],
  )

  const remove = useCallback(
    (a: Activity) => confirmDelete(a, () => (detail?.parent ? router.replace(`/activity/${detail.parent.id}`) : router.back()), notify),
    [detail, notify],
  )

  if (error) return <Empty icon="error_outline">Activity not found.</Empty>
  if (!detail) return <Loading />

  const a = detail.activity
  const sport = a.sport
  const dist = a.distance_meters
  const dur = a.duration_seconds

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen
        options={{
          title: a.name,
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="edit" color={c.primary} onPress={() => setEditing(true)} />
              <IconButton icon="delete" color={c.negative} onPress={() => remove(a)} />
            </View>
          ),
        }}
      />

      <Card style={{ borderLeftWidth: 3, borderLeftColor: sportColor(sport, '#6b7280') }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <SportIcon sport={sport} size={32} />
          <View style={{ flex: 1, gap: 3 }}>
            <T style={{ fontSize: 20, fontWeight: '800' }}>{a.name}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <T muted style={{ fontSize: 12 }}>{formatDate(a.date)}</T>
              <KindChip kind={a.kind} />
              <T muted style={{ fontSize: 12 }}>{sportLabel(sport)}</T>
            </View>
          </View>
        </View>
        <StatGrid>
          {!!dist && <Stat label="Distance" value={formatDistance(dist, sport)} />}
          <Stat label="Duration" value={formatDuration(dur)} />
          {!!dist && !!dur && <Stat label="Pace" value={formatPace(dist, dur, sport)} />}
          {!!a.avg_heart_rate && <Stat label="Avg HR" value={`${a.avg_heart_rate} bpm`} color="#ef4444" />}
          {!!a.max_heart_rate && <Stat label="Max HR" value={`${a.max_heart_rate} bpm`} color="#ef4444" />}
          {!!a.elevation_gain_meters && <Stat label="Elevation" value={`${a.elevation_gain_meters.toFixed(0)} m`} color="#10b981" />}
          {!!a.calories && <Stat label="Calories" value={`${a.calories} kcal`} color="#f59e0b" />}
          {!!a.avg_cadence && <Stat label="Cadence" value={`${stepsPerMinute(a.avg_cadence, sport)} ${cadenceUnit(sport)}`} color="#8b5cf6" />}
          {!!a.avg_power && <Stat label="Power" value={`${a.avg_power} W`} color="#3b82f6" />}
        </StatGrid>
      </Card>

      {detail.parent && (
        <Button title={`Back to ${detail.parent.name || 'Triathlon'}`} icon="arrow_back" variant="text" onPress={() => router.push(`/activity/${detail.parent!.id}`)} />
      )}
      {detail.children.length > 0 && (
        <Card>
          <CardTitle>Sub-activities</CardTitle>
          {detail.children.map((child) => {
            const color = sportColor(child.sport, '#6b7280')
            const parts = [child.name || sportLabel(child.sport)]
            if (child.distance_meters) parts.push(formatDistance(child.distance_meters, child.sport))
            if (child.duration_seconds) parts.push(formatDuration(child.duration_seconds))
            return (
              <Pressable key={child.id} onPress={() => router.push(`/activity/${child.id}`)} style={[styles.child, { borderColor: color }]}>
                <SportIcon sport={child.sport} size={20} color={color} />
                <T style={{ color, fontWeight: '600', flex: 1 }}>{parts.join(' · ')}</T>
              </Pressable>
            )
          })}
        </Card>
      )}
      {detail.children.length >= 2 && <ActivityBreakdown activity={a} raceResult={detail.race_result} />}

      <RaceResultCard
        result={detail.race_result}
        onEdit={() => setRaceSheet(true)}
        onDelete={async () => {
          await api.delete(`/activities/${activityId}/race-result`)
          reload()
        }}
      />

      {a.has_route && <RouteMap activityId={activityId} sport={sport} streams={streams} legs={legs} />}

      <ActivityCharts activity={a} laps={detail.laps} streams={streams} />

      {a.notes && (
        <Card>
          <CardTitle>Notes</CardTitle>
          <T>{a.notes}</T>
        </Card>
      )}

      {detail.laps.length > 0 && (
        <Card>
          <CardTitle>Laps</CardTitle>
          <Table
            rows={detail.laps}
            rowKey={(lap) => lap.lap_number}
            columns={[
              { label: '#', width: 30, render: (lap) => String(lap.lap_number) },
              { label: 'Time', width: 70, align: 'right', render: (lap) => (lap.duration_seconds ? formatDuration(lap.duration_seconds) : '–') },
              { label: 'Dist', width: 72, align: 'right', render: (lap) => (lap.distance_meters ? formatDistance(lap.distance_meters, sport) : '–') },
              {
                label: 'Pace',
                width: 84,
                align: 'right',
                render: (lap) => (lap.distance_meters && lap.duration_seconds ? formatPace(lap.distance_meters, lap.duration_seconds, sport) : '–'),
              },
              { label: 'Avg HR', width: 60, align: 'right', render: (lap) => String(lap.avg_heart_rate ?? '–') },
              { label: 'Elev', width: 56, align: 'right', render: (lap) => (lap.elevation_gain ? `${lap.elevation_gain.toFixed(0)} m` : '–') },
            ]}
          />
        </Card>
      )}

      {detail.best_efforts.length > 0 && (
        <Card>
          <CardTitle>Best efforts</CardTitle>
          <StatGrid>
            {detail.best_efforts.map((be) => (
              <Stat
                key={be.id}
                label={distanceLabel(be.distance_meters, be.sport)}
                value={
                  <>
                    {formatDuration(be.duration_seconds)} {MEDAL_COLORS[be.rank] ? <Medal rank={be.rank} size={18} /> : null}
                  </>
                }
                hint={`All-time #${be.rank}${be.distance_meters && be.duration_seconds ? ` · ${formatPace(be.distance_meters, be.duration_seconds, sport)}` : ''}`}
              />
            ))}
          </StatGrid>
        </Card>
      )}

      <FriendsCard activityId={activityId} current={detail.friends} onChange={reload} />

      <ActivityEditSheet visible={editing} activity={a} onClose={() => setEditing(false)} onSaved={reload} />
      <RaceResultSheet
        visible={raceSheet}
        activityId={activityId}
        sport={sport}
        existing={detail.race_result}
        onClose={() => setRaceSheet(false)}
        onSaved={reload}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: { borderRadius: 12, padding: 14, gap: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  child: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
})
