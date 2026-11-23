import { useEffect, useState } from 'react'
import { Button, CircularProgress, Dialog, DialogContent, InputAdornment, MenuItem, TextField } from '@mui/material'
import type { Friend, FriendRequest, UserSearchResult } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { FriendAvatar } from './FriendAvatar'
import { Icon } from './icons'
import { useNotify } from './Notify'

const errorMessage = (error: unknown) => (error as Error).message

const ACTION_LABELS: Record<UserSearchResult['status'], string> = {
  none: 'Add',
  outgoing: 'Requested',
  incoming: 'Accept',
  friend: 'Friends',
}

/** Search accounts by username and send them a friend request. */
export function FindFriendsDialog({
  open,
  link,
  onClose,
  onChanged,
  onAddOffline,
}: {
  open: boolean
  /** A friend without an account to link to the account the request goes to. */
  link?: Friend
  onClose: () => void
  onChanged: () => void
  onAddOffline: (name: string) => void
}) {
  const notify = useNotify()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults(null)
    }
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      api
        .get<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(q)}`)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && setResults([]))
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const act = async (user: UserSearchResult) => {
    setBusy(user.username)
    try {
      if (user.status === 'incoming' && user.request_id) {
        await api.post(`/friend-requests/${user.request_id}/accept`, { friend_id: link?.id ?? null })
        notify(`You and ${user.username} are now friends`, 'success')
      } else {
        const result = await api.post<{ status: string }>('/friend-requests', {
          username: user.username,
          friend_id: link?.id ?? null,
        })
        notify(
          result.status === 'accepted' ? `You and ${user.username} are now friends` : `Friend request sent to ${user.username}`,
          'success',
        )
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
    <Dialog open={open} onClose={onClose}>
      <DialogContent sx={{ p: 2, width: 'min(440px, calc(100vw - 32px))' }}>
        <div className="text-h6">{link ? `Link ${link.name} to an account` : 'Find friends'}</div>
        <div className="text-body2 text-grey-6 q-mb-md">
          {link
            ? `Once they accept, ${link.name} and the activities they are tagged on are linked to their account.`
            : 'Search by username. They can accept your request from their Friends page.'}
        </div>
        <TextField
          value={query}
          autoFocus
          fullWidth
          placeholder="Username"
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name="search" size={20} className="text-grey-6" />
                </InputAdornment>
              ),
            },
          }}
        />
        <div className="column gap-1 q-mt-sm find-results">
          {q.length > 0 && q.length < 2 && <div className="text-caption text-grey-6">Type at least 2 characters.</div>}
          {results?.length === 0 && <div className="text-body2 text-grey-6 find-empty">No one with “{q}” in their username.</div>}
          {results?.map((user) => (
            <div key={user.username} className="row items-center no-wrap gap-3 find-result">
              <FriendAvatar name={user.username} size={34} />
              <span className="flex-1 text-weight-medium ellipsis">{user.username}</span>
              <Button
                size="small"
                variant={user.status === 'none' || user.status === 'incoming' ? 'contained' : 'text'}
                disabled={user.status === 'outgoing' || user.status === 'friend' || busy !== null}
                startIcon={busy === user.username ? <CircularProgress size={14} /> : undefined}
                onClick={() => act(user)}
              >
                {link && user.status === 'none' ? 'Link' : ACTION_LABELS[user.status]}
              </Button>
            </div>
          ))}
        </div>
        <div className="row items-center justify-between gap-2 q-mt-md">
          {!link ? (
            <Button size="small" startIcon={<Icon name="person_outline" size={18} />} onClick={() => onAddOffline(q)}>
              Add without account
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Add a friend without an account, or edit a friend's name and email. */
export function EditFriendDialog({ friend, onClose, onSaved }: { friend: Partial<Friend> | null; onClose: () => void; onSaved: () => void }) {
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
    if (!name.trim()) {
      notify('Name is required', 'warning')
      return
    }
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
    <Dialog open={friend !== null} onClose={onClose}>
      <DialogContent sx={{ p: 2, width: 'min(400px, calc(100vw - 32px))' }} className="column gap-3">
        <div>
          <div className="text-h6">{isNew ? 'Add friend without account' : `Edit ${friend?.name}`}</div>
          {isNew && (
            <div className="text-body2 text-grey-6">
              For people who don't use Kinetic. You can link them to an account later.
            </div>
          )}
        </div>
        <TextField label="Name" value={name} autoFocus fullWidth onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <TextField label="Email (optional)" type="email" value={email} fullWidth onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div className="row justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={save}>
            {isNew ? 'Add' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Accept a request, optionally merging it into a friend without an account. */
export function AcceptDialog({
  request,
  offline,
  onClose,
  onAccept,
}: {
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

  return (
    <Dialog open={request !== null} onClose={onClose}>
      <DialogContent sx={{ p: 2, width: 'min(420px, calc(100vw - 32px))' }} className="column gap-3">
        <div>
          <div className="text-h6">Accept {request?.username}</div>
          <div className="text-body2 text-grey-6">
            Already added them without an account? Link that friend so the activities you tagged them on carry over.
          </div>
        </div>
        <TextField select label="Add as" value={choice} onChange={(e) => setChoice(e.target.value)} fullWidth>
          <MenuItem value="new">A new friend “{request?.username}”</MenuItem>
          {offline.map((f) => (
            <MenuItem key={f.id} value={String(f.id)}>
              Link to {f.name}
              {f.activity_count ? ` (${f.activity_count} activities)` : ''}
            </MenuItem>
          ))}
        </TextField>
        <div className="row justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={() => request && onAccept(request, choice === 'new' ? null : Number(choice))}>
            Accept
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Confirm, then remove a friend from this account. */
export function RemoveFriendDialog({ friend, onClose, onRemoved }: { friend: Friend | null; onClose: () => void; onRemoved: () => void }) {
  const notify = useNotify()
  const count = friend?.activity_count ?? 0
  const remove = async () => {
    if (!friend) return
    try {
      await api.delete(`/friends/${friend.id}`)
      onClose()
      onRemoved()
    } catch (error) {
      notify(`Failed to remove: ${errorMessage(error)}`, 'error')
    }
  }
  return (
    <Dialog open={friend !== null} onClose={onClose}>
      <DialogContent sx={{ p: 2, width: 'min(400px, calc(100vw - 32px))' }}>
        <div className="text-h6 q-mb-sm">Remove {friend?.name}?</div>
        <div className="text-body2 text-grey-7">
          {count
            ? `They are also removed from the ${count} ${count === 1 ? 'activity' : 'activities'} they are tagged on.`
            : 'They are not tagged on any activities.'}
          {friend?.username && ' You stay in their own friends list.'}
        </div>
        <div className="row justify-end gap-2 q-mt-md">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" color="error" onClick={remove}>
            Remove
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
