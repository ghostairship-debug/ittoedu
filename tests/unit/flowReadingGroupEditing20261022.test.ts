import { describe, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { splitBlock } from 'prosemirror-commands'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { projectFlowDocument, flowDocumentEdits, isFlowReadingGroup } from '../../src/core/components/document/flowDocumentProjection'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { serializeDocumentMarkdown, parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { documentContentSchema } from '../../src/shared/document/content'
import { createImageData } from '../../src/components/image/data'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'reading', revision: 0, title: 'Reading', rootIds: ['flow'], entry: { rootInstanceId: 'flow' },
    assets: {}, global: { underlay: [], overlay: [] },
    definitions: Object.fromEntries(['group', 'text', 'container.flow'].map(key => [key, { id: key, role: 'content', implementation: { kind: 'builtin', key: 'guoling.' + key } }])),
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', data: {}, childIds: ['reading', 'neighbor'], container: { kind: 'flow' } },
      reading: { id: 'reading', definitionId: 'group', data: {}, childIds: ['first', 'second'], style: { display: 'grid', gridTemplateColumns: '1fr', gap: '24px', padding: '20px' } },
      first: { id: 'first', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('First paragraph'))) },
      second: { id: 'second', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Second paragraph'))) },
      neighbor: { id: 'neighbor', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Untouched neighbor'))) },
    } }
}

describe('native reading groups remain one continuous author projection', () => {
  it('splits and edits within the group through the existing canonical planner without converting its definition or layout', () => {
    const project = fixture(), initial = projectFlowDocument(project, 'flow'), host = document.createElement('div')
    document.body.append(host)
    const style = vi.fn((_id: string, wrapper: HTMLElement, children: HTMLElement) => { wrapper.style.padding = '20px'; children.style.display = 'grid' })
    const editor = createLayoutEditor(host, { document: initial, revision: '0', presentation: 'flow', renderGroup: style,
      change: vi.fn(), undo() {}, redo() {}, diagnostic(message) { throw new Error(message) } })
    try {
      const wrapper = host.querySelector('[data-flow-reading-group="reading"]')!
      expect(wrapper.querySelector('[data-flow-reading-group-content]')?.children).toHaveLength(2)
      expect(host.querySelector('[data-flow-reading-group-content]')?.textContent).toBe('First paragraphSecond paragraph')
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 4)))
      splitBlock(editor.view.state, editor.view.dispatch)
      editor.view.dispatch(editor.view.state.tr.insertText('Changed '))
      const content = fromEditorDocument(editor.view.state.doc)
      const changed = applyComponentOperation(project, captureComponentOperation(project, flowDocumentEdits(project, 'flow', content.blocks)))
      expect(changed.instances.reading.definitionId).toBe('group')
      expect(changed.instances.reading.style).toEqual(project.instances.reading.style)
      expect(changed.instances.reading.data).toEqual(project.instances.reading.data)
      expect(changed.instances.reading.frame).toBeUndefined()
      expect(changed.instances.reading.childIds).toHaveLength(3)
      expect(changed.instances.reading.childIds?.[0]).toBe('first')
      expect(changed.instances.reading.childIds?.at(-1)).toBe('second')
      expect(changed.instances.neighbor).toEqual(project.instances.neighbor)
      expect(textComponentDataSchema.parse(changed.instances.first.data).content.inlines[0]).toMatchObject({ text: 'Fi' })
      const document = projectFlowDocument(changed, 'flow')
      const parsed = parseDocumentMarkdown(serializeDocumentMarkdown(document), { target: 'flow', createId: () => 'unexpected-new-id' })
      expect(parsed.status).toBe('valid')
      if (parsed.status === 'valid') expect(parsed.document.content).toEqual(document.content)
      expect(host.querySelector('[data-flow-reading-group="reading"]')).toBe(wrapper)
      expect(style).toHaveBeenCalledTimes(1)
    } finally { editor.destroy(); host.remove() }
  })

  it('keeps a free/framed group atomic while a program child only owns its own boundary', () => {
    const project = fixture()
    expect(isFlowReadingGroup(project, 'reading')).toBe(true)
    project.instances.reading.frame = { width: 900, height: 500, transform: [1, 0, 0, 1, 0, 0] }
    expect(projectFlowDocument(project, 'flow').content.blocks[0]).not.toHaveProperty('blocks')
    delete project.instances.reading.frame
    project.instances.first.implementationOverride = { kind: 'source', entry: 'index.js', files: { 'index.js': 'export default {}' } } as any
    expect(isFlowReadingGroup(project, 'reading')).toBe(true)
    const reading = projectFlowDocument(project, 'flow').content.blocks[0]
    expect(reading).toMatchObject({ type: 'course-instance', blocks: [
      { id: 'first', type: 'course-instance' }, { id: 'second', type: 'paragraph' },
    ] })
    expect(() => documentContentSchema.parse({ blocks: [{ id: 'group', type: 'course-instance', blocks: [
      { id: 'same', type: 'paragraph', content: { inlines: [] } }, { id: 'same', type: 'paragraph', content: { inlines: [] } },
    ] }] })).toThrow(/重复身份/)
  })

  it('projects framed native text and a pure media grid without changing authored geometry or opaque children', () => {
    const project = fixture()
    project.instances.first.frame = { width: 400, height: 80, transform: [1, 0, 0, 1, 20, 30] }
    project.instances.second.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' }
    project.instances.second.childIds = ['opaque-child']
    project.instances['opaque-child'] = { id: 'opaque-child', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Program-owned child'))) }
    const initial = projectFlowDocument(project, 'flow'), content = structuredClone(initial.content)
    const group = content.blocks[0]
    if (group.type !== 'course-instance' || !group.blocks || group.blocks[0].type !== 'paragraph') throw new Error('Expected native reading text')
    group.blocks[0].content.inlines = [{ type: 'text', text: 'Changed native text' }]
    const changed = applyComponentOperation(project, captureComponentOperation(project, flowDocumentEdits(project, 'flow', content.blocks)))
    expect(changed.instances.first.frame).toEqual(project.instances.first.frame)
    expect(changed.instances.second).toEqual(project.instances.second)
    expect(changed.instances['opaque-child']).toEqual(project.instances['opaque-child'])
    project.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
    project.instances.reading.childIds = ['picture']
    project.instances.picture = { id: 'picture', definitionId: 'image', data: JSON.parse(JSON.stringify(createImageData('picture-asset'))) }
    expect(projectFlowDocument(project, 'flow').content.blocks[0]).toMatchObject({ type: 'course-instance', blocks: [{ type: 'media', id: 'picture' }] })
  })
})
