import { Marked, Lexer, type Token, type Tokens, type TokensList, type TokenizerExtension } from 'marked'
import { decodeHTMLStrict } from 'entities'
import { documentBlockSchema, documentContentSchema, documentTextSlots, documentTextStyleSchema, documentMathStyleSchema, normalizeDocumentText, type DocumentBlock, type DocumentContent, type FlowInline, type FlowTextContent } from './content'
import { describeDocumentMath, DocumentMathError, parseDocumentMath } from './math'
import { documentObjectSchema, emptyDocumentResources, resourcesForBlock, validateDocumentResources, type DocumentResources } from './resources'
import type { DocumentDiagnostic } from './ports'
import { mapMarkdownBlock, type MarkdownSourceMap } from './markdownSourceMap'

export interface MarkdownDocument { content: DocumentContent; resources: DocumentResources }
export interface MarkdownOptions {
  /** Receiver allocates identity; the parser never fixes duplicate explicit IDs. */
  createId: (kind: 'block' | 'item' | 'row' | 'column' | 'formula' | 'asset') => string
  target?: 'flow' | 'file'
  resolveImage?: (href: string) => { assetId: string; source: DocumentResources['assets'][number]['source'] }
}
export type MarkdownParseResult =
  | { status: 'valid'; document: MarkdownDocument; source: string; sourceMap: MarkdownSourceMap; diagnostics: [] }
  | { status: 'invalid'; source: string; diagnostics: DocumentDiagnostic[] }
class SourceError extends Error { constructor(message: string, readonly fragment: string, readonly absoluteOffset?: number) { super(message) } }
function error(message: string, fragment: string): never { throw new SourceError(message, fragment) }

/** Attribute strings use JSON scalars, with a deliberately closed field set. */
function attributes(source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let remaining = source
  while (remaining.trim()) {
    const match = /^\s*cw:([A-Za-z][A-Za-z0-9]*)=("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|true|false|null)(?=\s|$)/.exec(remaining)
    if (!match) error('属性须使用 cw:字段=JSON值', source)
    if (Object.hasOwn(result, match[1]!)) error('属性重复', source)
    result[match[1]!] = JSON.parse(match[2]!)
    remaining = remaining.slice(match[0].length)
  }
  return result
}
function attributeTail(src: string): { attrs: Record<string, unknown>; length: number } {
  if (!src.startsWith('{cw:')) return { attrs: {}, length: 0 }
  let quote = false
  for (let i = 1; i < src.length; i++) {
    if (src[i] === '\\' && quote) { i++; continue }
    if (src[i] === '"') quote = !quote
    if (src[i] === '}' && !quote) return { attrs: attributes(src.slice(1, i)), length: i + 1 }
  }
  return error('属性未闭合', src)
}
function commentJson(raw: string, kind: string): Record<string, unknown> {
  const match = new RegExp(`^<!--cw:${kind}\\s+([\\s\\S]*?)-->$`).exec(raw.trim())
  if (!match) return error('无效身份标记', raw)
  const value: unknown = JSON.parse(match[1]!)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return error('标记需要 JSON 对象', raw)
  return value as Record<string, unknown>
}
const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/[\\`*_[\]{}<>!$|~#.+\-]/g, '\\$&').replace(/\n/g, '  \n')
const attrsText = (attrs: Record<string, unknown>): string => Object.keys(attrs).length ? `{${Object.entries(attrs).map(([k, v]) => `cw:${k}=${JSON.stringify(v)}`).join(' ')}}` : ''
const metadata = (kind: string, attrs: object): string => `<!--cw:${kind} ${JSON.stringify(attrs).replace(/-->/g, '--\\u003e')}-->`
const fence = (body: string, language: string): string => {
  const n = Math.max(3, ...Array.from(body.matchAll(/`+/g), m => m[0].length + 1))
  return `${'`'.repeat(n)}${language}\n${body}\n${'`'.repeat(n)}`
}

