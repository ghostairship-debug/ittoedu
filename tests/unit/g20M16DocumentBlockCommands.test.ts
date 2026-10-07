import { describe, expect, it, vi } from 'vitest'
import type { DocumentContent } from '@/shared/document/content'
import { applyDocumentBlockCommand, documentBlockMenu } from '@/renderer/document/documentBlockCommands'

const initial: DocumentContent = { blocks: [
  { id: 'first', type: 'paragraph', content: { inlines: [{ type: 'text', text: '甲' }, { type: 'math', formulaId: 'math', latex: 'x', accessibleText: 'x' }] } },
  { id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [
    { id: 'nested', type: 'list', ordered: true, items: [{ id: 'item', content: { inlines: [{ type: 'text', text: '乙' }] } }] },
  ] },
  { id: 'last', type: 'paragraph', content: { inlines: [{ type: 'text', text: '丙' }] } },
] }

describe('M16 document block commands', () => {
  it('shares one command list for insertion, conversion, ordering and AI', () => {
    const apply = vi.fn(), ai = vi.fn()
    const menu = documentBlockMenu({ content: initial, blockId: 'first', apply, ai, createId: () => 'new' })
    expect(menu.map(item => item.id)).toEqual([
      'insert-paragraph', 'insert-heading', 'insert-quote', 'insert-list', 'insert-code', 'insert-divider', 'insert-table', 'insert-above',
      'convert-paragraph', 'convert-heading', 'convert-quote', 'convert-list', 'convert-code', 'convert-divider',
      'duplicate', 'delete', 'move-up', 'move-down', 'ai',
    ])
    expect(menu.find(item => item.id === 'move-up')?.disabledReason).toBe('已在顶部')
    expect(menu.find(item => item.id === 'convert-code')?.disabledReason).toBe('转换会丢失文字样式或公式')
    menu.find(item => item.id === 'insert-paragraph')!.run()
    expect(apply.mock.calls[0]![0].blocks.map((block: { id: string }) => block.id)).toEqual(['first', 'new', 'section', 'last'])
    menu.find(item => item.id === 'ai')!.run(); expect(ai).toHaveBeenCalledWith('first')
    expect(initial.blocks).toHaveLength(3)
  })

  it('renews block and nested identities on duplicate; moving keeps them and is one result', () => {
    let serial = 0; const id = () => `copy-${++serial}`
    const copied = applyDocumentBlockCommand(initial, { action: 'duplicate', blockId: 'section' }, id)
    expect(copied.blocks[2]).toMatchObject({ id: 'copy-1', type: 'section', blocks: [{ id: 'copy-2', items: [{ id: 'copy-3' }] }] })
    expect(copied.blocks[1]).toEqual(initial.blocks[1])
    const textCopy = applyDocumentBlockCommand(initial, { action: 'duplicate', blockId: 'first' }, id)
    expect(textCopy.blocks[1]).toMatchObject({ id: 'copy-4', content: { inlines: [{ type: 'text', text: '甲' }, { type: 'math', formulaId: 'copy-5' }] } })
    const moved = applyDocumentBlockCommand(initial, { action: 'move', blockId: 'first', targetId: 'last', side: 'after' })
    expect(moved.blocks.map(block => block.id)).toEqual(['section', 'last', 'first'])
    expect(moved.blocks[2]).toEqual(initial.blocks[0])
    expect(applyDocumentBlockCommand(moved, { action: 'move-up', blockId: 'first' }).blocks.map(block => block.id)).toEqual(['section', 'first', 'last'])
  })

  it('inserts around a nested block, converts without replacing its block ID, and deletes only that block', () => {
    const inserted = applyDocumentBlockCommand(initial, { action: 'insert-above', blockId: 'nested', kind: 'heading' }, () => 'heading-new')
    const section = inserted.blocks[1]!
    expect(section.type === 'section' && section.blocks.map(block => block.id)).toEqual(['heading-new', 'nested'])
    const converted = applyDocumentBlockCommand(initial, { action: 'convert', blockId: 'last', kind: 'quote' })
    expect(converted.blocks[2]).toEqual({ id: 'last', type: 'quote', content: { inlines: [{ type: 'text', text: '丙' }] } })
    expect(applyDocumentBlockCommand(converted, { action: 'delete', blockId: 'last' }).blocks.map(block => block.id)).toEqual(['first', 'section'])
  })

  it('applies an open menu to the latest document instead of restoring stale text', () => {
    let current: DocumentContent = { blocks: [{ id: 'first', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'OLD' }] } }] }
    const apply = vi.fn((content: DocumentContent) => { current = content })
    const menu = documentBlockMenu({ content: current, readContent: () => current, blockId: 'first', apply,
      createId: () => 'copy' })
    current = { blocks: [{ id: 'first', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'NEW' }] } }] }
    menu.find(item => item.id === 'duplicate')!.run()
    expect(current.blocks).toMatchObject([
      { id: 'first', content: { inlines: [{ text: 'NEW' }] } },
      { id: 'copy', content: { inlines: [{ text: 'NEW' }] } },
    ])
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('refuses identity-invalid and destructive transformations', () => {
    expect(() => applyDocumentBlockCommand(initial, { action: 'insert-below', blockId: 'first' }, () => 'last')).toThrow()
    expect(() => applyDocumentBlockCommand(initial, { action: 'convert', blockId: 'first', kind: 'code' })).toThrow('丢失')
    expect(() => applyDocumentBlockCommand(initial, { action: 'move', blockId: 'nested', targetId: 'last', side: 'before' })).toThrow('跨分节')
    const styled: DocumentContent = { blocks: [{ id: 'p', type: 'paragraph', textAlign: 'right', lineSpacing: 1.5, content: { inlines: [{ type: 'text', text: '甲' }] } }] }
    expect(applyDocumentBlockCommand(styled, { action: 'convert', blockId: 'p', kind: 'heading' }).blocks[0]).toMatchObject({ id: 'p', textAlign: 'right', lineSpacing: 1.5 })
    expect(() => applyDocumentBlockCommand(styled, { action: 'convert', blockId: 'p', kind: 'list' })).toThrow('段落排版')
  })
})
