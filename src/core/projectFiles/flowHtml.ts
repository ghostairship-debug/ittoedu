import type { NativeChartContent, TextRunStyle } from '../../shared/contracts/native-v1/types'
import { assetReferencePath } from '../../shared/composition/projectReferences'
import type { CourseAssetMeta, FlowBlock, FlowSurfaceDocument } from '../../shared/courseProjectTypes'
import { describeDocumentMath, parseDocumentMath } from '../../shared/document/math'
import { normalizeDocumentText, type FlowInline, type FlowTextContent, type InlineLink, type MathStyle } from '../../shared/document/content'
import { stableFlowId } from '../tools/flowDocumentModel'
import { assetFilePath, type PageDiagnostic, type PageNode, type PageParsePort } from './pageHtml'

type Assets = Readonly<Record<string, CourseAssetMeta>>
type ElementNode = Extract<PageNode, { kind: 'element' }>
type Block = FlowBlock
type Of<T extends Block['type']> = Extract<Block, { type: T }>
type ParagraphStyle = { textAlign?: 'left' | 'center' | 'right'; lineSpacing?: number }

export interface FlowHtmlContext {
  assets: Assets
  /** Component package display names, for blocks that embed a component. */
  packageName(packageId: string): string
}

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;')
const scriptJson = (value: unknown) => JSON.stringify(value, null, 2).replace(/<(\/script|!--)/gi, '\\u003c$1')
const CHART_HEIGHT = 320
const HIGHLIGHT = '#fef08a'

function defaultAccessibleText(latex: string): string | undefined {
  try { return describeDocumentMath(parseDocumentMath(latex)).trim() || undefined } catch { return undefined }
}

// ---------------------------------------------------------------------------------------------
// Serialization: one continuous semantic HTML document per Flow surface. Ids never appear.

const STYLE_TAGS: readonly [keyof TextRunStyle, string][] = [['strike', 's'], ['underline', 'u'], ['italic', 'em'], ['bold', 'strong']]

function styleCss(style: TextRunStyle): { css: string[]; rest: Record<string, unknown> } {
  const css: string[] = [], rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(style) as [keyof TextRunStyle, unknown][]) {
    if (value === undefined) continue
    if ((key === 'bold' || key === 'italic' || key === 'underline' || key === 'strike') && value === true) continue
    if (key === 'color') css.push(`color:${value}`)
    else if (key === 'fontFamily') css.push(`font-family:${value}`)
    else if (key === 'fontSize') css.push(`font-size:${value}px`)
    else if (key === 'baseline') css.push(`vertical-align:${value}em`)
    else if (key === 'bold') css.push('font-weight:400')
    else if (key === 'italic') css.push('font-style:normal')
    else if (key === 'highlightColor') css.push(`background-color:${value ?? 'transparent'}`)
    else if (key === 'emphasis') css.push(`text-emphasis-style:${value ? 'filled circle' : 'none'}`)
    else rest[key] = value
  }
  return { css, rest }
}

function textHtml(text: string): string {
  return text.split('\n').map(escapeText).join('<br>')
}

export function inlineHtml(content: FlowTextContent): string {
  return content.inlines.map(inline => {
    let html: string
    if (inline.type === 'math') {
      const math = `\\(${escapeText(inline.latex)}\\)`
      const labelled = inline.accessibleText !== defaultAccessibleText(inline.latex)
      const css = [inline.style?.fontSize !== undefined ? `font-size:${inline.style.fontSize}px` : '', inline.style?.color ? `color:${inline.style.color}` : ''].filter(Boolean).join(';')
      html = !labelled && !css ? math : `<span class="math"${labelled ? ` aria-label="${escapeAttribute(inline.accessibleText)}"` : ''}${css ? ` style="${escapeAttribute(css)}"` : ''}>${math}</span>`
    } else {
      html = textHtml(inline.text)
      const { css, rest } = styleCss(inline.style ?? {})
      if (css.length || Object.keys(rest).length)
        html = `<span${css.length ? ` style="${escapeAttribute(css.join(';'))}"` : ''}${Object.keys(rest).length ? ` data-style="${escapeAttribute(JSON.stringify(rest))}"` : ''}>${html}</span>`
      for (const [key, tag] of STYLE_TAGS) if (inline.style?.[key] === true) html = `<${tag}>${html}</${tag}>`
      if (inline.code) html = `<code>${html}</code>`
    }
    if (inline.link) html = `<a href="${escapeAttribute(inline.link.href)}"${inline.link.title !== undefined ? ` title="${escapeAttribute(inline.link.title)}"` : ''}>${html}</a>`
    return html
  }).join('')
}

function paragraphStyle(block: ParagraphStyle): string {
  const css = [block.textAlign ? `text-align:${block.textAlign}` : '', block.lineSpacing !== undefined ? `line-height:${block.lineSpacing}` : ''].filter(Boolean)
  return css.length ? ` style="${css.join(';')}"` : ''
}

function assetSource(assets: Assets, assetId: string): string {
  const meta = assets[assetId]
  return meta ? `../${assetFilePath(meta)}` : ''
}

function chartPayload(chart: NativeChartContent): unknown {
  return { chartType: chart.chartType, title: chart.title, categories: chart.categories.map(category => category.label),
    series: chart.series.map(series => ({ name: series.name, color: series.color,
      values: chart.categories.map(category => series.points.find(point => point.categoryId === category.id)?.value ?? 0) })),
    style: chart.style }
}

