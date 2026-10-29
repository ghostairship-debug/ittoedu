import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextData } from '../../src/components/text'
import type { ComponentFrame, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { capturedCourseViewIsCurrent } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { editingLevelInstanceId, groupEditingPath } from '../../src/renderer/documents/containerEditingContext'
import { freeSurfaceTargets, freeTargetAtEditingLevel, hitFreeObject, marqueeFreeTargets } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import { createSlideWorkspaceAuthoringController, listSlideWorkspaceHitTargets } from '../../src/renderer/ui/workspaceSlideAuthoring'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

const identity = [1, 0, 0, 1, 0, 0] as const
const frame = (x: number, y: number, width = 100, height = 80): ComponentFrame => ({ width, height, transform: [1, 0, 0, 1, x, y] })
function fixture(): CourseProjectV10 {
  let index = 0
  const project = createBlankCourseProjectV10('Group selection', () => ['project', 'slide'][index++])
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.slide.childIds = ['outer', 'peer']
  project.instances.outer = { id: 'outer', definitionId: 'group', data: {}, childIds: ['inner', 'sibling', 'container'], frame: frame(40, 30, 500, 300) }
  project.instances.inner = { id: 'inner', definitionId: 'group', data: {}, childIds: ['text'], frame: frame(20, 20, 200, 120) }
  project.instances.text = { id: 'text', definitionId: 'text', data: {}, frame: frame(10, 10, 100, 40) }
  project.instances.sibling = { id: 'sibling', definitionId: 'text', data: {}, frame: frame(260, 20) }
  project.instances.peer = { id: 'peer', definitionId: 'text', data: {}, frame: frame(650, 30) }
  project.instances.container = { id: 'container', definitionId: 'guoling.container.slide', data: {}, childIds: [],
    frame: frame(20, 180), container: { kind: 'slide', designSize: { width: 400, height: 300 } } }
  project.instances.shared = { id: 'shared', definitionId: 'group', data: {}, childIds: ['sharedText'], frame: frame(900, 10, 200, 100) }
  project.instances.sharedText = { id: 'sharedText', definitionId: 'text', data: {}, frame: frame(10, 10) }
  project.global.overlay = ['shared']
  for (const instance of Object.values(project.instances)) if (instance.definitionId === 'text') instance.data = JSON.parse(JSON.stringify(createTextData(instance.id)))
  return project
}

function controllerFor(h: Awaited<ReturnType<typeof createV10StoreHost>>) {
  const report = vi.fn()
  const controller = createSlideWorkspaceAuthoringController({
    read: () => { const view = h.bridge.read(); return { project: view.editingProject!, surfaceId: view.surfaceId!,
      documentId: view.activeDocumentId!, activeStateId: view.activeStateId, activeGroupId: view.activeGroupId, selectedInstanceIds: view.selectedInstanceIds } },
    capture: () => h.bridge.captureOwnedTarget(), select: ids => h.bridge.selectInstances(h.first.documentId, ids),
    selectCanvas: (ids, groupId) => h.bridge.selectInstances(h.first.documentId, ids, undefined, groupId),
    commit: (edits, target, group) => h.bridge.editCaptured(h.bridge.capture(edits, target), group), report,
  })
  return { controller, report }
}

it('single-click selects and drags the whole group, and entering it changes only transient inspection', async () => {
  const source = fixture(), h = await createV10StoreHost(source), { controller } = controllerFor(h)
  try {
    controller.pointerDown({ x: 80, y: 70 }, identity)
    expect(h.bridge.read().selectedInstanceIds).toEqual(['outer'])
    await controller.pointerUp({ x: 100, y: 90, altKey: true }, identity)
    expect(h.model().project.instances.outer.frame!.transform).toEqual([1, 0, 0, 1, 60, 50])
    expect(h.model().project.instances.inner).toEqual(source.instances.inner)
    expect(h.model().project.instances.text).toEqual(source.instances.text)
    expect(h.first.read().undoDepth).toBe(1)
    await h.bridge.undo()
    const beforeEntry = h.bridge.read()
    h.bridge.enterGroup(h.first.documentId, 'outer')
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'outer', surfaceId: 'slide', editingContainerId: null, selectedInstanceIds: [] })
    expect(h.bridge.read().project).toBe(beforeEntry.project)
    expect(h.first.read().undoDepth).toBe(0)
    expect(h.operations).toHaveLength(2) // Only the completed drag and its undo reached the document owner.
    controller.pointerDown({ x: 80, y: 70 }, identity)
    expect(h.bridge.read().selectedInstanceIds).toEqual(['text'])
    await controller.pointerUp({ x: 80, y: 70 }, identity)
    controller.pointerDown({ x: 1200, y: 650 }, identity)
    await controller.pointerUp({ x: 1200, y: 650 }, identity)
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, selectedInstanceIds: [] })
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('legacy hierarchy queries stay explicit while canvas context selects a member and preserves full geometry and lock ancestry', async () => {
  const project = fixture(), targets = freeSurfaceTargets(project, 'slide')
  expect(hitFreeObject(targets, { x: 80, y: 70 })?.instanceId).toBe('outer')
  expect(freeTargetAtEditingLevel(targets, 'text', 'outer')?.instanceId).toBe('inner')
  expect(freeTargetAtEditingLevel(targets, 'text', 'inner')?.instanceId).toBe('text')
  expect(freeTargetAtEditingLevel(targets, 'peer', 'outer')).toBeNull()
  expect(marqueeFreeTargets(targets, { x: 40, y: 30 }, { x: 600, y: 400 }, 'outer')).toEqual(['inner', 'sibling', 'container'])
  expect(targets.find(target => target.instanceId === 'text')).toMatchObject({ ancestors: ['outer', 'inner'], parentToSurface: [1, 0, 0, 1, 60, 50] })
  project.instances.outer.locked = true
  const h = await createV10StoreHost(project), { controller } = controllerFor(h)
  try {
    h.bridge.enterGroup(h.first.documentId, 'outer')
    expect(controller.contextTarget({ x: 80, y: 70 }, identity)).toBe('text')
    controller.pointerDown({ x: 80, y: 70 }, identity)
    await controller.pointerUp({ x: 100, y: 90 }, identity)
    expect(h.first.read().undoDepth).toBe(0)
    expect(listSlideWorkspaceHitTargets({ project, surfaceId: 'slide', documentId: h.first.documentId, activeGroupId: 'outer', selectedInstanceIds: [] })
      .find(target => target.instanceId === 'text')?.ancestors).toEqual(['outer', 'inner'])
  } finally { h.bridge.dispose() }
})

