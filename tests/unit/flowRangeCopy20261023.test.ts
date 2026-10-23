// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library/insert'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentDefinitionBuiltinKey, owningContainer, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { documentTextAt, documentTextRanges } from '../../src/shared/document/textInteraction'

const resources = { assets: {}, components: {} }
function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'ranges', revision: 0, title: 'Ranges', rootIds: ['flow'], entry: { rootInstanceId: 'flow' },
    assets: {}, global: { underlay: [], overlay: [] },
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      noteDefinition: { id: 'noteDefinition', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } },
    }, instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['A', 'B', 'note'], container: { kind: 'flow' } },
      A: { id: 'A', definitionId: 'text', data: { content: { inlines: [{ type: 'text', text: '前半段', rangeIds: ['R'] }] } } },
      B: { id: 'B', definitionId: 'text', data: { content: { inlines: [{ type: 'text', text: '后半段', rangeIds: ['R'] }] } } },
      note: { id: 'note', definitionId: 'noteDefinition', data: { label: '注释', content: '同一条注释' }, attachments: ['A', 'B'].map(instanceId =>
        ({ instanceId: 'note', target: { kind: 'text-range', instanceId, dataPath: ['content'], rangeId: 'R' } })) },
    } }
}

function expectCopiedAnnotation(project: CourseProjectV10, ids: ReadonlyMap<string, string>, targets: readonly string[], ownerId: string) {
  const noteId = ids.get('note')!
  expect(noteId).toBeDefined()
  const note = project.instances[noteId]
  expect(note.data).toEqual({ label: '注释', content: '同一条注释' })
  expect(note.attachments).toHaveLength(targets.length)
  const ranges = new Set<string>()
  for (const [index, attachment] of note.attachments!.entries()) {
    expect(attachment.instanceId).toBe(noteId)
    expect(attachment.target).toMatchObject({ kind: 'text-range', instanceId: ids.get(targets[index]), dataPath: ['content'] })
    if (attachment.target.kind !== 'text-range') throw new Error('Expected text range')
    const content = documentTextAt(project.instances[attachment.target.instanceId].data, attachment.target.dataPath)!
    expect(documentTextRanges(content).has(attachment.target.rangeId)).toBe(true)
    expect(attachment.target.rangeId).not.toBe('R')
    ranges.add(attachment.target.rangeId)
  }
  expect(ranges.size).toBe(1)
  expect(owningContainer(project, noteId)).toMatchObject({ instanceId: ownerId })
}

