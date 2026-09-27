import { tokenizer, tokTypes } from 'acorn'
import type { TokenType } from 'acorn'
import { unpackHtmlDocumentRuntimeSource } from '../runtime/htmlDocumentSource'

export interface PageTextOccurrence { path: string; start: number; end: number; context: 'html-text' | 'html-attr' | 'js-string' | 'js-template'; attribute?: string }
export interface PageTextEntry { text: string; occurrences: PageTextOccurrence[] }
export interface PageTextScanResult { entries: PageTextEntry[]; diagnostics: { path: string; message: string }[] }
export interface PageTextScanInput { path: string; kind: 'html' | 'js' | 'css'; text: string }
export interface PageTextScanOptions { maxEntries?: number }

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const WORD_RE = /^[A-Za-z]+(?:['’][A-Za-z]+)*[.,!?…;:)]*$/
const SENTENCE_END_RE = /[.!?…。！？]$/
const URI_OR_PATH_RE = /^(?:https?:|data:|blob:|file:|ftp:|mailto:|tel:|ws:|[a-zA-Z]:[\\/]|\/|\.{1,2}\/|~\/)/
const FORMAT_PLACEHOLDER_RE = /%[sdif]|{\d+}/
const SELECTOR_HINT_RE = /[#>[\]{}]/
const NON_TEXT_RE = /[\d\s\p{P}\p{S}]/gu
const PURE_PUNCT_RE = /^[^\p{L}\p{N}]+$/u
const MAX_TEXT_LENGTH = 500

export function isDisplayText(text: string): boolean {
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return false
  if (text === 'use strict') return false
  if (URI_OR_PATH_RE.test(text)) return false
  if (FORMAT_PLACEHOLDER_RE.test(text)) return false
  const hasCjk = CJK_RE.test(text)
  if (!hasCjk && SELECTOR_HINT_RE.test(text)) return false
  if (text.replace(NON_TEXT_RE, '').length === 0) return false
  if (hasCjk) return true
  const tokens = text.split(/\s+/)
  const words = tokens.filter((word) => WORD_RE.test(word))
  const allWordLike = tokens.every((word) => WORD_RE.test(word) || PURE_PUNCT_RE.test(word))
  if (!allWordLike) return false
  if (words.length >= 2) return true
  return words.length >= 1 && SENTENCE_END_RE.test(text)
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' }

function decodeHtmlEntities(raw: string): string {
  return raw.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return HTML_ENTITIES[name.toLowerCase()] ?? match
  })
}

function normalizeHtmlText(raw: string): string {
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim()
}

interface HtmlTagAttr { name: string; value: string; valueStart: number; valueEnd: number }
interface HtmlTag { name: string; closing: boolean; selfClosing: boolean; attrs: HtmlTagAttr[]; end: number }

function parseHtmlTag(src: string, lt: number): HtmlTag | null {
  let i = lt + 1
  let closing = false
  if (src[i] === '/') { closing = true; i += 1 }
  const nameStart = i
  while (i < src.length && /[a-zA-Z0-9-]/.test(src[i])) i += 1
  if (i === nameStart) return null
  const name = src.slice(nameStart, i).toLowerCase()
  const attrs: HtmlTagAttr[] = []
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i += 1
    if (i >= src.length) return null
    if (src[i] === '>') return { name, closing, selfClosing: false, attrs, end: i + 1 }
    if (src[i] === '/' && src[i + 1] === '>') return { name, closing, selfClosing: true, attrs, end: i + 2 }
    const attrStart = i
    while (i < src.length && !/[\s=>/]/.test(src[i])) i += 1
    if (i === attrStart) return null
    const attrName = src.slice(attrStart, i).toLowerCase()
    while (i < src.length && /\s/.test(src[i])) i += 1
    if (src[i] !== '=') { attrs.push({ name: attrName, value: '', valueStart: i, valueEnd: i }); continue }
    i += 1
    while (i < src.length && /\s/.test(src[i])) i += 1
    const quote = src[i]
    if (quote === '"' || quote === "'") {
      const close = src.indexOf(quote, i + 1)
      if (close < 0) return null
      attrs.push({ name: attrName, value: src.slice(i + 1, close), valueStart: i + 1, valueEnd: close })
      i = close + 1
    } else {
      const valueStart = i
      while (i < src.length && !/[\s>]/.test(src[i])) i += 1
      attrs.push({ name: attrName, value: src.slice(valueStart, i), valueStart, valueEnd: i })
    }
  }
}

function findCloseTag(src: string, from: number, name: string): number {
  const pattern = new RegExp(`</${name}(?=[\\s/>])`, 'gi')
  pattern.lastIndex = from
  const match = pattern.exec(src)
  return match ? match.index : -1
}

function isScannableScriptType(type: string | undefined): boolean {
  if (type === undefined) return true
  const t = type.trim().toLowerCase()
  if (t === '' || t === 'module') return true
  return /^(?:text|application)\/(?:java|ecma)script$/.test(t)
}

type AddText = (text: string, occurrence: PageTextOccurrence) => void

const TEXT_ATTRS = new Set(['alt', 'title', 'placeholder'])
const SKIP_CONTENT_TAGS = new Set(['style', 'template'])

function scanHtmlFile(file: PageTextScanInput, add: AddText, diagnostics: { path: string; message: string }[]): void {
  const src = file.text
  let i = 0
  let textStart = 0
  const flushText = (end: number) => {
    if (end <= textStart) return
    let s = textStart
    let e = end
    while (s < e && /\s/.test(src[s])) s += 1
    while (e > s && /\s/.test(src[e - 1])) e -= 1
    const text = normalizeHtmlText(src.slice(s, e))
    if (text) add(text, { path: file.path, start: s, end: e, context: 'html-text' })
  }
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    const next = src[lt + 1]
    if (next === undefined) break
    if (!/[a-zA-Z/!?]/.test(next)) { i = lt + 1; continue }
    if (src.startsWith('!--', lt + 1)) {
      flushText(lt)
      const end = src.indexOf('-->', lt + 4)
      i = end < 0 ? src.length : end + 3
      textStart = i
      continue
    }
    if (next === '!' || next === '?') {
      flushText(lt)
      const end = src.indexOf('>', lt + 2)
      i = end < 0 ? src.length : end + 1
      textStart = i
      continue
    }
    const tag = parseHtmlTag(src, lt)
    if (!tag) { i = lt + 1; continue }
    flushText(lt)
    i = tag.end
    if (!tag.closing) {
      for (const attr of tag.attrs) {
        if (TEXT_ATTRS.has(attr.name) && attr.valueEnd > attr.valueStart) {
          const text = normalizeHtmlText(attr.value)
          if (text) add(text, { path: file.path, start: attr.valueStart, end: attr.valueEnd, context: 'html-attr', attribute: attr.name })
        }
      }
      if (tag.name === 'script' && !tag.selfClosing) {
        const close = findCloseTag(src, i, 'script')
        const innerEnd = close < 0 ? src.length : close
        const hasSrc = tag.attrs.some((a) => a.name === 'src')
        if (!hasSrc && isScannableScriptType(tag.attrs.find((a) => a.name === 'type')?.value)) {
          scanJavaScript(src.slice(i, innerEnd), i, file.path, add, diagnostics)
        }
        i = innerEnd
        if (close >= 0) {
          const gt = src.indexOf('>', close)
          i = gt < 0 ? src.length : gt + 1
        }
      } else if (SKIP_CONTENT_TAGS.has(tag.name) && !tag.selfClosing) {
        const close = findCloseTag(src, i, tag.name)
        i = close < 0 ? src.length : close
        if (close >= 0) {
          const gt = src.indexOf('>', close)
          i = gt < 0 ? src.length : gt + 1
        }
      }
    }
    textStart = i
  }
  flushText(src.length)
}

