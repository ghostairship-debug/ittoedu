import { serializeFormulaAst } from '../../../shared/formulaLinear'
import type { MixedPrintEntry, MixedPrintPlan } from '../../../shared/courseProjectTypes'
import type { PublishedFlowSurface } from '../../../shared/publishedCourseTypes'
import { resolveCourseSurfaceBackgroundColor } from '../../../shared/courseProjectModel'
import type { TextRun, TextRunStyle } from '../../../shared/contracts/native-v1'
import {
  flowTableCellText,
  flowRichTextSegments,
  walkFlowBlocks,
  type FlowBlock,
} from '../../../player/surfaces/flow/flowModel'

export const FLOW_PRINT_EXCLUDES_RUNTIME_TOC = false as const
export const FLOW_PRINT_INCLUDES_FLOATING_LAYERS = false as const

export type FlowPrintPageSize = MixedPrintPlan['pageSize']
export type FlowPrintOrientation = MixedPrintPlan['orientation']

export type FlowPrintNode =
  | { type: 'document-title'; text: string }
  | {
      type: 'heading'
      blockId: string
      level: 1 | 2 | 3 | 4 | 5 | 6
      text: string
      runs: readonly TextRun[]
    }
  | { type: 'paragraph'; blockId: string; text: string; runs: readonly TextRun[] }
  | { type: 'quote'; blockId: string; text: string; runs: readonly TextRun[]; citation?: string }
  | {
      type: 'list'
      blockId: string
      ordered: boolean
      items: Array<{ id: string; text: string; runs: readonly TextRun[] }>
    }
  | {
      type: 'table'
      blockId: string
      caption?: string
      headers: string[]
      rows: Array<Array<{ text: string; runs: readonly TextRun[] }>>
    }
  | {
      type: 'formula'
      blockId: string
      linear: string
      accessibleText: string
    }
  | {
      type: 'media'
      blockId: string
      mediaKind: 'image' | 'audio' | 'video'
      assetId: string
      fallbackLabel: string
      altText?: string
      caption?: string
    }
  | { type: 'code'; blockId: string; language?: string; code: string }
  | {
      type: 'callout'
      blockId: string
      tone: 'note' | 'example' | 'warning' | 'conclusion'
      title?: string
      body: string
    }
  | { type: 'section'; blockId: string; title: string }
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
        text: block.text,
        runs: block.runs ?? [],
      }]
    case 'paragraph':
      return [{
        type: 'paragraph',
        blockId: block.id,
        text: block.text,
        runs: block.runs ?? [],
      }]
    case 'quote':
      return [{
        type: 'quote',
        blockId: block.id,
        text: block.text,
        runs: block.runs ?? [],
        ...(block.citation ? { citation: block.citation } : {}),
      }]
    case 'list':
      return [{
        type: 'list',
        blockId: block.id,
        ordered: block.ordered,
        items: block.items.map((item) => ({
          id: item.id,
          text: item.text,
          runs: item.runs ?? [],
        })),
      }]
    case 'table':
      return [{
        type: 'table',
        blockId: block.id,
        ...(block.caption ? { caption: block.caption } : {}),
        headers: block.columns.map((column) => column.header),
        rows: block.rows.map((row) => block.columns.map((column) => {
          const cell = row.cells[column.id]
          return {
            text: flowTableCellText(cell),
            runs: typeof cell === 'object' && cell ? cell.runs ?? [] : [],
          }
        })),
      }]
    case 'formula':
      return [{
        type: 'formula',
        blockId: block.id,
        linear: serializeFormulaAst(block.ast),
        accessibleText: block.accessibleText,
      }]
    case 'media':
      return [{
        type: 'media',
        blockId: block.id,
        mediaKind: block.mediaKind,
        assetId: block.assetId,
        fallbackLabel: block.altText?.trim() || block.caption?.trim() || block.assetId,
        ...(block.altText ? { altText: block.altText } : {}),
        ...(block.caption ? { caption: block.caption } : {}),
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
  switch (node.type) {
    case 'document-title':
      return `<h1 data-flow-print-node="title">${escapeHtml(node.text)}</h1>`
    case 'heading':
      return `<h${node.level} data-flow-print-block="${escapeHtml(node.blockId)}">${richTextToHtml(node.text, node.runs)}</h${node.level}>`
    case 'paragraph':
      return `<p data-flow-print-block="${escapeHtml(node.blockId)}">${richTextToHtml(node.text, node.runs)}</p>`
    case 'quote':
      return `<blockquote data-flow-print-block="${escapeHtml(node.blockId)}"><p>${richTextToHtml(node.text, node.runs)}</p>${
        node.citation ? `<cite>${escapeHtml(node.citation)}</cite>` : ''
      }</blockquote>`
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      return `<${tag} data-flow-print-block="${escapeHtml(node.blockId)}">${
        node.items.map((item) => `<li>${richTextToHtml(item.text, item.runs)}</li>`).join('')
      }</${tag}>`
    }
    case 'table': {
      const head = `<tr>${node.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>`
      const body = node.rows.map((row) => `<tr>${row.map((cell) => `<td>${richTextToHtml(cell.text, cell.runs)}</td>`).join('')}</tr>`).join('')
      return `<figure data-flow-print-block="${escapeHtml(node.blockId)}">${
        node.caption ? `<figcaption>${escapeHtml(node.caption)}</figcaption>` : ''
      }<table>${head}${body}</table></figure>`
    }
    case 'formula':
      return `<p data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="formula"><span>${escapeHtml(node.linear)}</span><span>公式说明：${escapeHtml(node.accessibleText)}</span></p>`
    case 'media': {
      const assetUrl = node.mediaKind === 'image'
        ? options.resolveAssetUrl?.(node.assetId)?.trim()
        : undefined
      if (assetUrl) {
        const alt = node.altText?.trim() || node.caption?.trim() || node.fallbackLabel
        return `<figure data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="image"><img class="flow-print-image" src="${escapeHtml(assetUrl)}" alt="${escapeHtml(alt)}"/>${
          node.caption ? `<figcaption>${escapeHtml(node.caption)}</figcaption>` : ''
        }</figure>`
      }
      return `<p data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="media-fallback">[媒体后备：${escapeHtml(node.fallbackLabel)}]</p>`
    }
    case 'code':
      return `<pre data-flow-print-block="${escapeHtml(node.blockId)}"><code>${escapeHtml(node.code)}</code></pre>`
    case 'callout':
      return `<aside data-flow-print-block="${escapeHtml(node.blockId)}">${
        node.title ? `<strong>${escapeHtml(node.title)}</strong>` : ''
      }<p>${escapeHtml(node.body)}</p></aside>`
    case 'section':
      return `<h2 data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="section">${escapeHtml(node.title)}</h2>`
    case 'divider':
      return `<hr data-flow-print-block="${escapeHtml(node.blockId)}"/>`
    case 'component':
      return `<p data-flow-print-block="${escapeHtml(node.blockId)}" data-flow-print="component-fallback">[组件后备：${escapeHtml(node.fallbackLabel)}]</p>`
  }
}