function inlineSource(content: FlowTextContent): string {
  return content.inlines.map(atom => {
    let value: string
    if (atom.type === 'math') value = `$${atom.latex}$` + attrsText({ formulaId: atom.formulaId, accessibleText: atom.accessibleText, ...atom.style })
    else {
      value = escapeText(atom.text)
      if (atom.code) {
        const n = Math.max(1, ...Array.from(atom.text.matchAll(/`+/g), m => m[0].length + 1))
        const pad = atom.text.startsWith('`') || atom.text.endsWith('`') || /^ .* $/s.test(atom.text) ? ' ' : ''
        value = `${'`'.repeat(n)}${pad}${atom.text}${pad}${'`'.repeat(n)}`
      }
      if (atom.style && Object.keys(atom.style).length) value = `[${value}]` + attrsText({ ...atom.style })
    }
    if (atom.link) value = `[${value}](<${atom.link.href.replace(/&/g, '&amp;')}>${atom.link.title !== undefined ? ` ${JSON.stringify(atom.link.title.replace(/&/g, '&amp;'))}` : ''})`
    return value
  }).join('')
}

export function serializeDocumentMarkdown(document: MarkdownDocument, target: 'flow' | 'file' = 'flow'): string {
  documentContentSchema.parse(document.content)
  validateDocumentResources(document.content.blocks, document.resources, target)
  const object = (block: DocumentBlock) => fence(JSON.stringify({ kind: 'flow-block', block, resources: resourcesForBlock(block, document.resources) }, null, 2), 'cw-object-v1')
  return document.content.blocks.map(block => {
    // Multiline code atoms/URLs have no lossless ordinary inline representation.
    const simpleSlots = documentTextSlots(block).map(s => s.content)
    if (simpleSlots.some(c => {
      const first = c.inlines[0]; const last = c.inlines.at(-1)
      return first?.type === 'text' && /^\s/.test(first.text) || last?.type === 'text' && /\s$/.test(last.text)
    })) return object(block)
    if (simpleSlots.some(c => c.inlines.some(i => i.type === 'text' && i.code && (/[\n\[\]]/.test(i.text) || /^\s*$/.test(i.text)) || i.link && (/[<>\\\n]/.test(i.link.href) || /[\\\n]/.test(i.link.title ?? ''))))) return object(block)
    switch (block.type) {
      case 'paragraph': case 'heading': case 'quote': {
        if (block.type === 'quote' && block.citation) return object(block)
        if (!block.content.inlines.length) return object(block)
        const { content, type, ...meta } = block
        return `${metadata('block', meta)}\n${type === 'heading' ? '#'.repeat(block.level) + ' ' : type === 'quote' ? '> ' : ''}${inlineSource(content).replace(/\n/g, type === 'quote' ? '\n> ' : '\n')}`
      }
      case 'list':
        if (block.items.some(i => inlineSource(i.content).includes('\n') || !i.content.inlines.length)) return object(block)
        return `${metadata('block', { id: block.id })}\n${block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${metadata('item', { id: item.id })}${inlineSource(item.content)}`).join('\n')}`
      case 'table': {
        if (block.merges !== undefined || block.caption || block.columns.some(c => /[|\n]/.test(inlineSource(c.header) + c.id)) || block.rows.some(r => /[|\n]/.test(r.id) || Object.values(r.cells).some(c => /[|\n]/.test(inlineSource(c))))) return object(block)
        const headers = block.columns.map(c => `${inlineSource(c.header)} ${metadata('column', { id: c.id })}`)
        return `${metadata('block', { id: block.id })}\n| ${headers.join(' | ')} |\n| ${block.columns.map(() => '---').join(' | ')} |\n${block.rows.map(r => `| ${block.columns.map((c, i) => `${i === 0 ? metadata('row', { id: r.id }) : ''}${inlineSource(r.cells[c.id]!)}`).join(' | ')} |`).join('\n')}`
      }
      case 'formula': { const { type: _type, latex, ...meta } = block; return `${metadata('block', meta)}\n$$\n${latex}\n$$` }
      case 'code': return block.language === 'cw-object-v1' ? object(block) : `${metadata('block', { id: block.id })}\n${fence(block.code, block.language ?? '')}`
      case 'divider': return `${metadata('block', { id: block.id })}\n---`
      default: return object(block)
    }
  }).join('\n\n') + '\n'
}

/** Uses the same pinned Marked lexer as Tiptap Markdown, with product-owned
 * mapping. No ProseMirror JSON is saved; metadata never goes through HTML DOM.
 */
export function parseDocumentMarkdown(source: string, options: MarkdownOptions): MarkdownParseResult {
  const originalSource = source
  source = source.replace(/\r\n?/g, '\n')
  let location = 0
  try {
    const resources = emptyDocumentResources()
    const extensions: TokenizerExtension[] = [
      {
        name: 'cwMeta', level: 'block', start: src => src.indexOf('<!--cw:block'),
        tokenizer(src) {
          if (!src.startsWith('<!--cw:block')) return
          const end = src.indexOf('-->')
          if (end < 0) return error('块标记未闭合', src)
          const raw = src.slice(0, end + 3)
          return { type: 'cwMeta', raw, attrs: commentJson(raw, 'block') }
        },
      },
      {
        name: 'cwFormula', level: 'block', start: src => { const m = /(?:^|\n)\$\$\s*\n/.exec(src); return m ? m.index + (src[m.index] === '\n' ? 1 : 0) : undefined },
        tokenizer(src) {
          if (!/^\$\$[ \t]*\n/.test(src)) return
          const match = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src)
          if (!match) return error('独立公式未闭合', src)
          return { type: 'cwFormula', raw: match[0], latex: match[1] }
        },
      },
      {
        name: 'cwMath', level: 'inline', start: src => src.indexOf('$'),
        tokenizer(src) {
          if (!src.startsWith('$')) return
          let end = 1
          for (; end < src.length; end++) { if (src[end] === '\\') end++; else if (src[end] === '$') break; else if (src[end] === '\n') return error('行内公式未闭合', src) }
          if (end === src.length) return error('行内公式未闭合，字面美元请写 \\$', src)
          const tail = attributeTail(src.slice(end + 1))
          return { type: 'cwMath', raw: src.slice(0, end + 1 + tail.length), latex: src.slice(1, end), attrs: tail.attrs }
        },
      },
      {
        name: 'cwStyle', level: 'inline', start: src => src.indexOf('['),
        tokenizer(src) {
          if (!src.startsWith('[')) return
          let depth = 1
          for (let i = 1; i < src.length; i++) {
            if (src[i] === '\\') { i++; continue }
            if (src[i] === '[') depth++
            if (src[i] === ']') {
              depth--
              if (!depth) {
                const tail = attributeTail(src.slice(i + 1))
                if (!tail.length) return
                return { type: 'cwStyle', raw: src.slice(0, i + 1 + tail.length), text: src.slice(1, i), attrs: tail.attrs }
              }
            }
          }
        },
      },
    ]
    const lexer = new Marked({ gfm: true, extensions })
    const mathDescription = (latex: string): string => {
      try { return describeDocumentMath(parseDocumentMath(latex)) } catch (e) {
        if (e instanceof DocumentMathError) {
          const start = source.indexOf(latex, location)
          throw new SourceError(e.message, latex, start >= 0 ? start + e.offset : location)
        }
        throw e
      }
    }
    let links: TokensList['links'] = {}
    const lexInline = (src: string): Token[] => {
      const inlineLexer = new Lexer(lexer.defaults)
      inlineLexer.tokens.links = links
      return inlineLexer.inlineTokens(src)
    }
    const inlines = (tokens: Token[], style: Record<string, unknown> = {}, link?: { href: string; title?: string }): FlowInline[] => tokens.flatMap((token): FlowInline[] => {
      const t = token as Tokens.Generic
      switch (token.type) {
        case 'text': case 'escape': {
          if (t.tokens) return inlines(t.tokens as Token[], style, link)
          if (token.type === 'text' && (t.text as string).includes('{cw:')) return error('样式扩展没有合法的正文或公式目标', token.raw)
          return [{ type: 'text', text: decodeHTMLStrict((t.text as string).replace(/\n/g, ' ')), ...(Object.keys(style).length ? { style: documentTextStyleSchema.parse(style) } : {}), ...(link ? { link } : {}) }]
        }
        case 'br': return [{ type: 'text', text: '\n', ...(Object.keys(style).length ? { style: documentTextStyleSchema.parse(style) } : {}), ...(link ? { link } : {}) }]
        case 'strong': case 'em': case 'del': return inlines(t.tokens as Token[], { ...style, [token.type === 'strong' ? 'bold' : token.type === 'em' ? 'italic' : 'strike']: true }, link)
        case 'codespan': return [{ type: 'text', text: t.text as string, code: true, ...(Object.keys(style).length ? { style: documentTextStyleSchema.parse(style) } : {}), ...(link ? { link } : {}) }]
        case 'link':
          if (link) return error('禁止嵌套链接', token.raw)
          return inlines(t.tokens as Token[], style, { href: decodeHTMLStrict(t.href as string), ...(t.title !== null && t.title !== undefined ? { title: decodeHTMLStrict(t.title as string) } : {}) })
        case 'cwStyle': return inlines(lexInline(t.text as string), { ...style, ...documentTextStyleSchema.parse(t.attrs) }, link)
        case 'cwMath': {
          const { formulaId, accessibleText, ...mathStyle } = t.attrs as Record<string, unknown>
          // Text-only marks cannot be silently discarded around a formula.
          const resolvedStyle = documentMathStyleSchema.parse({ ...style, ...mathStyle })
          const latex = t.latex as string
          const description = mathDescription(latex)
          return [{ type: 'math', formulaId: formulaId === undefined ? options.createId('formula') : formulaId as string, latex, accessibleText: accessibleText === undefined ? description : accessibleText as string, ...(Object.keys(resolvedStyle).length ? { style: resolvedStyle } : {}), ...(link ? { link } : {}) }]
        }
        default: return error(`不支持或位置不正确的行内内容：${token.type}`, token.raw)
      }
    })
    const text = (src: string) => normalizeDocumentText({ inlines: inlines(lexInline(src)) })
    const mergeResources = (extra: DocumentResources) => {
      for (const a of extra.assets) {
        const prior = resources.assets.find(p => p.assetId === a.assetId)
        if (prior && JSON.stringify(prior.source) !== JSON.stringify(a.source)) error('同一素材的来源冲突', a.assetId)
        if (!prior) resources.assets.push(a)
      }
      for (const c of extra.components) {
        const prior = resources.components.find(p => p.packageId === c.packageId && p.version === c.version)
        if (prior && JSON.stringify(prior.source) !== JSON.stringify(c.source)) error('同一组件包的来源冲突', c.packageId)
        if (!prior) resources.components.push(c)
      }
    }
    const idMarker = (src: string, kind: 'item' | 'row' | 'column'): { id: string; source: string } => {
      const re = new RegExp(`<!--cw:${kind}\\s+[\\s\\S]*?-->`)
      const match = re.exec(src)
      if (!match) return { id: options.createId(kind), source: src }
      const attrs = commentJson(match[0], kind)
      if (Object.keys(attrs).length !== 1 || typeof attrs.id !== 'string') return error('身份标记只接受 id', match[0])
      return { id: attrs.id, source: src.slice(0, match.index) + src.slice(match.index + match[0].length) }
    }
    const blocks: DocumentBlock[] = []
    const sourceMap: MarkdownSourceMap = { blocks: [] }
    let pending: Record<string, unknown> | undefined
    let pendingStart: number | undefined
    let cursor = 0
    const tokens = lexer.lexer(source)
    links = tokens.links
    for (const token of tokens) {
      // Advance every consumed token, including metadata and whitespace. Searching
      // again can match a visible word inside the preceding identity marker.
      location = cursor
      if (source.slice(cursor, cursor + token.raw.length) !== token.raw) error('源文块位置无法对应，请检查格式', token.raw)
      cursor += token.raw.length
      const t = token as Tokens.Generic
      if (token.type === 'space' || token.type === 'def') continue
      if (token.type === 'cwMeta') {
        if (pending) error('一个块只能有一个元数据标记', token.raw)
        pending = t.attrs as Record<string, unknown>
        pendingStart = location
        continue
      }
      const meta = pending ?? {}; pending = undefined
      let value: unknown
      const common = { ...meta, id: meta.id === undefined ? options.createId('block') : meta.id }
      // Metadata can provide fields, but cannot override the semantic token type.
      if ('type' in meta) error('块元数据不能覆盖类型', token.raw)
      const bodyFields = ['content', 'items', 'columns', 'rows', 'code', 'language', 'latex', 'assetId', 'mediaKind', 'ordered']
      if (bodyFields.some(field => field in meta)) error('块标记不能包含由可见源文表达的正文字段', token.raw)
      switch (token.type) {
        case 'paragraph': case 'heading': case 'text': {
          const ts = t.tokens as Token[] | undefined
          if (ts?.length === 1 && ts[0]!.type === 'image') {
            const image = ts[0] as Tokens.Image
            const asset = options.resolveImage?.(image.href)
            if (!asset) error('图片尚未通过资源接入口准备', image.raw)
            mergeResources({ assets: [asset], components: [] })
            value = { ...common, type: 'media', assetId: asset.assetId, mediaKind: 'image', layout: 'content-width', altText: image.text, ...(image.title ? { caption: { inlines: [{ type: 'text', text: image.title }] } } : {}) }
          } else {
            value = { ...common, type: token.type === 'heading' ? 'heading' : 'paragraph', ...(token.type === 'heading' ? { level: t.depth } : {}), content: text(t.text as string) }
            if (token.type === 'heading' && meta.level !== undefined && meta.level !== t.depth) error('标题层级与源文不一致', token.raw)
          }
          break
        }
        case 'blockquote': {
          const child = (t.tokens as Token[]).filter(c => c.type !== 'space')
          if (child.length !== 1 || child[0]?.type !== 'paragraph') error('复杂引用需要 cw-object-v1 以保持块语义', token.raw)
          value = { ...common, type: 'quote', content: text((child[0] as Tokens.Paragraph).text) }; break
        }
        case 'list': {
          const items = (t.items as Tokens.ListItem[]).map(item => {
            const info = idMarker(item.text, 'item')
            if (item.task || lexer.lexer(info.source).some(c => !['paragraph', 'text', 'space'].includes(c.type))) error('嵌套或任务列表尚不能映射到正式 Flow 列表', item.raw)
            return { id: info.id, content: text(info.source) }
          })
          value = { ...common, type: 'list', ordered: t.ordered, items }; break
        }
        case 'table': {
          const table = token as Tokens.Table
          if (table.align.some(a => a !== null)) error('表格列对齐没有正式字段，不能静默丢失', token.raw)
          const columns = table.header.map(c => { const info = idMarker(c.text, 'column'); return { id: info.id, header: text(info.source.trimEnd()) } })
          const rows = table.rows.map(cells => {
            const info = idMarker(cells[0]!.text, 'row')
            return { id: info.id, cells: Object.fromEntries(cells.map((cell, i) => [columns[i]!.id, text(i === 0 ? info.source : cell.text)])) }
          })
          value = { ...common, type: 'table', columns, rows }; break
        }
        case 'cwFormula': {
          const latex = t.latex as string
          const description = mathDescription(latex)
          value = { ...common, type: 'formula', formulaId: meta.formulaId === undefined ? options.createId('formula') : meta.formulaId, accessibleText: meta.accessibleText === undefined ? description : meta.accessibleText, latex }; break
        }
        case 'code':
          if (/^ {0,3}(`{3,}|~{3,})/.test(token.raw)) {
            const opening = /^ {0,3}(`{3,}|~{3,})/.exec(token.raw)![1]!
            const closing = new RegExp(`\\n {0,3}${opening[0]}{${opening.length},}[ \\t]*(?:\\n)?$`)
            if (!closing.test(token.raw)) error('代码或对象围栏未闭合', token.raw)
          }
          if (t.lang === 'cw-object-v1') {
            if (Object.keys(meta).length) error('对象片段已包含完整身份，不接受额外块标记', token.raw)
            const object = documentObjectSchema.parse(JSON.parse(t.text as string))
            mergeResources(object.resources); value = object.block
          } else value = { ...common, type: 'code', code: t.text, ...(t.lang ? { language: t.lang } : {}) }
          break
        case 'hr': value = { ...common, type: 'divider' }; break
        default: error(`未知源文块 ${token.type}，原文已保留`, token.raw)
      }
      const block = documentBlockSchema.parse(value)
      blocks.push(block)
      sourceMap.blocks.push({ ...mapMarkdownBlock(token, block, location, lexInline), from: pendingStart ?? location })
      pendingStart = undefined
      location += token.raw.length
    }
    if (pending) error('块标记后缺少内容', '<!--cw:block')
    const content = documentContentSchema.parse({ blocks })
    validateDocumentResources(blocks, resources, options.target)
    // Source editors use the original UTF-16 indices, including CRLF pairs.
    const offsets: number[] = []; let originalOffset = 0
    for (let i = 0; i < source.length; i++) { offsets.push(originalOffset); if (originalSource[originalOffset] === '\r' && originalSource[originalOffset + 1] === '\n') originalOffset++; originalOffset++ }
    offsets.push(originalSource.length)
    for (const block of sourceMap.blocks) {
      block.from = offsets[block.from]!; block.to = offsets[block.to]!
      for (const slot of block.slots) for (const unit of slot.units) { unit.from = offsets[unit.from]!; unit.to = offsets[unit.to]! }
    }
    return { status: 'valid', source: originalSource, document: { content, resources }, sourceMap, diagnostics: [] }
  } catch (e) {
    const found = e instanceof SourceError ? source.indexOf(e.fragment, Math.min(location, source.length)) : -1
    const normalizedOffset = Math.min(source.length, e instanceof SourceError && e.absoluteOffset !== undefined ? e.absoluteOffset : found >= 0 ? found : location)
    let offset = 0
    for (let n = 0; n < normalizedOffset; n++, offset++) if (originalSource[offset] === '\r' && originalSource[offset + 1] === '\n') offset++
    const before = source.slice(0, normalizedOffset)
    return { status: 'invalid', source: originalSource, diagnostics: [{ message: e instanceof Error ? e.message : '源文解析失败', offset, endOffset: Math.min(originalSource.length, offset + 1), line: before.split('\n').length, column: normalizedOffset - before.lastIndexOf('\n') }] }
  }
}
