// The result of "Analyse now" on the Training page (no chart code, so tests type-check it)

/** An activity "Analyse now" could not analyse, and why (from the API). */
export interface AnalyseFailure {
  id: number
  name: string
  reason: string
}

/** The one-line result of "Analyse now". */
export function analyseSummary(computed: number, failures: AnalyseFailure[] = []): string {
  const analysed = `Analysed ${computed} ${computed === 1 ? 'activity' : 'activities'}`
  if (!failures.length) return analysed
  const which = failures.length === 1 ? '1 could not be analysed' : `${failures.length} could not be analysed`
  return `${analysed}; ${which}`
}