function richTextStyleToCss(style: TextRunStyle): string {
  const decorations = [
    style.underline ? 'underline' : '',
    style.strike ? 'line-through' : '',
  ].filter(Boolean).join(' ')
  return [
    style.fontFamily ? `font-family:${style.fontFamily}` : '',
    style.fontSize !== undefined ? `font-size:${style.fontSize}px` : '',
    style.color ? `color:${style.color}` : '',
    style.bold !== undefined ? `font-weight:${style.bold ? '700' : '400'}` : '',
    style.italic !== undefined ? `font-style:${style.italic ? 'italic' : 'normal'}` : '',
    decorations ? `text-decoration-line:${decorations}` : '',
    style.highlightColor ? `background-color:${style.highlightColor}` : '',
    style.emphasis !== undefined
      ? `text-emphasis-style:${style.emphasis ? 'filled circle' : 'none'}`
      : '',
  ].filter(Boolean).join(';')
}

function richTextToHtml(text: string, runs: readonly TextRun[]): string {
  return flowRichTextSegments(text, runs).map((segment) => {
    const content = escapeHtml(segment.text).replace(/\n/g, '<br/>')
    const css = richTextStyleToCss(segment.style)
    return css ? `<span style="${escapeHtml(css)}">${content}</span>` : content
  }).join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