export function blockHtml(block: Block, context: FlowHtmlContext): string {
  switch (block.type) {
    case 'paragraph': return `<p${paragraphStyle(block)}>${inlineHtml(block.content)}</p>`
    case 'heading': return `<h${block.level}${paragraphStyle(block)}>${inlineHtml(block.content)}</h${block.level}>`
    case 'quote': return `<blockquote${paragraphStyle(block)}><p>${inlineHtml(block.content)}</p>${block.citation ? `<footer>${inlineHtml(block.citation)}</footer>` : ''}</blockquote>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}>\n${block.items.map(item => `<li>${inlineHtml(item.content)}</li>`).join('\n')}\n</${tag}>`
    }
    case 'divider': return '<hr>'
    case 'media': {
      const attributes = [block.layout !== 'content-width' ? ` data-layout="${block.layout}"` : '', block.wrap ? ` data-wrap="${block.wrap}"` : '',
        block.crop ? ` data-crop="${block.crop.left} ${block.crop.top} ${block.crop.right} ${block.crop.bottom}"` : '',
        block.cropX !== undefined ? ` data-crop-x="${block.cropX}"` : '', block.cropY !== undefined ? ` data-crop-y="${block.cropY}"` : ''].join('')
      const src = escapeAttribute(assetSource(context.assets, block.assetId))
      const label = block.altText !== undefined ? (block.mediaKind === 'image' ? ` alt="${escapeAttribute(block.altText)}"` : ` aria-label="${escapeAttribute(block.altText)}"`) : ''
      const media = block.mediaKind === 'image' ? `<img src="${src}"${label}>` : `<${block.mediaKind} src="${src}"${label} controls></${block.mediaKind}>`
      return `<figure${attributes}>${media}${block.caption ? `<figcaption>${inlineHtml(block.caption)}</figcaption>` : ''}</figure>`
    }
    case 'table': {
      const spans = new Map<string, { rows: number; columns: number }>(), covered = new Set<string>()
      for (const merge of block.merges ?? []) {
        spans.set(`${merge.rowIds[0]}\u0000${merge.columnIds[0]}`, { rows: merge.rowIds.length, columns: merge.columnIds.length })
        for (const row of merge.rowIds) for (const column of merge.columnIds) if (row !== merge.rowIds[0] || column !== merge.columnIds[0]) covered.add(`${row}\u0000${column}`)
      }
      const header = block.headerEnabled === undefined ? '' : ` data-header="${block.headerEnabled ? 'on' : 'off'}"`
      const rows = block.rows.map(row => `<tr>${block.columns.flatMap(column => {
        const key = `${row.id}\u0000${column.id}`
        if (covered.has(key)) return []
        const span = spans.get(key)
        const attributes = `${span && span.rows > 1 ? ` rowspan="${span.rows}"` : ''}${span && span.columns > 1 ? ` colspan="${span.columns}"` : ''}`
        return [`<td${attributes}>${inlineHtml(row.cells[column.id] ?? { inlines: [] })}</td>`]
      }).join('')}</tr>`).join('\n')
      return `<table${header}>\n${block.caption ? `<caption>${inlineHtml(block.caption)}</caption>\n` : ''}<thead><tr>${block.columns.map(column => `<th>${inlineHtml(column.header)}</th>`).join('')}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`
    }
    case 'chart': return `<guoling-chart data-height="${block.height}"><script type="application/json">${scriptJson(chartPayload(block.chart))}</script></guoling-chart>`
    case 'formula': {
      const css = [block.style?.fontSize !== undefined ? `font-size:${block.style.fontSize}px` : '', block.style?.color ? `color:${block.style.color}` : ''].filter(Boolean).join(';')
      const label = block.accessibleText === defaultAccessibleText(block.latex) ? '' : ` aria-label="${escapeAttribute(block.accessibleText)}"`
      return `<div class="math"${label}${css ? ` style="${css}"` : ''}>\\[${escapeText(block.latex)}\\]</div>`
    }
    case 'code': return `<pre><code${block.language ? ` class="language-${escapeAttribute(block.language)}"` : ''}>${escapeText(block.code)}</code></pre>`
    case 'callout': return `<aside data-tone="${block.tone}">${block.title ? `<header>${inlineHtml(block.title)}</header>` : ''}<p>${inlineHtml(block.body)}</p></aside>`
    case 'section': return `<details${block.collapsedByDefault ? '' : ' open'}>\n<summary>${inlineHtml(block.title)}</summary>\n${block.blocks.map(child => blockHtml(child, context)).join('\n')}\n</details>`
    case 'component': return `<guoling-component name="${escapeAttribute(context.packageName(block.component.packageId))}"${block.wrap ? ` data-wrap="${block.wrap}"` : ''}></guoling-component>`
  }
}

