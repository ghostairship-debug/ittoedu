import { expect, it } from 'vitest'
import { createDocumentBlock, documentBlockMenu, DOCUMENT_BLOCK_KINDS } from '../../src/renderer/document/documentBlockCommands'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import type { DocumentContent } from '../../src/shared/document/content'

it('inserts a table through the common menu and preserves rich cell content in saved Markdown', () => {
  let content: DocumentContent = { blocks: [{ id: 'body', type: 'paragraph', content: { inlines: [{ type: 'text', text: '原正文', style: { bold: true } }] } }] }
  let sequence = 0
  const menu = documentBlockMenu({ content, blockId: 'body', readContent: () => content, apply: next => { content = next }, createId: () => `new-${++sequence}` })
  menu.find(command => command.id === 'insert-table')!.run()
  const table = content.blocks[1]
  expect(table.type).toBe('table')
  if (table.type !== 'table') throw new Error('table missing')
  table.rows[0].cells[table.columns[0].id] = { inlines: [{ type: 'text', text: '重点', style: { italic: true, color: '#123456' } }] }
  const saved = serializeDocumentMarkdown({ content, resources: emptyDocumentResources() }, 'file')
  const reopened = parseDocumentMarkdown(saved, { target: 'file', createId: () => `reopened-${++sequence}` })
  expect(reopened.status).toBe('valid')
  if (reopened.status !== 'valid') throw new Error('invalid saved document')
  const restored = reopened.document.content.blocks[1]
  expect(restored.type === 'table' && restored.rows[0].cells[restored.columns[0].id]).toEqual({ inlines: [{ type: 'text', text: '重点', style: { italic: true, color: '#123456' } }] })
  expect(reopened.document.content.blocks[0]).toMatchObject({ content: { inlines: [{ text: '原正文', style: { bold: true } }] } })
})

it('shares section and callout creation while keeping unsupported conversions unavailable', () => {
  const section = createDocumentBlock('section', () => 'section', { text: '本节' })
  const callout = createDocumentBlock('callout', () => 'callout', { text: '说明', title: '注意' })
  expect(section).toMatchObject({ type: 'section', title: { inlines: [{ text: '本节' }] }, collapsedByDefault: false, blocks: [] })
  expect(callout).toMatchObject({ type: 'callout', title: { inlines: [{ text: '注意' }] }, body: { inlines: [{ text: '说明' }] } })
  const menu = documentBlockMenu({ content: { blocks: [section] }, blockId: section.id, apply() {} })
  expect(menu.filter(command => command.group === '插入').map(command => command.id)).toEqual([...DOCUMENT_BLOCK_KINDS.map(({ kind }) => `insert-${kind}`), 'insert-above'])
  expect(menu.some(command => command.id === 'convert-section' || command.id === 'convert-callout')).toBe(false)
})
