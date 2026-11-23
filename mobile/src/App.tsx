import { useEffect, useState } from 'react'
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { api, onUnauthorized } from './api'
import { useColors } from './components/ui'
import { GraphsScreen } from './screens/GraphsScreen'
import { LoginScreen } from './screens/LoginScreen'

export default function App() {
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

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
      <StatusBar style="auto" />
      {signedIn === null && (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )}
      {signedIn === false && <LoginScreen onLoggedIn={() => setSignedIn(true)} />}
      {signedIn && <GraphsScreen />}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