export function serializeFlowHtml(surface: Pick<FlowSurfaceDocument, 'title' | 'blocks'>, context: FlowHtmlContext): string {
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeText(surface.title)}</title>\n</head>\n<body>\n${
    surface.blocks.map(block => blockHtml(block, context)).join('\n')}\n</body>\n</html>\n`
}

// ---------------------------------------------------------------------------------------------
// Parsing: the importer's parser builds the tree; these rules read it as Flow blocks (fresh ids).

interface InlineContext { style: TextRunStyle; code?: boolean; link?: InlineLink; math?: { accessibleText?: string; style?: MathStyle } }
interface RawInline { text: string; br?: boolean; context: InlineContext }

const tagOf = (node: PageNode) => node.kind === 'element' ? node.tagName.toLowerCase() : ''
const textOf = (node: PageNode): string => node.kind === 'text' ? node.text : node.kind === 'element' ? node.children.map(textOf).join('') : ''
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

function declarations(css: string | undefined): [string, string][] {
  const result: [string, string][] = []
  let current = '', quote = '', depth = 0
  for (const character of css ?? '') {
    if (quote) { current += character; if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") quote = character
    else if (character === '(') depth++
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ';' && !depth) { push(); continue }
    current += character
  }
  push()
  function push() {
    const index = current.indexOf(':')
    if (index > 0) result.push([current.slice(0, index).trim().toLowerCase(), current.slice(index + 1).replace(/!important\s*$/i, '').trim()])
    current = ''
  }
  return result
}

function hexColor(value: string): string | undefined {
  const text = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(text)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const rgb = /^rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/i.exec(text)
  if (rgb) return `#${rgb.slice(1, 4).map(part => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`
  return undefined
}

function cssLength(value: string): number | undefined {
  const match = /^(-?[\d.]+)(px|pt|em|rem)?$/.exec(value.trim())
  if (!match) return undefined
  const number = Number(match[1])
  return !Number.isFinite(number) ? undefined : match[2] === 'pt' ? number * 4 / 3 : match[2] === 'em' || match[2] === 'rem' ? number * 16 : number
}

function applyCss(style: TextRunStyle, element: ElementNode): TextRunStyle {
  const next: TextRunStyle = { ...style }
  for (const [name, value] of declarations(element.attributes.style)) {
    const lower = value.toLowerCase()
    if (name === 'color') { const color = hexColor(value); if (color) next.color = color }
    else if (name === 'font-family' && value) next.fontFamily = value
    else if (name === 'font-size') { const size = cssLength(value); if (size !== undefined) next.fontSize = Math.min(400, Math.max(8, Math.round(size * 100) / 100)) }
    else if (name === 'vertical-align') {
      const em = /^(-?[\d.]+)em$/.exec(lower)
      if (em) next.baseline = Math.min(1, Math.max(-1, Number(em[1])))
      else if (lower === 'super') next.baseline = 0.3
      else if (lower === 'sub') next.baseline = -0.2
    } else if (name === 'font-weight') next.bold = lower === 'bold' || lower === 'bolder' || Number(lower) >= 600
    else if (name === 'font-style') next.italic = lower === 'italic' || lower === 'oblique'
    else if (name === 'text-decoration' || name === 'text-decoration-line') {
      if (lower.includes('underline')) next.underline = true
      if (lower.includes('line-through')) next.strike = true
    } else if (name === 'background-color' || name === 'background') {
      if (lower === 'transparent') next.highlightColor = null
      else { const color = hexColor(value); if (color) next.highlightColor = color }
    } else if (name === 'text-emphasis' || name === 'text-emphasis-style' || name === '-webkit-text-emphasis-style') next.emphasis = lower !== 'none'
  }
  if (element.attributes['data-style']) {
    try { Object.assign(next, JSON.parse(element.attributes['data-style'])) } catch { /* Ignore an unreadable extra style. */ }
  }
  return next
}

export interface FlowParseResult { blocks: Block[]; diagnostics: PageDiagnostic[] }
export class FlowContentError extends Error {}

