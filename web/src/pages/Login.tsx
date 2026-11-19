import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import '../styles/login.css'

/** Sign-in and registration form. */
export function LoginPage({ mode }: { mode: 'login' | 'register' }) {
  const register = mode === 'register'
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setMessage('')
    document.title = register ? 'Create account · Kinetic' : 'Sign in · Kinetic'
  }, [register])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    setBusy(true)
    try {
      await api.post(register ? '/auth/register' : '/auth/login', { username, password })
      navigate('/')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <main className="auth-shell">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2 4.5 13h6l-.5 9L19.5 10h-6L13 2z" />
            </svg>
          </span>
          <span>Kinetic</span>
        </div>
        <section className="auth-card" aria-labelledby="title">
          <p className="eyebrow">Your activity, in motion</p>
          <h1 id="title">{register ? 'Create account' : 'Sign in'}</h1>
          <p className="subtitle">
            {register
              ? 'Choose a username and a password of at least 12 characters.'
              : 'Welcome back. Sign in to view your activities.'}
          </p>
          <form onSubmit={submit}>
            <label className="field" htmlFor="username">
              Username
              <input
                id="username"
                type="text"
                placeholder={register ? 'Choose a username' : 'Your username'}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="field" htmlFor="password">
              Password
              <input
                id="password"
                type="password"
                placeholder={register ? 'At least 12 characters' : 'Enter your password'}
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={register ? 12 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {register ? 'Create account' : 'Sign in'}
            </button>
          </form>
          {message && (
            <p className="message" role="status">
              {message}
            </p>
          )}
          <nav aria-label="Account options">
            <Link to="/login">Sign in</Link>
            <Link to="/register">Register</Link>
          </nav>
        </section>
      </main>
    </div>
  )
}
