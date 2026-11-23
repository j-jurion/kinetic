import { NAV_SECTIONS } from '@kinetic/shared/navigation'
import { NavList } from '../../components/NavList'
import { useNotify } from '../../components/Notify'
import { Button, Caption, PageHeader, Screen } from '../../components/ui'
import { ORIGIN, api } from '../../lib/api'
import { useSession } from '../../lib/session'

const account = NAV_SECTIONS.find(([section]) => section === 'Account')?.[1] ?? []

/** The Account pages of the web navigation, and signing out. */
export default function MoreScreen() {
  const { setSignedIn } = useSession()
  const notify = useNotify()
  const signOut = async () => {
    try {
      await api.post('/auth/logout')
      setSignedIn(false)
    } catch {
      notify('Sign out failed', 'error')
    }
  }
  return (
    <Screen>
      <PageHeader kicker="Account" title="More" />
      <NavList items={account} />
      <Button title="Sign out" icon="logout" variant="outlined" onPress={signOut} />
      <Caption>Connected to {ORIGIN || 'no server (set EXPO_PUBLIC_KINETIC_URL)'}</Caption>
    </Screen>
  )
}