it('nested and shared groups return one group at a time and ordinary selection or clearing retains the current scope', async () => {
  const h = await createV10StoreHost(fixture()), id = h.first.documentId
  try {
    h.bridge.enterGroup(id, 'outer'); h.bridge.enterGroup(id, 'inner')
    expect(groupEditingPath(h.model().project, 'slide', 'inner')).toEqual(['outer', 'inner'])
    h.bridge.selectInstances(id, ['text'], 'slide')
    h.bridge.selectInstances(id, [], 'slide')
    expect(h.bridge.read().activeGroupId).toBe('inner')
    h.bridge.leaveGroup(id)
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'outer', selectedInstanceIds: ['inner'] })
    h.bridge.leaveGroup(id)
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, selectedInstanceIds: ['outer'] })
    h.bridge.enterGroup(id, 'shared')
    h.bridge.selectInstances(id, ['sharedText'])
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'shared', rootInstanceId: 'slide', editingContainerId: null })
    h.bridge.leaveGroup(id)
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, selectedInstanceIds: ['shared'] })
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('entering a real container clears group scope and returning restores its ordinary parent group', async () => {
  const h = await createV10StoreHost(fixture()), id = h.first.documentId
  try {
    h.bridge.enterGroup(id, 'outer')
    h.bridge.enterContainer(id, 'container')
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, surfaceId: 'container', editingContainerId: 'container' })
    h.bridge.leaveContainer(id)
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'outer', surfaceId: 'slide', selectedInstanceIds: ['container'] })
    h.bridge.selectSurface(id, 'slide')
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, selectedInstanceIds: [] })
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('formal layer and field selections adopt the selected target parent group instead of retaining a stale scope', async () => {
  const h = await createV10StoreHost(fixture()), id = h.first.documentId
  try {
    h.bridge.enterGroup(id, 'outer')
    h.bridge.selectInstances(id, ['peer'])
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, selectedInstanceIds: ['peer'] })
    h.bridge.selectInstances(id, ['text'])
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'inner', selectedInstanceIds: ['text'] })
    h.bridge.selectInteraction(id, { kind: 'author-field', instanceId: 'sharedText', field: { kind: 'text', authorKey: 'label', initialValue: 'Label' } })
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'shared', selectedInstanceIds: ['sharedText'] })
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('leaving a shared real container restores its actual shared parent group independently of the work root', async () => {
  const project = fixture()
  project.instances.outer.childIds = ['inner', 'sibling']
  project.instances.shared.childIds!.push('container')
  const h = await createV10StoreHost(project), id = h.first.documentId
  try {
    h.bridge.enterGroup(id, 'shared'); h.bridge.enterContainer(id, 'container')
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, editingContainerId: 'container', editingPlane: 'overlay', rootInstanceId: 'slide' })
    h.bridge.leaveContainer(id)
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'shared', editingContainerId: null, rootInstanceId: 'slide', selectedInstanceIds: ['container'] })
    h.bridge.selectInstances(id, ['container'])
    expect(h.bridge.read().activeGroupId).toBe('shared')
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('group navigation invalidates captured view and pointer intent, including a pending marquee and drag', async () => {
  const h = await createV10StoreHost(fixture()), { controller, report } = controllerFor(h), id = h.first.documentId
  try {
    const captured = h.bridge.captureTarget(), hit = controller.captureHit({ x: 80, y: 70 }, identity)
    h.bridge.enterGroup(id, 'outer')
    expect(capturedCourseViewIsCurrent(h.bridge.read(), captured)).toBe(false)
    expect(h.bridge.captureTarget().activeGroupId).toBe('outer')
    controller.pointerDown({ x: 80, y: 70 }, identity, undefined, hit)
    expect(h.bridge.read().selectedInstanceIds).toEqual([])
    expect(report).toHaveBeenCalledTimes(1)
    controller.pointerDown({ x: 80, y: 70 }, identity)
    controller.pointerMove({ x: 100, y: 90 }, identity)
    h.bridge.enterGroup(id, 'inner')
    await controller.pointerUp({ x: 100, y: 90 }, identity)
    expect(h.first.read().undoDepth).toBe(0)
    controller.pointerDown({ x: 1200, y: 650 }, identity)
    h.bridge.leaveGroup(id)
    await controller.pointerUp({ x: 0, y: 0 }, identity)
    expect(h.bridge.read()).toMatchObject({ activeGroupId: 'outer', selectedInstanceIds: ['inner'] })
  } finally { h.bridge.dispose() }
})

