import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { createTextComponentData } from '../../src/components/text/data'
import { flowDocumentInsertionAt, flowFloatingModeEdits, flowReadingMembers, flowReadingMove } from '../../src/renderer/ui/flow/flowParagraphLayout'
import { resolveFlowMenuInsertionOptions, FLOW_DOCUMENT_INSERT_COMMANDS } from '../../src/renderer/ui/flow/flowInsertCommands'
import { flowParagraphAnchoredFrame } from '../../src/shared/flowParagraphAnchors'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import type { CapturedFlowMenuTarget } from '../../src/renderer/ui/flow/flowInsertCommands'

function lesson() {
  const project = createBlankCourseProjectV10('长章节')
  project.definitions = { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [DOCUMENT_BLOCK_DEFINITION.id]: DOCUMENT_BLOCK_DEFINITION,
    behavior: { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interaction' } } }
  const text = (id: string) => ({ id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(id))) })
  project.instances = { a: text('a'), b: text('b'), c: text('c'), d: text('d'),
    float: { ...text('float'), flowPlacement: { space: 'paper', plane: 'overlay' }, frame: { width: 100, height: 40, transform: [1, 0, 0, 1, 50, 140] } },
    behavior: { id: 'behavior', definitionId: 'behavior', data: {} },
    section: { id: 'section', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: documentBlockData({ id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [] }), childIds: ['c', 'd'] } }
  project.surfaces = [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['a', 'float', 'behavior', 'b', 'section'] }]
  project.global = { underlay: [], overlay: [] }
  return project
}

it('moves between reading neighbors across floating and behavior roots and keeps a serialized formal result', () => {
  const original = lesson(), container = { kind: 'surface' as const, surfaceId: 'flow' }
  expect(flowReadingMembers(original, container)).toEqual(['a', 'b', 'section'])
  const next = applyComponentOperation(original, captureComponentOperation(original, flowReadingMove(original, 'a', 'down')))
  expect(flowReadingMembers(next, container)).toEqual(['b', 'a', 'section'])
  expect(next.instances.float).toEqual(original.instances.float)
  expect(next.instances.behavior).toEqual(original.instances.behavior)
  const restored = applyComponentOperation(next, captureComponentOperation(next, flowReadingMove(next, 'a', 'up')))
  expect(flowReadingMembers(restored, container)).toEqual(['a', 'b', 'section'])
  const driver = new CourseV10Driver(), model = { kind: 'course-v10' as const, project: next, resources: { assets: {}, components: {} } }
  expect(driver.load(driver.serialize(model))).toEqual(model)
})

it('captures a section drop and menu insertion in the real container instead of the old top-level selection', () => {
  const project = lesson(), paper = document.createElement('article')
  paper.innerHTML = '<div data-flow-block-id="a"></div><div data-flow-block-id="section"><div data-flow-block-id="c"></div><div data-flow-block-id="d"></div></div>'
  const rect = (id: string, y: number, height: number) => { paper.querySelector<HTMLElement>(`[data-flow-block-id="${id}"]`)!.getBoundingClientRect = () => new DOMRect(20, y, 600, height) }
  rect('a', 0, 30); rect('section', 100, 1000); rect('c', 150, 50); rect('d', 300, 50)
  expect(flowDocumentInsertionAt(paper, project, 'flow', { x: 30, y: 155 })).toEqual({ container: { kind: 'instance', instanceId: 'section' }, index: 0, afterBlockId: null })
  expect(flowDocumentInsertionAt(paper, project, 'flow', { x: 30, y: 280 })).toEqual({ container: { kind: 'instance', instanceId: 'section' }, index: 1, afterBlockId: 'c' })
  const target: CapturedFlowMenuTarget = { project, editingProject: project, documentId: 'document', epoch: 'epoch', surfaceId: 'flow', activeStateId: null, resources: { assets: {}, components: {} }, instanceId: 'a', instanceIds: ['a'],
    flowMenuPage: { ok: true, documentId: 'document', projectId: project.id, revision: 0, locationId: 'flow', surfaceId: 'flow', generation: 1, selectedBlockId: 'c', selectionSignature: '', paperWidth: 800, bodyWidth: 728,
      paragraphRects: [{ blockId: 'c', depth: 1, x: 36, y: 150, width: 728, height: 50 }] } }
  expect(resolveFlowMenuInsertionOptions(target, { destination: 'document', kind: 'table', label: '表格' })).toMatchObject({ container: { kind: 'instance', instanceId: 'section' }, index: 1 })
  expect(resolveFlowMenuInsertionOptions(target, { destination: 'paper', kind: 'shape', label: '形状' })).toMatchObject({ x: 36, y: 216 })
  expect(FLOW_DOCUMENT_INSERT_COMMANDS.map(value => value.kind)).toEqual(expect.arrayContaining(['paragraph', 'quote', 'code', 'table', 'section']))
})

it('keeps the displayed position when switching fixed, paragraph and viewport modes and clears stale anchors', () => {
  const project = lesson(), instance = project.instances.float
  const rects = [{ blockId: 'a', depth: 0, x: 36, y: 100, width: 728, height: 30 }]
  const apply = (edits: ReturnType<typeof flowFloatingModeEdits>) => applyComponentOperation(project, captureComponentOperation(project, edits)).instances.float
  const anchored = apply(flowFloatingModeEdits('float', instance.frame!, instance.flowPlacement!, 'paragraph', 800, rects, { x: 80, y: -900 }))
  expect(anchored.flowPlacement!.paragraphAnchor).toEqual({ blockId: 'a', offsetY: 40, xRatio: 50 / 800 })
  const shown = flowParagraphAnchoredFrame(anchored.flowPlacement!.paragraphAnchor!, { x: 50, y: 140, width: 100, height: 40 }, 800, [{ ...rects[0], y: 200 }])!
  const displayed = { ...anchored.frame!, transform: [1, 0, 0, 1, shown.x, shown.y] as [number, number, number, number, number, number] }
  const fixed = apply(flowFloatingModeEdits('float', displayed, anchored.flowPlacement!, 'fixed', 800, rects, { x: 80, y: -900 }))
  expect(fixed.frame!.transform).toEqual([1, 0, 0, 1, 50, 240]); expect(fixed.flowPlacement).toEqual({ space: 'paper', plane: 'overlay' })
  const viewport = apply(flowFloatingModeEdits('float', fixed.frame!, fixed.flowPlacement!, 'viewport', 800, rects, { x: 80, y: -900 }))
  expect(viewport.frame!.transform).toEqual([1, 0, 0, 1, 130, -660]); expect(viewport.flowPlacement).toEqual({ space: 'viewport', plane: 'overlay' })
  const paper = apply(flowFloatingModeEdits('float', viewport.frame!, viewport.flowPlacement!, 'fixed', 800, rects, { x: 80, y: -900 }))
  expect(paper.frame).toEqual(fixed.frame)
})
