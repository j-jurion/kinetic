import { useSearchParams } from 'react-router-dom'

/** Sport and year filters kept in the URL (?sport=…&year=…), so they carry across pages. */
export function useFilters(defaultSport = '') {
  const [params, setParams] = useSearchParams()
  const sport = params.get('sport') || defaultSport
  const yearText = params.get('year') ?? ''
  const year = /^\d+$/.test(yearText) ? Number(yearText) : null

  const update = (next: { sport?: string; year?: number | null }) => {
    const search = new URLSearchParams(params)
    const nextSport = next.sport ?? sport
    const nextYear = next.year === undefined ? year : next.year
    if (nextSport && nextSport !== defaultSport) search.set('sport', nextSport)
    else search.delete('sport')
    if (nextYear) search.set('year', String(nextYear))
    else search.delete('year')
    setParams(search, { replace: true })
  }

  return {
    sport,
    year,
    setSport: (value: string) => update({ sport: value }),
    setYear: (value: number | null) => update({ year: value }),
  }
}
