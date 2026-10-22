import { describe, expect, it } from 'vitest'
import { documentPreviewTarget, layoutPreviewRanges } from '../../src/renderer/document/editPreviewWidgets'
import { toEditorDocument } from '../../src/renderer/document/documentAdapter'
import type { EditTarget } from '../../src/shared/workbench/editSession'

const instance = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'paragraph' }
const document = toEditorDocument({ blocks: [{ type: 'paragraph', id: 'paragraph', content: { inlines: [{ type: 'text', text: 'Current paragraph' }] } }] })
const ranges = (target: EditTarget) => layoutPreviewRanges(document, { editId: 'result', target, value: '', cancel() {} }, { blocks: [] })

describe('precise field targets never widen to their parent block', () => {
  it('leaves author fields and unsupported field addresses unprojected', () => {
    const fields: EditTarget[] = [
      { ...instance, authorField: { kind: 'text', fieldScope: 'data', dataPath: ['html'], initialValue: 'A' } },
      { ...instance, dataPath: ['content'] },
      { ...instance, dataPath: ['nested', 'content'], from: 0, to: 3 },
      { ...instance, fieldScope: 'authoring', dataPath: ['content'], from: 0, to: 3 },
      { ...instance, fieldScope: 'flowLayout', dataPath: ['content'], from: 0, to: 3 },
    ]
    for (const target of fields) {
      expect(documentPreviewTarget(target)).toBe(target)
      expect(ranges(target)).toEqual([])
    }
  })

  it('retains proven document ranges and explicit whole-instance selection', () => {
    expect(documentPreviewTarget({ ...instance, dataPath: ['content'], from: 2, to: 5 })).toEqual({
      kind: 'flow-range', surfaceId: 'flow', blockId: 'paragraph', parentId: null, slot: { kind: 'field', field: 'content' }, from: 2, to: 5,
    })
    expect(ranges({ ...instance, dataPath: ['content'], from: 2, to: 5 })).toMatchObject([{ from: 3, to: 6 }])
    expect(documentPreviewTarget({ ...instance, fieldScope: 'flowLayout', dataPath: ['caption'], from: 1, to: 2 })).toMatchObject({ kind: 'flow-range', slot: { kind: 'field', field: 'caption' } })
    expect(ranges(instance)).toHaveLength(1)
  })
})
