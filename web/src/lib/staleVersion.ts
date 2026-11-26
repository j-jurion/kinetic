// After a new version is deployed, a tab opened before it still asks for the old version's
// code files (their names change with every build). They are gone, so loading a page that is
// fetched on first visit fails, and without this the app went blank until reloaded by hand.

const KEY = 'kinetic-reloaded-for-new-version'
/** A reload this recent that did not help means the files are really missing: stop there. */
const LOOP_GUARD_MS = 10_000

/**
 * Reloads the page once to pick up the new version's files. Returns false, without reloading,
 * when it just did so (or cannot tell), so a file that is missing for another reason cannot
 * reload the page over and over.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < LOOP_GUARD_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/**
 * Wraps the import of a part of the app loaded on first use (for React's `lazy`): when it fails,
 * reload once for the new version and keep showing the loading state meanwhile; otherwise the
 * error reaches the nearest error boundary.
 */
export function reloadIfStale<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((error: unknown) => {
      if (reloadForNewVersion()) return new Promise<T>(() => {})
      throw error
    })
}

/** Vite reports a failed preload (a code or style file a lazy part needs) with this event. */
export function reloadOnFailedPreload() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewVersion()) event.preventDefault()
  })
}
