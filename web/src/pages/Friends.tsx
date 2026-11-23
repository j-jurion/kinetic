import { useCallback, useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, IconButton, TextField } from '@mui/material'
import { api } from '../lib/api'
import type { Friend } from '@kinetic/shared/types'
import { EmptyCard } from '../components/fields'
import { Icon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { useNotify } from '../components/Notify'

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #fb923c, #ea580c)',
  'linear-gradient(135deg, #60a5fa, #2563eb)',
  'linear-gradient(135deg, #34d399, #059669)',
  'linear-gradient(135deg, #a78bfa, #7c3aed)',
  'linear-gradient(135deg, #f472b6, #db2777)',
  'linear-gradient(135deg, #2dd4bf, #0f766e)',
]

/** A stable colour per name, so each friend keeps the same avatar. */
function avatarColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

export function FriendsPage() {
  const notify = useNotify()
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const refresh = useCallback(() => {
    api.get<Friend[]>('/friends').then(setFriends)
  }, [])
  useEffect(refresh, [refresh])

  const add = async () => {
    if (!name.trim()) {
      notify('Name is required', 'warning')
      return
    }
    try {
      await api.post('/friends', { name })
      notify('Friend added!', 'success')
      setAdding(false)
      refresh()
    } catch {
      notify('Failed to add friend', 'error')
    }
  }

  return (
    <>
      <PageHeader icon="people" kicker="Training partners" title="Friends" subtitle="People you train with. Tag them on an activity from its detail page.">
        <Button
          variant="contained"
          startIcon={<Icon name="person_add" size={20} />}
          onClick={() => {
            setName('')
            setAdding(true)
          }}
        >
          Add friend
        </Button>
      </PageHeader>

      {friends?.length === 0 && <EmptyCard icon="group_add">No friends added yet.</EmptyCard>}
      <div className="friend-grid">
        {friends?.map((f) => (
          <div key={f.id} className="card friend-card">
              <span className="friend-avatar" style={{ background: avatarColor(f.name) }}>
                {f.name[0]?.toUpperCase()}
              </span>
              <div className="column gap-0 flex-1 min-w-0">
                <span className="text-weight-bold text-body1 ellipsis">{f.name}</span>
                {f.email && <span className="text-caption text-grey-6 ellipsis">{f.email}</span>}
              </div>
              <IconButton
                size="small"
                color="error"
                aria-label={`Delete ${f.name}`}
                onClick={async () => {
                  await api.delete(`/friends/${f.id}`)
                  refresh()
                }}
              >
                <Icon name="delete" size={18} />
              </IconButton>
          </div>
        ))}
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)}>
        <DialogContent sx={{ p: 2, width: 'min(380px, calc(100vw - 32px))' }}>
          <div className="text-h6 q-mb-md">Add Friend</div>
          <TextField
            label="Name"
            value={name}
            autoFocus
            fullWidth
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <div className="row justify-end gap-2 q-mt-md">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="contained" onClick={add}>
              Add
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
