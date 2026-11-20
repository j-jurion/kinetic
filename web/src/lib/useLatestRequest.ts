import { useCallback, useEffect, useRef } from 'react'

/**
 * Applies the result of a request only if no newer request was started since.
 *
 * Without this, quickly changing a filter can let a slow, older response arrive last and
 * replace the data for the current selection. Results arriving after unmount are dropped too.
 *
 *   const latest = useLatestRequest()
 *   useEffect(() => latest(api.get(`/activities?year=${year}`), setActivities), [year])
 */
export function useLatestRequest() {
  const counter = useRef(0)

  useEffect(
    () => () => {
      counter.current += 1 // invalidate anything still in flight when the page unmounts
    },
    [],
  )

  return useCallback(<T>(request: Promise<T>, apply: (value: T) => void): void => {
    const id = ++counter.current
    request.then(
      (value) => {
        if (id === counter.current) apply(value)
      },
      (error) => {
        // Only the current request's failure is worth surfacing
        if (id === counter.current) throw error
      },
    )
  }, [])
}
