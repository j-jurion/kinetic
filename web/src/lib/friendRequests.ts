// The number of friend requests waiting for this account's answer, for the navigation badge.
import { useEffect, useState } from 'react'
import { api } from './api'

const CHANGED = 'kinetic:friend-requests-changed'
const POLL_MS = 60_000

/** Tell the badge to refresh, e.g. after accepting or declining a request. */
export function friendRequestsChanged() {
  window.dispatchEvent(new Event(CHANGED))
}

/** Incoming friend requests, refreshed every minute, on focus and after changes. */
export function useIncomingFriendRequests(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      api
        .get<{ incoming: number }>('/friend-requests/count')
        .then((data) => !cancelled && setCount(data.incoming))
        .catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    window.addEventListener(CHANGED, refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(CHANGED, refresh)
    }
  }, [])

  return count
}
