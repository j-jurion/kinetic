// Colour contrast (WCAG 2.1), so data colours (sports, zones, metrics) stay readable as text.

/** WCAG's minimum contrast for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

const toHex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** The contrast ratio of two #rgb / #rrggbb colours, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const ca = rgb(a)
  const cb = rgb(b)
  if (!ca || !cb) return 1
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The colour itself when it is readable as text on the background, otherwise the same hue
 * mixed with black (on a light background) or white (on a dark one) just enough to reach
 * `min`. Colours it cannot parse (named colours, rgba, var()) are returned unchanged.
 */
export function readableColor(color: string, background: string, min = MIN_TEXT_CONTRAST): string {
  const fg = rgb(color)
  const bg = rgb(background)
  if (!fg || !bg || contrastRatio(color, background) >= min) return color
  const toward = luminance(bg) > 0.5 ? 0 : 255
  for (let step = 1; step <= 20; step++) {
    const mixed = fg.map((c) => c + (toward - c) * (step / 20)) as [number, number, number]
    if (contrastRatio(toHex(mixed), background) >= min) return toHex(mixed)
  }
  return toward === 0 ? '#000000' : '#ffffff'
}
