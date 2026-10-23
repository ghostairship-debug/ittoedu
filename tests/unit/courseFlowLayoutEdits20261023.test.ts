import { expect, it } from 'vitest'
import { prepareCourseFlowColumns } from '../../src/core/course/courseFlowLayoutEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData } from '../../src/components/text/data'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { documentColumnSelection } from '../../src/renderer/document/documentBlockCommands'
import { flowDocumentInsertionAt } from '../../src/renderer/ui/flow/flowParagraphLayout'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'columns', revision: 0, title: 'Reading', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
    definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } }, text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: ['a', 'b', 'c'] },
      a: { id: 'a', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('A'))), frame: { width: 400, height: 40, transform: [1, 0, 0, 1, 10, 20] }, style: { color: '#123456' } },
      b: { id: 'b', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('B'))) },
      c: { id: 'c', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('C'))) } } }
}
let sequence = 0
const id = () => `layout-${++sequence}`
const apply = (project: CourseProjectV10, input: Parameters<typeof prepareCourseFlowColumns>[1]) => {
  const prepared = prepareCourseFlowColumns(project, input, id)
  return { prepared, next: applyComponentOperation(project, captureComponentOperation(project, prepared.edits)) }
}

it('creates ordinary columns with software identities in one transaction and preserves manual text geometry/style', () => {
  const project = fixture(), { prepared, next } = apply(project, { surfaceId: 'flow', instanceIds: ['b', 'a'] })
  expect(next.instances.flow.childIds).toEqual([prepared.groupId, 'c'])
  expect(next.instances[prepared.groupId].childIds).toEqual(prepared.columnIds)
  expect(next.instances[prepared.columnIds[0]].childIds).toEqual(['a'])
  expect(next.instances[prepared.columnIds[1]].childIds).toEqual(['b'])
  expect(next.instances.a).toEqual(project.instances.a)
  expect(next.instances.c).toEqual(project.instances.c)
  expect(projectFlowDocument(next, 'flow').content.blocks[0]).toMatchObject({ blocks: [{ blocks: [{ id: 'a' }] }, { blocks: [{ id: 'b' }] }] })
})

it('keeps longer selected content together by default and accepts explicit AI membership and ratios', () => {
  const project = fixture(), { prepared, next } = apply(project, { surfaceId: 'flow', instanceIds: ['c', 'a', 'b'] })
  expect(next.instances[prepared.columnIds[0]].childIds).toEqual(['a', 'b', 'c'])
  expect(next.instances[prepared.columnIds[1]].childIds).toHaveLength(1)
  const explicit = apply(project, { surfaceId: 'flow', instanceIds: ['a', 'b', 'c'], columns: [['c', 'a'], ['b']], ratios: [2, 1], gap: 18 })
  expect(explicit.next.instances[explicit.prepared.columnIds[0]].childIds).toEqual(['c', 'a'])
  expect(explicit.next.instances[explicit.prepared.groupId].style).toMatchObject({ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 })
  expect(() => prepareCourseFlowColumns(project, { surfaceId: 'flow', instanceIds: ['a', 'b'], columns: [['a'], ['a']] }, id)).toThrow(/只能分配/)
})

it('uses formal sibling order for the nearby selected-paragraph action and inserts media into the same short column', () => {
  const project = fixture(), { prepared, next } = apply(project, { surfaceId: 'flow', instanceIds: ['a', 'b'] })
  const content = projectFlowDocument(project, 'flow').content
  expect(documentColumnSelection(content, { kind: 'text', revision: '0', anchor: { blockId: 'b', slot: { kind: 'field', field: 'content' }, offset: 1, affinity: 'after' }, head: { blockId: 'a', slot: { kind: 'field', field: 'content' }, offset: 0, affinity: 'after' } })).toEqual(['a', 'b'])
  const paper = document.createElement('div')
  const [leftId, rightId] = prepared.columnIds
  for (const [blockId, left, top, width, height] of [[prepared.groupId, 0, 0, 500, 300], [leftId, 0, 0, 238, 300], [rightId, 262, 0, 238, 30], ['a', 0, 0, 238, 30], ['b', 262, 0, 238, 30]] as const) {
    const element = document.createElement('div'); element.dataset.flowBlockId = blockId
    element.getBoundingClientRect = () => ({ left, right: left + width, top, bottom: top + height, width, height } as DOMRect)
    paper.append(element)
  }
  expect(flowDocumentInsertionAt(paper, next, 'flow', { x: 400, y: 200 })).toEqual({ container: { kind: 'instance', instanceId: rightId }, index: 1, afterBlockId: 'b' })
})
