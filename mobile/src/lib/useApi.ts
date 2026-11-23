import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/**
 * GETs the path (null skips it) and keeps the latest answer; an answer to a request that a
 * newer one replaced is dropped. `reload` fetches again, e.g. after a change.
 */
export function useApi<T>(path: string | null): { data: T | null; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [version, setVersion] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    if (path === null) return
    const id = ++latest.current
    api.get<T>(path).then(
      (result) => {
        if (id !== latest.current) return
        setData(result)
        setError(null)
      },
      (e: Error) => {
        if (id === latest.current) setError(e)
      },
    )
  }, [path, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { data, error, reload }
}
