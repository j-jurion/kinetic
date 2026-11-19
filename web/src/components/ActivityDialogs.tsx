import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  MenuItem,
  TextField,
} from '@mui/material'
import { api } from '../lib/api'
import { KINDS, SPORTS, formatDateTime, parseDateInput, sportLabel } from '../lib/format'
import type { Activity, Friend } from '../lib/types'
import { Icon } from './icons'
import { useNotify } from './Notify'

const numberOrNull = (value: string) => (value.trim() === '' || Number(value) === 0 ? null : Number(value))

interface EditProps {
  open: boolean
  /** The activity to edit, or null to add one manually. */
  activity: Activity | null
  onClose: () => void
  onSaved: () => void
}

/** Add or edit an activity by hand. */
export function ActivityEditDialog({ open, activity, onClose, onSaved }: EditProps) {
  const notify = useNotify()
  const isEdit = activity !== null
  const [form, setForm] = useState<Record<string, string>>({})
  const [friends, setFriends] = useState<Friend[]>([])
  const [selected, setSelected] = useState<Friend[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const a = activity
    setForm({
      name: a?.name ?? '',
      date: formatDateTime(a?.date ?? new Date()),
      sport: a?.sport ?? 'running',
      kind: a?.kind ?? 'training',
      duration: String(a?.duration_seconds ?? 0),
      distance: String(a?.distance_meters ?? 0),
      avgHr: String(a?.avg_heart_rate ?? 0),
      calories: String(a?.calories ?? 0),
      elevation: String(a?.elevation_gain_meters ?? 0),
      avgSpeed: String(a?.avg_speed_ms ?? 0),
      notes: a?.notes ?? '',
    })
    setSelected([])
    api.get<Friend[]>('/friends').then(setFriends).catch(() => setFriends([]))
    if (a) {
      api.get<Friend[]>(`/activities/${a.id}/friends`).then(setSelected).catch(() => setSelected([]))
    }
  }, [open, activity])

  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = async () => {
    const date = parseDateInput(form.date ?? '')
    if (!date) {
      notify('Invalid date — use dd-mm-yyyy HH:MM', 'error')
      return
    }
    const payload = {
      name: form.name,
      sport: form.sport,
      kind: form.kind,
      date,
      duration_seconds: Number(form.duration || 0),
      distance_meters: numberOrNull(form.distance),
      avg_heart_rate: numberOrNull(form.avgHr) === null ? null : Math.round(Number(form.avgHr)),
      calories: numberOrNull(form.calories) === null ? null : Math.round(Number(form.calories)),
      elevation_gain_meters: numberOrNull(form.elevation),
      avg_speed_ms: numberOrNull(form.avgSpeed),
      notes: form.notes || null,
      ...(friends.length ? { friend_ids: selected.map((f) => f.id) } : {}),
    }
    setSaving(true)
    try {
      if (isEdit) await api.patch(`/activities/${activity.id}`, payload)
      else await api.post('/activities', payload)
      notify('Saved!', 'success')
      onClose()
      onSaved()
    } catch (error) {
      notify(`Failed to save: ${(error as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const numberField = (label: string, key: string, step = 1) => (
    <TextField
      label={label}
      type="number"
      value={form[key] ?? ''}
      onChange={set(key)}
      className="flex-1"
      slotProps={{ htmlInput: { min: 0, step } }}
    />
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false}>
      <DialogContent className="column gap-4" sx={{ p: 2, width: 'min(600px, calc(100vw - 32px))', minWidth: { sm: 480 } }}>
        <div className="text-h6 q-mb-md">{isEdit ? 'Edit Activity' : 'Add Activity Manually'}</div>
        <TextField label="Name" value={form.name ?? ''} onChange={set('name')} className="w-full" />
        <TextField label="Date & Time (dd-mm-yyyy HH:MM)" value={form.date ?? ''} onChange={set('date')} className="w-full" />
        <div className="row no-wrap w-full gap-3">
          <TextField select label="Sport" value={form.sport ?? 'running'} onChange={set('sport')} className="flex-1">
            {SPORTS.map((s) => (
              <MenuItem key={s} value={s}>
                {sportLabel(s)}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Kind" value={form.kind ?? 'training'} onChange={set('kind')} className="flex-1">
            {KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </TextField>
        </div>
        <div className="row no-wrap w-full gap-3">
          {numberField('Duration (seconds)', 'duration')}
          {numberField('Distance (meters)', 'distance')}
        </div>
        <div className="row no-wrap w-full gap-3">
          {numberField('Avg HR (bpm)', 'avgHr')}
          {numberField('Calories', 'calories')}
        </div>
        <div className="row no-wrap w-full gap-3">
          {numberField('Elevation gain (m)', 'elevation')}
          {numberField('Avg speed (m/s)', 'avgSpeed', 0.1)}
        </div>
        <TextField label="Notes" value={form.notes ?? ''} onChange={set('notes')} multiline minRows={2} className="w-full" />
        {friends.length > 0 && (
          <Autocomplete
            multiple
            className="w-full"
            options={friends}
            value={selected}
            getOptionLabel={(f) => f.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_, value) => setSelected(value)}
            renderInput={(params) => <TextField {...params} label="Friends" />}
          />
        )}
        <div className="row justify-end gap-2 q-mt-md w-full">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface DeleteProps {
  activity: Activity | null
  onClose: () => void
  onDeleted: () => void
}

export function ConfirmDeleteDialog({ activity, onClose, onDeleted }: DeleteProps) {
  const notify = useNotify()
  const remove = async () => {
    if (!activity) return
    try {
      await api.delete(`/activities/${activity.id}`)
      onClose()
      onDeleted()
    } catch (error) {
      notify(`Failed to delete: ${(error as Error).message}`, 'error')
    }
  }
  return (
    <Dialog open={!!activity} onClose={onClose}>
      <DialogContent className="column gap-2" sx={{ p: 2 }}>
        <div className="text-h6">Delete '{activity?.name}'?</div>
        <div className="text-grey-6">This action cannot be undone.</div>
        <div className="row justify-end gap-2 q-mt-md w-full">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" color="error" onClick={remove}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface UploadItem {
  key: number
  name: string
  status: 'pending' | 'done' | 'error'
  error?: string
}

/** Upload one or more .fit files; each is imported as soon as it is selected. */
export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setItems([])
  }, [open])

  const upload = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const key = Math.random()
      setItems((list) => [...list, { key, name: file.name, status: 'pending' }])
      const form = new FormData()
      form.append('file', file)
      api
        .upload('/activities/upload-fit', form)
        .then(() => setItems((list) => list.map((i) => (i.key === key ? { ...i, status: 'done' } : i))))
        .catch((error: Error) =>
          setItems((list) => list.map((i) => (i.key === key ? { ...i, status: 'error', error: error.message } : i))),
        )
    }
  }

  const pending = items.filter((i) => i.status === 'pending').length
  const ok = items.filter((i) => i.status === 'done').length
  const failed = items.filter((i) => i.status === 'error').length
  const status = pending
    ? `Processing… (${pending} remaining)`
    : [ok ? `${ok} imported` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(', ')

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    upload(e.dataTransfer.files)
  }

  return (
    <Dialog open={open} onClose={() => !pending && onClose()} maxWidth={false}>
      <DialogContent sx={{ p: 3, width: 'min(520px, calc(100vw - 32px))' }}>
        <div className="text-h6 q-mb-xs">Upload .fit files</div>
        <div className="text-body2 text-grey-6 q-mb-md">
          Select one or more Garmin .fit files. Each is imported as soon as it is selected.
        </div>
        <div className="row items-center gap-2 q-mb-sm" style={{ minHeight: 24 }}>
          {pending > 0 && <CircularProgress size={18} />}
          <span className="text-body2">{status}</span>
        </div>
        <div
          className="upload-box q-mb-md"
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `1px solid var(--border)`,
            borderRadius: 4,
            overflow: 'hidden',
            boxShadow: dragging ? '0 0 0 2px var(--primary)' : undefined,
          }}
        >
          <div
            className="row items-center no-wrap gap-2 clickable"
            style={{ background: 'var(--primary)', color: '#fff', padding: '8px 12px' }}
            onClick={() => input.current?.click()}
          >
            <div className="flex-1">
              <div className="text-subtitle2">Drop files here or click to browse</div>
              <div className="text-caption" style={{ opacity: 0.85 }}>
                {items.length ? `${items.length} file${items.length === 1 ? '' : 's'}` : '.fit files only'}
              </div>
            </div>
            <Icon name="add_box" />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: items.length ? 8 : 0 }}>
            {items.map((item) => (
              <div key={item.key} className="row items-center no-wrap gap-2 text-body2" style={{ padding: '2px 4px' }}>
                {item.status === 'pending' ? (
                  <CircularProgress size={14} />
                ) : (
                  <Icon
                    name={item.status === 'done' ? 'check_circle' : 'error'}
                    size={16}
                    className={item.status === 'done' ? 'text-positive' : 'text-negative'}
                  />
                )}
                <span className="ellipsis flex-1">{item.name}</span>
                {item.error && <span className="text-caption text-negative ellipsis">{item.error}</span>}
              </div>
            ))}
          </div>
          <input
            ref={input}
            type="file"
            accept=".fit"
            multiple
            hidden
            onChange={(e) => {
              upload(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        <div className="row justify-end">
          <Button variant="contained" onClick={onClose} disabled={pending > 0}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
