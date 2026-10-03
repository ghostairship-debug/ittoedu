import { parseHtmlStartTag, readHtmlRawText } from '../../../shared/html/htmlSourceScanner'
import { createHash } from 'node:crypto'
import { parse } from 'acorn'
import { analyzeJavaScriptClosure, CSS_RESOURCE_PROPERTIES, nonResourceStyle } from './javascriptClosureProof'
import type { RemoteReference as Remote } from './types'
import type {
  ExtractedResource,
  ExtractedResourceOrigin,
  ExtractHtmlResourcesInput,
  ExtractHtmlResourcesResult,
  ImportDiagnostic,
  RemoteReference,
} from './types'

export type { ExtractedResource, ExtractedResourceOrigin, ExtractHtmlResourcesInput, ExtractHtmlResourcesResult, ImportDiagnostic, RemoteReference }

type Context = ExtractedResourceOrigin['context']
type Usage = Remote['usage']
type Sink = {
  resources: Map<string, ExtractedResource>
  remoteReferences: RemoteReference[]
  diagnostics: ImportDiagnostic[]
  cssStack: Set<string>
  htmlStack: Set<string>
}
type Flags = { url: boolean; remote: boolean }
type DataHit = {
  kind: 'media' | 'non-base64' | 'unsupported' | 'invalid'
  mime: string
  bytes?: Uint8Array
  end: number
  text: string
}
type ParsedAttr = {
  name: string
  rawName: string
  hasValue: boolean
  quote: '"' | "'" | ''
  rawValue: string
  value: string
  changed: boolean
  drop: boolean
}
type StartTag = { rawName: string; name: string; attrs: ParsedAttr[]; end: number; selfClosing: boolean }

const TOKEN = /[!#$%&'*+.^_`|~0-9A-Za-z-]/
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif', apng: 'image/apng', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm', mp4: 'video/mp4',
  webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/mp4', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject', css: 'text/css', js: 'text/javascript',
  mjs: 'text/javascript', json: 'application/json', wasm: 'application/wasm', txt: 'text/plain', html: 'text/html', htm: 'text/html',
}
const RAW_TEXT = new Set(['title', 'textarea', 'noscript'])
/** Diagnostics of an unproven script that still reach the import result. */
const reportedReference = (item: ImportDiagnostic) => item.level === 'error' || item.code === 'missing-relative-resource'
/** Written source file of a local iframe document inlined as srcdoc. */
export const EMBEDDED_SOURCE_ATTRIBUTE = 'data-guoling-source'

const clip = (value: string, max = 64) => value.length <= max ? value : value.slice(0, max)
const copyBytes = (bytes: Uint8Array) => new Uint8Array(bytes)
const placeholder = (key: string) => `cw-resource:${key}`
const createSink = (): Sink => ({ resources: new Map(), remoteReferences: [], diagnostics: [], cssStack: new Set(), htmlStack: new Set() })

function addDiagnostic(sink: Sink, level: ImportDiagnostic['level'], code: string, message: string, reference?: string) {
  sink.diagnostics.push(reference === undefined ? { level, code, message } : { level, code, message, reference })
}

function addResource(sink: Sink, bytes: Uint8Array, mediaType: string, origin: ExtractedResourceOrigin): string {
  const key = createHash('sha256').update(bytes).digest('hex')
  const existing = sink.resources.get(key)
  if (existing) existing.origins.push(origin)
  else sink.resources.set(key, { key, mediaType, bytes: copyBytes(bytes), origins: [origin] })
  return key
}

function decodeBase64(payload: string): Uint8Array | null {
  const compact = payload.replace(/[\t\n\f\r ]/g, '')
  if (compact.length % 4 === 1 || (compact && !/^[A-Za-z0-9+/]*={0,2}$/.test(compact))) return null
  const pad = compact.indexOf('=')
  if (pad !== -1 && (!/^={1,2}$/.test(compact.slice(pad)) || compact.length % 4 !== 0)) return null
  const buffer = Buffer.from(compact, 'base64')
  if (buffer.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) return null
  return new Uint8Array(buffer)
}

function parseDataUri(text: string, index: number, allowWhitespace: boolean): DataHit | null {
  if (text.slice(index, index + 5).toLowerCase() !== 'data:') return null
  let j = index + 5
  const readToken = () => {
    const start = j
    while (j < text.length && TOKEN.test(text[j])) j++
    return text.slice(start, j)
  }
  const type = readToken()
  if (!type) return null
  if (text[j] === '\\' && text[j + 1] === '/') j += 2
  else if (text[j] === '/') j++
  else return null
  const subtype = readToken()
  if (!subtype) return null
  const mime = `${type}/${subtype}`.toLowerCase()
  let base64 = false
  while (text[j] === ';') {
    if (text.slice(j, j + 8).toLowerCase() === ';base64,') { base64 = true; j += 8; break }
    j++
    if (!readToken()) return null
    if (text[j] !== '=') continue
    j++
    const quote = text[j]
    if (quote === '"' || quote === "'") {
      j++
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1
      if (text[j] !== quote) return null
      j++
    } else if (!readToken()) return null
  }
  if (!base64) {
    if (text[j] !== ',') return null
    j++
    while (j < text.length && !/[\t\n\f\r ]/.test(text[j])) j++
    return { kind: 'non-base64', mime, end: j, text: text.slice(index, j) }
  }
  const dataStart = j
  while (j < text.length) {
    const ch = text[j]
    if (/[A-Za-z0-9+/=]/.test(ch) || (allowWhitespace && /[\t\n\f\r ]/.test(ch))) { j++; continue }
    break
  }
  while (j > dataStart && /[\t\n\f\r ]/.test(text[j - 1])) j--
  const uriText = text.slice(index, j)
  const bytes = decodeBase64(text.slice(dataStart, j))
  if (!bytes) return { kind: 'invalid', mime, end: j, text: uriText }
  if (!/^(image|audio|video|font)\//.test(mime)) return { kind: 'unsupported', mime, end: j, text: uriText }
  return { kind: 'media', mime, bytes, end: j, text: uriText }
}

function dataUriReplacement(hit: DataHit, context: Context, sink: Sink): { replacement: string; changed: boolean } {
  const reference = clip(hit.text)
  if (hit.kind === 'media' && hit.bytes) {
    return { replacement: placeholder(addResource(sink, hit.bytes, hit.mime, { kind: 'data-uri', context, reference })), changed: true }
  }
  const invalid = hit.kind === 'invalid'
  addDiagnostic(
    sink,
    invalid ? 'error' : 'info',
    invalid ? 'invalid-base64' : hit.kind === 'unsupported' ? 'unsupported-data-uri-type' : 'non-base64-data-uri',
    invalid ? 'data URI 的 base64 无法解码，已保留原文' : hit.kind === 'unsupported' ? `未抽取 ${hit.mime} data URI` : '非 base64 data URI 已保留',
    reference,
  )
  return { replacement: hit.text, changed: false }
}

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_entity, body: string) => {
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return "'"
    const code = body.startsWith('#x') ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _entity
  })
}

function normalizeKey(key: string): string {
  const parts: string[] = []
  for (const part of key.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (parts.length === 0) return key.replace(/\\/g, '/'); parts.pop(); continue }
    parts.push(part)
  }
  return parts.join('/')
}

function siblingMap(files: ReadonlyMap<string, Uint8Array> | undefined): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>()
  if (!files) return map
  for (const [key, bytes] of files) {
    const normalized = normalizeKey(key)
    if (!map.has(normalized)) map.set(normalized, bytes)
  }
  return map
}

