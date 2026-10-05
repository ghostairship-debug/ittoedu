// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation, ComponentOperationConflict } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'

function sample() {
  const project = createBlankCourseProjectV10('批内对象')
  project.definitions.card = { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'test.card' } }
  project.instances.existing = { id: 'existing', definitionId: 'card', data: { text: '保留' } }
  project.surfaces[0].childIds = ['existing']
  return project
}

it('captures and applies inserted subtree edits, moves and removals atomically against absent original IDs', () => {
  const project = sample(), surfaceId = project.surfaces[0].id
  const edits: ComponentEdit[] = [
    { type: 'instance.insert', container: { kind: 'surface', surfaceId }, index: 1, rootIds: ['clone'], instances: [
      { id: 'clone', definitionId: 'card', data: {}, childIds: ['child', 'discard'] },
      { id: 'child', definitionId: 'card', data: { text: '克隆' } },
      { id: 'discard', definitionId: 'card', data: {} },
    ] },
    { type: 'data.set', instanceId: 'child', path: ['text'], value: '新内容' },
    { type: 'instance.move', instanceId: 'child', container: { kind: 'surface', surfaceId }, index: 0 },
    { type: 'instance.remove', instanceId: 'clone' },
  ]
  const command = captureComponentOperation(project, edits)
  expect(command.expected).toContainEqual({ path: ['instances', 'clone'], exists: false })
  expect(command.expected).toContainEqual({ path: ['@owner', 'child'], exists: false })
  const unrelated = structuredClone(project); unrelated.instances.existing.data = { text: '人工修改' }
  const result = applyComponentOperation(unrelated, command)
  expect(result.surfaces[0].childIds).toEqual(['child', 'existing'])
  expect(result.instances.child.data).toEqual({ text: '新内容' })
  expect(result.instances.existing.data).toEqual({ text: '人工修改' })
  expect(result.instances.clone).toBeUndefined(); expect(result.instances.discard).toBeUndefined()
  const occupied = structuredClone(project)
  occupied.instances.child = { id: 'child', definitionId: 'card', data: {} }; occupied.surfaces[0].childIds.push('child')
  expect(() => applyComponentOperation(occupied, command)).toThrow(ComponentOperationConflict)
})

it('captures the existing subtree moved under a new parent before deleting that parent', () => {
  const project = sample(), surfaceId = project.surfaces[0].id
  const command = captureComponentOperation(project, [
    { type: 'instance.insert', container: { kind: 'surface', surfaceId }, index: 1, rootIds: ['group'],
      instances: [{ id: 'group', definitionId: 'card', data: {}, childIds: [] }] },
    { type: 'instance.move', instanceId: 'existing', container: { kind: 'instance', instanceId: 'group' }, index: 0 },
    { type: 'instance.remove', instanceId: 'group' },
  ])
  expect(applyComponentOperation(project, command).surfaces[0].childIds).toEqual([])
  const changed = structuredClone(project); changed.instances.existing.data = { text: '不可丢失' }
  expect(() => applyComponentOperation(changed, command)).toThrow(ComponentOperationConflict)
})
