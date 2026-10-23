// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canonicalComponentFileEdits, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'

function fixture(): CourseProjectV10 {
  const text = (value: string, ranged: boolean): JsonValue => JSON.parse(JSON.stringify({ ...createTextComponentData(value), content: { inlines: [{ type: 'text', text: value, ...(ranged ? { rangeIds: ['R'] } : {}) }] } }))
  return { schemaVersion: 11, id: 'source-ranges', revision: 0, title: 'Source ranges', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
    definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      note: { id: 'note', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['A', 'tail'], container: { kind: 'flow' } },
      A: { id: 'A', definitionId: 'text', data: text('abcd', true), childIds: ['note'] }, tail: { id: 'tail', definitionId: 'text', data: text('Neighbor', false) },
      note: { id: 'note', definitionId: 'note', data: { label: 'Note', content: 'Preserved while its range exists' }, attachments: [{ instanceId: 'note', target: { kind: 'text-range', instanceId: 'A', dataPath: ['content'], rangeId: 'R' } }] } } }
}
const resources = { assets: {}, components: {} }
function body(project: CourseProjectV10, format: 'markdown' | 'html') {
  const file = componentProjectFiles(project, resources).find(file => file.binding?.kind === 'flow' && file.binding.format === format)
  if (!file) throw new Error(`Missing ${format} body`)
  return file
}
function snapshot(project: CourseProjectV10): ComponentProjectSnapshot {
  return { documentId: 'doc', epoch: 'epoch', revision: 0, model: { kind: 'course-v10', project, resources } } as ComponentProjectSnapshot
}
describe.each(['markdown', 'html'] as const)('public Flow %s range intent', format => {
  it('removes a range explicitly omitted from source even when its text is unchanged', () => {
    const before = fixture(), desired = structuredClone(before)
    const data = textComponentDataSchema.parse(desired.instances.A.data)
    desired.instances.A.data = JSON.parse(JSON.stringify({ ...data, content: { inlines: [{ type: 'text', text: 'abcd' }] } }))
    const file = body(before, format), source = body(desired, format).content!
    const edits = canonicalComponentFileEdits(snapshot(before), file, source)
    const after = applyComponentOperation(before, captureComponentOperation(before, edits))
    expect(textComponentDataSchema.parse(after.instances.A.data).content).toEqual({ inlines: [{ type: 'text', text: 'abcd' }] })
    expect(after.instances.note).toBeUndefined()
    expect(after.instances.tail).toEqual(before.instances.tail)
    expect(before.instances.note.attachments?.[0].target).toMatchObject({ rangeId: 'R' })
  })
  it('retains the original range and note when the public source still declares them', () => {
    const before = fixture(), file = body(before, format)
    const edits = canonicalComponentFileEdits(snapshot(before), file, file.content!)
    const after = applyComponentOperation(before, captureComponentOperation(before, edits))
    expect(after.instances.A).toEqual(before.instances.A)
    expect(after.instances.note).toEqual(before.instances.note)
    expect(after.instances.tail).toEqual(before.instances.tail)
  })
})
