import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { formatDate } from '@kinetic/shared/format'
import { togetherLabel } from '@kinetic/shared/friends'
import type { Friend, FriendRequest, FriendRequests } from '@kinetic/shared/types'
import { FriendAvatar } from '../../components/FriendAvatar'
import { Icon } from '../../components/Icon'
import { FindFriendsSheet, FriendFormSheet } from '../../components/FriendSheets'
import { useNotify } from '../../components/Notify'
import { Button, Caption, Card, Empty, FormSheet, PageHeader, Screen, SectionHeading, Select, T, useColors } from '../../components/ui'
import { api } from '../../lib/api'
import { friendRequestsChanged } from '../../lib/friendRequests'
import { useApi } from '../../lib/useApi'

const errorMessage = (error: unknown) => (error as Error).message

export default function FriendsScreen() {
  const notify = useNotify()
  const { data: friends, reload: reloadFriends } = useApi<Friend[]>('/friends')
  const { data: requests, reload: reloadRequests } = useApi<FriendRequests>('/friend-requests')
  const [finding, setFinding] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<FriendRequest | null>(null)

  const reload = () => {
    reloadFriends()
    reloadRequests()
    friendRequestsChanged()
  }
  const incoming = requests?.incoming ?? []
  const outgoing = requests?.outgoing ?? []
  const offline = friends?.filter((f) => !f.username) ?? []

  const accept = async (request: FriendRequest, friendId: number | null) => {
    try {
      await api.post(`/friend-requests/${request.id}/accept`, { friend_id: friendId })
      notify(`You and ${request.username} are now friends`, 'success')
      setAccepting(null)
      reload()
    } catch (error) {
      notify(`Failed to accept: ${errorMessage(error)}`, 'error')
    }
  }
  const answer = async (path: string, method: 'post' | 'delete') => {
    try {
      await (method === 'post' ? api.post(path) : api.delete(path))
      reload()
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  return (
    <Screen onRefresh={reload}>
      <PageHeader kicker="Training partners" title="Friends" subtitle="Find friends on Kinetic, or add people who don't use the app.">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Find friends" icon="person_search" onPress={() => setFinding(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="No account" icon="person_add" variant="outlined" onPress={() => setAdding('')} />
          </View>
        </View>
      </PageHeader>

      {incoming.length > 0 && (
        <>
          <SectionHeading icon="mark_email_unread" title={`Friend requests (${incoming.length})`} />
          {incoming.map((r) => (
            <RequestCard key={r.id} request={r} caption="Wants to be friends">
              <Button title="Accept" onPress={() => (offline.length ? setAccepting(r) : accept(r, null))} />
              <IconAction icon="close" label={`Decline ${r.username}`} onPress={() => answer(`/friend-requests/${r.id}/decline`, 'post')} />
            </RequestCard>
          ))}
        </>
      )}

      {(incoming.length > 0 || outgoing.length > 0) && <SectionHeading icon="people" title="Your friends" />}
      {friends === null && <ActivityIndicator />}
      {friends?.length === 0 && (
        <Empty icon="group_add">No friends yet. Find them by username, or add someone without an account.</Empty>
      )}
      {friends?.map((f) => <FriendRow key={f.id} friend={f} invited={outgoing.find((r) => r.friend_id === f.id)?.username} />)}

      {outgoing.length > 0 && (
        <>
          <SectionHeading icon="schedule_send" title="Sent requests" />
          {outgoing.map((r) => (
            <RequestCard key={r.id} request={r} caption={`Waiting for an answer · ${formatDate(r.created_at)}`}>
              <Button title="Cancel" variant="text" onPress={() => answer(`/friend-requests/${r.id}`, 'delete')} />
            </RequestCard>
          ))}
        </>
      )}

      <FindFriendsSheet
        visible={finding}
        onClose={() => setFinding(false)}
        onChanged={reload}
        onAddOffline={(name) => {
          setFinding(false)
          setAdding(name)
        }}
      />
      <FriendFormSheet friend={adding === null ? null : { name: adding }} onClose={() => setAdding(null)} onSaved={reload} />
      <AcceptSheet request={accepting} offline={offline} onClose={() => setAccepting(null)} onAccept={accept} />
    </Screen>
  )
}

function IconAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const c = useColors()
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={{ padding: 6 }}>
      <Icon name={icon} size={20} color={c.muted} />
    </Pressable>
  )
}

function RequestCard({ request, caption, children }: { request: FriendRequest; caption: string; children: React.ReactNode }) {
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <FriendAvatar name={request.username} />
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '700' }} numberOfLines={1}>{request.username}</T>
        <Caption>{caption}</Caption>
      </View>
      {children}
    </Card>
  )
}

/** A friend in the list, opening the friend's screen. */
function FriendRow({ friend: f, invited }: { friend: Friend; invited?: string }) {
  const c = useColors()
  const account = f.username ? `@${f.username}` : invited ? `Invited @${invited}` : 'No account'
  return (
    <Card onPress={() => router.push(`/friends/${f.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <FriendAvatar name={f.name} />
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: '700' }} numberOfLines={1}>{f.name}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={f.username ? 'verified' : invited ? 'schedule' : 'person_off'} size={14} color={f.username ? c.primary : c.muted} />
          <T style={{ fontSize: 12, color: f.username ? c.primary : c.muted, fontWeight: f.username ? '600' : '400' }}>{account}</T>
        </View>
        <Caption>{togetherLabel(f)}</Caption>
      </View>
      <Icon name="chevron_right" size={22} color={c.muted} />
    </Card>
  )
}

/** Accept a request, optionally linking it to a friend without an account. */
function AcceptSheet({ request, offline, onClose, onAccept }: {
  request: FriendRequest | null
  offline: Friend[]
  onClose: () => void
  onAccept: (request: FriendRequest, friendId: number | null) => void
}) {
  const [choice, setChoice] = useState('new')

  useEffect(() => {
    if (!request) return
    const match = offline.find((f) => f.name.toLowerCase() === request.username.toLowerCase())
    setChoice(match ? String(match.id) : 'new')
  }, [request, offline])

  const options: [string, string][] = [
    ['new', `A new friend “${request?.username ?? ''}”`],
    ...offline.map((f): [string, string] => [String(f.id), `Link to ${f.name}`]),
  ]
  return (
    <FormSheet
      visible={request !== null}
      title={`Accept ${request?.username ?? ''}`}
      onClose={onClose}
      onSave={() => request && onAccept(request, choice === 'new' ? null : Number(choice))}
      saveLabel="Accept"
    >
      <Caption>Already added them without an account? Link that friend so the activities you tagged them on carry over.</Caption>
      <Select label="Add as" value={choice} options={options} onChange={setChoice} />
    </FormSheet>
  )
}
