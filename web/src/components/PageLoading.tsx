import { useEffect, useState } from 'react'
import { CircularProgress } from '@mui/material'

/**
 * Shown in place of a page, or part of one, while its data or code is still loading. It
 * appears after a short delay, so fast loads don't flash a spinner.
 */
export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 150)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="page-loading" role="status" aria-live="polite">
      {visible && (
        <>
          <CircularProgress size={28} />
          <span>{label}</span>
        </>
      )}
    </div>
  )
}
