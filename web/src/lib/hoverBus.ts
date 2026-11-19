/**
 * Shares the hovered point of an activity between its charts and its map.
 *
 * Hovering fires many times a second, so listeners are called directly instead of going
 * through React state, which would re-render the whole page on every mouse move.
 */
export interface HoverBus {
  /** The index into the activity's stream points, or null when nothing is hovered. */
  set: (index: number | null) => void
  subscribe: (listener: (index: number | null) => void) => () => void
}

export function createHoverBus(): HoverBus {
  const listeners = new Set<(index: number | null) => void>()
  let current: number | null = null
  return {
    set(index) {
      if (index === current) return
      current = index
      listeners.forEach((listener) => listener(index))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