it('reparenting an active group into another real container clears its stale scope and selection', async () => {
  const h = await createV10StoreHost(fixture()), id = h.first.documentId
  try {
    h.bridge.enterGroup(id, 'outer'); h.bridge.enterGroup(id, 'inner'); h.bridge.selectInstances(id, ['text'])
    await h.bridge.edit([{ type: 'instance.move', instanceId: 'inner', container: { kind: 'instance', instanceId: 'container' }, index: 0, frame: frame(0, -160, 200, 120) }])
    expect(h.bridge.read()).toMatchObject({ activeGroupId: null, surfaceId: 'slide', selectedInstanceIds: [] })
    expect(h.model().project.instances.container.childIds).toEqual(['inner'])
    expect(h.first.read().undoDepth).toBe(1)
  } finally { h.bridge.dispose() }
})

it('natural Flow reading groups keep their continuous-document owner', async () => {
  const project = fixture()
  project.definitions.flow = { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } }
  project.instances.slide.definitionId = 'flow'; project.instances.slide.container = { kind: 'flow' }
  delete project.instances.outer.frame; project.instances.outer.style = { display: 'grid' }
  const h = await createV10StoreHost(project)
  try {
    expect(() => h.bridge.enterGroup(h.first.documentId, 'outer')).toThrow('连续正文')
    expect(h.bridge.read().activeGroupId).toBeNull()
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('unframed groups remain selectable by author identity without borrowing child geometry', () => {
  const project = fixture()
  delete project.instances.outer.frame
  const targets = freeSurfaceTargets(project, 'slide')
  expect(editingLevelInstanceId(project, 'slide', 'text')).toBe('outer')
  expect(editingLevelInstanceId(project, 'slide', 'text', 'outer')).toBe('inner')
  expect(editingLevelInstanceId(project, 'slide', 'text', 'inner')).toBe('text')
  expect(freeTargetAtEditingLevel(targets, 'text')).toBeNull()
  expect(editingLevelInstanceId(project, 'container', 'text')).toBeNull()
})
