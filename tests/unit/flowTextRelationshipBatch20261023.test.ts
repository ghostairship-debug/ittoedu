// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { flowDocumentEdits, projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { componentDataEdits } from '../../src/core/course/componentDataEdits'
import { courseObjectMoveEdits, courseObjectRemovalEdits } from '../../src/core/course/courseObjectEdits'
import { applyComponentOperation, captureComponentOperation, prepareComponentTextRelationships, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createTextComponentData } from '../../src/components/text/data'
import { owningContainer } from '../../src/shared/contracts/component-platform/project'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue
const text = (value: string, range = true) => json({ ...createTextComponentData(value), content: { inlines: [{ type: 'text', text: value, ...(range ? { rangeIds: ['R'] } : {}) }] } })
function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'ranges', revision: 0, title: 'Ranges', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
    definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
      note: { id: 'note', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } },
      input: { id: 'input', role: 'content', implementation: { kind: 'builtin', key: 'fixture.input' } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['A', 'tail'], container: { kind: 'flow' } },
      A: { id: 'A', definitionId: 'text', data: text('abcd'), childIds: ['note'] },
      tail: { id: 'tail', definitionId: 'text', data: text('tail', false) },
      note: { id: 'note', definitionId: 'note', data: { label: '注释', content: '同一个内容' }, attachments: [
        { instanceId: 'note', target: { kind: 'text-range', instanceId: 'A', dataPath: ['content'], rangeId: 'R' } }] } } }
}
const apply = (project: CourseProjectV10, edits: Parameters<typeof captureComponentOperation>[1]) => applyComponentOperation(project, captureComponentOperation(project, edits))

