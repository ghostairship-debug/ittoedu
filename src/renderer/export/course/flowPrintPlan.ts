import { buildNativeChartSvg } from '../../../shared/nativeChartSvg'
import { flowMediaCropGeometry, type FlowImageCrop } from '../../../shared/flowMediaCrop'
import { resolveFlowParagraphPresentation, type FlowParagraphPresentation } from '../../../shared/flowBodyPresentation'
import { tableCellSpan, type TableCellSpan } from '../../../shared/tableMerge'
import type { NativeChartContent } from '../../../shared/contracts/native-v1'
import { renderDocumentText, renderDocumentMath } from '../../../shared/document/render'
import { plainDocumentText, type FlowTextContent } from '../../../shared/document/content'
import type { MixedPrintEntry, MixedPrintPlan } from '../../../shared/courseProjectTypes'
import type { PublishedFlowSurface } from '../../../shared/publishedCourseTypes'
import { resolveCourseSurfaceBackgroundColor } from '../../../shared/courseProjectModel'
import {
  walkFlowBlocks,
  type FlowBlock,
} from '../../../player/surfaces/flow/flowModel'

export const FLOW_PRINT_EXCLUDES_RUNTIME_TOC = false as const
export const FLOW_PRINT_INCLUDES_FLOATING_LAYERS = false as const

export type FlowPrintPageSize = MixedPrintPlan['pageSize']
export type FlowPrintOrientation = MixedPrintPlan['orientation']

export type FlowPrintNode =
  | { type: 'chart'; blockId: string; chart: NativeChartContent; height: number }
  | { type: 'document-title'; text: string }
  | {
      type: 'heading'
      blockId: string
      level: 1 | 2 | 3 | 4 | 5 | 6
      content: FlowTextContent
      paragraph?: FlowParagraphPresentation
    }
  | { type: 'paragraph'; blockId: string; content: FlowTextContent; paragraph?: FlowParagraphPresentation }
  | { type: 'quote'; blockId: string; content: FlowTextContent; citation?: FlowTextContent; paragraph?: FlowParagraphPresentation }
  | {
      type: 'list'
      blockId: string
      ordered: boolean
      items: Array<{ id: string; content: FlowTextContent }>
    }
  | {
      type: 'table'
      blockId: string
      caption?: FlowTextContent
      headers: FlowTextContent[]
      headerEnabled: boolean
      rows: Array<Array<{ content: FlowTextContent; span?: TableCellSpan }>>
    }
  | {
      type: 'formula'
      blockId: string
      latex: string
      style?: { fontSize?: number; color?: string }
      accessibleText: string
    }
  | {
      type: 'media'
      blockId: string
      mediaKind: 'image' | 'audio' | 'video'
      assetId: string
      fallbackLabel: string
      altText?: string
      caption?: FlowTextContent
      crop?: FlowImageCrop['crop']
      cropX?: number
      cropY?: number
    }
  | { type: 'code'; blockId: string; language?: string; code: string }
  | {
      type: 'callout'
      blockId: string
      tone: 'note' | 'example' | 'warning' | 'conclusion'
      title?: FlowTextContent
      body: FlowTextContent
    }
  | { type: 'section'; blockId: string; title: FlowTextContent }
  | { type: 'divider'; blockId: string }
  | {
      type: 'component'
      blockId: string
      fallbackLabel: string
      staticFallbackAssetId: string
    }

export interface FlowPrintPlan {
  readonly surfaceId: string
  readonly title: string
  readonly backgroundColor: string
  readonly pageSize: FlowPrintPageSize
  readonly orientation: FlowPrintOrientation
  readonly nodes: readonly FlowPrintNode[]
  /** Runtime TOC chrome is session UI and must never enter print/PDF/DOCX. */
  readonly includesRuntimeToc: typeof FLOW_PRINT_EXCLUDES_RUNTIME_TOC
  /** Absolute Flow overlays are intentionally omitted from reflowed print/DOCX. */
  readonly includesFloatingLayers: typeof FLOW_PRINT_INCLUDES_FLOATING_LAYERS
  readonly omittedFloatingLayerCount: number
}

