/** Literal UTF-16 text locations shared by disk and current project-file reads. */
export function literalTextMatches(source: string, query: string, options: {
  offset?: number; limit?: number; line?: number; lineStart?: number
} = {}) {
  let offset = options.offset ?? 0, line = options.line ?? 1, lineStart = options.lineStart ?? 0
  if (options.line === undefined) for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
  const matches: Array<{ line: number; column: number; offset: number; matchLength: number;
    offsetUnit: 'utf-16-code-unit'; excerptOffset: number; excerpt: string }> = []
  while (query && matches.length < (options.limit ?? 50)) {
    const index = source.indexOf(query, offset)
    if (index < 0) break
    for (let i = offset; i < index; i++) if (source.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
    let excerptOffset = Math.max(lineStart, index - 100)
    let excerptEnd = Math.min(source.length, Math.max(index + query.length, excerptOffset + 240))
    if (/[\uDC00-\uDFFF]/u.test(source[excerptOffset] ?? '') && /[\uD800-\uDBFF]/u.test(source[excerptOffset - 1] ?? '')) excerptOffset--
    if (/[\uD800-\uDBFF]/u.test(source[excerptEnd - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(source[excerptEnd] ?? '')) excerptEnd++
    matches.push({ line, column: index - lineStart + 1, offset: index, matchLength: query.length,
      offsetUnit: 'utf-16-code-unit', excerptOffset, excerpt: source.slice(excerptOffset, excerptEnd) })
    offset = index + query.length
    for (let i = index; i < offset; i++) if (source.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
  }
  return { matches, offset, line, lineStart, truncated: !!query && source.indexOf(query, offset) >= 0 }
}
