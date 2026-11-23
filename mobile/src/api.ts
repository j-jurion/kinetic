// The mobile app's client for the FastAPI backend, built on the shared client.
import { createApiClient } from '@kinetic/shared/api'

/** The web app's public origin, e.g. https://kinetic.example.com (see .env.example). */
export const ORIGIN = (process.env.EXPO_PUBLIC_KINETIC_URL ?? '').replace(/\/$/, '')

const unauthorizedListeners = new Set<() => void>()

/** Called whenever the session has expired, so the app can show the login screen. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

export const api = createApiClient({
  baseUrl: `${ORIGIN}/api`,
  // The session cookie is kept by the native cookie store and sent along like in a browser
  credentials: 'include',
  // The backend accepts state-changing requests only from the web app's origin
  headers: { Origin: ORIGIN },
  onUnauthorized: () => unauthorizedListeners.forEach((listener) => listener()),
})
