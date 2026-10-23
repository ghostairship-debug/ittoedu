import { afterEach, expect, it } from 'vitest'
import { documentBlockDropTarget } from '../../src/renderer/document/documentBlockDrop'
import { applyDocumentBlockCommand } from '../../src/renderer/document/documentBlockCommands'
import type { DocumentContent } from '../../src/shared/document/content'

afterEach(() => { document.body.replaceChildren() })
const paragraph = (id: string) => ({ id, type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: id }] } })
function root(rects: Record<string, [number, number]>) {
  const root = document.createElement('div')
  for (const [id, [top, height]] of Object.entries(rects)) {
    const block = document.createElement('p'); block.dataset.flowBlockId = id
    block.getBoundingClientRect = () => ({ left: 50, right: 550, top, bottom: top + height, width: 500, height } as DOMRect)
    root.append(block)
  }
  document.body.append(root)
  return root
}
it('resolves gaps, before-first and blank end into the same sibling move command', () => {
  const content = { blocks: ['a', 'b', 'c'].map(paragraph) }
  const editor = root({ a: [100, 30], b: [150, 30], c: [200, 30] })
  for (const [sourceId, y, targetId, side, order] of [
    ['a', 190, 'b', 'after', ['b', 'a', 'c']],
    ['a', 350, 'c', 'after', ['b', 'c', 'a']],
    ['c', 90, 'a', 'before', ['c', 'a', 'b']],
  ] as const) {
    const drop = documentBlockDropTarget(content, editor, sourceId, { x: 100, y })!
    expect(drop).toMatchObject({ targetId, side, left: 50, width: 500 })
    expect(applyDocumentBlockCommand(content, { action: 'move', blockId: sourceId, ...drop }).blocks.map(block => block.id)).toEqual(order)
  }
})
it('moves between reading sections and excludes descendants of a dragged section', () => {
  const content: DocumentContent = { blocks: [paragraph('a'), { id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [paragraph('b'), paragraph('c')] }, paragraph('d')] }
  const editor = root({ a: [100, 30], section: [150, 200], b: [180, 30], c: [230, 30], d: [400, 30] })
  expect(documentBlockDropTarget(content, editor, 'section', { x: 100, y: 240 })?.targetId).toBe('a')
  const drop = documentBlockDropTarget(content, editor, 'b', { x: 100, y: 400 })!
  expect(drop).toMatchObject({ targetId: 'd', side: 'before' })
  const moved = applyDocumentBlockCommand(content, { action: 'move', blockId: 'b', ...drop })
  expect(moved.blocks[1]).toMatchObject({ id: 'section', blocks: [{ id: 'c' }] })
  expect(moved.blocks.map(block => block.id)).toEqual(['a', 'section', 'b', 'd'])
})

it('targets the column under X before choosing its logical insertion edge, including short and empty columns', () => {
  const group = (id: string, blocks: DocumentContent['blocks']) => ({ id, type: 'course-instance' as const, blocks })
  const content: DocumentContent = { blocks: [group('columns', [group('left', [paragraph('a'), paragraph('b')]), group('right', [paragraph('c')])])] }
  const editor = document.createElement('div')
  const bounds: Record<string, [number, number, number, number]> = {
    columns: [50, 100, 500, 300], left: [50, 100, 238, 300], right: [312, 100, 238, 30],
    a: [50, 100, 238, 30], b: [50, 200, 238, 30], c: [312, 100, 238, 30],
  }
  for (const [id, [left, top, width, height]] of Object.entries(bounds)) {
    const block = document.createElement('div'); block.dataset.flowBlockId = id
    block.getBoundingClientRect = () => ({ left, right: left + width, top, bottom: top + height, width, height } as DOMRect)
    editor.append(block)
  }
  document.body.append(editor)
  const drop = documentBlockDropTarget(content, editor, 'b', { x: 400, y: 300 })!
  expect(drop).toMatchObject({ targetId: 'c', side: 'after', left: 312, width: 238 })
  const moved = applyDocumentBlockCommand(content, { action: 'move', blockId: 'b', ...drop })
  expect(moved.blocks[0]).toMatchObject({ blocks: [{ id: 'left', blocks: [{ id: 'a' }] }, { id: 'right', blocks: [{ id: 'c' }, { id: 'b' }] }] })
  const emptied = applyDocumentBlockCommand(content, { action: 'move', blockId: 'c', targetId: 'b', side: 'after' })
  const emptyDrop = documentBlockDropTarget(emptied, editor, 'b', { x: 400, y: 300 })!
  expect(emptyDrop).toMatchObject({ targetId: 'right', side: 'inside' })
  expect(applyDocumentBlockCommand(emptied, { action: 'move', blockId: 'b', ...emptyDrop }).blocks[0])
    .toMatchObject({ blocks: [{ id: 'left', blocks: [{ id: 'a' }, { id: 'c' }] }, { id: 'right', blocks: [{ id: 'b' }] }] })
  expect(() => applyDocumentBlockCommand(content, { action: 'move', blockId: 'columns', targetId: 'a', side: 'before' })).toThrow(/自身内部/)
})
