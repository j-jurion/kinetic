import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { CircularProgress } from '@mui/material'
import { api } from '../lib/api'

/** Renders its children only for a signed-in account; otherwise goes to the login page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'ok' | 'anonymous'>('checking')

  useEffect(() => {
    api
      .get('/auth/me')
      .then(() => setState('ok'))
      .catch(() => setState('anonymous'))
  }, [])

  if (state === 'anonymous') return <Navigate to="/login" replace />
  if (state === 'checking') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress size={28} />
      </div>
    )
  }
  return <>{children}</>
}
