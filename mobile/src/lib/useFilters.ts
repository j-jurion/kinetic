import { router, useLocalSearchParams } from 'expo-router'

/** Sport and year filters kept in the route params (?sport=…&year=…), like the web app's. */
export function useFilters(defaultSport = '') {
  const params = useLocalSearchParams<{ sport?: string; year?: string }>()
  const sport = params.sport || defaultSport
  const year = params.year && /^\d+$/.test(params.year) ? Number(params.year) : null
  return {
    sport,
    year,
    setSport: (value: string) => router.setParams({ sport: value && value !== defaultSport ? value : undefined }),
    setYear: (value: number | null) => router.setParams({ year: value ? String(value) : undefined }),
  }
}
