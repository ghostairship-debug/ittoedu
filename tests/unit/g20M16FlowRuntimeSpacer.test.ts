import { expect, it, vi } from 'vitest'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import type { DocumentContent } from '../../src/shared/document/content'

it('keeps anchored Runtime space in the Flow view after nested and terminal blocks without changing content', () => {
  const content: DocumentContent = { blocks: [
    { id: 'before', type: 'paragraph', content: { inlines: [{ type: 'text', text: '前段' }] } },
    { id: 'section', type: 'section', title: { inlines: [{ type: 'text', text: '小节' }] }, collapsedByDefault: false,
      blocks: [{ id: 'nested', type: 'paragraph', content: { inlines: [{ type: 'text', text: '节内段' }] } }] },
    { id: 'table', type: 'table', columns: [{ id: 'c', header: { inlines: [{ type: 'text', text: '表头' }] } }],
      rows: [{ id: 'r', cells: { c: { inlines: [{ type: 'text', text: '单元格' }] } } }] },
    { id: 'after', type: 'paragraph', content: { inlines: [{ type: 'text', text: '末段' }] } },
  ] }
  const host = document.createElement('div'); document.body.append(host)
  const change = vi.fn()
  const options = { document: { content, resources: emptyDocumentResources() }, revision: '1', presentation: 'flow' as const,
    change, diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), runtimeSpacers: [
      { blockId: 'before', height: 120 }, { blockId: 'nested', height: 80 },
      { blockId: 'table', height: 50 }, { blockId: 'after', height: 60 },
    ] }
  const editor = createLayoutEditor(host, options)
  try {
    const spacer = (id: string) => host.querySelector<HTMLElement>(`[data-flow-runtime-spacer="${id}"]`)
    for (const entry of options.runtimeSpacers) expect(spacer(entry.blockId)?.style.height).toBe(`${entry.height}px`)
    expect(spacer('before')?.previousElementSibling?.getAttribute('data-flow-block-id')).toBe('before')
    expect(spacer('nested')?.previousElementSibling?.getAttribute('data-flow-block-id')).toBe('nested')
    expect(spacer('nested')?.closest('details')?.getAttribute('data-flow-block-id')).toBe('section')
    expect(spacer('table')?.previousElementSibling?.getAttribute('data-flow-block-id')).toBe('table')
    expect(spacer('after')?.previousElementSibling?.getAttribute('data-flow-block-id')).toBe('after')
    const sameView = editor.view
    editor.update({ ...options, runtimeSpacers: [{ blockId: 'before', height: 240 }] })
    expect(editor.view).toBe(sameView)
    expect(spacer('before')?.style.height).toBe('240px')
    expect(spacer('nested')).toBeNull()
    expect(fromEditorDocument(editor.view.state.doc)).toEqual(content)
    expect(change).not.toHaveBeenCalled()
  } finally { editor.destroy(); host.remove() }
})
