import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, CircularProgress, IconButton, ListItemIcon, Menu, MenuItem } from '@mui/material'
import { api } from '../lib/api'
import { friendRequestsChanged } from '../lib/friendRequests'
import { formatDate } from '@kinetic/shared/format'
import { togetherLabel } from '@kinetic/shared/friends'
import type { Friend, FriendRequest, FriendRequests } from '@kinetic/shared/types'
import { FriendAvatar } from '../components/FriendAvatar'
import { AcceptDialog, EditFriendDialog, FindFriendsDialog, RemoveFriendDialog } from '../components/FriendDialogs'
import { EmptyCard } from '../components/fields'
import { Icon } from '../components/icons'
import { PageHeader, SectionHeading } from '../components/PageHeader'
import { useNotify } from '../components/Notify'

const errorMessage = (error: unknown) => (error as Error).message

export function FriendsPage() {
  const notify = useNotify()
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [requests, setRequests] = useState<FriendRequests>({ incoming: [], outgoing: [] })
  const [finding, setFinding] = useState<{ link?: Friend } | null>(null)
  const [editing, setEditing] = useState<Partial<Friend> | null>(null)
  const [accepting, setAccepting] = useState<FriendRequest | null>(null)
  const [removing, setRemoving] = useState<Friend | null>(null)

  const refresh = useCallback(() => {
    api.get<Friend[]>('/friends').then(setFriends)
    api.get<FriendRequests>('/friend-requests').then(setRequests)
    friendRequestsChanged()
  }, [])
  useEffect(refresh, [refresh])

  const offline = friends?.filter((f) => !f.username) ?? []
  const pendingLink = new Map(requests.outgoing.filter((r) => r.friend_id).map((r) => [r.friend_id, r.username]))

  const accept = async (request: FriendRequest, friendId: number | null) => {
    try {
      const friend = await api.post<Friend>(`/friend-requests/${request.id}/accept`, { friend_id: friendId })
      notify(`You and ${request.username} are now friends`, 'success')
      setAccepting(null)
      refresh()
      return friend
    } catch (error) {
      notify(`Failed to accept: ${errorMessage(error)}`, 'error')
    }
  }
  const decline = async (request: FriendRequest) => {
    try {
      await api.post(`/friend-requests/${request.id}/decline`)
      refresh()
    } catch (error) {
      notify(`Failed to decline: ${errorMessage(error)}`, 'error')
    }
  }
  const cancel = async (request: FriendRequest) => {
    try {
      await api.delete(`/friend-requests/${request.id}`)
      refresh()
    } catch (error) {
      notify(`Failed to cancel: ${errorMessage(error)}`, 'error')
    }
  }

  return (
    <>
      <PageHeader
        icon="people"
        kicker="Training partners"
        title="Friends"
        subtitle="Find friends on Kinetic, or add people who don't use the app. Tag them on your activities."
      >
        <Button variant="outlined" startIcon={<Icon name="person_outline" size={20} />} onClick={() => setEditing({ name: '' })}>
          Add without account
        </Button>
        <Button variant="contained" startIcon={<Icon name="person_search" size={20} />} onClick={() => setFinding({})}>
          Find friends
        </Button>
      </PageHeader>

      {requests.incoming.length > 0 && (
        <>
          <SectionHeading icon="mark_email_unread">
            Friend requests <span className="friend-count-badge">{requests.incoming.length}</span>
          </SectionHeading>
          <div className="friend-grid friend-grid--wide">
            {requests.incoming.map((r) => (
              <div key={r.id} className="card friend-card friend-card--request">
                <FriendAvatar name={r.username} />
                <div className="column gap-0 flex-1 min-w-0">
                  <span className="text-weight-bold text-body1 ellipsis">{r.username}</span>
                  <span className="text-caption text-grey-6 ellipsis" title={`Sent ${formatDate(r.created_at)}`}>
                    Wants to be friends
                  </span>
                </div>
                <div className="row no-wrap gap-1">
                  <Button size="small" variant="contained" onClick={() => (offline.length ? setAccepting(r) : accept(r, null))}>
                    Accept
                  </Button>
                  <IconButton size="small" aria-label={`Decline ${r.username}`} onClick={() => decline(r)}>
                    <Icon name="close" size={18} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(requests.incoming.length > 0 || requests.outgoing.length > 0) && (
        <SectionHeading icon="people">Your friends</SectionHeading>
      )}
      {friends === null && <CircularProgress size={28} sx={{ alignSelf: "center" }} />}
      {friends?.length === 0 && (
        <EmptyCard icon="group_add">
          No friends yet. Find them by username, or add someone without an account to tag them on activities.
        </EmptyCard>
      )}
      <div className="friend-grid">
        {friends?.map((f) => (
          <FriendCard
            key={f.id}
            friend={f}
            pendingUsername={pendingLink.get(f.id)}
            onEdit={() => setEditing(f)}
            onLink={() => setFinding({ link: f })}
            onRemove={() => setRemoving(f)}
          />
        ))}
      </div>

      {requests.outgoing.length > 0 && (
        <>
          <SectionHeading icon="schedule_send">Sent requests</SectionHeading>
          <div className="friend-grid friend-grid--wide">
            {requests.outgoing.map((r) => (
              <div key={r.id} className="card friend-card">
                <FriendAvatar name={r.username} size={36} />
                <div className="column gap-0 flex-1 min-w-0">
                  <span className="text-weight-bold text-body2 ellipsis">{r.username}</span>
                  <span className="text-caption text-grey-6">Waiting for an answer · {formatDate(r.created_at)}</span>
                </div>
                <Button size="small" color="inherit" onClick={() => cancel(r)}>
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      <FindFriendsDialog
        open={finding !== null}
        link={finding?.link}
        onClose={() => setFinding(null)}
        onChanged={refresh}
        onAddOffline={(name) => {
          setFinding(null)
          setEditing({ name })
        }}
      />
      <EditFriendDialog friend={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <AcceptDialog request={accepting} offline={offline} onClose={() => setAccepting(null)} onAccept={accept} />
      <RemoveFriendDialog friend={removing} onClose={() => setRemoving(null)} onRemoved={refresh} />
    </>
  )
}

function FriendCard({
  friend: f,
  pendingUsername,
  onEdit,
  onLink,
  onRemove,
}: {
  friend: Friend
  pendingUsername?: string
  onEdit: () => void
  onLink: () => void
  onRemove: () => void
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  return (
    <div className="card friend-card">
      <Link to={`/friends/${f.id}`} className="row items-center no-wrap gap-3 flex-1 min-w-0 card-link">
      <FriendAvatar name={f.name} />
      <div className="column gap-0 flex-1 min-w-0">
        <span className="text-weight-bold text-body1 ellipsis">{f.name}</span>
        {f.username ? (
          <span className="friend-account friend-account--linked ellipsis" title="On Kinetic">
            <Icon name="verified" size={14} /> @{f.username}
          </span>
        ) : pendingUsername ? (
          <span className="friend-account ellipsis">
            <Icon name="schedule" size={14} /> Invited @{pendingUsername}
          </span>
        ) : (
          <span className="friend-account ellipsis">
            <Icon name="person_off" size={14} /> No account{f.email ? ` · ${f.email}` : ''}
          </span>
        )}
        <span className="text-caption text-grey-6 ellipsis">{togetherLabel(f)}</span>
      </div>
      </Link>
      <IconButton size="small" aria-label={`Options for ${f.name}`} onClick={(e) => setMenu(e.currentTarget)}>
        <Icon name="more_vert" size={20} />
      </IconButton>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)} onClick={() => setMenu(null)}>
        <MenuItem onClick={onEdit}>
          <ListItemIcon>
            <Icon name="edit" size={18} />
          </ListItemIcon>
          Edit
        </MenuItem>
        {!f.username && !pendingUsername && (
          <MenuItem onClick={onLink}>
            <ListItemIcon>
              <Icon name="link" size={18} />
            </ListItemIcon>
            Link to Kinetic account
          </MenuItem>
        )}
        <MenuItem onClick={onRemove} sx={{ color: 'error.main' }}>
          <ListItemIcon>
            <Icon name="delete" size={18} color="currentColor" />
          </ListItemIcon>
          Remove
        </MenuItem>
      </Menu>
    </div>
  )
}

