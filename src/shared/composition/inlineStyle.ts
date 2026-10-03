function propertyName(value: string): string {
  const name = value.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  return name.startsWith('--') ? name : name.toLowerCase()
}

/** Split declaration boundaries only; quoted strings, data URLs and custom-property blocks stay intact. */
function cssDeclarations(css: string): { source: string; property: string }[] {
  const result: { source: string; property: string }[] = []
  const closing: string[] = []
  let start = 0, colon = -1, quote = '', comment = false
  const emit = (end: number) => {
    result.push({ source: css.slice(start, end), property: colon < 0 ? '' : propertyName(css.slice(start, colon)) })
    start = end; colon = -1
  }
  for (let i = 0; i < css.length; i++) {
    const char = css[i]!, next = css[i + 1]
    if (comment) { if (char === '*' && next === '/') { comment = false; i++ }; continue }
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = ''; continue }
    if (char === '/' && next === '*') { comment = true; i++; continue }
    if (char === '\\') { i++; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(' || char === '[' || char === '{') { closing.push(char === '(' ? ')' : char === '[' ? ']' : '}'); continue }
    if (char === ')' || char === ']' || char === '}') {
      if (closing.pop() !== char) throw new Error('行内样式括号不完整，未修改样式')
      continue
    }
    if (closing.length) continue
    if (char === ':' && colon < 0) colon = i
    if (char === ';') emit(i + 1)
  }
  if (comment || quote || closing.length) throw new Error('行内样式尚未闭合，未修改样式')
  if (start < css.length) emit(css.length)
  return result
}

/** Real CSS remains the only layout source, including absolute positioning and dimensions. */
export function patchCompositionInlineStyle(css: string, patch: Readonly<Record<string, string | null>>): string {
  if (Object.keys(patch).length === 0) return css
  const changed = new Map<string, string | null>()
  for (const [key, value] of Object.entries(patch)) {
    const name = propertyName(key)
    if (!/^(?:--[^\s:;{}]+|-?[a-z][a-z0-9-]*)$/i.test(name)) throw new Error(`CSS 属性名无效：${key}`)
    if (value !== null) {
      const declarations = cssDeclarations(`${name}:${value};`)
      if (declarations.length !== 1 || declarations[0]!.property !== name)
        throw new Error(`CSS 属性值包含额外声明：${key}`)
    }
    changed.set(name, value)
  }
  // Remove every old declaration for the selected properties, including !important duplicates.
  const kept = cssDeclarations(css).filter(declaration => !changed.has(declaration.property)).map(declaration => declaration.source).join('')
  const added = [...changed].flatMap(([name, value]) => value === null || !value.trim() ? [] : [`${name}: ${value};`]).join(' ')
  if (!added) return kept
  const separator = kept.trim() ? `${kept.trimEnd().endsWith(';') ? '' : ';'} ` : ''
  return `${kept}${separator}${added}`
}

