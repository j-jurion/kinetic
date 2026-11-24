import { useEffect, useRef } from 'react'
import { Button, CircularProgress } from '@mui/material'

/**
 * "Load more" at the end of a paged list. It loads by itself as it scrolls into view, and
 * stays a button for keyboard and screen reader users (and browsers without the observer).
 */
export function LoadMore({ hasMore, loading, onLoad }: { hasMore: boolean; loading: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoad(), {
      rootMargin: '400px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasMore, onLoad])

  if (!hasMore) return null
  return (
    <div ref={ref} className="row justify-center q-my-md">
      <Button variant="outlined" onClick={onLoad} disabled={loading} startIcon={loading ? <CircularProgress size={16} /> : undefined}>
        {loading ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  )
}
