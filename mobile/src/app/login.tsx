import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon } from '../components/Icon'
import { Button, Field, T, useColors } from '../components/ui'
import { ORIGIN, api } from '../lib/api'
import { useSession } from '../lib/session'

/** Sign-in and registration, like the web login page. */
export default function LoginScreen() {
  const c = useColors()
  const { setSignedIn } = useSession()
  const [register, setRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async () => {
    setBusy(true)
    setMessage('')
    try {
      await api.post(register ? '/auth/register' : '/auth/login', { username, password })
      setSignedIn(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not reach Kinetic')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.page, { backgroundColor: c.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.brand}>
        <View style={[styles.mark, { backgroundColor: c.primary }]}>
          <Icon name="bolt" size={22} color="#fff" />
        </View>
        <T style={styles.brandName}>Kinetic</T>
      </View>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
        <Text style={[styles.eyebrow, { color: c.primary }]}>YOUR ACTIVITY, IN MOTION</Text>
        <T style={styles.title}>{register ? 'Create account' : 'Sign in'}</T>
        <T muted>
          {register ? 'Choose a username and a password of at least 12 characters.' : 'Welcome back. Sign in to view your activities.'}
        </T>
        {!ORIGIN && <Text style={{ color: c.negative }}>Set EXPO_PUBLIC_KINETIC_URL in mobile/.env (see the README).</Text>}
        <Field label="Username" autoCapitalize="none" autoCorrect={false} autoComplete="username" value={username} onChangeText={setUsername} />
        <Field
          label="Password"
          secureTextEntry
          autoComplete={register ? 'new-password' : 'current-password'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        {message ? <Text style={{ color: c.negative }}>{message}</Text> : null}
        <Button title={register ? 'Create account' : 'Sign in'} onPress={submit} busy={busy} />
        <Pressable onPress={() => setRegister(!register)} style={{ alignSelf: 'center', padding: 6 }}>
          <Text style={{ color: c.primary }}>{register ? 'I already have an account' : 'Create an account'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 20, gap: 18 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center' },
  mark: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 22, fontWeight: '800' },
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 12 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: '800' },
})
