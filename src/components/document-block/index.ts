import type { ComponentDefinition, ComponentRuntimeImplementation, JsonValue } from '../../shared/contracts/component-platform'
import { documentBlockSchema, documentTextSlots, plainDocumentText, type DocumentBlock } from '../../shared/document/content'
import { renderDocumentText } from '../../shared/document/render'

export const DOCUMENT_BLOCK_DEFINITION: ComponentDefinition = { id: 'guoling.document-block', role: 'content',
  implementation: { kind: 'builtin', key: 'guoling.document-block' }, title: '文档块' }
type InstanceBlockData<T> = T extends {type:'section'} ? Omit<T,'id'|'blocks'> : Omit<T,'id'>
export type DocumentBlockData = InstanceBlockData<Extract<DocumentBlock, { type: 'heading' | 'quote' | 'list' | 'divider' | 'code' | 'callout' | 'section' }>>
const kinds = new Set(['heading', 'quote', 'list', 'divider', 'code', 'callout', 'section'])
/** Section descendants belong to instance.childIds, never to this data. */
export function parseDocumentBlockData(data: unknown, id = 'document-block'): DocumentBlock {
  const fields = data as Record<string, unknown>
  if (!fields || !kinds.has(String(fields.type))) throw new Error('文档块需要标题、引用、列表、代码、提示、分节或分隔线')
  if ('id' in fields || 'blocks' in fields) throw new Error('文档块身份和子对象由实例持有')
  return documentBlockSchema.parse({ ...fields, id, ...(fields.type === 'section' ? { blocks: [] } : {}) })
}
export function documentBlockData(block: DocumentBlock): JsonValue {
  if (!kinds.has(block.type)) throw new Error('此内容由对应专业组件持有')
  const { id: _id, ...fields } = block
  const data = { ...fields } as Record<string, unknown>
  if (block.type === 'section') delete data.blocks
  parseDocumentBlockData(data)
  return JSON.parse(JSON.stringify(data)) as JsonValue
}
export function documentBlockElement(dom: Document, block: DocumentBlock): HTMLElement {
  const node = dom.createElement(block.type === 'heading' ? `h${block.level}` : block.type === 'quote' ? 'blockquote'
    : block.type === 'list' ? block.ordered ? 'ol' : 'ul' : block.type === 'code' ? 'pre' : block.type === 'divider' ? 'hr' : 'section')
  node.dataset.componentFlowId = block.id
  node.style.margin = '0 0 12px'
  if (block.type === 'heading' || block.type === 'quote') {
    node.innerHTML = renderDocumentText(block.content)
    node.style.textAlign = block.textAlign ?? 'left'
    node.style.lineHeight = String(1.6 + (block.lineSpacing ?? 0) / 16)
    if (block.type === 'quote' && block.citation) { const cite = dom.createElement('cite'); cite.innerHTML = renderDocumentText(block.citation); node.append(cite) }
  } else if (block.type === 'list') {
    for (const item of block.items) { const li = dom.createElement('li'); li.dataset.itemId = item.id; li.innerHTML = renderDocumentText(item.content); node.append(li) }
  } else if (block.type === 'code') { const code = dom.createElement('code'); code.textContent = block.code; if (block.language) code.dataset.language = block.language; node.append(code) }
  else if (block.type === 'callout') {
    node.dataset.tone = block.tone
    if (block.title) { const title = dom.createElement('strong'); title.innerHTML = renderDocumentText(block.title); node.append(title) }
    const body = dom.createElement('div'); body.innerHTML = renderDocumentText(block.body); node.append(body)
  } else if (block.type === 'section') { const title = dom.createElement('h2'); title.innerHTML = renderDocumentText(block.title); node.append(title) }
  return node
}
export const documentBlockRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, root, scope }) {
    let element: HTMLElement | null = null
    const paint = (next: typeof instance) => {
      if (!root || !scope.isActive()) return
      element = documentBlockElement(root.ownerDocument, parseDocumentBlockData(next.data, next.id))
      root.replaceChildren(element)
    }
    paint(instance)
    const dispose = () => { element?.remove(); element = null }
    scope.cleanup(dispose)
    return { update: paint, dispose }
  },
}
export const documentBlockOutputAdapter = {
  block: (data: unknown, id: string): DocumentBlock => parseDocumentBlockData(data, id),
  text: (data: unknown): string => { const block = parseDocumentBlockData(data); return block.type === 'code' ? block.code : documentTextSlots(block).map(slot => plainDocumentText(slot.content)).join('\n') },
  html: (dom: Document, data: unknown, id: string): string => documentBlockElement(dom, parseDocumentBlockData(data, id)).outerHTML,
}
