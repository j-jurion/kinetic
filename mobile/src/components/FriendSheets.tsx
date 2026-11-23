import { useEffect, useState } from 'react'
import type { Friend, UserSearchResult } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { FriendAvatar } from './FriendAvatar'
import { useNotify } from './Notify'
import { Button, Caption, Card, Field, FormSheet, T } from './ui'

const errorMessage = (error: unknown) => (error as Error).message

const ACTION_LABELS: Record<UserSearchResult['status'], string> = {
  none: 'Add',
  outgoing: 'Requested',
  incoming: 'Accept',
  friend: 'Friends',
}

/** Search accounts by username and send them a friend request (or link a friend to one). */
export function FindFriendsSheet({ visible, link, onClose, onChanged, onAddOffline }: {
  visible: boolean
  link?: Friend
  onClose: () => void
  onChanged: () => void
  onAddOffline?: (name: string) => void
}) {
  const notify = useNotify()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (visible) {
      setQuery('')
      setResults(null)
    }
  }, [visible])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      api.get<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(q)}`).then(
        (rows) => !cancelled && setResults(rows),
        () => !cancelled && setResults([]),
      )
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const act = async (user: UserSearchResult) => {
    setBusy(user.username)
    try {
      if (user.status === 'incoming' && user.request_id) {
        await api.post(`/friend-requests/${user.request_id}/accept`, { friend_id: link?.id ?? null })
        notify(`You and ${user.username} are now friends`, 'success')
      } else {
        const result = await api.post<{ status: string }>('/friend-requests', { username: user.username, friend_id: link?.id ?? null })
        notify(result.status === 'accepted' ? `You and ${user.username} are now friends` : `Friend request sent to ${user.username}`, 'success')
      }
      onChanged()
      if (link) onClose()
      else {
        const status = user.status === 'incoming' ? 'friend' : 'outgoing'
        setResults((rows) => rows?.map((r) => (r.username === user.username ? { ...r, status } : r)) ?? null)
      }
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const q = query.trim()
  return (
    <FormSheet visible={visible} title={link ? `Link ${link.name}` : 'Find friends'} onClose={onClose}>
      <Caption>
        {link
          ? `Once they accept, ${link.name} and the activities they are tagged on are linked to their account.`
          : 'Search by username. They can accept your request from their Friends screen.'}
      </Caption>
      <Field label="Username" value={query} onChangeText={setQuery} autoFocus autoCapitalize="none" autoCorrect={false} />
      {q.length === 1 && <Caption>Type at least 2 characters.</Caption>}
      {results?.length === 0 && <Caption>No one with “{q}” in their username.</Caption>}
      {results?.map((user) => (
        <Card key={user.username} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
          <FriendAvatar name={user.username} size={34} />
          <T style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>{user.username}</T>
          <Button
            title={link && user.status === 'none' ? 'Link' : ACTION_LABELS[user.status]}
            variant={user.status === 'none' || user.status === 'incoming' ? 'contained' : 'text'}
            disabled={user.status === 'outgoing' || user.status === 'friend' || busy !== null}
            busy={busy === user.username}
            onPress={() => act(user)}
          />
        </Card>
      ))}
      {onAddOffline && <Button title="Add without account" icon="person_add" variant="text" onPress={() => onAddOffline(q)} />}
    </FormSheet>
  )
}

/** Add a friend without an account (no id) or edit a friend's name and email. */
export function FriendFormSheet({ friend, onClose, onSaved }: { friend: Partial<Friend> | null; onClose: () => void; onSaved: () => void }) {
  const notify = useNotify()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const isNew = !friend?.id

  useEffect(() => {
    if (friend) {
      setName(friend.name ?? '')
      setEmail(friend.email ?? '')
    }
  }, [friend])

  const save = async () => {
    if (!name.trim()) return notify('Name is required', 'warning')
    try {
      const body = { name, email: email.trim() || null }
      if (isNew) await api.post('/friends', body)
      else await api.patch(`/friends/${friend?.id}`, body)
      notify(isNew ? 'Friend added!' : 'Saved', 'success')
      onClose()
      onSaved()
    } catch (error) {
      notify(`Failed to save: ${errorMessage(error)}`, 'error')
    }
  }

  return (
    <FormSheet visible={friend !== null} title={isNew ? 'Add friend' : 'Edit friend'} onClose={onClose} onSave={save} saveLabel={isNew ? 'Add' : 'Save'}>
      {isNew && <Caption>For people who don't use Kinetic. You can link them to an account later.</Caption>}
      <Field label="Name" value={name} autoFocus onChangeText={setName} />
      <Field label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    </FormSheet>
  )
}

