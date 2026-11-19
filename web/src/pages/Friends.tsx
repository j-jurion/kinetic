import { useCallback, useEffect, useState } from 'react'
import { Avatar, Button, Dialog, DialogContent, IconButton, TextField } from '@mui/material'
import { api } from '../lib/api'
import type { Friend } from '../lib/types'
import { Icon } from '../components/icons'
import { useNotify } from '../components/Notify'

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
      <div className="row items-center justify-between w-full q-mb-md">
        <div className="text-h5 text-weight-bold">Friends</div>
        <Button
          variant="contained"
          size="small"
          startIcon={<Icon name="person_add" size={20} />}
          onClick={() => {
            setName('')
            setAdding(true)
          }}
        >
          + Add Friend
        </Button>
      </div>

      <div className="column w-full gap-3">
        {friends?.length === 0 && <div className="text-grey-6 q-mt-lg">No friends added yet.</div>}
        {friends?.map((f) => (
          <div key={f.id} className="card w-full q-pa-sm">
            <div className="row items-center justify-between no-wrap w-full">
              <div className="row items-center no-wrap gap-3">
                <Avatar sx={{ bgcolor: 'primary.main', color: '#fff' }}>{f.name[0]?.toUpperCase()}</Avatar>
                <span className="text-weight-medium text-body1">{f.name}</span>
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