describe('copying text with a Flow-owned shared range annotation', () => {
  it.each([
    { name: 'one side', roots: ['A'], targets: ['A'] },
    { name: 'both sides', roots: ['A', 'B'], targets: ['A', 'B'] },
    { name: 'the whole Flow', roots: ['flow'], targets: ['A', 'B'] },
  ])('copies $name through the library and same-document clipboard', ({ roots, targets }) => {
    const project = fixture(), before = structuredClone(project)
    const extracted = extractComponentLibraryEntry(project, resources, { id: 'entry', title: '范围片段', rootIds: roots })
    const whole = roots.includes('flow')
    expect(Object.keys(extracted.entry.example.instances).sort()).toEqual([...targets, 'note', ...(whole ? ['flow'] : [])].sort())
    expect(extracted.entry.example.instances.note.attachments?.map(attachment => attachment.target)).toEqual(targets.map(instanceId =>
      ({ kind: 'text-range', instanceId, dataPath: ['content'], rangeId: 'R' })))
    expect(extracted.diagnostics.some(item => item.code === 'target-binding-required')).toBe(false)

    const insertion = prepareComponentLibraryInsertion(project, extracted.entry, {
      container: whole ? { kind: 'project' } : { kind: 'instance', instanceId: 'flow' }, index: whole ? 1 : 3,
    })
    const inserted = applyComponentOperation(project, insertion.command)
    expectCopiedAnnotation(inserted, insertion.identities.instances, targets, whole ? insertion.identities.instances.get('flow')! : 'flow')

    const plan = prepareCourseObjectPaste({ documentId: 'doc', project, resources, roots }, {
      capturedTarget: { documentId: 'doc', project, resources, surfaceId: 'flow' },
      container: whole ? { kind: 'project' } : { kind: 'instance', instanceId: 'flow' }, index: whole ? 1 : 3,
    })
    expect([...plan.idMap.keys()].sort()).toEqual(Object.keys(extracted.entry.example.instances).sort())
    const copied = applyComponentOperation(project, captureComponentOperation(project, plan.edits, plan.readPaths))
    expectCopiedAnnotation(copied, plan.idMap, targets, whole ? plan.idMap.get('flow')! : 'flow')
    expect(Object.values(copied.instances).filter(instance => instance.id !== 'note'
      && componentDefinitionBuiltinKey(copied.definitions[instance.definitionId]) === 'guoling.popover')).toHaveLength(1)
    for (const id of ['A', 'B', 'note']) expect(copied.instances[id]).toEqual(before.instances[id])
    expect(project).toEqual(before)
  })

  it('discovers only actual selected ranges on popover behaviors', () => {
    const project = fixture()
    project.definitions.other = { id: 'other', role: 'behavior', implementation: { kind: 'builtin', key: 'fixture.behavior' } }
    project.instances.other = { id: 'other', definitionId: 'other', data: {}, attachments: [
      { instanceId: 'other', target: { kind: 'text-range', instanceId: 'A', dataPath: ['content'], rangeId: 'R' } }] }
    project.instances.stale = { ...structuredClone(project.instances.note), id: 'stale', attachments: [
      { instanceId: 'stale', target: { kind: 'text-range', instanceId: 'A', dataPath: ['content'], rangeId: 'missing' } }] }
    project.instances.flow.childIds!.push('other', 'stale')
    const extracted = extractComponentLibraryEntry(project, resources, { id: 'entry', title: '正文', rootIds: ['A'] })
    expect(Object.keys(extracted.entry.example.instances).sort()).toEqual(['A', 'note'])
  })

  it('keeps a copied annotation under the Flow when text leaves its reading group', () => {
    const project = fixture()
    project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
    project.instances.group = { id: 'group', definitionId: 'group', data: {}, style: { display: 'grid' }, childIds: [] }
    project.instances.flow.childIds!.push('group')
    const extracted = extractComponentLibraryEntry(project, resources, { id: 'entry', title: '正文', rootIds: ['A'] })
    const insertion = prepareComponentLibraryInsertion(project, extracted.entry, { container: { kind: 'instance', instanceId: 'group' }, index: 0 })
    const inserted = applyComponentOperation(project, insertion.command)
    expectCopiedAnnotation(inserted, insertion.identities.instances, ['A'], 'flow')
    const bodyId = insertion.identities.instances.get('A')!
    expect(owningContainer(inserted, bodyId)).toMatchObject({ instanceId: 'group' })
    const moved = applyComponentOperation(inserted, captureComponentOperation(inserted, [
      { type: 'instance.move', instanceId: bodyId, container: { kind: 'instance', instanceId: 'flow' }, index: 0 },
      { type: 'instance.remove', instanceId: 'group' },
    ]))
    expectCopiedAnnotation(moved, insertion.identities.instances, ['A'], 'flow')
    expect(moved.instances.group).toBeUndefined()
  })

  it('keeps the inline object as one copied child while detaching only valid selected bindings', () => {
    const project = fixture()
    project.definitions.atom = { id: 'atom', role: 'content', implementation: { kind: 'builtin', key: 'fixture.inline' } }
    project.instances.atom = { id: 'atom', definitionId: 'atom', data: { label: '内联对象' } }
    project.instances.A.childIds = ['atom']
    project.instances.A.data = { content: { inlines: [
      { type: 'text', text: '前半段', rangeIds: ['R'] },
      { type: 'component', instanceId: 'atom', accessibleText: '内联对象', rangeIds: ['R'] },
    ] } }
    project.instances.note.attachments!.push({ instanceId: 'note', target: {
      kind: 'text-range', instanceId: 'A', dataPath: ['content'], rangeId: 'missing',
    } })
    const before = structuredClone(project)
    const extracted = extractComponentLibraryEntry(project, resources, { id: 'entry', title: '含内联对象的范围', rootIds: ['A'] })
    expect(Object.keys(extracted.entry.example.instances).sort()).toEqual(['A', 'atom', 'note'])
    expect(extracted.entry.example.instances.note.attachments).toEqual([before.instances.note.attachments![0]])
    const insertion = prepareComponentLibraryInsertion(project, extracted.entry, { container: { kind: 'instance', instanceId: 'flow' }, index: 3 })
    const inserted = applyComponentOperation(project, insertion.command)
    const plan = prepareCourseObjectPaste({ documentId: 'doc', project, resources, roots: ['A'] }, {
      capturedTarget: { documentId: 'doc', project, resources, surfaceId: 'flow' },
      container: { kind: 'instance', instanceId: 'flow' }, index: 3,
    })
    const copied = applyComponentOperation(project, captureComponentOperation(project, plan.edits, plan.readPaths))
    for (const [result, identities] of [[inserted, insertion.identities.instances], [copied, plan.idMap]] as const) {
      expectCopiedAnnotation(result, identities, ['A'], 'flow')
      const body = result.instances[identities.get('A')!], atomId = identities.get('atom')!
      const content = documentTextAt(body.data, ['content'])!
      expect(content.inlines.filter(inline => inline.type === 'component')).toEqual([
        expect.objectContaining({ type: 'component', instanceId: atomId }),
      ])
      expect(body.childIds).toEqual([atomId])
      expect(owningContainer(result, atomId)).toMatchObject({ instanceId: body.id })
      expect(Object.values(result.instances).filter(instance => instance.definitionId === 'atom')).toHaveLength(2)
    }
    expect(project).toEqual(before)
  })
})
