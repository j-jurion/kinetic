import { defineConfig } from 'vitest/config'

// The app reads API dates as local wall-clock time, so pin a time zone with daylight saving
// time: tests then behave the same on every machine and catch DST bugs (23- and 25-hour days).
process.env.TZ = 'Europe/Brussels'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