function extensionOf(reference: string): string {
  const clean = reference.split(/[?#]/, 1)[0] ?? ''
  const base = clean.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

function directoryOf(key: string): string {
  const index = key.lastIndexOf('/')
  return index === -1 ? '' : key.slice(0, index)
}

function mediaTypeForPath(key: string): string {
  return MEDIA_TYPES[extensionOf(key)] ?? 'application/octet-stream'
}

function managedMediaType(type: string): boolean {
  return /^(image|audio|video|font)\//.test(type) || type.includes('font') || type.includes('woff')
}

function resolveRelative(baseDir: string, reference: string): string | null {
  let raw = reference.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null
  raw = (raw.split('#', 1)[0] ?? '').split('?', 1)[0] ?? ''
  if (!raw) return null
  try { raw = decodeURI(raw) } catch { /* 保留无法解码的路径文本 */ }
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(raw)) return null
  const parts = (baseDir ? baseDir.split('/') : []).concat(raw.replace(/\\/g, '/').split('/'))
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') { if (out.length === 0) return null; out.pop(); continue }
    out.push(part)
  }
  return out.join('/')
}

function rewriteRelative(reference: string, context: Context, baseDir: string, sink: Sink, siblings: Map<string, Uint8Array>): { value: string; changed: boolean } {
  const key = resolveRelative(baseDir, reference)
  const bytes = key ? siblings.get(key) : undefined
  if (!key || !bytes) {
    addDiagnostic(sink, 'warning', 'missing-relative-resource', `找不到相对资源 ${clip(reference, 180)}，已保留引用作为待填位置`, key ?? reference)
    return { value: reference, changed: false }
  }
  const mediaType = mediaTypeForPath(key)
  if (!managedMediaType(mediaType)) {
    addDiagnostic(sink, 'warning', 'unmanaged-relative-resource', `本地资源 ${clip(reference, 120)} 的类型暂不能作为受管素材，已保留原引用；课件中无法解析该引用，请内联内容或改用受支持媒体`, reference)
    return { value: reference, changed: false }
  }
  return {
    value: placeholder(addResource(sink, bytes, mediaType, { kind: 'relative', context, reference })) + (reference.match(/#[^?]*/)?.[0] ?? ''),
    changed: true,
  }
}

function rewriteSingleUrl(rawUrl: string, context: Context, baseDir: string, sink: Sink, siblings: Map<string, Uint8Array>, allowWhitespace: boolean, usage: Usage = 'unknown'): { value: string; changed: boolean } {
  const lead = rawUrl.match(/^[\t\n\f\r ]*/)?.[0] ?? ''
  const trail = rawUrl.match(/[\t\n\f\r ]*$/)?.[0] ?? ''
  const core = rawUrl.slice(lead.length, rawUrl.length - trail.length)
  if (!core || core.startsWith('#')) return { value: rawUrl, changed: false }
  if (core.startsWith('//')) {
    const normalized = `https:${core}`
    sink.remoteReferences.push({ url: normalized, context, usage })
    return { value: lead + normalized + trail, changed: true }
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(core)) {
    if (/^https?:/i.test(core)) { sink.remoteReferences.push({ url: core, context, usage }); return { value: rawUrl, changed: false } }
    if (/^data:/i.test(core)) {
      const hit = parseDataUri(core, 0, allowWhitespace)
      if (!hit) return { value: rawUrl, changed: false }
      const applied = dataUriReplacement(hit, context, sink)
      if (!applied.changed) return { value: rawUrl, changed: false }
      return { value: lead + applied.replacement + core.slice(hit.end) + trail, changed: true }
    }
    addDiagnostic(sink, 'error', 'unsupported-url-scheme', `不支持资源协议 ${clip(core, 180)}`, core)
    return { value: rawUrl, changed: false }
  }
  const relative = rewriteRelative(core, context, baseDir, sink, siblings)
  return relative.changed ? { value: lead + relative.value + trail, changed: true } : { value: rawUrl, changed: false }
}

function folded(text: string): string {
  const lower = text.toLowerCase()
  return lower.length === text.length ? lower : text
}

function indexOfUrl(lower: string, from: number): number {
  let index = from
  while ((index = lower.indexOf('url', index)) !== -1) {
    const prev = index > 0 ? lower[index - 1] : ''
    if (prev && /[a-z0-9_\-%]/.test(prev)) { index += 3; continue }
    let j = index + 3
    while (j < lower.length && /[\t\n\f\r ]/.test(lower[j])) j++
    if (lower[j] === '(') return index
    index += 3
  }
  return -1
}

function findNext(text: string, lower: string, from: number, flags: Flags): number {
  let best = -1
  const consider = (index: number) => { if (index !== -1 && (best === -1 || index < best)) best = index }
  consider(lower.indexOf('data:', from))
  if (flags.url) consider(indexOfUrl(lower, from))
  if (flags.remote) {
    consider(lower.indexOf('http://', from))
    consider(lower.indexOf('https://', from))
    consider(text.indexOf('//', from))
  }
  return best
}

function readUrlCall(text: string, index: number): { inner: string; quote: '"' | "'" | ''; end: number } | null {
  let j = index + 3
  while (j < text.length && /[\t\n\f\r ]/.test(text[j])) j++
  if (text[j] !== '(') return null
  j++
  while (j < text.length && /[\t\n\f\r ]/.test(text[j])) j++
  let quote: '"' | "'" | '' = ''
  if (text[j] === '"' || text[j] === "'") { quote = text[j] as '"' | "'"; j++ }
  const innerStart = j
  if (quote) {
    while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1
    const innerEnd = j
    if (text[j] === quote) j++
    while (j < text.length && /[\t\n\f\r ]/.test(text[j])) j++
    if (text[j] === ')') j++
    return { inner: text.slice(innerStart, innerEnd), quote, end: j }
  }
  while (j < text.length && text[j] !== ')' && !/[\t\n\f\r ]/.test(text[j])) j++
  const innerEnd = j
  while (j < text.length && /[\t\n\f\r ]/.test(text[j])) j++
  if (text[j] === ')') j++
  return { inner: text.slice(innerStart, innerEnd), quote, end: j }
}

function renderUrl(quote: '"' | "'" | '', value: string): string {
  if (!quote && /^[^\s"'()\\]+$/.test(value)) return `url(${value})`
  const used = quote || '"'
  const escaped = value.replace(/\\/g, '\\\\').replaceAll(used, `\\${used}`)
  return `url(${used}${escaped}${used})`
}

function readRemote(text: string, index: number): { url: string; end: number } | null {
  const prev = index > 0 ? text[index - 1] : ''
  if (prev && /[A-Za-z0-9:/]/.test(prev)) return null
  const head = text.slice(index, index + 8).toLowerCase()
  if (head.startsWith('http://') || head.startsWith('https://')) {
    let j = index
    while (j < text.length && !/[\s"'`<>\\)]/.test(text[j])) j++
    return j > index ? { url: text.slice(index, j), end: j } : null
  }
  if (!text.startsWith('//', index)) return null
  const match = /^\/\/(?:localhost|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?::\d+)?(?:\/[^\s"'`<>\\)]*)?/i.exec(text.slice(index))
  return match ? { url: match[0], end: index + match[0].length } : null
}

function rewriteEmbedded(text: string, context: Context, baseDir: string, sink: Sink, siblings: Map<string, Uint8Array>, flags: Flags, allowWhitespace: boolean): string {
  if (!/data:|url\s*\(|https?:\/\/|\/\//i.test(text)) return text
  const lower = folded(text)
  const parts: string[] = []
  let cursor = 0
  let i = 0
  let changed = false
  while (i < text.length) {
    const next = findNext(text, lower, i, flags)
    if (next < 0) break
    const head = lower.slice(next, next + 5)
    if (head === 'data:') {
      const hit = parseDataUri(text, next, allowWhitespace)
      if (!hit) { i = next + 5; continue }
      const applied = dataUriReplacement(hit, context, sink)
      if (applied.changed) {
        changed = true
        parts.push(text.slice(cursor, next), applied.replacement)
        cursor = hit.end
      }
      i = hit.end
      continue
    }
    if (flags.url && lower.startsWith('url', next)) {
      const call = readUrlCall(text, next)
      if (!call) { i = next + 3; continue }
      const inner = rewriteSingleUrl(call.inner, context, baseDir, sink, siblings, Boolean(call.quote))
      if (inner.changed) {
        changed = true
        parts.push(text.slice(cursor, next), renderUrl(call.quote, inner.value.trim()))
        cursor = call.end
      }
      i = call.end > next ? call.end : next + 3
      continue
    }
    const remote = flags.remote ? readRemote(text, next) : null
    if (remote) {
      sink.remoteReferences.push({ url: remote.url, context, usage: context === 'css-url' ? 'image' : 'unknown' })
      i = remote.end
      continue
    }
    i = next + 1
  }
  if (!changed) return text
  parts.push(text.slice(cursor))
  return parts.join('')
}

function imageSetStringStarts(css: string): Set<number> {
  const starts = new Set<number>()
  const imageSets: number[] = []
  let depth = 0
  for (let i = 0; i < css.length;) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? css.length : end + 2
      continue
    }
    const quote = css[i]
    if (quote === '"' || quote === "'") {
      if (imageSets[imageSets.length - 1] === depth) starts.add(i)
      i++
      while (i < css.length && css[i] !== quote) i += css[i] === '\\' ? 2 : 1
      if (i < css.length) i++
      continue
    }
    if (css.slice(i, i + 10).toLowerCase() === 'image-set(' && !/[A-Za-z0-9_]/.test(css[i - 1] ?? '')) {
      depth++
      imageSets.push(depth)
      i += 10
      continue
    }
    if (css[i] === '(') depth++
    else if (css[i] === ')') {
      if (imageSets[imageSets.length - 1] === depth) imageSets.pop()
      depth = Math.max(0, depth - 1)
    }
    i++
  }
  return starts
}

function cssUrlUsage(css: string, at: number, propertyHint?: string): Usage {
  const before = css.slice(0, at)
  const block = before.lastIndexOf('{')
  const rule = before.slice(Math.max(0, before.lastIndexOf('}', block) + 1), block).trim()
  const declaration = before.slice(Math.max(block + 1, before.lastIndexOf(';') + 1), at)
  const property = (declaration.includes(':') ? declaration.split(':')[0] : propertyHint ?? '')
    .replace(/^style\./, '').replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).trim().toLowerCase()
  if (/@font-face\b/i.test(rule) && property === 'src') return 'font'
  if (/^(?:background(?:-image)?|border-image(?:-source)?|list-style(?:-image)?|content|cursor|mask-image)$/.test(property)) return 'image'
  return 'unknown'
}

function importConditions(value: string): { layer?: string; supports?: string; media: string } | null {
  let rest = value.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  const take = (name: string): string | null => {
    const match = new RegExp(`^${name}\\s*\\(`, 'i').exec(rest)
    if (!match) return null
    let depth = 1, i = match[0].length
    const start = i
    for (; i < rest.length; i++) {
      if (rest[i] === '"' || rest[i] === "'") {
        const quote = rest[i++]
        while (i < rest.length && rest[i] !== quote) i += rest[i] === '\\' ? 2 : 1
      } else if (rest[i] === '(') depth++
      else if (rest[i] === ')' && --depth === 0) break
    }
    if (depth !== 0) return null
    const content = rest.slice(start, i).trim()
    rest = rest.slice(i + 1).trim()
    return content
  }
  let layer: string | undefined, supports: string | undefined
  if (/^layer\s*\(/i.test(rest)) { const name = take('layer'); if (name === null) return null; layer = name }
  else if (/^layer\b/i.test(rest)) { layer = ''; rest = rest.slice(5).trim() }
  if (/^supports\s*\(/i.test(rest)) { const condition = take('supports'); if (condition === null) return null; supports = condition }
  return { layer, supports, media: rest }
}

function rewriteCss(css: string, baseDir: string, sink: Sink, siblings: Map<string, Uint8Array>, propertyHint?: string): string {
  const lower = folded(css)
  const parts: string[] = []
  let cursor = 0
  let i = 0
  let changed = false
  const imageSetStrings = imageSetStringStarts(css)
  const nextAt = (from: number) => {
    let best = -1
    const consider = (index: number) => { if (index !== -1 && (best === -1 || index < best)) best = index }
    consider(css.indexOf('/*', from))
    consider(css.indexOf('"', from))
    consider(css.indexOf("'", from))
    consider(indexOfUrl(lower, from))
    consider(lower.indexOf('@import', from))
    consider(lower.indexOf('data:', from))
    return best
  }
  while (i < css.length) {
    const next = nextAt(i)
    if (next < 0) break
    if (css.startsWith('/*', next)) {
      const end = css.indexOf('*/', next + 2)
      i = end === -1 ? css.length : end + 2
      continue
    }
    const quote = css[next]
    if (quote === '"' || quote === "'") {
      let j = next + 1
      while (j < css.length && css[j] !== quote) j += css[j] === '\\' ? 2 : 1
      const closed = j < css.length
      if (closed) j++
      const inner = css.slice(next + 1, closed ? j - 1 : j)
      const rewritten = imageSetStrings.has(next)
        ? rewriteSingleUrl(inner, 'css-url', baseDir, sink, siblings, false, 'image').value
        : rewriteEmbedded(inner, 'css-url', baseDir, sink, siblings, { url: false, remote: false }, false)
      if (rewritten !== inner) {
        changed = true
        parts.push(css.slice(cursor, next), quote + rewritten + (closed ? quote : ''))
        cursor = j
      }
      i = j
      continue
    }
    if (lower.startsWith('@import', next)) {
      const match = /^@import\s+(?:url\(\s*(['"]?)([^)'"\s]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/i.exec(css.slice(next))
      if (!match) { addDiagnostic(sink, 'warning', 'unsupported-css-import', '无法解析 CSS @import'); i = next + 7; continue }
      const reference = match[2] ?? match[4]
      const conditions = importConditions(match[5] ?? '')
      const key = resolveRelative(baseDir, reference)
      const bytes = key ? siblings.get(key) : undefined
      if (/^https?:|^\/\//i.test(reference)) sink.remoteReferences.push({ url: reference, context: 'css-url', usage: 'stylesheet' })
      else if (!key || !bytes) addDiagnostic(sink, 'warning', 'missing-relative-resource', `找不到相对资源 ${clip(reference, 180)}，已保留引用作为待填位置`, key ?? reference)
      else if (sink.cssStack.has(key)) addDiagnostic(sink, 'warning', 'css-import-cycle', `CSS @import 循环: ${key}`, reference)
      else if (!conditions) addDiagnostic(sink, 'warning', 'unsupported-css-import', 'CSS @import 条件无法解析，已保留原文；本地样式不能加载，请内联对应样式', reference)
      else {
        sink.cssStack.add(key)
        let imported = rewriteCss(decodeText(bytes), directoryOf(key), sink, siblings)
        sink.cssStack.delete(key)
        changed = true
        if (conditions.media) imported = `@media ${conditions.media}{${imported}}`
        if (conditions.supports !== undefined) {
          const condition = /^[\w-]+\s*:/.test(conditions.supports) ? `(${conditions.supports})` : conditions.supports
          imported = `@supports ${condition}{${imported}}`
        }
        if (conditions.layer !== undefined) imported = `@layer${conditions.layer ? ' ' + conditions.layer : ''}{${imported}}`
        parts.push(css.slice(cursor, next), imported)
        cursor = next + match[0].length
      }
      i = next + match[0].length
      continue
    }
    if (lower.startsWith('url', next)) {
      const call = readUrlCall(css, next)
      if (!call) { i = next + 3; continue }
      const inner = rewriteSingleUrl(call.inner, 'css-url', baseDir, sink, siblings, Boolean(call.quote), cssUrlUsage(css, next, propertyHint))
      if (inner.changed) {
        changed = true
        parts.push(css.slice(cursor, next), renderUrl(call.quote, inner.value.trim()))
        cursor = call.end
      }
      i = call.end > next ? call.end : next + 3
      continue
    }
    const hit = parseDataUri(css, next, false)
    if (!hit) { i = next + 5; continue }
    const applied = dataUriReplacement(hit, 'css-url', sink)
    if (applied.changed) {
      changed = true
      parts.push(css.slice(cursor, next), applied.replacement)
      cursor = hit.end
    }
    i = hit.end
  }
  if (!changed) return css
  parts.push(css.slice(cursor))
  return parts.join('')
}

type JavaScriptNode = { type: string; start: number; end: number; [key: string]: unknown }

function modulepreloadShape(node: JavaScriptNode): string {
  return JSON.stringify(node, (key, value: unknown) => {
    if (['start', 'end', 'raw'].includes(key)) return undefined
    if (value && typeof value === 'object' && (value as JavaScriptNode).type === 'TemplateLiteral') {
      const template = value as JavaScriptNode
      if ((template.expressions as JavaScriptNode[]).length === 0) {
        return { type: 'Literal', value: (template.quasis as Array<{ value: { cooked: string | null } }>)[0].value.cooked }
      }
    }
    return value
  })
}

// Only these complete, inert-on-supported-host IIFEs are exempt, never a guard-shaped substring.
// Keep identifiers and every executable AST field: broader Vite variants need their own evidence.
const modulepreloadShapes = new Set([
  '(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();',
  '(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);function n(e){if(e.ep)return;e.ep=!0;let n={credentials:`same-origin`};fetch(e.href,n)}})();',
].map(code => modulepreloadShape(((parse(code, { ecmaVersion: 'latest' }) as unknown as JavaScriptNode).body as JavaScriptNode[])[0].expression as JavaScriptNode)))

function rewriteJavaScript(code: string, sourceType: 'script' | 'module', baseDir: string, sink: Sink, siblings: Map<string, Uint8Array>, scriptLabel = '脚本'): string {
  type Node = JavaScriptNode
  let root: Node
  try {
    root = parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true }) as unknown as Node
  } catch (error) {
    addDiagnostic(sink, 'error', 'script-parse', `${scriptLabel} 无法解析: ${String(error)}；请修正该脚本的语法后重试`)
    return code
  }
  const inertPolyfills = new Set<Node>()
  for (const statement of root.body as Node[]) {
    const expression = statement.expression as Node | undefined
    if (statement.type === 'ExpressionStatement' && expression?.type === 'CallExpression'
      && (expression.callee as Node).type === 'FunctionExpression' && modulepreloadShapes.has(modulepreloadShape(expression))) inertPolyfills.add(expression)
  }
  const closureProof = analyzeJavaScriptClosure(root, inertPolyfills)
  if (closureProof.networkCalls.length) addDiagnostic(sink, 'warning', 'unsupported-network-sink', '脚本网络调用已保留；fetch/EventSource/WebSocket 仅可连接工程声明的精确 HTTPS/WSS 源，本地相对数据不会打包，远程脚本/模块/Worker 被 CSP 阻止；请内联本地数据或使用已声明的连接源')
  const preserveScript = closureProof.frameworkError || closureProof.capabilityErrors.length > 0
  const outputSink = sink
  if (preserveScript) {
    addDiagnostic(sink, 'warning', closureProof.frameworkError ? 'unsupported-framework-resource-input' : 'unsupported-dynamic-url-sink',
      '无法静态证明该脚本的资源引用闭合，已原样保留；脚本里的本地文件引用不会被打包，请内联资源或改为可解析的静态媒体引用')
    // Still diagnose explicit bad inputs using the existing traversal, but do not
    // publish any resources or partial rewrites from an unproven script.
    sink = createSink()
  }
  const edits = new Map<string, { start: number; end: number; value: string }>()
  let conflictingEdits = false
  const addEdit = (edit: { start: number; end: number; value: string }) => {
    const key = `${edit.start}:${edit.end}`, previous = edits.get(key)
    if (previous && previous.value !== edit.value) {
      conflictingEdits = true
      addDiagnostic(sink, 'warning', 'conflicting-js-rewrite', '同一脚本值在不同资源上下文中需要不同改写')
      return
    }
    edits.set(key, edit)
  }
  const handled = new Set<Node>()
  const jsString = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c')
  const staticString = (value: Node): string | null => {
    if (value.type === 'Literal' && typeof value.value === 'string') return value.value
    if (value.type === 'TemplateLiteral' && (value.expressions as Node[]).length === 0)
      return ((value.quasis as Array<{ value: { cooked: string | null } }>)[0]?.value.cooked) ?? null
    return null
  }
  // Resolve only unambiguous top-level const strings. A shadow, reassignment or
  // non-literal initializer makes a sink unknown and therefore a clear failure.
  const constants = new Map<string, string>()
  for (const statement of root.body as Node[]) if (statement.type === 'VariableDeclaration' && statement.kind === 'const') {
    for (const declarator of statement.declarations as Node[]) {
      const id = declarator.id as Node, initial = declarator.init as Node | undefined
      if (id.type === 'Identifier' && initial) {
        const value = staticString(initial)
        if (value !== null) constants.set(String(id.name), value)
      }
    }
  }
  const declarations = new Map<string, number>(), ambiguous = new Set<string>()
  const patternNames = (pattern: Node | undefined): string[] => {
    if (!pattern) return []
    if (pattern.type === 'Identifier') return [String(pattern.name)]
    if (pattern.type === 'AssignmentPattern') return patternNames(pattern.left as Node)
    if (pattern.type === 'RestElement') return patternNames(pattern.argument as Node)
    if (pattern.type === 'ArrayPattern') return (pattern.elements as Array<Node | null>).flatMap(item => patternNames(item ?? undefined))
    if (pattern.type === 'ObjectPattern') return (pattern.properties as Node[]).flatMap(item =>
      patternNames((item.type === 'RestElement' ? item.argument : item.value) as Node))
    return []
  }
  const scanBindings = (node: Node): void => {
    if (node.type === 'VariableDeclarator') for (const name of patternNames(node.id as Node))
      declarations.set(name, (declarations.get(name) ?? 0) + 1)
    if (node.type === 'AssignmentExpression') for (const name of patternNames(node.left as Node)) ambiguous.add(name)
    if (node.type === 'UpdateExpression') for (const name of patternNames(node.argument as Node)) ambiguous.add(name)
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type))
      for (const param of node.params as Node[]) for (const name of patternNames(param)) ambiguous.add(name)
    if (node.type === 'CatchClause') for (const name of patternNames(node.param as Node | undefined)) ambiguous.add(name)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && typeof child.type === 'string') scanBindings(child as Node)
      } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') scanBindings(value as Node)
    }
  }
  scanBindings(root)
  const isDocumentCreateElement = (call: Node): boolean => {
    if (call.type !== 'CallExpression') return false
    const callee = call.callee as Node
    return callee.type === 'MemberExpression' && closureProof.memberName(callee) === 'createElement'
      && (callee.object as Node).type === 'Identifier' && (callee.object as Node).name === 'document'
      && !declarations.has('document')
  }
  const mediaBindings = new Map<string, Usage>()
  const collectMediaBindings = (node: Node): void => {
    if (node.type === 'VariableDeclarator' && (node.id as Node).type === 'Identifier') {
      const name = String((node.id as Node).name)
      const init = node.init as Node | undefined
      const ctor = init?.type === 'NewExpression' ? (init.callee as Node).name : undefined
      let usage: Usage = ctor === 'Image' && !declarations.has('Image') ? 'image'
        : ctor === 'Audio' && !declarations.has('Audio') ? 'media' : 'unknown'
      if (init && isDocumentCreateElement(init)) {
        const tag = (init.arguments as Node[])[0]
        const value = tag && staticString(tag)?.toLowerCase()
        usage = value === 'img' ? 'image' : value === 'audio' || value === 'video' ? 'media' : value === 'script' ? 'script' : 'unknown'
      }
      if (usage !== 'unknown' && declarations.get(name) === 1 && !ambiguous.has(name)) mediaBindings.set(name, usage)
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && typeof child.type === 'string') collectMediaBindings(child as Node)
      } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') collectMediaBindings(value as Node)
    }
  }
  collectMediaBindings(root)
  const targetUsage = (receiver: Node | undefined, name: string): Usage => {
    if (name !== 'src' && name !== 'srcset') return 'unknown'
    if (receiver?.type === 'Identifier') {
      const usage = mediaBindings.get(String(receiver.name)) ?? 'unknown'
      return name === 'srcset' && usage !== 'image' ? 'unknown' : usage
    }
    if (receiver && isDocumentCreateElement(receiver)) {
      const tag = (receiver.arguments as Node[])[0]
      const value = tag && staticString(tag)?.toLowerCase()
      return value === 'img' ? 'image' : name === 'src' && (value === 'audio' || value === 'video') ? 'media'
        : name === 'src' && value === 'script' ? 'script' : 'unknown'
    }
    return 'unknown'
  }
  for (const name of constants.keys()) if (declarations.get(name) !== 1 || ambiguous.has(name)) constants.delete(name)
  const visit = (node: Node, ancestors: Node[] = []) => {
    if (handled.has(node)) return
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) || (node.type === 'ExportNamedDeclaration' && node.source)) {
      const source = node.source as Node | undefined
      const reference = source && staticString(source)
      addDiagnostic(outputSink, 'warning', 'unsupported-module-graph', `模块依赖 ${reference ? clip(reference, 100) : '（动态引用）'} 已保留，但本地 import 引用在课件中无法解析，该页脚本不会运行；请把脚本合并为单文件。远程模块被 CSP 阻止，请内联模块`)
      if (reference && /^(?:\.{1,2}\/|\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(reference)) {
        // Reuse URL diagnostics without registering or rewriting module dependencies.
        const diagnosticSink = createSink()
        rewriteSingleUrl(reference, 'js-string', baseDir, diagnosticSink, siblings, false, 'script')
        sink.diagnostics.push(...diagnosticSink.diagnostics.filter(reportedReference))
        sink.remoteReferences.push(...diagnosticSink.remoteReferences)
      }
    }
    const memberName = (member: Node): string | null => closureProof.memberName(member) ?? null
    const literalValue = (value: Node): string | null => {
      if (value.type === 'Literal' && typeof value.value === 'string') return value.value
      if (value.type === 'TemplateLiteral' && (value.expressions as Node[]).length === 0) return ((value.quasis as Array<{ value: { cooked: string | null } }>)[0]?.value.cooked) ?? null
      return null
    }
    const writeString = (value: Node, next: string) => {
      handled.add(value)
      addEdit({ start: value.start, end: value.end, value: jsString(next) })
    }
    const preserveDynamicHtml = (name: string) => addDiagnostic(sink, 'warning', 'dynamic-html-preserved',
      `${name} 的动态内容保留原代码执行；运行时生成的资源未作静态收集`)
    const embeddedSink = (value: Node, kind: 'css' | 'html', name: string) => {
      const text = literalValue(value) ?? (value.type === 'Identifier' ? constants.get(String(value.name)) ?? null : null)
      if (text === null) {
        if (kind === 'html') preserveDynamicHtml(name)
        else addDiagnostic(sink, 'warning', 'unsupported-dynamic-url-sink', `无法静态解析 ${name} 的资源内容`)
        return
      }
      const next = kind === 'css' ? rewriteCss(text, baseDir, sink, siblings, name) : transformHtml(text, sink, siblings, baseDir, true)
      writeString(value, next)
    }
    const rewriteUrl = (url: string, name: string, usage: Usage): string => {
      if (!url.trim() || url.trim().startsWith('#')) return url
      if (name === 'srcset') return rewriteSrcset(url, baseDir, sink, siblings, usage)
      if (/^data:/i.test(url.trim())) return rewriteEmbedded(url, 'js-string', baseDir, sink, siblings, { url: true, remote: true }, false)
      return rewriteSingleUrl(url, 'js-string', baseDir, sink, siblings, false, usage).value
    }
    const urlSink = (value: Node, name: string, usage: Usage = 'unknown') => {
      const url = literalValue(value) ?? (value.type === 'Identifier' ? constants.get(String(value.name)) ?? null : null)
      if (url === null) { addDiagnostic(sink, 'warning', 'unsupported-dynamic-url-sink', `无法静态解析 ${name} 的资源地址`); return }
      writeString(value, rewriteUrl(url, name, usage))
    }
    if (node === root) {
      for (const definition of closureProof.exclusiveDefinitions) urlSink(definition.value, definition.name, definition.usage)
      for (const definition of closureProof.deadDefinitions) writeString(definition, '')
      type Transform = { path: string[]; before: string; after: string }
      const targets = new Map<Node, { local: Map<Node, string>; transforms: Transform[] }>()
      const inputs = [
        ...closureProof.resourceInputs.filter(input => !closureProof.definitionBackedUses.has(input.value)).map(input => ({ ...input, path: [] as string[], kind: 'url' as const })),
        ...closureProof.embeddedInputs,
      ]
      for (const input of inputs) {
        if (input.proof.kind !== 'proven-resource') {
          if (input.kind === 'html') preserveDynamicHtml(input.name)
          else addDiagnostic(sink, 'warning', 'unsupported-dynamic-url-sink', `无法静态解析 ${input.name} 的资源内容`)
          continue
        }
        for (const literal of input.proof.literals) {
          const before = literalValue(literal)!
          const after = input.kind === 'url' ? rewriteUrl(before, input.name, input.usage)
            : input.kind === 'css' ? rewriteCss(before, baseDir, sink, siblings, input.name) : transformHtml(before, sink, siblings, baseDir, true)
          const owned = input.value.start <= literal.start && literal.end <= input.value.end
          if (before === after) continue
          const target = targets.get(input.value) ?? { local: new Map<Node, string>(), transforms: [] }
          if (owned) {
            const previous = target.local.get(literal)
            if (previous !== undefined && previous !== after) { conflictingEdits = true; addDiagnostic(sink, 'warning', 'conflicting-js-rewrite', '同一资源使用位置需要不同改写') }
            target.local.set(literal, after)
          } else target.transforms.push({ path: input.path, before, after })
          targets.set(input.value, target)
        }
      }
      const mapValue = (expression: string, transforms: Transform[]) => {
        const values = new Map<string, string>()
        for (const item of transforms) {
          const previous = values.get(item.before)
          if (previous !== undefined && previous !== item.after) { conflictingEdits = true; addDiagnostic(sink, 'warning', 'conflicting-js-rewrite', '同一资源使用位置需要不同改写') }
          values.set(item.before, item.after)
        }
        const branches = [...values].map(([before, after]) => `__cwField===${jsString(before)}?${jsString(after)}:`).join('')
        return branches ? `(__cwField=>${branches}__cwField)(${expression})` : expression
      }
      for (const [value, target] of targets) {
        let expression = code.slice(value.start, value.end)
        for (const [literal, after] of [...target.local].sort(([a], [b]) => b.start - a.start))
          expression = expression.slice(0, literal.start - value.start) + jsString(after) + expression.slice(literal.end - value.start)
        const direct = target.transforms.filter(item => item.path.length === 0)
        if (direct.length) expression = mapValue(expression, direct)
        const fields = [...new Set(target.transforms.filter(item => item.path.length === 1).map(item => item.path[0]))]
        if (fields.length) expression = `(__cwValue=>({...__cwValue,${fields.map(field => `[${jsString(field)}]:${mapValue(`__cwValue[${jsString(field)}]`, target.transforms.filter(item => item.path[0] === field))}`).join(',')}}))(${expression})`
        addEdit({ start: value.start, end: value.end, value: expression })
      }
    }
    if (node.type === 'AssignmentExpression' && !closureProof.auditedNode(node)) {
      const left = node.left as Node, right = node.right as Node
      const property = left.property as Node | undefined
      const name = memberName(left) ?? (left.computed && property?.type === 'Identifier' ? constants.get(String(property.name)) ?? null : null)
      const dataTarget = left.type === 'MemberExpression' && closureProof.dataReceiver(left.object as Node)
      if (left.type === 'MemberExpression' && left.computed && name === null && !dataTarget && !(property?.type === 'Literal' && typeof property.value === 'number'))
        addDiagnostic(sink, 'warning', 'unsupported-dynamic-url-sink', '无法静态确定计算属性写入是否为资源入口')
      if (!dataTarget && name && ['src', 'srcset', 'href', 'poster', 'data', 'action', 'formAction'].includes(name)) {
        if (node.operator !== '=') addDiagnostic(sink, 'warning', 'unsupported-dynamic-url-sink', `无法静态解析 ${name} 的复合写入`)
        else urlSink(right, name, targetUsage(left.object as Node | undefined, name))
      }
      const htmlTarget = !dataTarget && !!name && ['innerHTML', 'outerHTML', 'srcdoc'].includes(name)
      const cssTarget = !dataTarget && (name === 'cssText' || (left.type === 'MemberExpression' && closureProof.styleReceiver(left.object as Node) && !nonResourceStyle(name)))
      if (htmlTarget) embeddedSink(right, 'html', name!)
      else if (cssTarget && node.operator !== '=') addDiagnostic(sink, 'warning', 'unsupported-dynamic-url-sink', '资源内容的复合写入无法静态解析')
      else if (cssTarget) embeddedSink(right, 'css', name ?? 'style')
    }
    if (node.type === 'AssignmentExpression' && closureProof.auditedNode(node) && node.operator === '=') {
      const name = memberName(node.left as Node)
      if (name && ['src', 'srcset', 'href', 'poster', 'data', 'action', 'formAction'].includes(name)
        && closureProof.internalSink(node).kind === 'unknown') urlSink(node.right as Node, name, targetUsage((node.left as Node).object as Node | undefined, name))
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee as Node | undefined
      const name = callee?.type === 'Identifier' ? String(callee.name) : callee ? memberName(callee) : null
      if (name && ['fetch', 'importScripts', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'XMLHttpRequest', 'sendBeacon'].includes(name)) {
        const modulepreloadPolyfill = name === 'fetch' && ancestors.some(ancestor => inertPolyfills.has(ancestor))
        if (!modulepreloadPolyfill) addDiagnostic(sink, 'warning', 'unsupported-network-sink', `脚本网络/动态调用保留原样执行: ${name}；本地相对数据不会打包，fetch/EventSource/WebSocket 仅允许工程声明的精确 HTTPS/WSS 源，远程脚本/模块/Worker 被 CSP 阻止；请内联数据或使用已声明源`)
      }
      if (node.type === 'NewExpression' && name === 'Audio' && (node.arguments as Node[])[0]) urlSink((node.arguments as Node[])[0], 'Audio', declarations.has('Audio') ? 'unknown' : 'media')
      if (name === 'setAttribute') {
        const args = node.arguments as Node[]
        const attribute = args[0] ? literalValue(args[0]) ?? (args[0].type === 'Identifier' ? constants.get(String(args[0].name)) ?? null : null) : null
        if (!attribute && !closureProof.auditedNode(node)) addDiagnostic(sink, 'warning', 'unsupported-dynamic-url-sink', '无法静态确定 setAttribute 的属性；保留原代码执行，运行时资源未静态收集')
        if (attribute && ['src', 'srcset', 'href', 'poster', 'data', 'action', 'formaction'].includes(attribute) && args[1]) urlSink(args[1], attribute, targetUsage(callee?.object as Node | undefined, attribute))
        if (attribute && (attribute === 'style' || CSS_RESOURCE_PROPERTIES.has(attribute)) && args[1]) embeddedSink(args[1], 'css', attribute)
        if (attribute === 'srcdoc' && args[1]) embeddedSink(args[1], 'html', attribute)
      }
      if (!closureProof.auditedNode(node)) {
        const args = node.arguments as Node[]
        if (name === 'setProperty' && args[1] && !nonResourceStyle(args[0] ? literalValue(args[0]) : null)) embeddedSink(args[1], 'css', 'style.setProperty')
        if (name === 'insertRule' && args[0]) embeddedSink(args[0], 'css', 'stylesheet.insertRule')
        if (name === 'insertAdjacentHTML' && args[1]) embeddedSink(args[1], 'html', name)
      }
    }
    if (handled.has(node)) return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && typeof child.type === 'string') visit(child as Node, [...ancestors, node])
      } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') visit(value as Node, [...ancestors, node])
    }
  }
  visit(root)
  if (preserveScript) {
    outputSink.diagnostics.push(...sink.diagnostics.filter(reportedReference))
    outputSink.remoteReferences.push(...sink.remoteReferences)
    return code
  }
  if (edits.size === 0 || conflictingEdits) return code
  const ordered = [...edits.values()].sort((a, b) => b.start - a.start)
  if (ordered.some((edit, index) => index > 0 && edit.end > ordered[index - 1].start)) {
    addDiagnostic(sink, 'warning', 'conflicting-js-rewrite', '脚本资源改写区间重叠')
    return code
  }
  let result = code
  for (const edit of ordered) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
  try { parse(result, { ecmaVersion: 'latest', sourceType, allowHashBang: true }) } catch (error) {
    addDiagnostic(sink, 'warning', 'script-rewrite', `资源改写后脚本无法解析: ${String(error)}`)
    return code
  }
  return result
}
function neutralizeScriptClose(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script')
}

function neutralizeStyleClose(css: string): string {
  return css.replace(/<\/style/gi, '\\003c/style')
}

function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function parseStartTag(html: string, index: number): StartTag | null {
  const tag = parseHtmlStartTag(html, index)
  if (!tag) return null
  return {
    rawName: tag.rawName,
    name: tag.name,
    attrs: tag.attributes.map(attribute => ({
      name: attribute.name,
      rawName: attribute.rawName,
      hasValue: attribute.valueSpan !== undefined,
      quote: attribute.quote,
      rawValue: attribute.valueSpan ? html.slice(attribute.valueSpan.start, attribute.valueSpan.end) : '',
      value: attribute.decodedValue ?? '',
      changed: false,
      drop: false,
    })),
    end: tag.end,
    selfClosing: tag.selfClosing,
  }
}

function readRaw(html: string, from: number, tag: string): { body: string; closeStart: number; closeEnd: number; closed: boolean } {
  const raw = readHtmlRawText(html, from, tag)
  if (!raw.close) return { body: html.slice(from), closeStart: html.length, closeEnd: html.length, closed: false }
  return { body: html.slice(raw.body.start, raw.body.end), closeStart: raw.close.start, closeEnd: raw.close.end, closed: true }
}

function escapeAttr(value: string, quote: '"' | "'"): string {
  const escaped = value.replace(/&/g, '&amp;')
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&apos;')
}

function rebuildStart(tag: StartTag, selfClosing: boolean): string {
  let out = `<${tag.rawName}`
  for (const attribute of tag.attrs) {
    if (attribute.drop) continue
    out += ` ${attribute.rawName}`
    if (!attribute.hasValue && !attribute.changed) continue
    const quote = attribute.quote || '"'
    const raw = attribute.changed ? escapeAttr(attribute.value, quote) : attribute.rawValue
    out += `=${quote}${raw}${quote}`
  }
  out += selfClosing ? ' />' : '>'
  return out
}

function attributeBy(attrs: ParsedAttr[], name: string): ParsedAttr | undefined {
  return attrs.find(attribute => attribute.name === name)
}

function relHas(attrs: ParsedAttr[], token: string): boolean {
  const rel = attributeBy(attrs, 'rel')
  return Boolean(rel?.hasValue && decodeEntities(rel.rawValue).toLowerCase().split(/\s+/).includes(token))
}

function javascriptKind(typeValue: string | null): 'script' | 'module' | 'other' {
  if (typeValue === null) return 'script'
  const type = decodeEntities(typeValue).trim().toLowerCase()
  if (!type || type === 'text/javascript' || type === 'application/javascript' || type === 'text/ecmascript' || type === 'application/ecmascript') return 'script'
  if (type === 'module') return 'module'
  return 'other'
}

function attributeUsage(tag: StartTag, attribute: string, parent: string | null): Usage {
  if (attribute === 'poster') return tag.name === 'video' ? 'image' : 'unknown'
  if (tag.name === 'img' || tag.name === 'image' || tag.name === 'picture') return 'image'
  if (tag.name === 'audio' || tag.name === 'video') return attribute === 'srcset' ? 'unknown' : 'media'
  if (tag.name === 'source') return attribute === 'srcset' ? parent === 'picture' ? 'image' : 'unknown'
    : parent === 'audio' || parent === 'video' ? 'media' : 'unknown'
  if (tag.name === 'link' && relHas(tag.attrs, 'icon')) return 'image'
  if (tag.name === 'link' && relHas(tag.attrs, 'stylesheet')) return 'stylesheet'
  if (tag.name === 'link' && relHas(tag.attrs, 'modulepreload')) return 'script'
  if (tag.name === 'link' && relHas(tag.attrs, 'preload')) {
    const as = attributeBy(tag.attrs, 'as')?.rawValue.toLowerCase()
    return as === 'image' ? 'image' : as === 'audio' || as === 'video' ? 'media' : as === 'font' ? 'font' : as === 'script' ? 'script' : 'unknown'
  }
  return 'unknown'
}

function rewriteAttributes(tag: StartTag, baseDir: string, sink: Sink, siblings: Map<string, Uint8Array>, href: boolean, parent: string | null = null) {
  for (const attribute of tag.attrs) {
    if (!attribute.hasValue || attribute.drop) continue
    if (attribute.name === 'src' || attribute.name === 'poster' || (href && attribute.name === 'href')) {
      const result = rewriteSingleUrl(decodeEntities(attribute.rawValue), 'html-attr', baseDir, sink, siblings, true, attributeUsage(tag, attribute.name, parent))
      if (!result.changed) continue
      attribute.value = result.value.trim()
      attribute.changed = true
    } else if (attribute.name === 'srcset') {
      const decoded = decodeEntities(attribute.rawValue)
      const next = rewriteSrcset(decoded, baseDir, sink, siblings, attributeUsage(tag, attribute.name, parent))
      if (next === decoded) continue
      attribute.value = next
      attribute.changed = true
    } else if (attribute.name === 'style') {
      const decoded = decodeEntities(attribute.rawValue)
      const next = rewriteCss(decoded, baseDir, sink, siblings)
      if (next === decoded) continue
      attribute.value = next
      attribute.changed = true
    }
  }
}

function rewriteSrcset(value: string, baseDir: string, sink: Sink, siblings: Map<string, Uint8Array>, usage: Usage = 'image'): string {
  const parts: string[] = []
  let cursor = 0
  let i = 0
  let changed = false
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++
    if (i >= value.length) break
    const urlStart = i
    const hit = /^data:/i.test(value.slice(i, i + 5)) ? parseDataUri(value, i, false) : null
    let urlEnd = hit ? hit.end : i
    if (!hit) while (urlEnd < value.length && !/[\s,]/.test(value[urlEnd])) urlEnd++
    const result = rewriteSingleUrl(decodeEntities(value.slice(urlStart, urlEnd)), 'srcset', baseDir, sink, siblings, false, usage)
    if (result.changed) {
      changed = true
      parts.push(value.slice(cursor, urlStart), result.value.trim())
      cursor = urlEnd
    }
    i = urlEnd
    while (i < value.length && value[i] !== ',') i++
  }
  if (!changed) return value
  parts.push(value.slice(cursor))
  return parts.join('')
}

function keptStyleAttributes(attrs: ParsedAttr[]): ParsedAttr[] {
  return attrs.filter(attribute => ['media', 'title', 'id', 'class', 'nonce'].includes(attribute.name)).map(attribute => ({ ...attribute }))
}

function transformHtml(html: string, sink: Sink, siblings: Map<string, Uint8Array>, baseDir = '', embedded = false): string {
  const parts: string[] = []
  let i = 0
  let mediaParent: string | null = null
  let scriptNumber = 0
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4)
      const stop = end === -1 ? html.length : end + 3
      const body = html.slice(i + 4, end === -1 ? html.length : end)
      parts.push('<!--', body, end === -1 ? '' : '-->')
      i = stop
      continue
    }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i)
      const stop = end === -1 ? html.length : end + 1
      parts.push(html.slice(i, stop))
      i = stop
      continue
    }
    if (html.startsWith('</', i)) {
      const end = html.indexOf('>', i)
      const stop = end === -1 ? html.length : end + 1
      const closing = /^<\/\s*([a-z][\w:-]*)/i.exec(html.slice(i, stop))?.[1]?.toLowerCase()
      if (closing === mediaParent) mediaParent = null
      parts.push(html.slice(i, stop))
      i = stop
      continue
    }
    if (html[i] !== '<') {
      const end = html.indexOf('<', i)
      const stop = end === -1 ? html.length : end
      parts.push(html.slice(i, stop))
      i = stop
      continue
    }
    const tagStart = i
    const tag = parseStartTag(html, i)
    if (!tag) { parts.push(html[i]); i++; continue }
    if (tag.attrs.some(attribute => /^(onload|onerror)$/i.test(attribute.name))) addDiagnostic(sink, 'warning', 'early-event-handler',
      'onload/onerror 等加载期事件尽力绑定，个别时序可能漏触发；关键初始化请改用脚本内 addEventListener 或立即执行')
    if (['picture', 'audio', 'video'].includes(tag.name) && !tag.selfClosing) mediaParent = tag.name
    if (embedded && (tag.name === 'script' || tag.attrs.some(attribute => /^on[a-z]/i.test(attribute.name)))) addDiagnostic(sink, 'warning', 'unsupported-html-capability', '动态 HTML 中的脚本和内联事件按原样保留，由宿主预览/Player 决定是否可执行')
    if (tag.name === 'iframe') {
      const src = attributeBy(tag.attrs, 'src')
      const srcdoc = attributeBy(tag.attrs, 'srcdoc')
      if (srcdoc) {
        srcdoc.value = transformHtml(decodeEntities(srcdoc.rawValue), sink, siblings, baseDir)
        srcdoc.hasValue = true
        srcdoc.changed = true
        if (src) src.drop = true
      } else if (src?.hasValue && ['html', 'htm'].includes(extensionOf(decodeEntities(src.rawValue)))) {
        const reference = decodeEntities(src.rawValue).trim()
        const key = resolveRelative(baseDir, reference)
        const bytes = key ? siblings.get(key) : undefined
        if (bytes && key) {
          if (sink.htmlStack.has(key)) addDiagnostic(sink, 'error', 'recursive-html-document', `嵌入 HTML 循环引用，无法建立离线文档：${key}`, reference)
          else {
            sink.htmlStack.add(key)
            const content = transformHtml(decodeText(bytes), sink, siblings, directoryOf(key))
            sink.htmlStack.delete(key)
            src.drop = true
            // The embedded document keeps the name of the file it came from.
            tag.attrs.push({ name: EMBEDDED_SOURCE_ATTRIBUTE, rawName: EMBEDDED_SOURCE_ATTRIBUTE, hasValue: true, quote: '"', rawValue: '', value: reference, changed: true, drop: false })
            tag.attrs.push({ name: 'srcdoc', rawName: 'srcdoc', hasValue: true, quote: '"', rawValue: '', value: content, changed: true, drop: false })
          }
        } else if (key) addDiagnostic(sink, 'warning', 'missing-relative-resource', `找不到嵌入 HTML ${clip(reference, 180)}，已保留为待填组件`, key)
      }
      // Independent local documents become ordinary srcdoc before carrier selection.
      // Remote and unsupported embeddings retain their existing diagnostic and source.
      if (!tag.attrs.some(attribute => attribute.name === 'srcdoc' && attribute.hasValue)) addDiagnostic(sink, 'warning', 'unsupported-html-capability', '<iframe> 已保留；预览与发布播放器的 CSP 阻止外部嵌入页面，请改为普通链接或本地 HTML 文档')
    }
    if (['base', 'object', 'embed'].includes(tag.name)) addDiagnostic(sink, 'warning', 'unsupported-html-capability', `<${tag.name}> 已保留；预览与发布播放器的 CSP 阻止外部嵌入页面，请改为普通链接或内联内容`)
    if (tag.name === 'meta' && /refresh/i.test(attributeBy(tag.attrs, 'http-equiv')?.rawValue ?? '')) addDiagnostic(sink, 'warning', 'unsupported-html-capability', 'meta refresh 已保留；宿主预览/Player 可能忽略自动跳转')
    if (RAW_TEXT.has(tag.name)) {
      const raw = readRaw(html, tag.end, tag.name)
      if (!raw.closed) addDiagnostic(sink, 'warning', 'unclosed-element', `未闭合的 <${tag.name}>`)
      parts.push(html.slice(tagStart, tag.end), raw.body)
      if (raw.closed) parts.push(html.slice(raw.closeStart, raw.closeEnd))
      i = raw.closeEnd
      continue
    }
    if (tag.name === 'style' && !tag.selfClosing) {
      const raw = readRaw(html, tag.end, 'style')
      if (!raw.closed) addDiagnostic(sink, 'warning', 'unclosed-element', '未闭合的 <style>')
      parts.push(html.slice(tagStart, tag.end), rewriteCss(raw.body, baseDir, sink, siblings))
      if (raw.closed) parts.push(html.slice(raw.closeStart, raw.closeEnd))
      i = raw.closeEnd
      continue
    }
    if (tag.name === 'link') {
      const href = attributeBy(tag.attrs, 'href')
      const stylesheet = relHas(tag.attrs, 'stylesheet')
      const modulepreload = relHas(tag.attrs, 'modulepreload')
      const managed = stylesheet || relHas(tag.attrs, 'icon') || relHas(tag.attrs, 'preload') || modulepreload
      if (href?.hasValue && (modulepreload || relHas(tag.attrs, 'preload'))) {
        const decoded = decodeEntities(href.rawValue).trim()
        const data = /^data:/i.test(decoded) ? parseDataUri(decoded, 0, true) : null
        const remoteMedia = /^https:|^\/\//i.test(decoded) && ['image', 'audio', 'video', 'font'].includes(attributeBy(tag.attrs, 'as')?.rawValue.toLowerCase() ?? '')
        if (!managedMediaType(mediaTypeForPath(decoded)) && data?.kind !== 'media' && !remoteMedia) {
          const key = resolveRelative(baseDir, decoded)
          // Keep the existing bad-input diagnostics even when the performance hint is omitted.
          if (!key || !siblings.has(key)) rewriteSingleUrl(decoded, 'html-attr', baseDir, sink, siblings, true, attributeUsage(tag, 'href', mediaParent))
          addDiagnostic(sink, 'warning', 'resource-hint-omitted', `已移除非受管素材的加载提示 ${clip(decoded, 120)}；不影响页面正文，脚本或样式请内联`, decoded)
          i = tag.end
          continue
        }
        const result = rewriteSingleUrl(decoded, 'html-attr', baseDir, sink, siblings, true, attributeUsage(tag, 'href', mediaParent))
        if (result.changed) { href.value = result.value; href.changed = true }
        parts.push(tag.attrs.some(attribute => attribute.changed) ? rebuildStart(tag, tag.selfClosing) : html.slice(tagStart, tag.end))
        i = tag.end
        continue
      }
      if (href?.hasValue && stylesheet && extensionOf(decodeEntities(href.rawValue)) === 'css') {
        const decoded = decodeEntities(href.rawValue).trim()
        const key = resolveRelative(baseDir, decoded)
        const bytes = key ? siblings.get(key) : undefined
        if (/^https?:/i.test(decoded) || decoded.startsWith('//')) sink.remoteReferences.push({ url: decoded, context: 'html-attr', usage: 'stylesheet' })
        else if (bytes && key) {
          const css = neutralizeStyleClose(rewriteCss(decodeText(bytes), directoryOf(key), sink, siblings))
          parts.push(rebuildStart({ rawName: 'style', name: 'style', attrs: keptStyleAttributes(tag.attrs), end: 0, selfClosing: false }, false))
          parts.push(css, '</style>')
          i = tag.end
          continue
        } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded) && !decoded.startsWith('#')) {
          addDiagnostic(sink, 'warning', 'missing-relative-resource', `找不到相对资源 ${clip(decoded, 180)}，已保留引用`, key ?? decoded)
        }
        if (managed) rewriteAttributes(tag, baseDir, sink, siblings, false)
        parts.push(tag.attrs.some(attribute => attribute.changed) ? rebuildStart(tag, tag.selfClosing) : html.slice(tagStart, tag.end))
        i = tag.end
        continue
      }
      if (managed) rewriteAttributes(tag, baseDir, sink, siblings, true)
      parts.push(tag.attrs.some(attribute => attribute.changed) ? rebuildStart(tag, tag.selfClosing) : html.slice(tagStart, tag.end))
      i = tag.end
      continue
    }
    if (tag.name === 'script' && !tag.selfClosing) {
      scriptNumber++
      const src = attributeBy(tag.attrs, 'src')
      const raw = readRaw(html, tag.end, 'script')
      if (!raw.closed) addDiagnostic(sink, 'warning', 'unclosed-element', '未闭合的 <script>')
      let body = raw.body
      let inlined = false
      if (src?.hasValue) {
        const decoded = decodeEntities(src.rawValue).trim()
        if (/^https?:|^\/\//i.test(decoded)) addDiagnostic(sink, 'warning', 'remote-script', `远程脚本已保留: ${clip(decoded, 180)}；预览与发布播放器的 CSP 阻止远程脚本加载，请内联该库或改用本地脚本文件`, decoded)
        if (/^data:/i.test(decoded)) addDiagnostic(sink, 'warning', 'unsupported-script-source', 'data URI 脚本源保留原文；不对其重写资源闭包', clip(decoded))
        const key = resolveRelative(baseDir, decoded)
        const bytes = key ? siblings.get(key) : undefined
        if (bytes && key && ['js', 'mjs'].includes(extensionOf(decoded))) {
          const type = attributeBy(tag.attrs, 'type')?.rawValue ?? null
          const scriptKind = javascriptKind(type)
          const base = directoryOf(key)
          const source = decodeText(bytes)
          body = neutralizeScriptClose(scriptKind === 'other'
            ? source
            : rewriteJavaScript(source, scriptKind === 'module' ? 'module' : 'script', base, sink, siblings, `第 ${scriptNumber} 个 <script>（${key}）`))
          src.drop = true
          if (scriptKind !== 'module' && attributeBy(tag.attrs, 'defer') && !attributeBy(tag.attrs, 'async')) tag.attrs.push({
            name: 'data-cw-defer', rawName: 'data-cw-defer', hasValue: false, quote: '', rawValue: '', value: '', changed: true, drop: false,
          })
          inlined = true
        } else if (bytes && key) {
          addDiagnostic(sink, 'warning', 'unsupported-script-source', `脚本文件类型未内联: ${key}；保留外部引用`, decoded)
        } else if (!/^https?:|^\/\//i.test(decoded)) {
          const result = rewriteSingleUrl(decoded, 'html-attr', baseDir, sink, siblings, true, 'script')
          if (result.changed) { src.value = result.value.trim(); src.changed = true }
        }
      }
      if (!inlined) {
        const baseKind = javascriptKind(attributeBy(tag.attrs, 'type')?.hasValue ? attributeBy(tag.attrs, 'type')!.rawValue : null)
        body = neutralizeScriptClose(baseKind === 'other'
          ? body
          : rewriteJavaScript(body, baseKind === 'module' ? 'module' : 'script', baseDir, sink, siblings, `第 ${scriptNumber} 个 <script>`))
      }
      const start = tag.attrs.some(attribute => attribute.changed || attribute.drop) ? rebuildStart(tag, false) : html.slice(tagStart, tag.end)
      parts.push(start, body)
      if (raw.closed) parts.push(html.slice(raw.closeStart, raw.closeEnd))
      i = raw.closeEnd
      continue
    }
    rewriteAttributes(tag, baseDir, sink, siblings, tag.name === 'image' || tag.name === 'use', mediaParent)
    if (tag.name === 'image' || tag.name === 'use') {
      const xlink = attributeBy(tag.attrs, 'xlink:href')
      if (xlink?.hasValue) {
        const result = rewriteSingleUrl(decodeEntities(xlink.rawValue), 'html-attr', baseDir, sink, siblings, false, tag.name === 'image' ? 'image' : 'unknown')
        if (result.changed) { xlink.value = result.value; xlink.changed = true }
      }
    }
    parts.push(tag.attrs.some(attribute => attribute.changed || attribute.drop) ? rebuildStart(tag, tag.selfClosing) : html.slice(tagStart, tag.end))
    i = tag.end
  }
  return parts.join('')
}

/** 把 HTML 中的内嵌资源和同级文件抽成按内容去重的受管资源，不访问网络或磁盘。 */
export function extractHtmlResources(input: ExtractHtmlResourcesInput): ExtractHtmlResourcesResult {
  const sink = createSink()
  const siblings = siblingMap(input.siblingFiles)
  const html = transformHtml(input.html, sink, siblings)
  return { html, resources: [...sink.resources.values()], remoteReferences: sink.remoteReferences, diagnostics: sink.diagnostics }
}
