export interface GenerationPreviewChange { path: string; before: string; after: string }

/** Human-review display only. These paths never become a patch or a writer. */
export function describeGenerationChanges(before: unknown, after: unknown) {
  const changes: GenerationPreviewChange[] = []
  let omitted = 0
  const summarize = (value: unknown) => {
    if (value === undefined) return '不存在'
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > 500 ? `${text.slice(0, 500)}…` : text
  }
  const walk = (left: unknown, right: unknown, path: string) => {
    if (left === right) return
    if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(Reflect.get(left, key), Reflect.get(right, key), path ? `${path}.${key}` : key)
      return
    }
    if (changes.length < 200) changes.push({ path, before: summarize(left), after: summarize(right) })
    else omitted++
  }
  walk(before, after, '')
  return { changes, omitted }
}
