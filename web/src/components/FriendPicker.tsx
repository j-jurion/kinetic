import { useState } from 'react'
import { Autocomplete, TextField, createFilterOptions } from '@mui/material'
import type { Friend } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { Icon } from './icons'
import { useNotify } from './Notify'

/** An option that creates a friend without an account from what was typed. */
interface NewFriend {
  create: string
}
type Option = Friend | NewFriend

const filter = createFilterOptions<Option>({ stringify: (o) => ('create' in o ? o.create : `${o.name} ${o.username ?? ''}`) })

interface Props {
  /** Every friend of the account; a friend created here is added to it through onCreated. */
  friends: Friend[]
  value: Friend[]
  onChange: (value: Friend[]) => void
  onCreated: (friend: Friend) => void
  label?: string
  placeholder?: string
  className?: string
  size?: 'small' | 'medium'
  /** Show the selected friends elsewhere: the field only adds friends. */
  hideSelected?: boolean
}

/**
 * Pick the friends on an activity. Typing a name that is not a friend yet offers to add them
 * as a friend without an account, so tagging someone never needs a trip to the Friends page.
 */
export function FriendPicker({ friends, value, onChange, onCreated, label = 'Friends', placeholder, className, size, hideSelected }: Props) {
  const notify = useNotify()
  const [creating, setCreating] = useState(false)

  const create = async (name: string) => {
    setCreating(true)
    try {
      const friend = await api.post<Friend>('/friends', { name })
      onCreated(friend)
      onChange([...value, friend])
      notify(`Added ${friend.name} as a friend`, 'success')
    } catch (error) {
      notify(`Failed to add friend: ${(error as Error).message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Autocomplete<Option, true, false, false>
      multiple
      fullWidth
      autoHighlight
      className={className}
      size={size}
      options={friends}
      value={value}
      loading={creating}
      disableCloseOnSelect={!hideSelected}
      filterSelectedOptions={hideSelected}
      renderValue={hideSelected ? () => null : undefined}
      sx={hideSelected ? { '& .MuiAutocomplete-clearIndicator': { display: 'none' } } : undefined}
      getOptionLabel={(o) => ('create' in o ? o.create : o.name)}
      isOptionEqualToValue={(a, b) => !('create' in a) && !('create' in b) && a.id === b.id}
      filterOptions={(options, state) => {
        const filtered = filter(options, state)
        const typed = state.inputValue.trim()
        const exists = friends.some((f) => f.name.toLowerCase() === typed.toLowerCase())
        if (typed && !exists) filtered.push({ create: typed })
        return filtered
      }}
      onChange={(_, next) => {
        const created = next.find((o): o is NewFriend => 'create' in o)
        if (created) create(created.create)
        else onChange(next as Friend[])
      }}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string }
        if ('create' in option) {
          return (
            <li key={key} {...rest} className={`${rest.className ?? ''} row items-center no-wrap gap-2`}>
              <Icon name="person_add" size={18} className="text-primary" />
              <span>
                Add “<b>{option.create}</b>” as a new friend
              </span>
            </li>
          )
        }
        return (
          <li key={key} {...rest} className={`${rest.className ?? ''} row items-center no-wrap gap-2`}>
            <span className="flex-1">{option.name}</span>
            {option.username && <span className="text-caption text-grey-6">@{option.username}</span>}
          </li>
        )
      }}
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder} />}
    />
  )
}
