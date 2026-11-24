import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { Friend } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { Icon } from './Icon'
import { useNotify } from './Notify'
import { Field, T, useColors } from './ui'

/**
 * Pick friends by tapping them; a search field filters the list, and a name that is not a
 * friend yet can be added as a friend without an account right here.
 */
export function FriendPicker({ friends, selected, onToggle, onCreated, hideSelected }: {
  friends: Friend[]
  selected: number[]
  onToggle: (friend: Friend) => void
  /** Called with a friend just created from the search text; it is selected too. */
  onCreated: (friend: Friend) => void
  /** Leave out the selected friends (they are shown elsewhere). */
  hideSelected?: boolean
}) {
  const c = useColors()
  const notify = useNotify()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const q = query.trim().toLowerCase()
  const shown = friends.filter(
    (f) =>
      !(hideSelected && selected.includes(f.id)) &&
      (!q || f.name.toLowerCase().includes(q) || (f.username ?? '').includes(q)),
  )
  const exists = friends.some((f) => f.name.toLowerCase() === q)

  const create = async () => {
    setCreating(true)
    try {
      const friend = await api.post<Friend>('/friends', { name: query.trim() })
      onCreated(friend)
      setQuery('')
      notify(`Added ${friend.name} as a friend`, 'success')
    } catch (error) {
      notify(`Failed to add friend: ${(error as Error).message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Field label="Find or add a friend" value={query} onChangeText={setQuery} placeholder="Type a name" autoCorrect={false} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {shown.map((f) => {
          const on = selected.includes(f.id)
          return (
            <Pressable
              key={f.id}
              onPress={() => onToggle(f)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySoft : c.card }}
            >
              <T style={{ color: on ? c.primaryText : c.text }}>{f.name}</T>
            </Pressable>
          )
        })}
        {q && !exists && (
          <Pressable
            onPress={create}
            disabled={creating}
            accessibilityRole="button"
            accessibilityState={{ disabled: creating, busy: creating }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderColor: c.primary, opacity: creating ? 0.5 : 1 }}
          >
            <Icon name="person_add" size={16} color={c.primaryText} />
            <T style={{ color: c.primaryText }}>Add “{query.trim()}” as a new friend</T>
          </Pressable>
        )}
      </View>
    </View>
  )
}