export interface BuildFlowPrintPlanOptions {
  pageSize?: FlowPrintPageSize
  orientation?: FlowPrintOrientation
}

export interface FlowPrintRenderOptions {
  readonly resolveAssetUrl?: (assetId: string) => string | undefined
}

export function flowImageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mimeType === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    const width = view.getUint32(16), height = view.getUint32(20)
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  if (mimeType === 'image/gif' && bytes.length >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
    const width = view.getUint16(6, true), height = view.getUint16(8, true)
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  if (mimeType === 'image/webp' && bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4))
      const length = view.getUint32(offset + 4, true)
      const start = offset + 8
      if (start + length > bytes.length) break
      if (kind === 'VP8X' && length >= 10) {
        const width = 1 + bytes[start + 4]! + (bytes[start + 5]! << 8) + (bytes[start + 6]! << 16)
        const height = 1 + bytes[start + 7]! + (bytes[start + 8]! << 8) + (bytes[start + 9]! << 16)
        return { width, height }
      }
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 47) {
        const width = 1 + bytes[start + 1]! + ((bytes[start + 2]! & 63) << 8)
        const height = 1 + (bytes[start + 2]! >> 6) + (bytes[start + 3]! << 2) + ((bytes[start + 4]! & 15) << 10)
        return { width, height }
      }
      if (kind === 'VP8 ' && length >= 10 && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) {
        const width = view.getUint16(start + 6, true) & 16383, height = view.getUint16(start + 8, true) & 16383
        return width > 0 && height > 0 ? { width, height } : undefined
      }
      offset = start + length + (length & 1)
    }
  }
  if (mimeType === 'image/svg+xml') {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
    const root = /<svg\b([^>]*)>/i.exec(new TextDecoder(encoding, { fatal: true }).decode(bytes))?.[1]
    if (!root) return undefined
    const attribute = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*([\"'])(.*?)\\1`, 'i').exec(root)?.[2]
    const length = (name: string): number | undefined => {
      const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(px|in|cm|mm|pt|pc)?\s*$/i.exec(attribute(name) ?? '')
      if (!match) return undefined
      const scale: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 }
      const value = Number(match[1]) * scale[(match[2] ?? 'px').toLowerCase()]!
      return value > 0 ? value : undefined
    }
    const viewBox = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    const boxWidth = viewBox?.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0 ? viewBox[2]! : undefined
    const boxHeight = boxWidth ? viewBox![3]! : undefined
    const width = length('width'), height = length('height')
    if (width && height) return { width, height }
    if (width && boxWidth && boxHeight) return { width, height: width * boxHeight / boxWidth }
    if (height && boxWidth && boxHeight) return { width: height * boxWidth / boxHeight, height }
    if (boxWidth && boxHeight) return { width: boxWidth, height: boxHeight }
    return { width: width ?? 300, height: height ?? 150 }
  }
  if (mimeType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break
      while (bytes[offset] === 255) offset += 1
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218 || marker === undefined || offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5)
        return width > 0 && height > 0 ? { width, height } : undefined
      }
      offset += length
    }
  }
  return undefined
}

function dataUrlImageDimensions(url: string): { width: number; height: number } | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i.exec(url)
  if (!match) return undefined
  try {
    const binary = atob(match[2]!)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return flowImageDimensions(bytes, match[1]!.toLowerCase())
  } catch {
    return undefined
  }
}

