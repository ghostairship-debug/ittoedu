import type { JsonObject } from './contracts/component-platform'

/** Native frame owns outer placement; content styles share CSS property identity. */
export const cssStyleName = (name: string): string => name.startsWith('--') ? name : name.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)
export const isOuterGeometryStyle = (name: string): boolean => /^(?:position|inset(?:-.+)?|top|right|bottom|left|(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-.+)?|transform(?:-.+)?|translate|rotate|scale|zoom|z-index|float|clear|order|flex(?:-.+)?|grid(?:-.+)?|align-self|justify-self)$/i.test(cssStyleName(name))

export function applyComponentStylePatch(previous: JsonObject = {}, patch: JsonObject,
  ignored?: (name: string, reason: 'geometry' | 'value') => void): JsonObject {
  const next = { ...previous }
  for (const [alias, value] of Object.entries(patch)) {
    if (isOuterGeometryStyle(alias)) { ignored?.(alias, 'geometry'); continue }
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') { ignored?.(alias, 'value'); continue }
    const name = cssStyleName(alias)
    for (const old of Object.keys(next)) if (cssStyleName(old) === name) delete next[old]
    if (value !== null) next[name] = value
  }
  return next
}
