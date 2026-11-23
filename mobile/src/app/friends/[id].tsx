import { useMemo, useState } from 'react'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Alert, View } from 'react-native'
import { byMonth, hours, km, monthSummary, monthTitle, totals } from '@kinetic/shared/activityList'
import { qs } from '@kinetic/shared/api'
import { formatDate, sportLabel } from '@kinetic/shared/format'
import { sportCounts } from '@kinetic/shared/friends'
import type { ActivityRow, Friend, FriendRequests } from '@kinetic/shared/types'
import { ActivityCard } from '../../components/ActivityCard'
import { FriendAvatar } from '../../components/FriendAvatar'
import { FindFriendsSheet, FriendFormSheet } from '../../components/FriendSheets'
import { Icon, SportIcon } from '../../components/Icon'
import { useNotify } from '../../components/Notify'
import { Button, Card, Empty, IconButton, Loading, Screen, SectionHeading, Stat, StatGrid, T, useColors } from '../../components/ui'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'

/** One friend: the activities you did together, from your own log. */
export default function FriendScreen() {
  const c = useColors()
  const notify = useNotify()
  const friendId = Number(useLocalSearchParams<{ id: string }>().id)
  const { data: friend, error, reload: reloadFriend } = useApi<Friend>(`/friends/${friendId}`)
  const { data: activities, reload: reloadActivities } = useApi<ActivityRow[]>(`/activities${qs({ friend: friendId })}`)
  const { data: requests, reload: reloadRequests } = useApi<FriendRequests>('/friend-requests')
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)

  const summary = useMemo(() => (activities ? totals(activities) : null), [activities])
  const sports = useMemo(() => (activities ? sportCounts(activities) : []), [activities])
  const months = useMemo(() => (activities ? byMonth(activities) : []), [activities])
  const invited = requests?.outgoing.find((r) => r.friend_id === friendId)?.username

  const reload = () => {
    reloadFriend()
    reloadActivities()
    reloadRequests()
  }

  if (error) return <Screen><Empty icon="person_off">This friend no longer exists.</Empty></Screen>
  if (!friend) return <Loading />

  const remove = () =>
    Alert.alert(`Remove ${friend.name}?`, `They are also removed from the activities they are tagged on.${friend.username ? ' You stay in their own friends list.' : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/friends/${friend.id}`)
            router.back()
          } catch (e) {
            notify(`Failed to remove: ${(e as Error).message}`, 'error')
          }
        },
      },
    ])

  const account = friend.username ? `@${friend.username}` : invited ? `Invited @${invited}` : 'No account'
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: friend.name }} />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <FriendAvatar name={friend.name} size={60} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontSize: 22, fontWeight: '800' }} numberOfLines={1}>{friend.name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name={friend.username ? 'verified' : invited ? 'schedule' : 'person_off'} size={15} color={friend.username ? c.primary : c.muted} />
            <T style={{ fontSize: 13, color: friend.username ? c.primary : c.muted, fontWeight: friend.username ? '600' : '400' }}>{account}</T>
          </View>
          {friend.email && <T muted style={{ fontSize: 12 }}>{friend.email}</T>}
        </View>
        <IconButton icon="edit" onPress={() => setEditing(true)} />
        <IconButton icon="delete" color={c.negative} onPress={remove} />
      </Card>
      {!friend.username && !invited && <Button title="Link to Kinetic account" icon="link" variant="outlined" onPress={() => setLinking(true)} />}

      {summary && summary.count > 0 && (
        <>
          <StatGrid>
            <Stat label="Together" value={`${summary.count} ${summary.count === 1 ? 'activity' : 'activities'}`} />
            <Stat label="Distance" value={km(summary.meters)} />
            <Stat label="Time" value={hours(summary.seconds)} />
            <Stat label="Since" value={formatDate(activities?.[activities.length - 1]?.date)} />
          </StatGrid>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {sports.map(([sport, count]) => (
              <View key={sport} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.soft }}>
                <SportIcon sport={sport} size={16} />
                <T style={{ fontSize: 13 }}>{sportLabel(sport)} <T style={{ fontWeight: '700', fontSize: 13 }}>{count}</T></T>
              </View>
            ))}
          </View>
          <SectionHeading icon="history" title="Activities together" />
        </>
      )}
      {activities?.length === 0 && (
        <Empty icon="group">No activities with {friend.name} yet. Tag them on an activity to see it here.</Empty>
      )}
      {months.map(([key, group]) => (
        <View key={key} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <T style={{ fontWeight: '700' }}>{monthTitle(key)}</T>
            <T muted style={{ fontSize: 12 }}>{monthSummary(group)}</T>
          </View>
          {group.map((a) => <ActivityCard key={a.id} a={a} />)}
        </View>
      ))}

      <FriendFormSheet friend={editing ? friend : null} onClose={() => setEditing(false)} onSaved={reload} />
      <FindFriendsSheet visible={linking} link={friend} onClose={() => setLinking(false)} onChanged={reload} />
    </Screen>
  )
}
