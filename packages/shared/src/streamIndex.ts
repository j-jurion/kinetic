/** Index of the stream point closest to a distance in metres (distances only increase). */
export function indexAtDistance(distances: (number | null)[], meters: number): number | null {
  let best: number | null = null
  let bestGap = Infinity
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i]
    if (d === null) continue
    const gap = Math.abs(d - meters)
    if (gap < bestGap) {
      best = i
      bestGap = gap
    } else if (d > meters) {
      break
    }
  }
  return best
}