/** Model HTML -> Flow blocks with fresh identities. Unsupported pieces are reported, never silently dropped. */
export function parseFlowHtml(html: string, options: { parse: PageParsePort; assets: Assets }): FlowParseResult {
  const diagnostics: PageDiagnostic[] = []
  const warn = (code: string, message: string) => { if (!diagnostics.some(item => item.message === message)) diagnostics.push({ level: 'warning', code, message }) }
  const parsed = options.parse({ html })
  if (parsed.kind === 'program') throw new FlowContentError('讲义不能包含脚本或事件属性；互动请写成 components/ 下的组件，放在演示页中')
  for (const item of parsed.diagnostics) if (item.level !== 'info') diagnostics.push(item)

  const byPath = new Map<string, CourseAssetMeta>(), byFilename = new Map<string, CourseAssetMeta | null>()
  for (const meta of Object.values(options.assets)) {
    byPath.set(assetFilePath(meta), meta)
    byFilename.set(meta.filename, byFilename.has(meta.filename) ? null : meta)
  }
  const assetFor = (src: string | undefined) => {
    const path = src === undefined ? null : assetReferencePath(src)
    return path ? byPath.get(path) ?? byFilename.get(path.slice('assets/'.length)) ?? undefined : undefined
  }

  function collectInlines(nodes: readonly PageNode[], context: InlineContext, out: RawInline[], hoisted: ElementNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'text') { out.push({ text: node.text, context }); continue }
      if (node.kind !== 'element') continue
      const tag = tagOf(node)
      if (tag === 'br') { out.push({ text: '\n', br: true, context }); continue }
      if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'figure') { hoisted.push(node); continue }
      if (tag === 'script' || tag === 'style' || tag === 'template') continue
      let next: InlineContext = { ...context, style: applyCss(context.style, node) }
      if (tag === 'strong' || tag === 'b') next.style = { ...next.style, bold: true }
      else if (tag === 'em' || tag === 'i' || tag === 'cite' || tag === 'var' || tag === 'dfn') next.style = { ...next.style, italic: true }
      else if (tag === 'u' || tag === 'ins') next.style = { ...next.style, underline: true }
      else if (tag === 's' || tag === 'del' || tag === 'strike') next.style = { ...next.style, strike: true }
      else if (tag === 'mark') next.style = { ...next.style, highlightColor: next.style.highlightColor ?? HIGHLIGHT }
      else if (tag === 'sup') next.style = { ...next.style, baseline: next.style.baseline ?? 0.3 }
      else if (tag === 'sub') next.style = { ...next.style, baseline: next.style.baseline ?? -0.2 }
      else if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') next.code = true
      else if (tag === 'a' && node.attributes.href) next.link = { href: node.attributes.href, ...(node.attributes.title !== undefined ? { title: node.attributes.title } : {}) }
      if ((node.attributes.class ?? '').split(/\s+/).includes('math')) {
        // A math wrapper's style describes its formulas, not surrounding text.
        const mathStyle: MathStyle = {}
        if (next.style.fontSize !== undefined && next.style.fontSize !== context.style.fontSize) mathStyle.fontSize = next.style.fontSize
        if (next.style.color !== undefined && next.style.color !== context.style.color) mathStyle.color = next.style.color
        next = { ...next, style: context.style, math: { ...(node.attributes['aria-label'] ? { accessibleText: node.attributes['aria-label'] } : {}), ...(Object.keys(mathStyle).length ? { style: mathStyle } : {}) } }
      }
      collectInlines(node.children, next, out, hoisted)
    }
  }

  /** HTML whitespace: a line break in the source (with its indentation) is one space, or nothing between CJK text. */
  function finishInlines(raw: RawInline[]): FlowTextContent {
    const parts = raw.map(part => ({ ...part }))
    const textual = parts.filter(part => !part.br)
    if (textual[0]) textual[0].text = textual[0].text.replace(/^[ \t\f]*[\r\n][\s]*/, '')
    if (textual.at(-1)) textual.at(-1)!.text = textual.at(-1)!.text.replace(/[\s]*[\r\n][ \t\f]*$/, '')
    const joined = parts.map(part => part.br ? '\u0000' : part.text).join('')
    const collapsed: string[] = []
    let cursor = 0
    for (const part of parts) {
      const end = cursor + (part.br ? 1 : part.text.length)
      if (part.br) { collapsed.push('\n'); cursor = end; continue }
      let text = ''
      for (let index = 0; index < part.text.length;) {
        const run = /^[ \t\f]*[\r\n][\s]*/.exec(part.text.slice(index))
        if (run) {
          const before = joined[cursor + index - 1] ?? '', after = joined[cursor + index + run[0].length] ?? ''
          if (!(CJK.test(before) && CJK.test(after))) text += ' '
          index += run[0].length
        } else { text += part.text[index]; index++ }
      }
      collapsed.push(text)
      cursor = end
    }
    const inlines: FlowInline[] = []
    parts.forEach((part, index) => {
      const text = collapsed[index]!
      if (!text) return
      const { context } = part
      const base = { ...(Object.keys(context.style).length ? { style: context.style } : {}), ...(context.link ? { link: context.link } : {}) }
      if (context.code || part.br) { inlines.push({ type: 'text', text, ...(context.code ? { code: true } : {}), ...base }); return }
      let rest = text
      for (let match = /\\\(([\s\S]+?)\\\)/.exec(rest); match; match = /\\\(([\s\S]+?)\\\)/.exec(rest)) {
        if (match.index) inlines.push({ type: 'text', text: rest.slice(0, match.index), ...base })
        const latex = match[1]!.trim()
        const accessibleText = context.math?.accessibleText ?? defaultAccessibleText(latex)
        if (accessibleText) inlines.push({ type: 'math', formulaId: stableFlowId('formula'), latex, accessibleText,
          ...(context.math?.style ? { style: context.math.style } : {}), ...(context.link ? { link: context.link } : {}) })
        else { warn('flow-math', `公式无法识别，已按文字保留：${latex.slice(0, 60)}`); inlines.push({ type: 'text', text: match[0], ...base }) }
        rest = rest.slice(match.index + match[0].length)
      }
      if (rest) inlines.push({ type: 'text', text: rest, ...base })
    })
    return normalizeDocumentText({ inlines })
  }

  const content = (nodes: readonly PageNode[], hoisted: ElementNode[] = []) => {
    const raw: RawInline[] = []
    collectInlines(nodes, { style: {} }, raw, hoisted)
    return finishInlines(raw)
  }

  function paragraphStyleOf(element: ElementNode): ParagraphStyle {
    const style: ParagraphStyle = {}
    for (const [name, value] of declarations(element.attributes.style)) {
      if (name === 'text-align' && (value === 'left' || value === 'center' || value === 'right')) style.textAlign = value
      if (name === 'line-height') { const number = Number(value); if (Number.isFinite(number) && number > 0) style.lineSpacing = number }
    }
    return style
  }

  /** `\[…\]` or `$$…$$` as the whole content of an element is a display formula. */
  function displayFormula(element: ElementNode): Of<'formula'> | undefined {
    const text = textOf(element).trim()
    const match = /^\\\[([\s\S]+)\\\]$/.exec(text) ?? /^\$\$([\s\S]+)\$\$$/.exec(text)
    if (!match) return undefined
    const latex = match[1]!.trim()
    const accessibleText = element.attributes['aria-label'] || defaultAccessibleText(latex)
    if (!accessibleText) { warn('flow-math', `公式无法识别：${latex.slice(0, 60)}`); return undefined }
    const style: MathStyle = {}, css = applyCss({}, element)
    if (css.fontSize !== undefined) style.fontSize = css.fontSize
    if (css.color) style.color = css.color
    return { id: stableFlowId('block'), type: 'formula', formulaId: stableFlowId('formula'), latex, accessibleText, ...(Object.keys(style).length ? { style } : {}) }
  }

  function media(element: ElementNode, figure?: ElementNode): Of<'media'> | undefined {
    const tag = tagOf(element)
    const kind = tag === 'img' ? 'image' : tag === 'video' || tag === 'audio' ? tag : undefined
    const source = element.attributes.src ?? element.children.find((child): child is ElementNode => tagOf(child) === 'source')?.attributes.src
    const meta = assetFor(source)
    if (!kind) return undefined
    if (!meta || meta.kind !== kind) {
      warn('flow-missing-asset', `讲义图片/媒体引用的素材不存在或类型不符，未写入：${source ?? '（无地址）'}；请先写入 assets/ 素材再引用`)
      return undefined
    }
    const holder = figure ?? element
    const layout = holder.attributes['data-layout']
    const wrap = holder.attributes['data-wrap']
    const crop = holder.attributes['data-crop']?.trim().split(/\s+/).map(Number)
    const caption = figure?.children.find((child): child is ElementNode => tagOf(child) === 'figcaption')
    const altText = kind === 'image' ? element.attributes.alt : element.attributes['aria-label'] ?? element.attributes.title
    return { id: stableFlowId('block'), type: 'media', assetId: meta.id, mediaKind: kind,
      ...(altText !== undefined ? { altText } : {}),
      ...(caption ? { caption: content(caption.children) } : {}),
      layout: layout === 'wide' || layout === 'full-width' ? layout : 'content-width',
      ...(wrap === 'none' || wrap === 'left' || wrap === 'right' ? { wrap } : {}),
      ...(crop?.length === 4 && crop.every(Number.isFinite) ? { crop: { left: crop[0]!, top: crop[1]!, right: crop[2]!, bottom: crop[3]! } } : {}),
      ...(holder.attributes['data-crop-x'] !== undefined && Number.isFinite(Number(holder.attributes['data-crop-x'])) ? { cropX: Number(holder.attributes['data-crop-x']) } : {}),
      ...(holder.attributes['data-crop-y'] !== undefined && Number.isFinite(Number(holder.attributes['data-crop-y'])) ? { cropY: Number(holder.attributes['data-crop-y']) } : {}) }
  }

  function table(element: ElementNode): Of<'table'> {
    const rows: ElementNode[] = [], headerRows: ElementNode[] = []
    let caption: ElementNode | undefined
    const visit = (node: PageNode, inHead: boolean) => {
      if (node.kind !== 'element') return
      const tag = tagOf(node)
      if (tag === 'caption') caption = node
      else if (tag === 'tr') (inHead ? headerRows : rows).push(node)
      else if (tag === 'thead') node.children.forEach(child => visit(child, true))
      else if (tag === 'tbody' || tag === 'tfoot') node.children.forEach(child => visit(child, false))
    }
    element.children.forEach(child => visit(child, false))
    // Without a <thead>, a first row of <th> cells is the header.
    if (!headerRows.length && rows[0]?.children.every(child => child.kind !== 'element' || tagOf(child) === 'th')) headerRows.push(rows.shift()!)
    const cellsOf = (row: ElementNode) => row.children.filter((child): child is ElementNode => tagOf(child) === 'td' || tagOf(child) === 'th')
    const grid: { node: ElementNode; anchor: boolean; rowSpan: number; columnSpan: number }[][] = rows.map(() => [])
    rows.forEach((row, rowIndex) => {
      let column = 0
      for (const cell of cellsOf(row)) {
        while (grid[rowIndex]![column]) column++
        const rowSpan = Math.max(1, Math.min(rows.length - rowIndex, Number(cell.attributes.rowspan) || 1))
        const columnSpan = Math.max(1, Number(cell.attributes.colspan) || 1)
        for (let r = 0; r < rowSpan; r++) for (let c = 0; c < columnSpan; c++) grid[rowIndex + r]![column + c] = { node: cell, anchor: !r && !c, rowSpan, columnSpan }
        column += columnSpan
      }
    })
    const headerCells = headerRows[0] ? cellsOf(headerRows[0]).flatMap(cell => [cell, ...Array.from({ length: Math.max(1, Number(cell.attributes.colspan) || 1) - 1 }, () => undefined)]) : []
    const width = Math.max(1, headerCells.length, ...grid.map(row => row.length))
    const columns = Array.from({ length: width }, (_, index) => ({ id: stableFlowId('col'), header: headerCells[index] ? content(headerCells[index]!.children) : { inlines: [] } }))
    const rowIds = rows.map(() => stableFlowId('row'))
    const merges: { rowIds: string[]; columnIds: string[] }[] = []
    // Every row holds every column; cells covered by a merge are empty.
    const tableRows = rows.map((_, rowIndex) => ({ id: rowIds[rowIndex]!, cells: Object.fromEntries(columns.map((column, columnIndex) => {
      const cell = grid[rowIndex]![columnIndex]
      if (!cell?.anchor) return [column.id, { inlines: [] }]
      if (cell.rowSpan > 1 || cell.columnSpan > 1) merges.push({ rowIds: rowIds.slice(rowIndex, rowIndex + cell.rowSpan), columnIds: columns.slice(columnIndex, columnIndex + cell.columnSpan).map(value => value.id) })
      return [column.id, content(cell.node.children)]
    })) }))
    const header = element.attributes['data-header']
    return { id: stableFlowId('block'), type: 'table', ...(caption ? { caption: content(caption.children) } : {}),
      ...(header === 'on' || header === 'off' ? { headerEnabled: header === 'on' } : {}),
      columns, rows: tableRows, ...(merges.length ? { merges } : {}) }
  }

  function blocks(nodes: readonly PageNode[]): Block[] {
    const result: Block[] = []
    let buffer: PageNode[] = []
    const flush = () => {
      if (buffer.some(node => node.kind === 'element' || node.kind === 'text' && node.text.trim())) {
        const hoisted: ElementNode[] = []
        const text = content(buffer, hoisted)
        if (text.inlines.length) result.push({ id: stableFlowId('block'), type: 'paragraph', content: text })
        result.push(...hoisted.flatMap(element => blocks([element])))
      }
      buffer = []
    }
    for (const node of nodes) {
      if (node.kind === 'comment' || node.kind === 'runtime') continue
      if (node.kind !== 'element') { buffer.push(node); continue }
      const tag = tagOf(node)
      const block = (value: Block | Block[] | undefined) => { flush(); if (value) result.push(...(Array.isArray(value) ? value : [value])) }
      if (/^h[1-6]$/.test(tag)) {
        const hoisted: ElementNode[] = []
        block({ id: stableFlowId('block'), type: 'heading', level: Number(tag[1]) as 1, content: content(node.children, hoisted), ...paragraphStyleOf(node) })
        result.push(...hoisted.flatMap(element => blocks([element])))
      } else if (tag === 'p') {
        const formula = displayFormula(node)
        if (formula) { block(formula); continue }
        const hoisted: ElementNode[] = []
        const text = content(node.children, hoisted)
        block(text.inlines.length || !hoisted.length ? { id: stableFlowId('block'), type: 'paragraph', content: text, ...paragraphStyleOf(node) } : undefined)
        result.push(...hoisted.flatMap(element => blocks([element])))
      } else if (tag === 'blockquote') {
        const citation = node.children.find((child): child is ElementNode => tagOf(child) === 'footer' || tagOf(child) === 'cite')
        const paragraphs = node.children.filter(child => child !== citation)
        const parts = paragraphs.some(child => tagOf(child) === 'p')
          ? paragraphs.filter(child => tagOf(child) === 'p').map(child => content((child as ElementNode).children)) : [content(paragraphs)]
        block({ id: stableFlowId('block'), type: 'quote', content: normalizeDocumentText({ inlines: parts.flatMap((part, index) => index ? [{ type: 'text' as const, text: '\n' }, ...part.inlines] : part.inlines) }),
          ...(citation ? { citation: content(citation.children) } : {}), ...paragraphStyleOf(node) })
      } else if (tag === 'ul' || tag === 'ol') {
        const items: { id: string; content: FlowTextContent }[] = []
        const visit = (list: ElementNode) => list.children.forEach(child => {
          if (tagOf(child) !== 'li' || child.kind !== 'element') return
          const nested = child.children.filter((grand): grand is ElementNode => tagOf(grand) === 'ul' || tagOf(grand) === 'ol')
          items.push({ id: stableFlowId('item'), content: content(child.children.filter(grand => !nested.includes(grand as ElementNode))) })
          if (nested.length) warn('flow-nested-list', '讲义列表不支持嵌套，已按顺序展平')
          nested.forEach(visit)
        })
        visit(node)
        block(items.length ? { id: stableFlowId('block'), type: 'list', ordered: tag === 'ol', items } : undefined)
      } else if (tag === 'hr') block({ id: stableFlowId('block'), type: 'divider' })
      else if (tag === 'img' || tag === 'video' || tag === 'audio') block(media(node))
      else if (tag === 'figure') {
        const inner = node.children.find((child): child is ElementNode => ['img', 'video', 'audio'].includes(tagOf(child)))
        const chart = node.children.find((child): child is ElementNode => tagOf(child) === 'guoling-chart')
        block(inner ? media(inner, node) : chart ? blocks([chart]) : blocks(node.children.filter(child => tagOf(child) !== 'figcaption')))
      } else if (tag === 'table') block(table(node))
      else if (tag === 'pre') {
        const code = node.children.find((child): child is ElementNode => tagOf(child) === 'code')
        const language = /(?:^|\s)language-([^\s]+)/.exec(code?.attributes.class ?? '')?.[1]
        block({ id: stableFlowId('block'), type: 'code', code: textOf(code ?? node), ...(language ? { language } : {}) })
      } else if (tag === 'aside') {
        const title = node.children.find((child): child is ElementNode => ['header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong'].includes(tagOf(child)))
        const rest = node.children.filter(child => child !== title)
        const parts = rest.some(child => tagOf(child) === 'p') ? rest.filter(child => tagOf(child) === 'p').map(child => content((child as ElementNode).children)) : [content(rest)]
        const tone = node.attributes['data-tone']
        block({ id: stableFlowId('block'), type: 'callout', tone: tone === 'example' || tone === 'warning' || tone === 'conclusion' ? tone : 'note',
          ...(title ? { title: content(title.children) } : {}),
          body: normalizeDocumentText({ inlines: parts.flatMap((part, index) => index ? [{ type: 'text' as const, text: '\n' }, ...part.inlines] : part.inlines) }) })
      } else if (tag === 'details') {
        const summary = node.children.find((child): child is ElementNode => tagOf(child) === 'summary')
        block({ id: stableFlowId('block'), type: 'section', title: summary ? content(summary.children) : { inlines: [] }, collapsedByDefault: node.attributes.open === undefined,
          blocks: blocks(node.children.filter(child => child !== summary)) })
      } else if (tag === 'guoling-chart') {
        const leaf = node.children.find(child => child.kind === 'native')
        if (leaf?.kind === 'native' && leaf.content.nativeType === 'chart') {
          const height = Number(node.attributes['data-height'])
          block({ id: stableFlowId('block'), type: 'chart', chart: leaf.content.data, height: Number.isFinite(height) && height >= 160 && height <= 1600 ? height : CHART_HEIGHT })
        } else block(undefined)
      } else if (tag === 'guoling-component') {
        // Matched to an existing block by the caller; a new one cannot be created from text.
        block({ id: stableFlowId('block'), type: 'component', component: { packageId: '', version: '' }, props: {}, staticFallbackAssetId: '',
          ...(node.attributes['data-wrap'] === 'left' || node.attributes['data-wrap'] === 'right' || node.attributes['data-wrap'] === 'none' ? { wrap: node.attributes['data-wrap'] } : {}),
          [UNRESOLVED_COMPONENT]: node.attributes.name ?? '' } as Block)
      } else if ((node.attributes.class ?? '').split(/\s+/).includes('math') && displayFormula(node)) block(displayFormula(node))
      else if (['html', 'body', 'main', 'article', 'section', 'div', 'header', 'footer', 'nav', 'center', 'hgroup'].includes(tag)) { flush(); result.push(...blocks(node.children)) }
      else if (tag === 'head') {
        if (node.children.some(child => tagOf(child) === 'style')) warn('flow-style', '讲义的样式由课程主题 theme.css 负责；页内 <style> 未保留')
      } else if (tag === 'title' || tag === 'meta' || tag === 'link' || tag === 'template') continue
      else if (tag === 'style') { flush(); warn('flow-style', '讲义的样式由课程主题 theme.css 负责；页内 <style> 未保留') }
      else if (tag === 'iframe') { flush(); warn('flow-iframe', '讲义暂不能嵌入组件页面（iframe）；已忽略，互动请放在演示页') }
      else if (tag === 'svg' || tag === 'canvas' || tag === 'form' || tag === 'object' || tag === 'embed') { flush(); warn('flow-unsupported', `讲义不支持 <${tag}>；图示请写成 assets/ 下的 SVG 素材后用 <img> 引用`) }
      else buffer.push(node)
    }
    flush()
    return result
  }

  const root = parsed.composition.root
  const body = root.kind === 'element' ? root.children : []
  return { blocks: blocks(body), diagnostics }
}

