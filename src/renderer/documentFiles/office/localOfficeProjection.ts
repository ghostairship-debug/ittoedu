/** Copy render projections only. Original models/OOXML retain external links for roundtrip. */
export function localOfficeProjection<T>(value: T): T {
  const copies = new WeakMap<object, unknown>()
  const copy = (input: unknown): unknown => {
    if (!input || typeof input !== 'object') return input
    if (copies.has(input)) return copies.get(input)
    if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return input
    const result: Record<string, unknown> | unknown[] = Array.isArray(input) ? [] : {}
    copies.set(input, result)
    for (const [key, child] of Object.entries(input)) {
      const next = (key === 'src' || key === 'preview') && typeof child === 'string'
        && /^(?:https?:|file:|ftp:|\/\/)/i.test(child) ? '' : copy(child)
      ;(result as Record<string, unknown>)[key] = next
    }
    return result
  }
  return copy(value) as T
}