describe('one final-batch text relationship planner', () => {
  it('splits one annotation into two bindings, keeps one inline child, and saves the Flow-owned behavior', async () => {
    const project = fixture()
    project.instances.A.locked = true
    project.instances.A.data = json({ ...createTextComponentData(), content: { inlines: [
      { type: 'text', text: 'ab', rangeIds: ['R'] }, { type: 'component', instanceId: 'input', accessibleText: '输入', rangeIds: ['R'] }, { type: 'text', text: 'cd', rangeIds: ['R'] }] } })
    project.instances.A.childIds!.push('input')
    project.instances.input = { id: 'input', definitionId: 'input', data: {} }
    const blocks = projectFlowDocument(project, 'flow').content.blocks
    const split = [{ ...blocks[0], type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: 'a', rangeIds: ['R'] }] } },
      { id: 'B', type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text: 'b', rangeIds: ['R'] }, { type: 'component' as const, instanceId: 'input', accessibleText: '输入', rangeIds: ['R'] }, { type: 'text' as const, text: 'cd', rangeIds: ['R'] }] } }, blocks[1]]
    const edits = flowDocumentEdits(project, 'flow', split)
    expect(edits.filter(edit => edit.type === 'attachments.set' && edit.instanceId === 'note')).toHaveLength(1)
    const next = apply(project, edits)
    expect(next.instances.note.attachments?.map(attachment => attachment.target)).toEqual(['A', 'B'].map(instanceId => ({ kind: 'text-range', instanceId, dataPath: ['content'], rangeId: 'R' })))
    expect(owningContainer(next, 'note')).toEqual({ kind: 'instance', instanceId: 'flow' })
    expect(owningContainer(next, 'input')).toEqual({ kind: 'instance', instanceId: 'B' })
    expect(Object.keys(next.instances).filter(id => id === 'input')).toHaveLength(1)
    expect(projectFlowDocument(next, 'flow').content.blocks.map(block => block.id)).toEqual(['A', 'B', 'tail'])
    const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project: next, resources: { assets: {}, components: {} } }))
    expect(reopened.kind === 'course-v10' && reopened.project.instances.note).toEqual(next.instances.note)
    const movedBlocks = projectFlowDocument(next, 'flow').content.blocks
    if (movedBlocks[0].type !== 'paragraph' || movedBlocks[1].type !== 'paragraph') throw new Error('Expected text halves')
    movedBlocks[0].content.inlines.push({ type: 'component', instanceId: 'input', accessibleText: '输入' })
    movedBlocks[1].content.inlines = movedBlocks[1].content.inlines.filter(inline => inline.type !== 'component')
    const movedBack = apply(next, flowDocumentEdits(next, 'flow', movedBlocks))
    expect(owningContainer(movedBack, 'input')).toEqual({ kind: 'instance', instanceId: 'A' })
    const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'ranges.glx' },
      model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver, {
      async append() {}, async save() { throw new Error('This test serializes directly') },
    })
    expect(await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: 0, operationId: 'split', actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(project, edits) } })).toMatchObject({ status: 'applied' })
    expect(session.read().undoDepth).toBe(1)
    expect(await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: session.read().revision, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    const restored = session.read().model
    expect(restored.kind === 'course-v10' && restored.project.instances).toEqual(project.instances)
  })

  it('evacuates the shared behavior when a body moves across columns and its old group is removed', () => {
    const project = fixture()
    project.instances.A.childIds = []
    project.instances.flow.childIds = ['left', 'right', 'tail']
    project.instances.left = { id: 'left', definitionId: 'group', data: {}, style: { display: 'grid' }, childIds: ['A', 'note'] }
    project.instances.right = { id: 'right', definitionId: 'group', data: {}, style: { display: 'grid' }, childIds: [] }
    const blocks = projectFlowDocument(project, 'flow').content.blocks
    if (blocks[0].type !== 'course-instance' || blocks[1].type !== 'course-instance') throw new Error('Expected columns')
    const next = apply(project, flowDocumentEdits(project, 'flow', [{ ...blocks[1], blocks: blocks[0].blocks }, blocks[2]]))
    expect(next.instances.left).toBeUndefined()
    expect(owningContainer(next, 'A')).toEqual({ kind: 'instance', instanceId: 'right' })
    expect(owningContainer(next, 'note')).toEqual({ kind: 'instance', instanceId: 'flow' })
    expect(next.instances.note.attachments).toEqual(project.instances.note.attachments)
    expect(projectFlowDocument(next, 'flow').content.blocks.map(block => block.id)).toEqual(['right', 'tail'])
  })

  it('uses current batch ownership when a behavior enters a group before that group is removed', () => {
    const project = fixture()
    project.instances.note.frame = { width: 40, height: 20, transform: [1, 0, 0, 1, 0, 0] }
    project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: [] }
    project.instances.flow.childIds!.push('group')
    const move = courseObjectMoveEdits(project, 'note', { kind: 'instance', instanceId: 'group' }, 0)
    const frame = { width: 80, height: 30, transform: [1, 0, 0, 1, 12, 18] as [number, number, number, number, number, number] }
    const edits = [...move, { type: 'frame.set' as const, instanceId: 'note', frame }]
    const interim = applyComponentOperation(project, captureComponentOperation(project, edits, [], { deferTextRelationships: true }))
    const remove = courseObjectRemovalEdits(interim, ['group'])
    const command = captureComponentOperation(project, [...edits, ...remove])
    const removalIndex = command.edits.findIndex(edit => edit.type === 'instance.remove' && edit.instanceId === 'group')
    const rescueIndex = command.edits.findIndex(edit => edit.type === 'instance.move' && edit.instanceId === 'note'
      && edit.container.kind === 'instance' && edit.container.instanceId === 'flow')
    expect(rescueIndex).toBeLessThan(removalIndex)
    const final = applyComponentOperation(project, command)
    expect(final.instances.group).toBeUndefined()
    expect(final.instances.note.attachments).toEqual(project.instances.note.attachments)
    expect(final.instances.note.frame).toEqual(frame)
    expect(owningContainer(final, 'note')).toMatchObject({ instanceId: 'flow' })
  })

  it('ordinary deletion removes one binding and deletes the behavior only after its last target', () => {
    let project = fixture()
    project.instances.B = { id: 'B', definitionId: 'text', data: text('second') }
    project.instances.flow.childIds!.push('B', 'note'); project.instances.A.childIds = []
    project.instances.note.attachments!.push({ instanceId: 'note', target: { kind: 'text-range', instanceId: 'B', dataPath: ['content'], rangeId: 'R' } })
    const first = captureComponentOperation(project, [{ type: 'instance.remove', instanceId: 'A' }])
    expect(first.edits.some(edit => edit.type === 'attachments.set' && edit.instanceId === 'note')).toBe(false) // The structural edit already filters the removed binding.
    project = applyComponentOperation(project, first)
    expect(project.instances.note.attachments).toHaveLength(1)
    const last = captureComponentOperation(project, [{ type: 'instance.remove', instanceId: 'B' }])
    expect(last.edits).toContainEqual({ type: 'instance.remove', instanceId: 'note' })
    expect(applyComponentOperation(project, last).instances.note).toBeUndefined()
  })

  it('keeps inactive authored ranges and inline atoms until the final version is cleared', () => {
    const project = fixture()
    const inactive = json({ ...createTextComponentData(), content: { inlines: [{ type: 'text', text: 'inactive', rangeIds: ['R'] }, { type: 'component', instanceId: 'input', accessibleText: '输入' }] } })
    project.instances.input = { id: 'input', definitionId: 'input', data: {} }
    project.instances.A.childIds!.push('input')
    project.instances.flow.container = { kind: 'slide', presentation: { states: [{ id: 'saved', title: '保留版本', overrides: { A: { data: inactive } } }] } }
    const baseEdits = componentDataEdits(project, { surfaceId: 'flow', instanceId: 'A' }, { kind: 'replace', data: text('plain', false), rangeProjection: [{ path: ['content'], ranges: [] }] })
    const base = apply(project, baseEdits)
    expect(base.instances.note).toBeDefined()
    expect(base.instances.input).toBeDefined()
    const stateEdits = componentDataEdits(base, { surfaceId: 'flow', instanceId: 'A', stateId: 'saved' }, { kind: 'replace', data: text('plain', false), rangeProjection: [{ path: ['content'], ranges: [] }] })
    const mapped = presentationComponentEdits(base, 'flow', 'saved', stateEdits)
    expect(mapped).toContainEqual({ type: 'instance.remove', instanceId: 'note' })
    const final = apply(base, mapped)
    expect(final.instances.note).toBeUndefined()
    expect(final.instances.input).toBeUndefined()
  })

  it('defers intermediate cleanup until all commands have authored their final base and overrides', () => {
    const project = fixture()
    project.instances.input = { id: 'input', definitionId: 'input', data: {} }
    project.instances.A.childIds!.push('input')
    project.instances.A.data = json({ ...createTextComponentData(), content: { inlines: [
      { type: 'text', text: 'original', rangeIds: ['R'] }, { type: 'component', instanceId: 'input', accessibleText: '输入' }] } })
    project.instances.flow.container = { kind: 'slide', presentation: { states: [{ id: 'saved', title: '后续版本', overrides: {} }] } }
    const defer = { deferTextRelationships: true }
    const first = componentDataEdits(project, { surfaceId: 'flow', instanceId: 'A' },
      { kind: 'replace', data: text('temporary', false), rangeProjection: [{ path: ['content'], ranges: [] }] })
    const interim = applyComponentOperation(project, captureComponentOperation(project, first, [], defer))
    expect(interim.instances.note).toBeDefined()
    expect(interim.instances.input).toBeDefined()
    const second = presentationComponentEdits(interim, 'flow', 'saved', componentDataEdits(interim,
      { surfaceId: 'flow', instanceId: 'A', stateId: 'saved' }, { kind: 'replace', data: project.instances.A.data }), defer)
    const command = captureComponentOperation(project, [...first, ...second])
    expect(command.edits.filter(edit => edit.type === 'instance.remove')).toEqual([])
    const final = applyComponentOperation(project, command)
    expect(final.instances.note).toEqual(project.instances.note)
    expect(final.instances.input).toEqual(project.instances.input)
  })

  it('defers Flow cleanup until a later command restores its range', () => {
    const project = fixture(), blocks = projectFlowDocument(project, 'flow').content.blocks
    if (blocks[0].type !== 'paragraph') throw new Error('Expected text body')
    blocks[0].content = { inlines: [{ type: 'text', text: 'temporary' }] }
    const first = flowDocumentEdits(project, 'flow', blocks, project,
      [{ blockId: 'A', slotKey: 'content', ranges: [] }], undefined, { deferTextRelationshipCleanup: true })
    expect(first.some(edit => edit.type === 'instance.remove')).toBe(false)
    const interim = applyComponentOperation(project, captureComponentOperation(project, first, [], { deferTextRelationships: true }))
    expect(interim.instances.note).toBeDefined()
    const restore = componentDataEdits(interim, { surfaceId: 'flow', instanceId: 'A' }, { kind: 'replace', data: project.instances.A.data })
    const final = apply(project, [...first, ...restore])
    expect(final.instances.note.attachments).toEqual(project.instances.note.attachments)
    expect(owningContainer(final, 'note')).toMatchObject({ instanceId: 'flow' })
  })

  it('rescues newly inserted range and inline instances before their staged group is removed', () => {
    const project = fixture()
    const content = json({ ...createTextComponentData(), content: { inlines: [
      { type: 'text', text: 'copied', rangeIds: ['fresh-range'] }, { type: 'component', instanceId: 'fresh-input', accessibleText: '输入' }] } })
    const edits = prepareComponentTextRelationships(project, [
      { type: 'instance.insert', container: { kind: 'instance', instanceId: 'flow' }, index: 2, rootIds: ['fresh-group'], instances: [
        { id: 'fresh-group', definitionId: 'group', data: {}, childIds: ['fresh-source', 'fresh-note'] },
        { id: 'fresh-source', definitionId: 'text', data: content, childIds: ['fresh-input'] },
        { id: 'fresh-input', definitionId: 'input', data: {} },
        { id: 'fresh-note', definitionId: 'note', data: { content: 'copied annotation' }, attachments: [
          { instanceId: 'fresh-note', target: { kind: 'text-range', instanceId: 'fresh-source', dataPath: ['content'], rangeId: 'fresh-range' } }] },
      ] },
      { type: 'instance.insert', container: { kind: 'instance', instanceId: 'flow' }, index: 3, rootIds: ['fresh-body'], instances: [
        { id: 'fresh-body', definitionId: 'text', data: content },
      ] },
      { type: 'instance.remove', instanceId: 'fresh-group' },
    ], { slotMigrations: [{ from: { instanceId: 'fresh-source', dataPath: ['content'] }, to: [{ instanceId: 'fresh-body', dataPath: ['content'] }] }] })
    const final = apply(project, edits)
    expect(final.instances['fresh-group']).toBeUndefined()
    expect(owningContainer(final, 'fresh-note')).toMatchObject({ instanceId: 'flow' })
    expect(owningContainer(final, 'fresh-input')).toMatchObject({ instanceId: 'fresh-body' })
    expect(final.instances['fresh-note'].attachments).toEqual([{ instanceId: 'fresh-note', target: {
      kind: 'text-range', instanceId: 'fresh-body', dataPath: ['content'], rangeId: 'fresh-range' } }])
  })

  it('retains legal children which the native text projection does not expose', () => {
    const project = fixture()
    project.instances.A.childIds!.push('hidden')
    project.instances.hidden = { id: 'hidden', definitionId: 'input', data: { preserved: true }, childIds: ['nested'] }
    project.instances.nested = { id: 'nested', definitionId: 'input', data: { preserved: 'nested' } }
    const blocks = projectFlowDocument(project, 'flow').content.blocks
    if (blocks[0].type !== 'paragraph') throw new Error('Expected paragraph')
    blocks[0].content = { inlines: [{ type: 'text', text: 'edited' }] }
    const next = apply(project, flowDocumentEdits(project, 'flow', blocks))
    expect(next.instances.hidden).toEqual(project.instances.hidden)
    expect(next.instances.nested).toEqual(project.instances.nested)
  })

  it('cleans the final inactive-only inline without relying on any range behavior', () => {
    const project = fixture()
    delete project.instances.note
    project.instances.A.data = text('base', false)
    project.instances.A.childIds = ['input']
    project.instances.input = { id: 'input', definitionId: 'input', data: {} }
    project.instances.flow.container = { kind: 'slide', presentation: { states: [{ id: 'saved', title: '原子版本', overrides: {
      A: { data: json({ ...createTextComponentData(), content: { inlines: [{ type: 'component', instanceId: 'input', accessibleText: '输入' }] } }) },
    } }] } }
    const edits = componentDataEdits(project, { surfaceId: 'flow', instanceId: 'A', stateId: 'saved' }, { kind: 'replace', data: text('cleared', false) })
    const mapped = presentationComponentEdits(project, 'flow', 'saved', edits)
    expect(mapped).toContainEqual({ type: 'instance.remove', instanceId: 'input' })
    expect(apply(project, mapped).instances.input).toBeUndefined()
  })

  it('maintains a locked paragraph annotation while preserving the behavior own lock', () => {
    const project = fixture()
    project.instances.A.locked = true
    const content = { inlines: [{ type: 'text' as const, text: 'changed', rangeIds: ['R'] }] }
    const command = captureComponentOperation(project, [{ type: 'data.set', instanceId: 'A', path: ['content'], value: content }])
    expect(owningContainer(applyComponentOperation(project, command), 'note')).toEqual({ kind: 'instance', instanceId: 'flow' })
    project.instances.note.locked = true
    expect(() => apply(project, [{ type: 'data.set', instanceId: 'A', path: ['content'], value: content }])).toThrow('锁定')
  })

  it('uses native reading-group ancestors for the canonical text lock exception', () => {
    const project = fixture()
    project.instances.flow.childIds = ['group', 'tail']
    project.instances.group = { id: 'group', definitionId: 'group', data: {}, style: { display: 'grid' }, childIds: ['A'] }
    project.instances.flow.childIds.push('note')
    project.instances.A.childIds = []
    project.instances.A.locked = true
    expect(() => apply(project, [{ type: 'data.set', instanceId: 'A', path: ['content'], value: { inlines: [{ type: 'text', text: 'editable' }] } }])).not.toThrow()
    expect(() => apply(project, [{ type: 'style.set', instanceId: 'A', path: ['color'], value: 'red' }])).toThrow('锁定')
  })
})
