import { expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import { plainDocumentText, type DocumentBlock, type DocumentContent } from '../../src/shared/document/content'

// The P3 saved-project failure has an image in the left column and an editable
// paragraph in the right. After typing, PM's paragraph data attrs still carry
// the prior projection while its inline content already has the acknowledged note.
it('reconciles a canonical image replacement after acknowledged typing in another column without fitting duplicate group wrappers', () => {
  const paragraph: DocumentBlock = { id: 'paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: '观察解释：水温逐渐接近室温。', style: { bold: true }, rangeIds: ['retained-range'] }] } }
  const content: DocumentContent = { blocks: [{ id: 'columns', type: 'course-instance', blocks: [
    { id: 'left', type: 'course-instance', blocks: [{ id: 'image', type: 'media', assetId: 'old-image', mediaKind: 'image', altText: '原图', layout: 'content-width' }] },
    { id: 'right', type: 'course-instance', blocks: [paragraph] },
  ] }, { id: 'neighbor', type: 'paragraph', content: { inlines: [{ type: 'text', text: '未修改的邻段' }] } }] }
  const host = document.createElement('div'); document.body.append(host)
  let published: DocumentContent | undefined, ratio = '1fr 1fr'
  const change = vi.fn((document: { content: DocumentContent }) => { published = document.content; return true })
  const options = { document: { content, resources: emptyDocumentResources() }, revision: '0', presentation: 'flow' as const,
    change, undo() {}, redo() {}, diagnostic: vi.fn(), renderGroup(_id: string, _wrapper: HTMLElement, children: HTMLElement) {
      children.style.display = 'grid'; children.style.gridTemplateColumns = ratio
    } }
  const editor = createLayoutEditor(host, options)
  try {
    const neighbor = host.querySelector('[data-document-id="neighbor"]'), columns = host.querySelector('[data-document-id="columns"]')
    let end = 0; editor.view.state.doc.descendants((node, at) => { if (node.attrs.id === 'paragraph') end = at + 1 + node.content.size })
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, end)))
    const insertion = editor.captureInsertionSelection()
    editor.view.dispatch(editor.view.state.tr.insertText(' 人工批注：保留此观察。'))
    expect(change).toHaveBeenCalledTimes(1)
    const next = structuredClone(published!)
    const group = next.blocks[0] as Extract<DocumentBlock, { type: 'course-instance' }>
    const left = group.blocks![0] as Extract<DocumentBlock, { type: 'course-instance' }>
    Object.assign(left.blocks![0], { assetId: 'replacement-image', altText: '人工换图' })
    ratio = 'minmax(0, 2fr) minmax(0, 1fr)'
    editor.update({ ...options, revision: '2', document: { ...options.document, content: next }, objectRevision: 1 })
    expect(fromEditorDocument(editor.view.state.doc)).toEqual(next)
    expect(change).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-document-id="neighbor"]')).toBe(neighbor)
    expect(host.querySelector('[data-document-id="columns"]')).toBe(columns)
    expect(host.querySelector('[data-flow-reading-group-content="columns"]')).toHaveStyle({ gridTemplateColumns: ratio })
    const right = group.blocks![1] as Extract<DocumentBlock, { type: 'course-instance' }>
    const updatedParagraph = right.blocks![0] as Extract<DocumentBlock, { type: 'paragraph' }>
    const offset = Array.from(plainDocumentText(updatedParagraph.content)).length
    expect(editor.readSelection()).toMatchObject({ kind: 'text', anchor: { blockId: 'paragraph', offset } })
    expect(insertion.read(next)).toMatchObject({ kind: 'text', anchor: { blockId: 'paragraph', offset } })
    insertion.release()
  } finally { editor.destroy(); host.remove() }
})
