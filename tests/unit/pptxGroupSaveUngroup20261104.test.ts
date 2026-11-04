import { expect, test } from 'vitest'
import PptxGenJS from 'pptxgenjs'
import { openEditor } from '@web-ppt/editor'
import { serializeEditDoc } from '@web-ppt/edit-core/save'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'

test('group, savepoint, then ungroup serializes the three original shapes', async () => {
  const ppt = new PptxGenJS(), slide = ppt.addSlide()
  slide.addText('A', { x: 1, y: 1, w: 2, h: 1 })
  slide.addShape(ppt.ShapeType.rect, { x: 1, y: 2, w: 2, h: 1 })
  slide.addShape(ppt.ShapeType.ellipse, { x: 5, y: 3, w: 2, h: 1 })
  const bytes = await ppt.write({ outputType: 'uint8array' }) as Uint8Array
  const session = await openEditor(bytes, { historyLimit: 0 })
  try {
    const editor = session.editor, slideId = editor.doc.slideOrder[0]
    editor.exec({ type: 'Group', ids: [...editor.doc.slides[slideId].children] })
    if (editor.selection.kind !== 'elements') throw new Error('group selection expected')
    const id = editor.selection.ids[0], confirm = editor.captureSavepoint()
    const grouped = await serializeEditDoc(editor.doc); confirm()
    const first = inspectOfficeContent(grouped.bytes, 'pptx')
    if (first.format !== 'pptx') throw new Error('PPT expected')
    expect(first.slides[0].shapes.filter(shape => shape.kind === 'group')).toHaveLength(1)
    editor.exec({ type: 'Ungroup', id })
    const ungrouped = await serializeEditDoc(editor.doc)
    const second = inspectOfficeContent(ungrouped.bytes, 'pptx')
    if (second.format !== 'pptx') throw new Error('PPT expected')
    expect(second.slides[0].shapes.filter(shape => shape.kind === 'group')).toHaveLength(0)
    expect(second.slides[0].shapes).toHaveLength(3)
  } finally { session.dispose() }
})
