// Race and split times as typed by the user: M:SS or H:MM:SS, with optional fractions.

/** Seconds as M:SS or H:MM:SS, keeping any fractional seconds (e.g. 1:05.4) so saving an
 * unchanged dialog never rounds a stored time. */
export function formatTimeInput(seconds: number | null | undefined): string {
  if (!seconds) return ''
  // Work in hundredths so floating-point noise (e.g. 65.40000001) does not leak into the text
  const total = Math.round(seconds * 100)
  const h = Math.floor(total / 360000)
  const m = Math.floor((total % 360000) / 6000)
  const hundredths = total % 6000
  const whole = Math.floor(hundredths / 100)
  const fraction = hundredths % 100
  const pad = (n: number) => String(n).padStart(2, '0')
  const s = fraction ? `${pad(whole)}.${pad(fraction).replace(/0$/, '')}` : pad(whole)
  return h ? `${h}:${pad(m)}:${s}` : `${m}:${s}`
}

/** M:SS or H:MM:SS, with optional fractional seconds. */
const TIME_PATTERN = /^(?:\d+:)?\d+:[0-5]\d(?:\.\d+)?$/

export const isValidTime = (value: string) => {
  const text = value.trim()
  if (!TIME_PATTERN.test(text)) return false
  // With hours, the minutes must be below 60 as well
  const parts = text.split(':')
  return parts.length === 2 || Number(parts[1]) < 60
}

export function parseTimeInput(text: string): number | null {
  const value = text.trim()
  if (!value || !isValidTime(value)) return null
  const parts = value.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return parts[0] * 60 + parts[1]
}

export const TIME_RULE = 'Use M:SS or H:MM:SS, with seconds from 00 to 59'
