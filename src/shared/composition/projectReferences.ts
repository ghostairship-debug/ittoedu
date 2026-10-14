/**
 * Project-relative references written in course HTML/CSS, as laid out in the
 * project files (`slides/`, `components/`, `assets/`, `theme.css`). They are kept
 * verbatim in the stored content; these helpers only read them.
 */

/** `../assets/x.svg`, `./assets/x.svg` and `assets/x.svg` all name `assets/x.svg`. */
export function projectReferencePath(value: string): string | null {
  let raw = value.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null
  raw = (raw.split('#', 1)[0] ?? '').split('?', 1)[0] ?? ''
  try { raw = decodeURI(raw) } catch { /* keep the written text */ }
  raw = raw.replace(/\\/g, '/')
  if (raw.startsWith('/')) return null
  const parts: string[] = []
  // Pages sit one directory below the project root; `..` never leaves the project.
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.length ? parts.join('/') : null
}

/** An asset slot (`assets/...`) that a managed asset may fill later. */
export function assetReferencePath(value: string): string | null {
  const path = projectReferencePath(value)
  return path?.startsWith('assets/') && path.length > 'assets/'.length ? path : null
}

/** `../components/公转模拟.html` -> `公转模拟`. */
export function componentReferenceName(value: string): string | null {
  const path = projectReferencePath(value)
  const match = path ? /^components\/([^/]+)\.html?$/i.exec(path) : null
  return match ? match[1]! : null
}

/** File-name rules shared by component names, so `components/<name>.html` is always a valid file. */
export function courseComponentNameIssue(name: string): string | null {
  if (name.length === 0 || name.length > 80) return '组件名称须为 1–80 个字符'
  if (name !== name.trim() || name.endsWith('.') || name.startsWith('.')) return '组件名称首尾不能是空格或点'
  // eslint-disable-next-line no-control-regex
  if (/[\\\/:*?"<>|#%\u0000-\u001f\u007f]/.test(name)) return '组件名称不能含 \\ / : * ? " < > | # % 或控制字符'
  return null
}

/** Names compare as file names do on Windows. */
export function courseComponentNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/** Every `url(...)` in a style text, with its written reference. */
export function cssUrlReferences(css: string): { start: number; end: number; reference: string }[] {
  const result: { start: number; end: number; reference: string }[] = []
  for (let at = 0; at < css.length;) {
    if (css.startsWith('/*', at)) { const end = css.indexOf('*/', at + 2); at = end < 0 ? css.length : end + 2; continue }
    if (css[at] === '"' || css[at] === "'") { const quote = css[at++]!; while (at < css.length && css[at] !== quote) at += css[at] === '\\' ? 2 : 1; at++; continue }
    const opening = /^url\s*\(/i.exec(css.slice(at))
    if (!opening || /[\w-]/.test(css[at - 1] ?? '')) { at++; continue }
    const start = at; at += opening[0].length
    while (/\s/.test(css[at] ?? '') && at < css.length) at++
    const quote = css[at] === '"' || css[at] === "'" ? css[at++]! : undefined
    const valueStart = at
    while (at < css.length && (quote ? css[at] !== quote : css[at] !== ')')) at += css[at] === '\\' ? 2 : 1
    const reference = decodeCssReference(css.slice(valueStart, at).trim())
    if (quote) at++
    while (/\s/.test(css[at] ?? '') && at < css.length) at++
    if (css[at] === ')') { at++; result.push({ start, end: at, reference }) }
  }
  return result
}

export function decodeCssReference(value: string): string {
  return value.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\r\n\f])/gi,
    (_, hex: string | undefined, character: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : character)
}

export function cssImportReferences(css: string): { start: number; end: number; reference: string; conditions: string }[] {
  const urls = cssUrlReferences(css), result: { start: number; end: number; reference: string; conditions: string }[] = []
  for (let at = 0; at < css.length;) {
    if (css.startsWith('/*', at)) { const end = css.indexOf('*/', at + 2); at = end < 0 ? css.length : end + 2; continue }
    if (css[at] === '"' || css[at] === "'") { const quote = css[at++]!; while (at < css.length && css[at] !== quote) at += css[at] === '\\' ? 2 : 1; at++; continue }
    const opening = /^@import\s+/i.exec(css.slice(at))
    if (!opening) { at++; continue }
    const start = at; at += opening[0].length
    let reference: string | undefined
    const url = urls.find(url => url.start === at)
    if (url) { reference = url.reference; at = url.end }
    else if (css[at] === '"' || css[at] === "'") {
      const quote = css[at++]!, valueStart = at
      while (at < css.length && css[at] !== quote) at += css[at] === '\\' ? 2 : 1
      reference = decodeCssReference(css.slice(valueStart, at)); at++
    }
    const conditionsStart = at
    while (at < css.length && css[at] !== ';') at++
    if (reference !== undefined) result.push({ start, end: Math.min(css.length, at + 1), reference, conditions: css.slice(conditionsStart, at).trim() })
    at++
  }
  return result
}

/** Rewrites bound asset slots in a style text; unbound references stay as written. */
export function resolveCssAssetReferences(
  css: string,
  assets: Readonly<Record<string, { assetId: string }>> | undefined,
  resolveAsset: (assetId: string) => string | undefined,
): string {
  if (!assets) return css
  let output = ''
  let cursor = 0
  for (const reference of cssUrlReferences(css)) {
    const path = assetReferencePath(reference.reference)
    const assetId = path ? assets[path]?.assetId : undefined
    const url = assetId ? resolveAsset(assetId) : undefined
    if (!url) continue
    output += `${css.slice(cursor, reference.start)}url(${JSON.stringify(url)})`
    cursor = reference.end
  }
  return output + css.slice(cursor)
}
