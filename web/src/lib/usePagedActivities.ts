import { useCallback, useEffect, useRef, useState } from 'react'
import { activityPagePath, activityTotalsPath, appendPage, nextPageCursor } from '@kinetic/shared/activityList'
import type { ActivityFilters, Totals } from '@kinetic/shared/activityList'
import type { ActivityRow } from '@kinetic/shared/types'
import { api } from './api'

export interface PagedActivities {
  /** The pages loaded so far, newest first; null until the first page arrives. */
  activities: ActivityRow[] | null
  /** Totals of every activity the filters list, not only the loaded ones. */
  totals: Totals | null
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  /** Start again from the first page (after an edit, delete or import). */
  reload: () => void
}

/**
 * The activities for a list, a page at a time, with the totals of all of them. Changing the
 * filters (or `version`) starts again from the first page; a response that arrives after
 * that, or after a newer reload, is dropped.
 */
export function usePagedActivities(filters: ActivityFilters, version = 0): PagedActivities {
  const { sport, year, friend } = filters
  const [activities, setActivities] = useState<ActivityRow[] | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const generation = useRef(0)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    const current = ++generation.current
    const selection = { sport, year, friend }
    setActivities(null)
    setTotals(null)
    setCursor(null)
    setLoadingMore(false)
    api.get<ActivityRow[]>(activityPagePath(selection)).then((page) => {
      if (current !== generation.current) return
      setActivities(page)
      setCursor(nextPageCursor(page))
    })
    api.get<Totals>(activityTotalsPath(selection)).then((result) => {
      if (current === generation.current) setTotals(result)
    })
  }, [sport, year, friend, version, reloads])

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return
    const current = generation.current
    setLoadingMore(true)
    api.get<ActivityRow[]>(activityPagePath({ sport, year, friend }, cursor)).then(
      (page) => {
        if (current !== generation.current) return
        setActivities((rows) => appendPage(rows ?? [], page))
        setCursor(nextPageCursor(page))
        setLoadingMore(false)
      },
      () => current === generation.current && setLoadingMore(false),
    )
  }, [cursor, loadingMore, sport, year, friend])

  const reload = useCallback(() => setReloads((n) => n + 1), [])

  return { activities, totals, hasMore: cursor !== null, loadingMore, loadMore, reload }
}
