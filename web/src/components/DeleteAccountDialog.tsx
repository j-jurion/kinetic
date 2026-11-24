import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, CircularProgress, Dialog, DialogContent, TextField } from '@mui/material'
import { api } from '../lib/api'

/** Asks for the password again, then permanently deletes the account and all of its data. */
export function DeleteAccountDialog({ open, onClose, onDeleted }: { open: boolean; onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    if (busy) return
    setPassword('')
    setError('')
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/delete-account', { password })
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deleting the account failed')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={close}>
      <DialogContent sx={{ p: 2, width: 'min(440px, calc(100vw - 32px))' }}>
        <form onSubmit={submit} className="column gap-3">
          <div className="text-h6">Delete account</div>
          <div className="text-body2">
            This permanently deletes your account, all activities and their files, race results, friends, friend
            requests, and your Garmin and Apple Health connections. It cannot be undone.
          </div>
          <TextField
            type="password"
            label="Password"
            autoComplete="current-password"
            autoFocus
            fullWidth
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={Boolean(error)}
            helperText={error || 'Enter your password to confirm.'}
          />
          <div className="row items-center justify-end gap-2">
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              color="error"
              variant="contained"
              disabled={!password || busy}
              startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              Delete account
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