export const UNRESOLVED_COMPONENT = '__component'

// ---------------------------------------------------------------------------------------------
// Alignment: unchanged blocks are the stored blocks themselves; a changed block keeps the identity
// of the block it replaces in place, with its list items, rows, columns and formulas.

function commonPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const pairs: [number, number][] = []
  for (let index = 0; index < start; index++) pairs.push([index, index])
  const n = endA - start, m = endB - start
  if (n && m && n * m <= 1_000_000) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      table[i]![j] = a[start + i] === b[start + j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[start + i] === b[start + j]) { pairs.push([start + i, start + j]); i++; j++ }
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
      else j++
    }
  }
  for (let index = 0; index < a.length - endA; index++) pairs.push([endA + index, endB + index])
  return pairs
}

/** Pair items: equal signatures by LCS, then the rest in order within each gap when `pairable`. */
function pairItems<T>(next: readonly T[], previous: readonly T[], signature: (value: T) => string, pairable: (a: T, b: T) => boolean = () => true): (T | undefined)[] {
  const pairs = commonPairs(next.map(signature), previous.map(signature))
  const result: (T | undefined)[] = new Array(next.length)
  for (const [i, j] of pairs) result[i] = previous[j]
  const bounds: [number, number][] = [[-1, -1], ...pairs, [next.length, previous.length]]
  for (let gap = 0; gap + 1 < bounds.length; gap++) {
    const [fromI, fromJ] = bounds[gap]!, [toI, toJ] = bounds[gap + 1]!
    const open = previous.slice(fromJ + 1, toJ)
    for (let i = fromI + 1; i < toI; i++) {
      const match = open.findIndex(candidate => pairable(next[i]!, candidate))
      if (match >= 0) result[i] = open.splice(match, 1)[0]
    }
  }
  return result
}