export function buildFlowPrintPlan(
  surface: PublishedFlowSurface,
  options: BuildFlowPrintPlanOptions = {},
): FlowPrintPlan {
  const nodes: FlowPrintNode[] = [{ type: 'document-title', text: surface.title }]
  walkFlowBlocks(surface.blocks, ({ block }) => {
    nodes.push(...printNodesForBlock(block))
  })
  return {
    surfaceId: surface.id,
    title: surface.title,
    backgroundColor: resolveCourseSurfaceBackgroundColor(surface.backgroundColor),
    pageSize: options.pageSize ?? 'A4',
    orientation: options.orientation ?? 'portrait',
    nodes,
    includesRuntimeToc: FLOW_PRINT_EXCLUDES_RUNTIME_TOC,
    includesFloatingLayers: FLOW_PRINT_INCLUDES_FLOATING_LAYERS,
    omittedFloatingLayerCount: surface.surfaceLayerItems.length,
  }
}

export function buildFlowPrintPlans(
  surfaces: readonly { type: string }[] | readonly PublishedFlowSurface[],
  options: BuildFlowPrintPlanOptions = {},
): FlowPrintPlan[] {
  return surfaces.flatMap((surface) => (
    surface.type === 'flow'
      ? [buildFlowPrintPlan(surface as PublishedFlowSurface, options)]
      : []
  ))
}

export function buildFlowMixedPrintEntries(
  surfaces: readonly { id: string; type: string }[],
): Extract<MixedPrintEntry, { kind: 'flow-document' }>[] {
  return surfaces.flatMap((surface, index) => (
    surface.type === 'flow'
      ? [{
          id: `flow-print-${surface.id || index}`,
          kind: 'flow-document' as const,
          surfaceId: surface.id,
        }]
      : []
  ))
}

export function renderFlowPrintBodyHtml(
  plan: FlowPrintPlan,
  options: FlowPrintRenderOptions = {},
): string {
  return plan.nodes.map((node) => printNodeToHtml(node, options)).join('')
}

