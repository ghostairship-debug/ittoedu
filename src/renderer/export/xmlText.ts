const unrepresentable = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

export function hasUnsupportedXmlText(value: unknown): boolean {
  if (typeof value === 'string') return value.replace(unrepresentable, '\uFFFD') !== value
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some(hasUnsupportedXmlText)
}

/** XML 1.0 cannot carry some valid authored strings. Only this target projection changes. */
export function outputXmlText(value: string): string {
  return value.replace(unrepresentable, '\uFFFD').replace(/[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}
