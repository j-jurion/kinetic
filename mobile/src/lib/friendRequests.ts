// The number of friend requests waiting for this account's answer, for the tab badge.
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { api } from './api'

const POLL_MS = 60_000
const listeners = new Set<() => void>()

/** Tell the badge to refresh, e.g. after accepting or declining a request. */
export function friendRequestsChanged() {
  listeners.forEach((listener) => listener())
}

/** Incoming friend requests, refreshed every minute, when the app returns and after changes. */
export function useIncomingFriendRequests(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (AppState.currentState !== 'active') return
      api.get<{ incoming: number }>('/friend-requests/count').then(
        (data) => !cancelled && setCount(data.incoming),
        () => {},
      )
    }
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && refresh())
    listeners.add(refresh)
    return () => {
      cancelled = true
      clearInterval(timer)
      subscription.remove()
      listeners.delete(refresh)
    }
  }, [])

  return count
}
