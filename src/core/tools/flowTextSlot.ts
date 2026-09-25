import { z } from 'zod'
import type { DocumentSelection, DocumentSlot } from '../../shared/document/ports'
import { documentTextLength, normalizeDocumentText, type DocumentBlock, type FlowTextContent } from '../../shared/document/content'
import { tableCellSpan } from '../../shared/tableMerge'
import { findFlowBlockRecursive, sliceFlowRichText } from './flowDocumentModel'
import { flowBlockSchema } from '../../shared/courseProjectSchema'
import type { TextRunStyle } from '../../shared/contracts/native-v1'

import { documentSlotSchema as flowDocumentSlotSchema } from '../../shared/document/selectionSchema'
export { documentSlotSchema as flowDocumentSlotSchema } from '../../shared/document/selectionSchema'

const point = z.object({ blockId: z.string(), slot: flowDocumentSlotSchema, offset: z.number().int().nonnegative(), affinity: z.enum(['before', 'after']) }).strict()
const cell = z.object({ rowId: z.string(), columnId: z.string() }).strict()
export const flowDocumentSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), revision: z.string(), anchor: point, head: point }).strict(),
  z.object({ kind: z.literal('object'), revision: z.string(), blockId: z.string() }).strict(),
  z.object({ kind: z.literal('cells'), revision: z.string(), tableId: z.string(), anchor: cell, head: cell }).strict(),
])
export const flowContextTextRangeSchema = z.object({ slot: flowDocumentSlotSchema, start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict()
export type FlowContextTextRange = z.infer<typeof flowContextTextRangeSchema>
export type FlowContextTarget = { kind: 'object'; blockId: string } | { kind: 'text'; blockId: string; textRange: FlowContextTextRange }

export function editFlowTextRange(block: DocumentBlock, range: FlowContextTextRange, input: { content?: FlowTextContent; textStyle?: TextRunStyle }): DocumentBlock {
  const next = structuredClone(block), slot = flowTextSlot(next, range.slot), content = slot.get()
  const { start, end } = range
  const length = documentTextLength(content)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > length) throw new Error('正文选区范围已失效')
  const middle = structuredClone(input.content ?? sliceFlowRichText(content, start, end))
  if (input.textStyle) for (const inline of middle.inlines) {
    if (inline.type === 'text') inline.style = { ...inline.style, ...input.textStyle }
    else inline.style = { ...inline.style, ...(input.textStyle.fontSize !== undefined ? { fontSize: input.textStyle.fontSize } : {}), ...(input.textStyle.color !== undefined ? { color: input.textStyle.color } : {}) }
  }
  slot.set(normalizeDocumentText({ inlines: [...sliceFlowRichText(content, 0, start).inlines, ...middle.inlines, ...sliceFlowRichText(content, end, length).inlines] }))
  return flowBlockSchema.parse(next)
}

/** Resolve the actual formal content slot. Never substitute content for another field. */
export function flowTextSlot(block: DocumentBlock, slot: DocumentSlot): { get(): FlowTextContent; set(content: FlowTextContent): void } {
  if (slot.kind === 'item' && block.type === 'list') {
    const item = block.items.find(item => item.id === slot.itemId)
    if (item) return { get: () => item.content, set: content => { item.content = content } }
  }
  if (slot.kind === 'header' && block.type === 'table') {
    const column = block.columns.find(column => column.id === slot.columnId)
    if (column) return { get: () => column.header, set: content => { column.header = content } }
  }
  if (slot.kind === 'cell' && block.type === 'table') {
    const row = block.rows.find(row => row.id === slot.rowId)
    if (row?.cells[slot.columnId] && !tableCellSpan(block, slot.rowId, slot.columnId).covered)
      return { get: () => row.cells[slot.columnId]!, set: content => { row.cells[slot.columnId] = content } }
  }
  if (slot.kind === 'field') {
    const permitted: Partial<Record<DocumentBlock['type'], readonly string[]>> = { paragraph: ['content'], heading: ['content'], quote: ['content', 'citation'], media: ['caption'], table: ['caption'], callout: ['title', 'body'], section: ['title'] }
    if (permitted[block.type]?.includes(slot.field)) {
      const fields = block as unknown as Record<string, FlowTextContent | undefined>
      if (fields[slot.field]) return { get: () => fields[slot.field]!, set: content => { fields[slot.field] = content } }
    }
  }
  throw new Error('所选正文位置已失效或是合并覆盖格，请重新选择。')
}
export function resolveFlowContextSelection(blocks: readonly DocumentBlock[], revision: number, raw: DocumentSelection, options: { allowCaret?: boolean } = {}): FlowContextTarget {
  const selection = flowDocumentSelectionSchema.parse(raw)
  if (selection.revision !== String(revision)) throw new Error('正文版本已改变，请重新选择。')
  const blockId = selection.kind === 'text' ? selection.anchor.blockId : selection.kind === 'cells' ? selection.tableId : selection.blockId
  const block = findFlowBlockRecursive([...blocks], blockId)?.block
  if (!block) throw new Error('所选正文块已失效。')
  if (selection.kind === 'object') return { kind: 'object', blockId }
  let slot: DocumentSlot, start: number, end: number
  if (selection.kind === 'cells') {
    if (selection.anchor.rowId !== selection.head.rowId || selection.anchor.columnId !== selection.head.columnId) throw new Error('暂不支持跨单元格 AI 修改，请选择一个单元格中的内容。')
    slot = { kind: 'cell', ...selection.anchor }; start = 0; end = documentTextLength(flowTextSlot(block, slot).get())
  } else {
    if (selection.anchor.blockId !== selection.head.blockId || JSON.stringify(selection.anchor.slot) !== JSON.stringify(selection.head.slot)) throw new Error('暂不支持跨正文位置的 AI 修改，请选择同一段或同一单元格。')
    slot = selection.anchor.slot; start = Math.min(selection.anchor.offset, selection.head.offset); end = Math.max(selection.anchor.offset, selection.head.offset)
    if (start === end && !options.allowCaret) throw new Error('请先选择要修改的内容。')
  }
  if (end > documentTextLength(flowTextSlot(block, slot).get())) throw new Error('正文选区已失效，请重新选择。')
  return { kind: 'text', blockId, textRange: { slot, start, end } }
}
