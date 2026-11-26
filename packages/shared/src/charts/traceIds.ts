// Kept apart from the chart modules, which need Plotly's types, so the shared tests can check it.

/**
 * Gives every named trace an id from its name, so a sport hidden by clicking the legend stays
 * hidden when the chart is redrawn, even if the sports come in another order.
 *
 * Plotly puts the id in CSS selectors (".cb" + uid), so it may only hold letters, digits, "_"
 * and "-": a name such as "Fitness (CTL)" used as is made Plotly throw when the chart was
 * removed, which blanked the whole app.
 */
export function traceIds(names: (string | undefined)[]): (string | undefined)[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    if (!name) return undefined
    const base = `t-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base}-${n}` : base
  })
}