function adoptFormulas(next: FlowTextContent, previous: FlowTextContent | undefined): FlowTextContent {
  const old = previous?.inlines.filter((inline): inline is Extract<FlowInline, { type: 'math' }> => inline.type === 'math') ?? []
  const current = next.inlines.filter((inline): inline is Extract<FlowInline, { type: 'math' }> => inline.type === 'math')
  const paired = pairItems(current, old, inline => inline.latex)
  return { inlines: next.inlines.map(inline => {
    const index = inline.type === 'math' ? current.indexOf(inline) : -1
    return index >= 0 && paired[index] ? { ...inline, formulaId: paired[index]!.formulaId } : inline
  }) }
}

function adoptChart(next: NativeChartContent, previous: NativeChartContent): NativeChartContent {
  const categories = pairItems(next.categories, previous.categories, category => category.label)
  const categoryIds = new Map(next.categories.map((category, index) => [category.id, categories[index]?.id ?? category.id]))
  const series = pairItems(next.series, previous.series, value => value.name)
  return { ...next, categories: next.categories.map(category => ({ ...category, id: categoryIds.get(category.id)! })),
    series: next.series.map((value, index) => {
      const prior = series[index]
      return { ...value, id: prior?.id ?? value.id, points: value.points.map(point => {
        const categoryId = categoryIds.get(point.categoryId) ?? point.categoryId
        return { ...point, categoryId, id: prior?.points.find(old => old.categoryId === categoryId)?.id ?? point.id }
      }) }
    }) } as NativeChartContent
}

