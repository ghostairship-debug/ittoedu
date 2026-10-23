import { documentBlockChildren, documentTextLength, sliceDocumentText, walkDocument, type DocumentBlock, type DocumentContent } from './content'
import type { DocumentPoint, DocumentSelection } from './ports'
export class DocumentInsertionTargetError extends Error {}

export interface DocumentBlockLocation { blocks: DocumentBlock[]; index: number; block: DocumentBlock; parentId: string | null }
export function locateDocumentBlock(blocks: DocumentBlock[], id: string, parentId: string | null = null): DocumentBlockLocation | null {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block.id === id) return { blocks, index, block, parentId }
    const children = documentBlockChildren(block), found = children && locateDocumentBlock(children, id, block.id)
    if (found) return found
  }
  return null
}

/** Non-collapsed insertion preserves selected content and uses its logical end. */
function insertionPoint(content: DocumentContent, selection: Extract<DocumentSelection, { kind: 'text' }>): DocumentPoint {
  const order: string[] = []; walkDocument(content.blocks, block => order.push(block.id))
  const { anchor, head } = selection
  const left = order.indexOf(anchor.blockId), right = order.indexOf(head.blockId)
  if (left < 0 || right < 0) throw new DocumentInsertionTargetError('正文插入位置已不存在，请重新选择落点')
  if (left !== right) return left < right ? head : anchor
  if (JSON.stringify(anchor.slot) !== JSON.stringify(head.slot)) throw new DocumentInsertionTargetError('此选区跨正文槽位，请选择普通段落光标，或使用所在块下方插入')
  return anchor.offset > head.offset ? anchor : head
}
/** Explicit block-boundary fallback for slots that cannot contain a block. */
export function documentInsertionBlockId(content: DocumentContent, selection: DocumentSelection): string {
  return selection.kind === 'cells' ? selection.tableId : selection.kind === 'object' ? selection.blockId
    : selection.anchor.blockId === selection.head.blockId ? selection.head.blockId : insertionPoint(content, selection).blockId
}

/** Pure structure preparation; the caller owns identity, canonical commit and History. */
export function planDocumentBlockInsertion(content: DocumentContent, selection: DocumentSelection | null, createId: () => string = () => crypto.randomUUID()) {
  const next = structuredClone(content)
  if (!selection) return { content: next, parentId: null, index: next.blocks.length }
  if (selection.kind === 'cells') throw new DocumentInsertionTargetError('表格单元格内不能插入块对象，请使用表格下方插入')
  const point = selection.kind === 'text' ? insertionPoint(content, selection) : null
  const location = locateDocumentBlock(next.blocks, point?.blockId ?? (selection as Extract<DocumentSelection, { kind: 'object' }>).blockId)
  if (!location) throw new DocumentInsertionTargetError('正文插入位置已不存在，请重新选择落点')
  const { block, blocks, index, parentId } = location
  if (!point) return { content: next, parentId, index: index + 1 }
  if (!['paragraph', 'heading', 'quote'].includes(block.type) || point.slot.kind !== 'field' || point.slot.field !== 'content'
    || !('content' in block)) {
    const slot = point.slot.kind === 'item' ? '列表项' : point.slot.kind === 'cell' || point.slot.kind === 'header' ? '表格单元格'
      : point.slot.field === 'citation' ? '引用出处' : point.slot.field === 'caption' ? '图注' : point.slot.field === 'title' ? '标题槽位' : '此正文槽位'
    throw new DocumentInsertionTargetError(`${slot}内不能插入块对象，请选择普通段落光标，或使用所在块下方插入`)
  }
  const length = documentTextLength(block.content)
  if (!Number.isInteger(point.offset) || point.offset < 0 || point.offset > length) throw new DocumentInsertionTargetError('正文光标已超出当前文字，请重新选择落点')
  if (point.offset === 0) return { content: next, parentId, index }
  if (point.offset === length) return { content: next, parentId, index: index + 1 }
  const head = { ...block, content: sliceDocumentText(block.content, 0, point.offset) }
  if (head.type === 'quote') delete head.citation
  blocks.splice(index, 1, head,
    { ...block, id: createId(), content: sliceDocumentText(block.content, point.offset, length) })
  return { content: next, parentId, index: index + 1 }
}

/** The same preparation also serves plain document files, without a course owner. */
export function insertDocumentBlocks(content: DocumentContent, selection: DocumentSelection | null, blocks: DocumentBlock[], createId?: () => string): DocumentContent {
  const plan = planDocumentBlockInsertion(content, selection, createId)
  const target = plan.parentId ? documentBlockChildren(locateDocumentBlock(plan.content.blocks, plan.parentId)!.block)! : plan.content.blocks
  target.splice(plan.index, 0, ...blocks)
  return plan.content
}
