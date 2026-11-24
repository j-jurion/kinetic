import { useState } from 'react'
import { NAV_SECTIONS } from '@kinetic/shared/navigation'
import { NavList } from '../../components/NavList'
import { useNotify } from '../../components/Notify'
import { Button, Caption, Card, CardTitle, Field, PageHeader, Screen, T, useColors } from '../../components/ui'
import { ORIGIN, api } from '../../lib/api'
import { useIncomingFriendRequests } from '../../lib/friendRequests'
import { useSession } from '../../lib/session'

const account = NAV_SECTIONS.find(([section]) => section === 'Account')?.[1] ?? []

/** The Account pages of the web navigation, signing out and deleting the account. */
export default function MoreScreen() {
  const { setSignedIn } = useSession()
  const notify = useNotify()
  const c = useColors()
  const friendRequests = useIncomingFriendRequests()
  const [deleting, setDeleting] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    try {
      await api.post('/auth/logout')
      setSignedIn(false)
    } catch {
      notify('Sign out failed', 'error')
    }
  }

  const cancelDelete = () => {
    setDeleting(false)
    setPassword('')
    setError('')
  }

  const deleteAccount = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/delete-account', { password })
      setSignedIn(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deleting the account failed')
      setBusy(false)
    }
  }

  return (
    <Screen>
      <PageHeader kicker="Account" title="More" />
      <NavList items={account} badges={{ '/friends': friendRequests }} />
      <Button title="Sign out" icon="logout" variant="outlined" onPress={signOut} />
      {deleting ? (
        <Card>
          <CardTitle>Delete account</CardTitle>
          <T>
            This permanently deletes your account, all activities and their files, race results, friends, friend
            requests, and your Garmin and Apple Health connections. It cannot be undone.
          </T>
          <Field
            label="Password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            error={error}
          />
          <Button title="Delete account" icon="delete_forever" color={c.negative} disabled={!password} busy={busy} onPress={deleteAccount} />
          <Button title="Cancel" variant="text" disabled={busy} onPress={cancelDelete} />
        </Card>
      ) : (
        <Button title="Delete account…" icon="delete_forever" variant="text" color={c.negative} onPress={() => setDeleting(true)} />
      )}
      <Caption>Connected to {ORIGIN || 'no server (set EXPO_PUBLIC_KINETIC_URL)'}</Caption>
    </Screen>
  )
}
