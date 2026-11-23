// The app shell: checks for a session, then shows the sign-in screen or the app. The routes
// match the web app's (see packages/shared/src/navigation.ts).
import { useEffect, useMemo, useState } from 'react'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { pageTitle } from '@kinetic/shared/navigation'
import { NotifyProvider } from '../components/Notify'
import { Loading } from '../components/ui'
import { api, onUnauthorized } from '../lib/api'
import { SessionContext } from '../lib/session'
import { useColors } from '../lib/theme'

export default function RootLayout() {
  const c = useColors()
  // null while checking whether a session from an earlier launch is still valid
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    api.get('/auth/me').then(
      () => setSignedIn(true),
      () => setSignedIn(false),
    )
    return onUnauthorized(() => setSignedIn(false))
  }, [])

  const theme = useMemo(() => {
    const base = c.dark ? DarkTheme : DefaultTheme
    return { ...base, colors: { ...base.colors, primary: c.primary, background: c.background, card: c.card, text: c.text, border: c.cardBorder } }
  }, [c])

  if (signedIn === null) return <Loading />

  const title = (path: string) => ({ title: pageTitle(path), headerBackTitle: 'Back' })
  return (
    <ThemeProvider value={theme}>
      <SessionContext.Provider value={{ signedIn, setSignedIn }}>
        <NotifyProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerTintColor: c.primary, headerTitleStyle: { color: c.text } }}>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="activity/[id]" options={title('/activity/')} />
              <Stack.Screen name="graphs" options={title('/graphs')} />
              <Stack.Screen name="training" options={title('/training')} />
              <Stack.Screen name="races" options={title('/races')} />
              <Stack.Screen name="friends/index" options={title('/friends')} />
              <Stack.Screen name="friends/[id]" options={title('/friends')} />
              <Stack.Screen name="sync" options={title('/sync')} />
              <Stack.Screen name="best-efforts/index" options={title('/best-efforts')} />
              <Stack.Screen name="best-efforts/[distance]" options={title('/best-efforts')} />
              <Stack.Screen name="best-efforts/top/[metric]" options={title('/best-efforts')} />
            </Stack.Protected>
          </Stack>
        </NotifyProvider>
      </SessionContext.Provider>
    </ThemeProvider>
  )
}