export function renderFlowPrintHtml(
  plan: FlowPrintPlan,
  options: FlowPrintRenderOptions = {},
): string {
  const body = renderFlowPrintBodyHtml(plan, options)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(plan.title)}</title><style>html,body{min-height:100%;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body class="flow-print-document" style="background:${escapeHtml(plan.backgroundColor)}" data-flow-print-surface="${escapeHtml(plan.surfaceId)}" data-flow-floating-layers="omitted" data-flow-omitted-floating-layer-count="${plan.omittedFloatingLayerCount}">${body}</body></html>`
}

export function flowPrintPlanHasRuntimeToc(plan: FlowPrintPlan): boolean {
  const includesRuntimeToc: boolean = plan.includesRuntimeToc
  return includesRuntimeToc
    || plan.nodes.some((node) => 'text' in node && typeof node.text === 'string' && node.text.includes('flow-runtime-toc'))
}

export function flowPrintOmittedOverlayMessage(plan: FlowPrintPlan): string | undefined {
  if (plan.omittedFloatingLayerCount <= 0) return undefined
  return `Flow 表面“${plan.title}”的 ${plan.omittedFloatingLayerCount} 个浮层不进入语义分页。`
}

function printNodesForBlock(block: FlowBlock): FlowPrintNode[] {
  switch (block.type) {
    case 'heading':
      return [{
        type: 'heading',
        blockId: block.id,
        level: block.level,
        paragraph: resolveFlowParagraphPresentation(block),
        content: block.content,
      }]
    case 'paragraph':
      return [{
        type: 'paragraph',
        paragraph: resolveFlowParagraphPresentation(block),
        blockId: block.id,
        content: block.content,
      }]
    case 'quote':
      return [{
        type: 'quote',
        paragraph: resolveFlowParagraphPresentation(block),
        blockId: block.id,
        content: block.content,
        ...(block.citation ? { citation: block.citation } : {}),
      }]
    case 'list':
      return [{
        type: 'list',
        blockId: block.id,
        ordered: block.ordered,
        items: block.items.map((item) => ({
          id: item.id,
          content: item.content,
        })),
      }]
    case 'chart':
      return [{ type: 'chart', blockId: block.id, chart: block.chart, height: block.height }]
    case 'table':
      return [{
        type: 'table',
        blockId: block.id,
        ...(block.caption ? { caption: block.caption } : {}),
        headers: block.columns.map((column) => column.header),
        headerEnabled: block.headerEnabled !== false,
        rows: block.rows.map((row) => block.columns.map((column) => {
          const cell = row.cells[column.id]
          return {
            content: cell ?? { inlines: [] },
            ...(block.merges?.length ? { span: tableCellSpan(block, row.id, column.id) } : {}),
          }
        })),
      }]
    case 'formula':
      return [{
        type: 'formula',
        blockId: block.id,
        latex: block.latex,
        ...(block.style ? { style: block.style } : {}),
        accessibleText: block.accessibleText,
      }]
    case 'media':
      return [{
        type: 'media',
        blockId: block.id,
        mediaKind: block.mediaKind,
        assetId: block.assetId,
        fallbackLabel: block.altText?.trim() || (block.caption ? plainDocumentText(block.caption).trim() : undefined) || block.assetId,
        ...(block.altText ? { altText: block.altText } : {}),
        ...(block.caption ? { caption: block.caption } : {}),
        ...(block.crop ? { crop: block.crop } : {}),
        ...(block.cropX !== undefined ? { cropX: block.cropX } : {}),
        ...(block.cropY !== undefined ? { cropY: block.cropY } : {}),
      }]
    case 'code':
      return [{
        type: 'code',
        blockId: block.id,
        code: block.code,
        ...(block.language ? { language: block.language } : {}),
      }]
    case 'callout':
      return [{
        type: 'callout',
        blockId: block.id,
        tone: block.tone,
        body: block.body,
        ...(block.title ? { title: block.title } : {}),
      }]
    case 'section':
      return [{ type: 'section', blockId: block.id, title: block.title }]
    case 'divider':
      return [{ type: 'divider', blockId: block.id }]
    case 'component':
      return [{
        type: 'component',
        blockId: block.id,
        fallbackLabel: `${block.component.packageId}@${block.component.version}`,
        staticFallbackAssetId: block.staticFallbackAssetId,
      }]
  }
}

function printNodeToHtml(
  node: FlowPrintNode,
  options: FlowPrintRenderOptions,
): string {
  const paragraph = 'paragraph' in node ? node.paragraph : undefined
  const paragraphStyle = paragraph
    ? ` style="text-align:${paragraph.textAlign};line-height:${paragraph.lineHeight}"`
    : ''
  switch (node.type) {
    case 'document-title':
      return `<h1 data-flow-print-node="title">${escapeHtml(node.text)}</h1>`
    case 'heading':
      return `<h${node.level} data-flow-print-block="${escapeHtml(node.blockId)}"${paragraphStyle}>${richTextToHtml(node.content)}</h${node.level}>`
    case 'paragraph':
      return `<p data-flow-print-block="${escapeHtml(node.blockId)}"${paragraphStyle}>${richTextToHtml(node.content)}</p>`
    case 'quote':
      return `<blockquote data-flow-print-block="${escapeHtml(node.blockId)}"${paragraphStyle}><p>${richTextToHtml(node.content)}</p>${
        node.citation ? `<cite>${richTextToHtml(node.citation)}</cite>` : ''
      }</blockquote>`
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      return `<${tag} data-flow-print-block="${escapeHtml(node.blockId)}">${
        node.items.map((item) => `<li>${richTextToHtml(item.content)}</li>`).join('')
      }</${tag}>`
    }
    case 'chart':
      return `<figure data-flow-print-block="${escapeHtml(node.blockId)}" style="width:100%;margin:16px 0;aspect-ratio:656/${node.height}">${buildNativeChartSvg(node.chart, 656, node.height, node.blockId)}</figure>`
    case 'table': {
      const head = `<tr>${node.headers.map((header) => `<${node.headerEnabled ? 'th' : 'td'}>${richTextToHtml(header)}</${node.headerEnabled ? 'th' : 'td'}>`).join('')}</tr>`
      const body = node.rows.map((row) => `<tr>${row.filter(cell => !cell.span?.covered).map((cell) => `<td${cell.span ? ` rowspan="${cell.span.rowSpan}" colspan="${cell.span.columnSpan}"` : ''}>${richTextToHtml(cell.content)}</td>`).join('')}</tr>`).join('')
      return `<figure data-flow-print-block="${escapeHtml(node.blockId)}">${
        node.caption ? `<figcaption>${richTextToHtml(node.caption)}</figcaption>` : ''
      }<table>${head}${body}</table></figure>`
    }
    case 'formula':
      return `<p data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="formula">${richTextToHtml({ inlines: [{ type: 'math', formulaId: node.blockId, latex: node.latex, accessibleText: node.accessibleText, style: node.style }] }, true)}</p>`
    case 'media': {
      const assetUrl = node.mediaKind === 'image'
        ? options.resolveAssetUrl?.(node.assetId)?.trim()
        : undefined
      if (assetUrl) {
        const alt = node.altText?.trim() || (node.caption ? plainDocumentText(node.caption).trim() : undefined) || node.fallbackLabel
        let image = `<img class="flow-print-image" src="${escapeHtml(assetUrl)}" alt="${escapeHtml(alt)}"/>`
        if (node.crop) {
          const source = dataUrlImageDimensions(assetUrl)
          if (!source) throw new Error(`正文图片 ${node.blockId} 无法读取原图尺寸，已停止裁剪打印。`)
          const { dom } = flowMediaCropGeometry(source, node)
          image = `<div class="flow-print-image-crop" style="width:100%;max-width:100%;aspect-ratio:${dom.wrapperAspectRatio};overflow:hidden;position:relative"><img class="flow-print-image" src="${escapeHtml(assetUrl)}" alt="${escapeHtml(alt)}" style="position:absolute;display:block;max-width:none;width:${dom.imageWidth};height:${dom.imageHeight};left:${dom.imageLeft};top:${dom.imageTop}"/></div>`
        }
        return `<figure data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="image">${image}${
          node.caption ? `<figcaption>${richTextToHtml(node.caption)}</figcaption>` : ''
        }</figure>`
      }
      return `<figure data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="media-fallback"><p>[媒体后备：${escapeHtml(node.fallbackLabel)}]</p>${node.caption ? `<figcaption>${richTextToHtml(node.caption)}</figcaption>` : ''}</figure>`
    }
    case 'code':
      return `<pre data-flow-print-block="${escapeHtml(node.blockId)}"><code>${escapeHtml(node.code)}</code></pre>`
    case 'callout':
      return `<aside data-flow-print-block="${escapeHtml(node.blockId)}">${
        node.title ? `<strong>${richTextToHtml(node.title)}</strong>` : ''
      }<p>${richTextToHtml(node.body)}</p></aside>`
    case 'section':
      return `<h2 data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="section">${richTextToHtml(node.title)}</h2>`
    case 'divider':
      return `<hr data-flow-print-block="${escapeHtml(node.blockId)}"/>`
    case 'component':
      return `<p data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="component-fallback">[组件后备：${escapeHtml(node.fallbackLabel)}]</p>`
  }
}

function richTextToHtml(content: FlowTextContent, displayMode = false): string {
  if (!displayMode) return renderDocumentText(content)
  const inline = content.inlines[0]
  if (!inline || inline.type !== 'math') return renderDocumentText(content)
  const style = `${inline.style?.fontSize ? `font-size:${inline.style.fontSize}px;` : ''}${inline.style?.color ? `color:${inline.style.color};` : ''}`
  return `<span aria-label="${escapeHtml(inline.accessibleText)}" style="${escapeHtml(style)}">${renderDocumentMath(inline.latex, true)}</span>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
