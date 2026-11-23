import { useState } from 'react'
import { Alert, View } from 'react-native'
import type { Friend } from '@kinetic/shared/types'
import { useNotify } from '../components/Notify'
import { Button, Card, Caption, Empty, Field, FormSheet, IconButton, PageHeader, Screen, T, useColors } from '../components/ui'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'

const AVATAR_COLORS = ['#ea580c', '#2563eb', '#059669', '#7c3aed', '#db2777', '#0f766e']

/** A stable colour per name, so each friend keeps the same avatar (as on the web). */
function avatarColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export default function FriendsScreen() {
  const notify = useNotify()
  const c = useColors()
  const { data: friends, reload } = useApi<Friend[]>('/friends')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const add = async () => {
    if (!name.trim()) return notify('Name is required', 'warning')
    try {
      await api.post('/friends', { name })
      notify('Friend added!', 'success')
      setAdding(false)
      reload()
    } catch {
      notify('Failed to add friend', 'error')
    }
  }
  const remove = (f: Friend) =>
    Alert.alert(`Remove ${f.name}?`, 'They are also removed from the activities they are tagged on.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await api.delete(`/friends/${f.id}`)
          reload()
        },
      },
    ])

  return (
    <Screen onRefresh={reload}>
      <PageHeader kicker="Training partners" title="Friends" subtitle="People you train with. Tag them on an activity from its detail page.">
        <Button
          title="Add friend"
          icon="person_add"
          onPress={() => {
            setName('')
            setAdding(true)
          }}
        />
      </PageHeader>
      {friends?.length === 0 && <Empty icon="group_add">No friends added yet.</Empty>}
      {friends?.map((f) => (
        <Card key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: avatarColor(f.name), alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ color: '#fff', fontWeight: '700', fontSize: 17 }}>{f.name[0]?.toUpperCase()}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700' }} numberOfLines={1}>{f.name}</T>
            {f.email && <Caption>{f.email}</Caption>}
          </View>
          <IconButton icon="delete" color={c.negative} onPress={() => remove(f)} />
        </Card>
      ))}
      <FormSheet visible={adding} title="Add friend" onClose={() => setAdding(false)} onSave={add} saveLabel="Add">
        <Field label="Name" value={name} autoFocus onChangeText={setName} onSubmitEditing={add} />
      </FormSheet>
    </Screen>
  )
}