export function alignFlowBlocks(next: readonly Block[], previous: readonly Block[], context: FlowHtmlContext): { blocks: Block[]; unresolved: string[] } {
  const unresolved: string[] = []
  const signature = (block: Block) => (block as Record<string, unknown>)[UNRESOLVED_COMPONENT] !== undefined
    ? `<guoling-component name="${escapeAttribute(String((block as Record<string, unknown>)[UNRESOLVED_COMPONENT]))}"${'wrap' in block && block.wrap ? ` data-wrap="${block.wrap}"` : ''}></guoling-component>`
    : blockHtml(normalized(block), context)
  const normalized = (block: Block): Block => {
    const clone = structuredClone(block) as Block & Record<string, unknown>
    for (const key of ['content', 'citation', 'caption', 'title', 'body'] as const) {
      const value = clone[key] as FlowTextContent | undefined
      if (value && Array.isArray(value.inlines)) clone[key] = normalizeDocumentText(value)
    }
    return clone
  }
  const align = (blocks: readonly Block[], prior: readonly Block[]): Block[] => {
    const paired = pairItems(blocks, prior, signature, (a, b) => a.type === b.type && a.type !== 'component')
    return blocks.flatMap((block, index): Block[] => {
      const old = paired[index]
      if (old && signature(old) === signature(block)) return [old]
      if (block.type === 'component') {
        unresolved.push(String((block as Record<string, unknown>)[UNRESOLVED_COMPONENT] ?? ''))
        return []
      }
      return [old ? adopt(block, old) : block]
    })
  }
  const adopt = (block: Block, old: Block): Block => {
    const next = { ...block, id: old.id } as Block & Record<string, unknown>
    const prior = old as Block & Record<string, unknown>
    for (const key of ['content', 'citation', 'caption', 'title', 'body'] as const)
      if (next[key]) next[key] = adoptFormulas(next[key] as FlowTextContent, prior[key] as FlowTextContent | undefined)
    if (next.type === 'formula' && old.type === 'formula') next.formulaId = old.formulaId
    if (next.type === 'list' && old.type === 'list') {
      const items = pairItems(next.items, old.items, item => inlineHtml(normalizeDocumentText(item.content)))
      next.items = next.items.map((item, index) => ({ ...item, id: items[index]?.id ?? item.id, content: adoptFormulas(item.content, items[index]?.content) }))
    }
    if (next.type === 'section' && old.type === 'section') next.blocks = align(next.blocks, old.blocks)
    if (next.type === 'chart' && old.type === 'chart') next.chart = adoptChart(next.chart, old.chart)
    if (next.type === 'table' && old.type === 'table') {
      const columns = pairItems(next.columns, old.columns, column => inlineHtml(normalizeDocumentText(column.header)))
      const columnIds = new Map(next.columns.map((column, index) => [column.id, columns[index]?.id ?? column.id]))
      const rowText = (row: { cells: Record<string, FlowTextContent> }, order: readonly { id: string }[]) => order.map(column => inlineHtml(normalizeDocumentText(row.cells[column.id] ?? { inlines: [] }))).join('\u0000')
      const rows = pairItems(next.rows, old.rows, row => 'cells' in row ? rowText(row, next.rows.includes(row) ? next.columns : old.columns) : '')
      const rowIds = new Map(next.rows.map((row, index) => [row.id, rows[index]?.id ?? row.id]))
      next.columns = next.columns.map((column, index) => ({ ...column, id: columnIds.get(column.id)!, header: adoptFormulas(column.header, columns[index]?.header) }))
      next.rows = next.rows.map((row, index) => ({ id: rowIds.get(row.id)!, cells: Object.fromEntries(Object.entries(row.cells).map(([columnId, cell]) => {
        const oldColumn = columnIds.get(columnId)!
        return [oldColumn, adoptFormulas(cell, rows[index]?.cells[oldColumn])]
      })) }))
      if (next.merges) next.merges = next.merges.map(merge => ({ rowIds: merge.rowIds.map(id => rowIds.get(id) ?? id), columnIds: merge.columnIds.map(id => columnIds.get(id) ?? id) }))
    }
    return next
  }
  return { blocks: align(next, previous), unresolved: unresolved.filter(Boolean) }
}
