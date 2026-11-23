import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError } from '@kinetic/shared/api'
import { api, ORIGIN } from '../api'
import { useColors } from '../components/ui'

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const c = useColors()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/login', { username, password })
      onLoggedIn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Kinetic')
    } finally {
      setBusy(false)
    }
  }

  const input = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]
  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <Text style={[styles.title, { color: c.text }]}>Kinetic</Text>
      {!ORIGIN && (
        <Text style={styles.error}>Set EXPO_PUBLIC_KINETIC_URL in mobile/.env (see .env.example).</Text>
      )}
      <TextInput
        style={input}
        placeholder="Username"
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={input}
        placeholder="Password"
        placeholderTextColor={c.muted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.button, { backgroundColor: c.accent }]} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  error: { color: '#ef4444' },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
