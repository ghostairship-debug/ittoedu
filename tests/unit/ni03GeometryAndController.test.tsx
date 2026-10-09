import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseGeometryEdits } from '../../src/core/course/courseGeometryEdits'
import { flowPlacementEdits } from '../../src/core/course/courseFlowEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { TEACHER_CONTROLLER_DEFINITION } from '../../src/components/teacher-controller/data'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ElementsTab } from '../../src/renderer/ui/ElementsTab'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { MultiSelectionPropertiesPanel } from '../../src/renderer/ui/properties/MultiSelectionPropertiesPanel'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ComponentEdit, CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('expected course')
  return snapshot.model.project
}
function fixture() {
  const project = createBlankCourseProjectV10('世界几何与控制器')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['a', 'b', 'c', 'locked'],
    frame: { width: 400, height: 300, transform: [0, 2, -2, 0, 100, 200] } }
  for (const [id, x, y, width, height] of [['a', 10, 20, 40, 20], ['b', 100, 60, 60, 30], ['c', 160, 30, 80, 40], ['locked', 220, 30, 60, 30]] as const) {
    project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(id))),
      ...(id === 'locked' ? { locked: true } : {}), frame: { width, height, transform: [1, 0, 0, 1, x, y] } }
  }
  project.surfaces[0].childIds = ['group']
  return project
}
function GeometryPanel() {
  const context = usePropertiesAuthoringBinding({ onReplaceImage() {} })
  if (context.kind !== 'multi-selection') throw new Error('expected original multi-selection owner')
  return <MultiSelectionPropertiesPanel context={context} />
}
async function harness(root: string, project: CourseProjectV10) {
  const host = new DocumentHostService(path.join(root, 'host'))
  const opened = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'geometry.h5lesson')
  const outside = async (): Promise<never> => { throw new Error('Outside geometry/controller fixture') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => opened, subscribe: host.subscribeEvents.bind(host),
    saveWithDialog: outside, closeWithDialog: outside, close: outside, discardRecovery: outside }
  await useEditorStore.getState().connectCourseDocuments(api)
  act(() => useEditorStore.getState().setEditingScope('scene'))
  return { host, opened }
}
async function savedAndUndone(root: string, host: DocumentHostService, documentId: string, project: CourseProjectV10) {
  const changed = await host.internalAPI.read(documentId), filename = path.join(root, 'saved.h5lesson')
  await host.internalAPI.save(documentId, filename)
  expect(course(await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename))).toEqual(course(changed))
  await act(async () => { await useEditorStore.getState().courseBridge.undo(documentId) })
  const undone = await host.internalAPI.read(documentId)
  expect(undone.undoDepth).toBe(0)
  expect(course(undone).instances).toEqual(project.instances)
  expect(course(undone).global).toEqual(project.global)
}

it('keeps the active affine calculation, roots and locks, preserves same-space Flow planes and diagnoses unmeasured carriers', () => {
  const project = fixture(), ids = ['a', 'b', 'c', 'locked']
  const aligned = apply(project, courseGeometryEdits(project, ids, { kind: 'align', alignment: 'left' }))
  expect(aligned.instances.a.frame!.transform).toEqual([1, 0, 0, 1, 10, 70])
  expect(aligned.instances.b.frame).toEqual(project.instances.b.frame)
  expect(aligned.instances.c.frame!.transform).toEqual([1, 0, 0, 1, 160, 50])
  expect(aligned.instances.group).toEqual(project.instances.group)
  expect(aligned.instances.locked).toEqual(project.instances.locked)
  const distributed = apply(project, courseGeometryEdits(project, ids, { kind: 'distribute', axis: 'vertical' }))
  expect(distributed.instances.b.frame!.transform).toEqual([1, 0, 0, 1, 75, 60])
  expect(distributed.instances.a).toEqual(project.instances.a)
  expect(distributed.instances.c).toEqual(project.instances.c)
  expect(distributed.instances.locked).toEqual(project.instances.locked)
  expect(() => courseGeometryEdits(project, ['group', 'a'], { kind: 'align', alignment: 'left' })).toThrow('至少需要')
  project.instances.remote = { ...structuredClone(project.instances.a), id: 'remote' }
  project.surfaces.push({ id: 'remote-surface', kind: 'slide', title: '别页', childIds: ['remote'] })
  expect(() => courseGeometryEdits(project, ['a', 'remote'], { kind: 'align', alignment: 'left' })).toThrow('不同归属')
  project.surfaces[0].kind = 'flow'
  project.surfaces[0].childIds = ['a', 'b', 'c', 'locked']
  delete project.instances.group
  project.instances.a.flowPlacement = { space: 'paper', plane: 'overlay' }
  project.instances.b.flowPlacement = { space: 'viewport', plane: 'overlay' }
  expect(() => courseGeometryEdits(project, ['a', 'b'], { kind: 'align', alignment: 'left' })).toThrow('同一定位空间')
  project.instances.b.flowPlacement = { space: 'paper', plane: 'underlay' }
  expect(courseGeometryEdits(project, ['a', 'b'], { kind: 'align', alignment: 'left' }))
    .toMatchObject([{ type: 'frame.set', instanceId: 'b', frame: { transform: [1, 0, 0, 1, 10, 60] } }])
  project.instances.b.flowPlacement.paragraphAnchor = { blockId: 'c', offsetY: 0, xRatio: .5 }
  expect(() => courseGeometryEdits(project, ['a', 'b'], { kind: 'align', alignment: 'left' })).toThrow('当前正文排版位置')
  delete project.instances.b.flowPlacement
  expect(() => courseGeometryEdits(project, ['a', 'b'], { kind: 'align', alignment: 'left' })).toThrow('正文保持阅读布局')
  const input = { kind: 'overlay' as const, surfaceId: project.surfaces[0].id,
    placement: { space: 'paper' as const, plane: 'overlay' as const, paragraphAnchor: { blockId: 'observed-anchor', offsetY: 14, xRatio: .25 } } }
  const refs = new Map([['observed-anchor', { kind: 'instance' as const, instanceId: 'b' }]])
  const anchorEdit = flowPlacementEdits(project, 'a', input, refs).find(edit => edit.type === 'instance.flowPlacement.set')
  expect(anchorEdit).toMatchObject({ flowPlacement: { ...input.placement, paragraphAnchor: { blockId: 'b', offsetY: 14, xRatio: .25 } } })
  const canonical = flowPlacementEdits(project, 'a', { ...input, placement: { ...input.placement, paragraphAnchor: { blockId: 'b', offsetY: 14, xRatio: .25 } } })
  expect(canonical.find(edit => edit.type === 'instance.flowPlacement.set')).toEqual(anchorEdit)
})

