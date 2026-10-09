import { documentHtmlMathAccessibleText as defaultAccessibleText, htmlDeclarations as declarations, htmlCssLength as cssLength, htmlTextStyle as applyCss, readHtmlDocumentText, type DocumentHtmlNode, type DocumentHtmlElement } from './htmlText'
import type { NativeChartContent, TextRunStyle } from '../contracts/native-v1/types'
import { assetReferencePath, componentReferenceName, courseComponentNameIssue } from '../composition/projectReferences'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { DocumentBlock as FlowBlock } from './content'
import { chartDataSchema, createChartData } from '../../components/chart/data'
import { normalizeDocumentText, type FlowInline, type FlowTextContent, type MathStyle } from './content'
type CourseAssetMeta = { id: string; path: string; filename?: string; kind?: 'image' | 'audio' | 'video' | 'font' }
type PageDiagnostic = { level: 'info' | 'warning' | 'error'; code: string; message: string }
type PageNode =
  | { kind: 'text' | 'comment'; text: string }
  | { kind: 'element'; tagName: string; attributes: Record<string, string>; children: PageNode[] }
  | { kind: 'runtime' | 'document' }
  | { kind: 'native'; content: { nativeType: string; data: unknown } }
type PageParsePort = (input: { html: string }) =>
  | { kind: 'program'; diagnostics: readonly PageDiagnostic[] }
  | { kind: 'composition'; composition: { root: PageNode }; diagnostics: readonly PageDiagnostic[] }
const stableFlowId = (_kind: string) => crypto.randomUUID()
const assetFilePath = (meta: CourseAssetMeta) => {
  const path = meta.path.replace(/\\/g, '/').replace(/^\.?\//, '')
  return path.startsWith('assets/') || !meta.filename ? path : `assets/${meta.filename}`
}

/** Structural HTML parsing is independent of any persisted page carrier. */
function parseDocumentHtml(input: { html: string }): ReturnType<PageParsePort> {
  const root = parse(input.html)
  const node = (value: DefaultTreeAdapterTypes.ChildNode): PageNode[] => {
    if (value.nodeName === '#text') return [{ kind: 'text', text: (value as DefaultTreeAdapterTypes.TextNode).value }]
    if (value.nodeName === '#comment') return [{ kind: 'comment', text: (value as DefaultTreeAdapterTypes.CommentNode).data }]
    if (!('tagName' in value)) return []
    return [{ kind: 'element', tagName: value.tagName, attributes: Object.fromEntries(value.attrs.map(attr => [attr.name, attr.value])), children: value.childNodes.flatMap(node) }]
  }
  return { kind: 'composition', composition: { root: { kind: 'element', tagName: 'root', attributes: {}, children: root.childNodes.flatMap(node) } }, diagnostics: [] }
}

type Assets = Readonly<Record<string, CourseAssetMeta>>
type ElementNode = Extract<PageNode, { kind: 'element' }>
type Block = FlowBlock
type Of<T extends Block['type']> = Extract<Block, { type: T }>
type ParagraphStyle = { textAlign?: 'left' | 'center' | 'right'; lineSpacing?: number }

export interface FlowHtmlContext {
  assets: Assets
  /** Component package display names, for blocks that embed a component. */
  packageName(packageId: string): string
  /** The formal output owner renders an instance reference without a component filename. */
  instanceHtml?(instanceId: string): string
}

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;')
const scriptJson = (value: unknown) => JSON.stringify(value, null, 2).replace(/<(\/script|!--)/gi, '\\u003c$1')
const CHART_HEIGHT = 320

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
      // A written reference stays as written; otherwise the asset's own file.
      const src = escapeAttribute(block.source ?? (block.assetId ? assetSource(context.assets, block.assetId) : ''))
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
    case 'course-instance':
      if (!context.instanceHtml) throw new FlowContentError(`正式实例尚未连接 HTML 输出：${block.id}`)
      return context.instanceHtml(block.id)
    case 'course-component': return `<iframe src="../components/${escapeAttribute(block.name)}.html"${block.title ? ` title="${escapeAttribute(block.title)}"` : ''}${
      block.height !== undefined ? ` height="${block.height}"` : ''}${block.wrap ? ` data-wrap="${block.wrap}"` : ''}></iframe>`
  }
}

