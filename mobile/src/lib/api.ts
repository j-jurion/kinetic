// The mobile app's client for the FastAPI backend, built on the shared client.
import { createApiClient } from '@kinetic/shared/api'
import { ndjsonParser } from '@kinetic/shared/stream'
import type { StreamMessage } from '@kinetic/shared/stream'

/** The web app's public origin, e.g. https://kinetic.example.com (see README). */
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

/**
 * POSTs to an endpoint that streams one JSON message per line (Garmin sync, training analysis)
 * and calls onMessage as each line arrives. React Native's fetch has no streaming body, but its
 * XMLHttpRequest reports partial text through onprogress.
 */
export function postStream(path: string, body: unknown, onMessage: (message: StreamMessage) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const parse = ndjsonParser(onMessage)
    let seen = 0
    const flush = () => {
      const text = xhr.responseText ?? ''
      if (text.length > seen) {
        parse(text.slice(seen))
        seen = text.length
      }
    }
    xhr.open('POST', `${ORIGIN}/api${path}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Origin', ORIGIN)
    xhr.onprogress = () => {
      if (xhr.status < 400) flush()
    }
    xhr.onload = () => {
      if (xhr.status >= 400) {
        let detail = `Request failed (${xhr.status})`
        try {
          const data = JSON.parse(xhr.responseText)
          if (typeof data.detail === 'string') detail = data.detail
        } catch {
          // not JSON: keep the generic message
        }
        reject(new Error(detail))
        return
      }
      flush()
      parse('\n')
      resolve()
    }
    xhr.onerror = () => reject(new Error('Could not reach Kinetic'))
    xhr.send(JSON.stringify(body ?? {}))
  })
}