it('uses the original multi-selection properties UI and one Session Undo with rotated parents and locked peers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni03-geometry-ui-'))
  try {
    const project = fixture(), { host, opened } = await harness(root, project)
    act(() => useEditorStore.getState().selectNodes(['a', 'b', 'c', 'locked']))
    render(<GeometryPanel />)
    fireEvent.click(screen.getByRole('button', { name: '垂直等距' }))
    await waitFor(async () => expect((await host.internalAPI.read(opened.documentId)).undoDepth).toBe(1))
    const changed = course(await host.internalAPI.read(opened.documentId))
    expect(changed.instances.b.frame!.transform).toEqual([1, 0, 0, 1, 75, 60])
    for (const id of ['a', 'c', 'group', 'locked']) expect(changed.instances[id]).toEqual(project.instances[id])
    await savedAndUndone(root, host, opened.documentId, project)
  } finally { cleanup(); useEditorStore.getState().courseBridge.dispose(); await fs.rm(root, { recursive: true, force: true }) }
})

it('aligns free children inside the same Flow floating container without requiring child placements', () => {
  const project = fixture()
  project.surfaces[0].kind = 'flow'
  project.instances.group.flowPlacement = { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'body', offsetY: 12, xRatio: .5 } }
  const aligned = apply(project, courseGeometryEdits(project, ['a', 'b', 'c'], { kind: 'align', alignment: 'left' }))
  expect(aligned.instances.a.frame!.transform).toEqual([1, 0, 0, 1, 10, 70])
  expect(aligned.instances.c.frame!.transform).toEqual([1, 0, 0, 1, 160, 50])
  expect(aligned.instances.group).toEqual(project.instances.group)
  delete project.instances.group.flowPlacement
  project.definitions.group.implementation = { kind: 'builtin', key: 'guoling.document-block' }
  expect(() => courseGeometryEdits(project, ['a', 'b'], { kind: 'align', alignment: 'left' })).toThrow('正文保持阅读布局')
})

it.each(['elements', 'slide-authoring'] as const)('uses %s controller defaults and reuses an existing instance without an extra history entry', async origin => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni03-controller-owner-'))
  try {
    const project = fixture()
    project.surfaces[0].designSize = { width: 1000, height: 600 }
    // The blank-course factory already includes a controller; exercise the original missing-controller repair path.
    for (const instance of Object.values(project.instances)) if (instance.definitionId === TEACHER_CONTROLLER_DEFINITION.id) {
      delete project.instances[instance.id]
      project.global.overlay = project.global.overlay.filter(id => id !== instance.id)
    }
    for (const id of ['global-a', 'global-b']) project.instances[id] = { ...structuredClone(project.instances.a), id }
    project.global.overlay = ['global-a', 'global-b']
    const { host, opened } = await harness(root, project)
    if (origin === 'elements') {
      act(() => useEditorStore.getState().setEditingScope('global'))
      act(() => useEditorStore.getState().selectNodes(['global-a']))
      render(<ElementsTab onAddImage={() => {}} />)
      fireEvent.click(screen.getByRole('tab', { name: '控制与全局' }))
      fireEvent.click(screen.getByTestId('add-teacher-controller'))
      await waitFor(async () => expect((await host.internalAPI.read(opened.documentId)).undoDepth).toBe(1))
    } else await act(async () => { await useEditorStore.getState().ensureTeacherController() })
    const changed = await host.internalAPI.read(opened.documentId), result = course(changed)
    const controller = Object.values(result.instances).find(instance => instance.definitionId === TEACHER_CONTROLLER_DEFINITION.id)!
    expect(controller.frame).toEqual(origin === 'elements'
      ? { width: 720, height: 80, transform: [1, 0, 0, 1, 20, 20] }
      : { width: 880, height: 64, transform: [1, 0, 0, 1, 60, 518] })
    expect(controller.data).toMatchObject({ hudReferenceSize: origin === 'elements' ? { width: 1280, height: 720 } : { width: 1000, height: 600 } })
    expect(result.global.overlay).toEqual(origin === 'elements' ? ['global-a', controller.id, 'global-b'] : ['global-a', 'global-b', controller.id])
    expect(changed.undoDepth).toBe(1)
    if (origin === 'elements') fireEvent.click(screen.getByTestId('add-teacher-controller'))
    else await act(async () => { await useEditorStore.getState().ensureTeacherController() })
    const reused = await host.internalAPI.read(opened.documentId)
    expect(reused.undoDepth).toBe(1)
    expect(course(reused).instances).toEqual(result.instances)
    await savedAndUndone(root, host, opened.documentId, project)
  } finally { cleanup(); useEditorStore.getState().courseBridge.dispose(); await fs.rm(root, { recursive: true, force: true }) }
})