interface LexToken { type: TokenType; value?: unknown; start: number; end: number }

function collectTokens(code: string, sourceType: 'module' | 'script'): { tokens: LexToken[]; error: unknown } {
  const tokens: LexToken[] = []
  try {
    const it = tokenizer(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true })
    for (;;) {
      const token = it.getToken() as LexToken
      if (token.type.label === 'eof') break
      tokens.push(token)
    }
    return { tokens, error: null }
  } catch (error) {
    return { tokens, error }
  }
}

function scanJavaScript(code: string, baseOffset: number, path: string, add: AddText, diagnostics: { path: string; message: string }[]): void {
  let { tokens, error } = collectTokens(code, 'module')
  if (error) {
    const retry = collectTokens(code, 'script')
    if (!retry.error || retry.tokens.length > tokens.length) { tokens = retry.tokens; error = retry.error }
  }
  if (error) diagnostics.push({ path, message: error instanceof Error ? error.message : String(error) })
  for (const token of tokens) {
    if (token.type === tokTypes.string) {
      const text = typeof token.value === 'string' ? token.value.replace(/\s+/g, ' ').trim() : ''
      if (text) add(text, { path, start: baseOffset + token.start + 1, end: baseOffset + token.end - 1, context: 'js-string' })
    } else if (token.type === tokTypes.template) {
      const text = typeof token.value === 'string' ? token.value.replace(/\s+/g, ' ').trim() : ''
      if (text) add(text, { path, start: baseOffset + token.start, end: baseOffset + token.end, context: 'js-template' })
    }
  }
}

export function scanPageText(files: readonly PageTextScanInput[], options: PageTextScanOptions = {}): PageTextScanResult {
  const maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY
  const diagnostics: { path: string; message: string }[] = []
  const byText = new Map<string, PageTextEntry>()
  const add: AddText = (text, occurrence) => {
    if (!isDisplayText(text)) return
    const existing = byText.get(text)
    if (existing) { existing.occurrences.push(occurrence); return }
    if (byText.size >= maxEntries) return
    byText.set(text, { text, occurrences: [occurrence] })
  }
  for (const file of files) {
    if (file.kind === 'html') scanHtmlFile(file, add, diagnostics)
    else if (file.kind === 'js') scanJavaScript(file.text, 0, file.path, add, diagnostics)
  }
  return { entries: [...byText.values()], diagnostics }
}

export function scanRuntimePageText(source: string, options: PageTextScanOptions = {}): PageTextScanResult {
  const htmlDocument = unpackHtmlDocumentRuntimeSource(source)
  return htmlDocument
    ? scanPageText([{ path: 'runtime.html', kind: 'html', text: htmlDocument.html }], options)
    : scanPageText([{ path: 'runtime.js', kind: 'js', text: source }], options)
}
