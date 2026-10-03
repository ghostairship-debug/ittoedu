import type { DocumentBlock, DocumentContent, FlowTextContent } from '../../shared/document/content'
import { flowFormulaBlockElement, renderDocumentText } from '../../shared/document/render'
import { buildNativeChartSvg } from '../../shared/nativeChartSvg'
import { tableCellSpan } from '../../shared/tableMerge'

export type CompositionDocumentComponent = Extract<DocumentBlock, { type: 'component' }>
export interface CompositionDocumentPaintOptions {
  renderComponent?(block: CompositionDocumentComponent): HTMLElement
  reportError?(error: Error): void
}

/** The document leaf owns its existing Flow data; this DOM is only a projection. */
export function paintCompositionDocument(root: HTMLElement, content: DocumentContent, resolveAsset: (id: string) => string | undefined, options: CompositionDocumentPaintOptions = {}): void {
  const dom = root.ownerDocument
  const text = (element: HTMLElement, value: FlowTextContent) => { element.innerHTML = renderDocumentText(value) }
  const render = (block: DocumentBlock, parent: HTMLElement): void => {
    let element: HTMLElement
    try { switch (block.type) {
      case 'paragraph': case 'heading': case 'quote': {
        element = dom.createElement(block.type === 'heading' ? `h${block.level}` : block.type === 'quote' ? 'blockquote' : 'p')
        text(element, block.content)
        if (block.textAlign) element.style.textAlign = block.textAlign
        if (block.lineSpacing !== undefined) element.style.lineHeight = String(1.6 + block.lineSpacing / 16)
        if (block.type === 'quote' && block.citation) { const cite = dom.createElement('cite'); text(cite, block.citation); element.append(cite) }
        break
      }
      case 'list':
        element = dom.createElement(block.ordered ? 'ol' : 'ul')
        for (const item of block.items) { const li = dom.createElement('li'); text(li, item.content); element.append(li) }
        break
      case 'divider': element = dom.createElement('hr'); break
      case 'code': element = dom.createElement('pre'); element.textContent = block.code; break
      case 'formula': element = flowFormulaBlockElement(dom, block); break
      case 'callout': {
        element = dom.createElement('aside'); element.dataset.tone = block.tone
        if (block.title) { const title = dom.createElement('strong'); text(title, block.title); element.append(title) }
        const body = dom.createElement('p'); text(body, block.body); element.append(body)
        break
      }
      case 'section': {
        element = dom.createElement('section')
        const title = dom.createElement('h2'); text(title, block.title); element.append(title)
        for (const child of block.blocks) render(child, element)
        break
      }
      case 'media': {
        element = dom.createElement('figure')
        const media = dom.createElement(block.mediaKind === 'image' ? 'img' : block.mediaKind)
        const url = resolveAsset(block.assetId)
        if (!url) throw new Error(`正文素材不可用：${block.assetId}`)
        media.setAttribute('src', url); media.style.maxWidth = '100%'
        if (block.mediaKind === 'image') media.setAttribute('alt', block.altText ?? '')
        else media.setAttribute('controls', '')
        element.append(media)
        if (block.caption) { const caption = dom.createElement('figcaption'); text(caption, block.caption); element.append(caption) }
        break
      }
      case 'table': {
        const table = dom.createElement('table'); element = table
        if (block.caption) { const caption = dom.createElement('caption'); text(caption, block.caption); table.append(caption) }
        if (block.headerEnabled !== false) {
          const row = dom.createElement('tr')
          for (const column of block.columns) { const cell = dom.createElement('th'); text(cell, column.header); row.append(cell) }
          const head = dom.createElement('thead'); head.append(row); table.append(head)
        }
        const body = dom.createElement('tbody')
        for (const row of block.rows) {
          const tr = dom.createElement('tr')
          for (const column of block.columns) {
            const span = tableCellSpan(block, row.id, column.id)
            if (span.covered) continue
            const td = dom.createElement('td'); td.rowSpan = span.rowSpan; td.colSpan = span.columnSpan
            text(td, row.cells[column.id]!); tr.append(td)
          }
          body.append(tr)
        }
        table.append(body)
        break
      }
      case 'chart':
        element = dom.createElement('div'); element.style.height = `${block.height}px`
        element.innerHTML = buildNativeChartSvg(block.chart, Math.max(1, root.clientWidth), block.height, block.id)
        break
      case 'component': {
        if (!options.renderComponent) throw new Error(`正文组件 ${block.component.packageId} 没有可用的挂载入口`)
        element = options.renderComponent(block)
        break
      }
    } } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      element = dom.createElement('aside')
      element.dataset.documentError = error.message
      element.textContent = error.message
      options.reportError?.(error)
    }
    element.dataset.documentBlockId = block.id
    parent.append(element)
  }
  root.replaceChildren()
  for (const block of content.blocks) render(block, root)
}
