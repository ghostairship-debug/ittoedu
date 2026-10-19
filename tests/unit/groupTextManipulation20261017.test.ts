import { expect, it } from 'vitest'
import { createTextComponentData } from '../../src/components/text'
import { defaultShapeData } from '../../src/components/shape'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createSlideWorkspaceAuthoringController } from '../../src/renderer/ui/workspaceSlideAuthoring'
import { freeSurfaceTargets, hitFreeObject } from '../../src/renderer/componentPlatform/surfaces/slide/targets'

// Geometry from the frozen six-page authoring result, page 2's rain-volume card.
function fixture(): CourseProjectV10 {
  return {
    schemaVersion: 10, id: 'group-text', revision: 0, title: '雨水的两条去路',
    definitions: {
      group: { id: 'group', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.group' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      shape: { id: 'shape', role: 'content', implementation: { kind: 'builtin', key: 'guoling.shape' } },
    },
    instances: {
      card: { id: 'card', definitionId: 'group', data: {}, childIds: ['background', 'text', 'note'],
        frame: { width: 355, height: 210, transform: [1, 0, 0, 1, 52, 201] } },
      background: { id: 'background', definitionId: 'shape', data: defaultShapeData('rounded-rectangle'),
        frame: { width: 355, height: 210, transform: [1, 0, 0, 1, 0, 0] } },
      text: { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('P × 100 升'))),
        frame: { width: 307, height: 39.5, transform: [1, 0, 0, 1, 24, 73.5] } },
      note: { id: 'note', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('一平方米屋顶的雨水'))),
        frame: { width: 307, height: 22, transform: [1, 0, 0, 1, 24, 140] } },
    },
    surfaces: [{ id: 'slide', kind: 'slide', title: '雨水的两条去路', childIds: ['card'], designSize: { width: 1280, height: 720 } }],
    global: { underlay: [], overlay: [] }, assets: {},
  }
}
const identity = [1, 0, 0, 1, 0, 0] as const

it('ordinary text hit drags and resizes only the child through Session, retaining the card, siblings, history and saved frame', async () => {
  const project = fixture(), host = await createCourseDocumentHost()
  await host.documents.createFrom!({ project, resources: { assets: {}, components: {} } })
  const kernel = createEditorStoreKernel({ bridge: host.bridge, commit() {} })
  const controller = createSlideWorkspaceAuthoringController({
    read: () => { const view = host.bridge.read(); return { project: view.editingProject!, surfaceId: view.surfaceId!,
      documentId: view.activeDocumentId!, activeStateId: view.activeStateId, selectedInstanceIds: view.selectedInstanceIds } },
    capture: () => kernel.captureTarget(), select: ids => kernel.selectInstances(ids),
    commit: (edits, target, group) => kernel.editCaptured(kernel.capture(edits, target), group),
    report: message => { throw new Error(message) },
  })
  try {
    controller.pointerDown({ x: 229.5, y: 294.25 }, identity)
    expect(host.bridge.read().selectedInstanceIds).toEqual(['text'])
    controller.pointerMove({ x: 260.5, y: 317.25, altKey: true }, identity)
    expect(host.read().undoDepth).toBe(0)
    await controller.pointerUp({ x: 260.5, y: 317.25, altKey: true }, identity)
    const dragged = kernel.readDocument()
    expect(dragged.instances.text.frame).toEqual({ width: 307, height: 39.5, transform: [1, 0, 0, 1, 55, 96.5] })
    expect(dragged.instances.card).toEqual(project.instances.card)
    expect(dragged.instances.background).toEqual(project.instances.background)
    expect(dragged.instances.note).toEqual(project.instances.note)
    expect(host.read().undoDepth).toBe(1)

    controller.pointerDown({ x: 414, y: 317.25 }, identity, 'e')
    await controller.pointerUp({ x: 474, y: 317.25 }, identity)
    const resized = kernel.readDocument()
    expect(resized.instances.text.frame).toEqual({ width: 367, height: 39.5, transform: [1, 0, 0, 1, 55, 96.5] })
    expect(resized.instances.text.data).toEqual(project.instances.text.data)
    expect(resized.instances.card).toEqual(project.instances.card)
    expect(resized.instances.background).toEqual(project.instances.background)
    expect(resized.instances.note).toEqual(project.instances.note)
    expect(host.read().undoDepth).toBe(2)
    const reopened = await host.driver.load(host.driver.serialize(host.read().model))
    expect(reopened.kind === 'course-v10' && reopened.project.instances).toEqual(resized.instances)
    await kernel.navigateHistory('undo')
    expect(kernel.readDocument().instances.text.frame).toEqual(dragged.instances.text.frame)
    await kernel.navigateHistory('undo')
    expect(kernel.readDocument().instances).toEqual(project.instances)
  } finally { host.dispose() }
})

it('card background still selects the group, explicit deep selection reaches its shape, and locked ancestry prevents the text gesture', async () => {
  const project = fixture(), targets = freeSurfaceTargets(project, 'slide')
  expect(hitFreeObject(targets, { x: 60, y: 210 })?.instanceId).toBe('card')
  expect(hitFreeObject(targets, { x: 60, y: 210 }, true)?.instanceId).toBe('background')
  expect(hitFreeObject(targets, { x: 229.5, y: 294.25 })?.instanceId).toBe('text')
  project.instances.card.locked = true
  const host = await createCourseDocumentHost()
  await host.documents.createFrom!({ project, resources: { assets: {}, components: {} } })
  const kernel = createEditorStoreKernel({ bridge: host.bridge, commit() {} })
  const controller = createSlideWorkspaceAuthoringController({
    read: () => { const view = host.bridge.read(); return { project: view.editingProject!, surfaceId: view.surfaceId!,
      documentId: view.activeDocumentId!, selectedInstanceIds: view.selectedInstanceIds } },
    capture: () => kernel.captureTarget(), select: ids => kernel.selectInstances(ids),
    commit: (edits, target, group) => kernel.editCaptured(kernel.capture(edits, target), group),
    report: message => { throw new Error(message) },
  })
  try {
    controller.pointerDown({ x: 229.5, y: 294.25 }, identity)
    await controller.pointerUp({ x: 260.5, y: 317.25 }, identity)
    expect(host.read().undoDepth).toBe(0)
    expect(kernel.readDocument().instances).toEqual(project.instances)
  } finally { host.dispose() }
})