export function serializeFlowHtml(surface: { title: string; blocks: readonly FlowBlock[] }, context: FlowHtmlContext): string {
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeText(surface.title)}</title>\n</head>\n<body>\n${
    surface.blocks.map(block => blockHtml(block, context)).join('\n')}\n</body>\n</html>\n`
}

// ---------------------------------------------------------------------------------------------
// Parsing: the importer's parser builds the tree; these rules read it as Flow blocks (fresh ids).

const tagOf = (node: PageNode) => node.kind === 'element' ? node.tagName.toLowerCase() : ''
const textOf = (node: PageNode): string => node.kind === 'text' ? node.text : node.kind === 'element' ? node.children.map(textOf).join('') : ''
export interface FlowParseResult { blocks: Block[]; diagnostics: PageDiagnostic[] }
export class FlowContentError extends Error {}

/** Model HTML -> Flow blocks with fresh identities. Unsupported pieces are reported, never silently dropped. */
export function parseFlowHtml(html: string, options: { parse?: PageParsePort; assets: Assets; requireResolvedAssets?: boolean; instanceByPath?(path: string): string | undefined }): FlowParseResult {
  const diagnostics: PageDiagnostic[] = []
  const warn = (code: string, message: string) => { if (!diagnostics.some(item => item.message === message)) diagnostics.push({ level: 'warning', code, message }) }
  const parsed = (options.parse ?? parseDocumentHtml)({ html })
  if (parsed.kind === 'program') throw new FlowContentError('讲义不能包含脚本或事件属性；互动请写成 components/ 下的组件，放在演示页中')
  for (const item of parsed.diagnostics) if (item.level !== 'info') diagnostics.push(item)

  const byPath = new Map<string, CourseAssetMeta>(), byFilename = new Map<string, CourseAssetMeta | null>()
  for (const meta of Object.values(options.assets)) {
    byPath.set(assetFilePath(meta), meta)
    if (meta.filename) byFilename.set(meta.filename, byFilename.has(meta.filename) ? null : meta)
  }
  const assetFor = (src: string | undefined) => {
    const path = src === undefined ? null : assetReferencePath(src)
    return path ? byPath.get(path) ?? byFilename.get(path.slice('assets/'.length)) ?? undefined : undefined
  }

  const content = (nodes: readonly PageNode[], hoisted: ElementNode[] = []) => {
    const sources = new Map<DocumentHtmlElement, ElementNode>()
    const project = (node: PageNode): DocumentHtmlNode[] => {
      if (node.kind === 'text' || node.kind === 'comment') return [{ kind: node.kind, text: node.text }]
      if (node.kind !== 'element') return []
      const element: DocumentHtmlElement = { kind: 'element', tagName: node.tagName,
        attributes: node.attributes, children: node.children.flatMap(project) }
      sources.set(element, node)
      return [element]
    }
    return readHtmlDocumentText(nodes.flatMap(project), { createFormulaId: () => stableFlowId('formula'), warn,
      onMedia: element => { const source = sources.get(element); if (source) hoisted.push(source) } })
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
    if (!kind) return undefined
    // The reference is kept as written; normalization binds it to the asset at that path, now or once it is written.
    if (source === undefined || assetReferencePath(source) === null) {
      warn('flow-missing-asset', `讲义图片/媒体只能引用 assets/ 下的素材，未写入：${source ?? '（无地址）'}`)
      return undefined
    }
    const meta = assetFor(source)
    if (options.requireResolvedAssets && !meta) {
      warn('flow-missing-asset', `媒体素材尚未提供：${source}；可用正文已导入，原文保留供补素材`)
      return undefined
    }
    if (meta?.kind && meta.kind !== kind) {
      warn('flow-asset-kind', `${source} 不是${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}素材，原文保留供修复`)
      if (options.requireResolvedAssets) return undefined
    }
    const holder = figure ?? element
    const layout = holder.attributes['data-layout']
    const wrap = holder.attributes['data-wrap']
    const crop = holder.attributes['data-crop']?.trim().split(/\s+/).map(Number)
    const caption = figure?.children.find((child): child is ElementNode => tagOf(child) === 'figcaption')
    const altText = kind === 'image' ? element.attributes.alt : element.attributes['aria-label'] ?? element.attributes.title
    return { id: stableFlowId('block'), type: 'media', source, mediaKind: kind,
      ...(meta && (!meta.kind || meta.kind === kind) ? { assetId: meta.id } : {}),
      ...(altText !== undefined ? { altText } : {}),
      ...(caption ? { caption: content(caption.children) } : {}),
      layout: layout === 'wide' || layout === 'full-width' ? layout : 'content-width',
      ...(wrap === 'none' || wrap === 'left' || wrap === 'right' ? { wrap } : {}),
      ...(crop?.length === 4 && crop.every(Number.isFinite) ? { crop: { left: crop[0]!, top: crop[1]!, right: crop[2]!, bottom: crop[3]! } } : {}),
      ...(holder.attributes['data-crop-x'] !== undefined && Number.isFinite(Number(holder.attributes['data-crop-x'])) ? { cropX: Number(holder.attributes['data-crop-x']) } : {}),
      ...(holder.attributes['data-crop-y'] !== undefined && Number.isFinite(Number(holder.attributes['data-crop-y'])) ? { cropY: Number(holder.attributes['data-crop-y']) } : {}) }
  }

  /** `<iframe src="../components/<名称>.html">`: a named component, a placeholder until `components/<名称>.html` exists. */
  function courseComponent(element: ElementNode): Of<'course-component'> | undefined {
    const name = element.attributes.src === undefined ? null : componentReferenceName(element.attributes.src)
    if (name === null || courseComponentNameIssue(name)) {
      warn('flow-iframe', '讲义中的 iframe 只能引用 components/<名称>.html 组件；其他 iframe 已忽略')
      return undefined
    }
    const height = cssLength(element.attributes.height ?? Object.fromEntries(declarations(element.attributes.style)).height ?? '')
    const wrap = element.attributes['data-wrap']
    return { id: stableFlowId('block'), type: 'course-component', name,
      ...(element.attributes.title ? { title: element.attributes.title } : {}),
      ...(height !== undefined && height > 0 && height <= 10_000 ? { height } : {}),
      ...(wrap === 'none' || wrap === 'left' || wrap === 'right' ? { wrap } : {}) }
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
          block({ id: stableFlowId('block'), type: 'chart', chart: chartDataSchema.parse(leaf.content.data), height: Number.isFinite(height) && height >= 160 && height <= 1600 ? height : CHART_HEIGHT })
        } else {
          try {
            const script = node.children.find(child => tagOf(child) === 'script')
            const raw = JSON.parse(textOf(script ?? node))
            const defaults = createChartData()
            const categories = raw.categories.map((value: unknown) => typeof value === 'string' ? { id: stableFlowId('category'), label: value } : value)
            const series = raw.series.map((value: { name: string; color: string; values?: number[]; points?: unknown[] }) => ({ id: stableFlowId('series'), name: value.name, color: value.color,
              points: value.points ?? categories.map((category: { id: string }, index: number) => ({ id: stableFlowId('point'), categoryId: category.id, value: value.values?.[index] ?? 0 })) }))
            const chart = chartDataSchema.parse({ ...defaults, ...raw, categories, series })
            const height = Number(node.attributes['data-height'])
            block({ id: stableFlowId('block'), type: 'chart', chart, height: Number.isFinite(height) && height >= 160 && height <= 1600 ? height : CHART_HEIGHT })
          } catch (error) { warn('flow-chart', error instanceof Error ? error.message : String(error)) }
        }
      } else if (tag === 'guoling-instance') {
        const id = options.instanceByPath?.(node.attributes.path ?? '')
        if (!id) throw new FlowContentError(`正文引用的正式对象已不存在：${node.attributes.path ?? ''}`)
        block({ id, type: 'course-instance', ...(node.attributes.title ? { title: node.attributes.title } : {}) })
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
      else if (tag === 'script') { flush(); if (node.attributes.type !== 'application/json') warn('flow-program', '正文中的程序需作为独立组件运行；已保留可用正文和完整原件，程序源文可继续修复。') }
      else if (tag === 'iframe') block(courseComponent(node))
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

export function adoptFormulas(next: FlowTextContent, previous: FlowTextContent | undefined): FlowTextContent {
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
      if (next[key] && typeof next[key] === 'object' && 'inlines' in next[key]) next[key] = adoptFormulas(next[key] as FlowTextContent, prior[key] as FlowTextContent | undefined)
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
