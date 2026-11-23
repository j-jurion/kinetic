// Adding, editing, deleting and uploading activities: the mobile versions of the web dialogs,
// sending the same payloads (packages/shared/src/forms.ts).
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { KINDS, SPORTS, sportLabel } from '@kinetic/shared/format'
import { activityForm, activityPayload } from '@kinetic/shared/forms'
import type { ActivityForm } from '@kinetic/shared/forms'
import type { Activity, Friend } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { FriendPicker } from './FriendPicker'
import { Icon } from './Icon'
import { useNotify } from './Notify'
import { Button, Caption, Field, FormSheet, Select, T, useColors } from './ui'

/** Add an activity by hand (activity null) or edit one. */
export function ActivityEditSheet({ visible, activity, onClose, onSaved }: {
  visible: boolean
  activity: Activity | null
  onClose: () => void
  onSaved: () => void
}) {
  const notify = useNotify()
  const [form, setForm] = useState<ActivityForm>(() => activityForm(null))
  const [friends, setFriends] = useState<Friend[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setForm(activityForm(activity))
    setSelected([])
    api.get<Friend[]>('/friends').then(setFriends, () => setFriends([]))
    if (activity) {
      api.get<Friend[]>(`/activities/${activity.id}/friends`).then((list) => setSelected(list.map((f) => f.id)), () => setSelected([]))
    }
  }, [visible, activity])

  const set = (key: keyof ActivityForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  const save = async () => {
    const result = activityPayload(form, friends.length ? selected : null)
    if ('error' in result) {
      notify(result.error, 'error')
      return
    }
    setSaving(true)
    try {
      if (activity) await api.patch(`/activities/${activity.id}`, result.payload)
      else await api.post('/activities', result.payload)
      notify('Saved!', 'success')
      onClose()
      onSaved()
    } catch (error) {
      notify(`Failed to save: ${(error as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const number = (label: string, key: keyof ActivityForm) => (
    <Field label={label} keyboardType="decimal-pad" value={form[key]} onChangeText={set(key)} style={{ flex: 1 }} />
  )

  return (
    <FormSheet visible={visible} title={activity ? 'Edit activity' : 'Add activity'} onClose={onClose} onSave={save} busy={saving}>
      <Field label="Name" value={form.name} onChangeText={set('name')} />
      <Field label="Date & time (dd-mm-yyyy HH:MM)" value={form.date} onChangeText={set('date')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Select label="Sport" value={form.sport} options={SPORTS.map((s): [string, string] => [s, sportLabel(s)])} onChange={set('sport')} />
        <Select label="Kind" value={form.kind} options={KINDS.map((k): [string, string] => [k, k])} onChange={set('kind')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {number('Duration (seconds)', 'duration')}
        {number('Distance (meters)', 'distance')}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {number('Avg HR (bpm)', 'avgHr')}
        {number('Calories', 'calories')}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {number('Elevation gain (m)', 'elevation')}
        {number('Avg speed (m/s)', 'avgSpeed')}
      </View>
      <Field label="Notes" value={form.notes} onChangeText={set('notes')} multiline />
      <View style={{ gap: 6 }}>
        <T muted style={{ fontSize: 11, fontWeight: '600' }}>Friends</T>
        <FriendPicker
          friends={friends}
          selected={selected}
          onToggle={(f) => setSelected((list) => (list.includes(f.id) ? list.filter((id) => id !== f.id) : [...list, f.id]))}
          onCreated={(f) => {
            setFriends((all) => [...all, f])
            setSelected((list) => [...list, f.id])
          }}
        />
      </View>
    </FormSheet>
  )
}

/** Asks for confirmation, then deletes the activity. */
export function confirmDelete(activity: Activity, onDeleted: () => void, notify: ReturnType<typeof useNotify>) {
  Alert.alert(`Delete '${activity.name}'?`, 'This action cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        try {
          await api.delete(`/activities/${activity.id}`)
          onDeleted()
        } catch (error) {
          notify(`Failed to delete: ${(error as Error).message}`, 'error')
        }
      },
    },
  ])
}

interface UploadItem {
  key: string
  name: string
  status: 'pending' | 'done' | 'error'
  error?: string
}

/** Pick one or more .fit files; each is imported as soon as it is picked. */
export function UploadSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors()
  const [items, setItems] = useState<UploadItem[]>([])

  useEffect(() => {
    if (visible) setItems([])
  }, [visible])

  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' })
    if (result.canceled) return
    for (const file of result.assets) {
      const key = `${file.uri}-${Math.random()}`
      setItems((list) => [...list, { key, name: file.name, status: 'pending' }])
      const form = new FormData()
      // React Native's FormData takes a file as { uri, name, type }
      form.append('file', { uri: file.uri, name: file.name, type: 'application/octet-stream' } as unknown as Blob)
      api.upload('/activities/upload-fit', form).then(
        () => setItems((list) => list.map((i) => (i.key === key ? { ...i, status: 'done' } : i))),
        (error: Error) => setItems((list) => list.map((i) => (i.key === key ? { ...i, status: 'error', error: error.message } : i))),
      )
    }
  }

  const pending = items.filter((i) => i.status === 'pending').length
  const ok = items.filter((i) => i.status === 'done').length
  const failed = items.filter((i) => i.status === 'error').length
  const status = pending
    ? `Processing… (${pending} remaining)`
    : [ok ? `${ok} imported` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(', ')

  return (
    <FormSheet visible={visible} title="Upload .fit files" onClose={() => !pending && onClose()} onSave={() => !pending && onClose()} saveLabel="Done">
      <Caption>Pick one or more Garmin .fit files. Each is imported as soon as it is picked.</Caption>
      <Button title="Choose files" icon="upload_file" onPress={pick} />
      {status ? <T>{status}</T> : null}
      {items.map((item) => (
        <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {item.status === 'pending' ? (
            <ActivityIndicator size="small" />
          ) : (
            <Icon name={item.status === 'done' ? 'check_circle' : 'error'} size={18} color={item.status === 'done' ? c.positive : c.negative} />
          )}
          <T style={{ flex: 1 }} numberOfLines={1}>{item.name}</T>
          {item.error && <T style={{ color: c.negative, fontSize: 12, flexShrink: 1 }} numberOfLines={2}>{item.error}</T>}
        </View>
      ))}
    </FormSheet>
  )
}
