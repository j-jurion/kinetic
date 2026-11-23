import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, CircularProgress, IconButton } from '@mui/material'
import { hours, km, totals } from '@kinetic/shared/activityList'
import { formatDate, sportLabel } from '@kinetic/shared/format'
import { accountLabel, sportCounts } from '@kinetic/shared/friends'
import type { ActivityRow, Friend, FriendRequests } from '@kinetic/shared/types'
import { api, qs } from '../lib/api'
import { ActivityMonths } from '../components/ActivityMonths'
import { EmptyCard, Stat } from '../components/fields'
import { FriendAvatar } from '../components/FriendAvatar'
import { EditFriendDialog, FindFriendsDialog, RemoveFriendDialog } from '../components/FriendDialogs'
import { Icon, SportIcon } from '../components/icons'
import { SectionHeading } from '../components/PageHeader'

/**
 * One friend: the activities you did together and what they add up to. Only your own log is
 * shown, so this works the same for friends with and without an account.
 */
export function FriendDetailPage() {
  const friendId = Number(useParams().id)
  const navigate = useNavigate()
  const [friend, setFriend] = useState<Friend | null>(null)
  const [missing, setMissing] = useState(false)
  const [activities, setActivities] = useState<ActivityRow[] | null>(null)
  const [invited, setInvited] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [removing, setRemoving] = useState(false)

  const load = useCallback(() => {
    api.get<Friend>(`/friends/${friendId}`).then(setFriend, () => setMissing(true))
    api.get<ActivityRow[]>(`/activities${qs({ friend: friendId })}`).then(setActivities, () => setActivities([]))
    api
      .get<FriendRequests>('/friend-requests')
      .then((r) => setInvited(r.outgoing.find((o) => o.friend_id === friendId)?.username ?? null))
      .catch(() => setInvited(null))
  }, [friendId])
  useEffect(load, [load])

  const summary = useMemo(() => (activities ? totals(activities) : null), [activities])
  const sports = useMemo(() => (activities ? sportCounts(activities) : []), [activities])
  const first = activities?.length ? activities[activities.length - 1].date : null

  if (missing) return <EmptyCard icon="person_off">This friend no longer exists.</EmptyCard>
  if (!friend) return <CircularProgress size={28} sx={{ alignSelf: 'center' }} />

  return (
    <>
      <header className="page-header friend-hero">
        <div className="page-header-main">
          <IconButton size="small" onClick={() => navigate('/friends')} aria-label="Back to friends">
            <Icon name="arrow_back" />
          </IconButton>
          <FriendAvatar name={friend.name} size={64} />
          <div className="column gap-0 min-w-0">
            <div className="page-header-kicker">Friend</div>
            <h1 className="page-header-title ellipsis">{friend.name}</h1>
            <div className={`friend-account ${friend.username ? 'friend-account--linked' : ''}`}>
              <Icon name={friend.username ? 'verified' : invited ? 'schedule' : 'person_off'} size={15} />
              {friend.username ? accountLabel(friend) : invited ? `Invited @${invited}` : 'No account'}
              {friend.email && <span className="text-grey-6"> · {friend.email}</span>}
            </div>
          </div>
        </div>
        <div className="page-header-actions">
          {!friend.username && !invited && (
            <Button variant="outlined" startIcon={<Icon name="link" size={18} />} onClick={() => setLinking(true)}>
              Link account
            </Button>
          )}
          <IconButton onClick={() => setEditing(true)} aria-label="Edit friend">
            <Icon name="edit" size={20} />
          </IconButton>
          <IconButton color="error" onClick={() => setRemoving(true)} aria-label="Remove friend">
            <Icon name="delete" size={20} />
          </IconButton>
        </div>
      </header>

      {summary && summary.count > 0 && (
        <>
          <div className="stat-grid">
            <Stat label="Together" value={`${summary.count} ${summary.count === 1 ? 'activity' : 'activities'}`} />
            <Stat label="Distance" value={km(summary.meters)} />
            <Stat label="Time" value={hours(summary.seconds)} />
            <Stat label="Since" value={formatDate(first)} />
          </div>
          <div className="row flex-wrap gap-2">
            {sports.map(([sport, count]) => (
              <span key={sport} className="friend-sport-chip">
                <SportIcon sport={sport} size={16} />
                {sportLabel(sport)} <b>{count}</b>
              </span>
            ))}
          </div>
          <SectionHeading icon="history">Activities together</SectionHeading>
        </>
      )}

      {activities?.length === 0 && (
        <EmptyCard icon="group">
          No activities with {friend.name} yet. Tag them on an activity from its detail page to see it here.
        </EmptyCard>
      )}
      <ActivityMonths activities={activities} />

      <EditFriendDialog friend={editing ? friend : null} onClose={() => setEditing(false)} onSaved={load} />
      <FindFriendsDialog open={linking} link={friend} onClose={() => setLinking(false)} onChanged={load} onAddOffline={() => setLinking(false)} />
      <RemoveFriendDialog
        friend={removing ? { ...friend, activity_count: summary?.count ?? 0 } : null}
        onClose={() => setRemoving(false)}
        onRemoved={() => navigate('/friends')}
      />
    </>
  )
}
