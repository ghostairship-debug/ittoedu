import { setRootContainers } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { commitCourseLogicAuthoringCommand } from '../../src/renderer/course/courseLogicAuthoringCommands'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

it('deletes the final only-source guard in the same Session transaction and restores its exact restriction through Undo and cold open', async () => {
  const project = createBlankCourseProjectV10('guard deletion')
  setRootContainers(project, ['source', 'other', 'target'].map(id => ({ id, title: id, kind: 'slide', childIds: [] })))
  project.logic = { courseState: [{ key: 'blocked', valueType: 'boolean', defaultValue: true }], navigationGuards: [
    { id: 'only', effect: 'block', fromSurfaceIds: ['source'], toSurfaceIds: ['target'], match: 'all', conditions: [{ type: 'compare', key: 'blocked', operator: 'eq', value: true }], message: 'source only' },
  ] }
  const originalGuard = structuredClone(project.logic.navigationGuards[0]), h = await createV10StoreHost(project)
  let active = 'other'
  const navigation = new ComponentNavigationOwner({ project: () => h.model().project, surfaceId: () => active,
    select: id => { active = id }, courseState: { get: () => true as never } })
  const blocked = (from: string) => { active = from; return !navigation.canExecute({ type: 'scene.go', sceneId: 'target' }) }
  try {
    expect(blocked('source')).toBe(true); expect(blocked('other')).toBe(false)
    const before = h.first.read()
    const result = await h.api.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
      operationId: 'remove-source', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project, [{ type: 'surface.remove', surfaceId: 'source' }]) } })
    expect(result.status).toBe('applied')
    expect(h.first.read().undoDepth).toBe(before.undoDepth + 1)
    expect(componentSurfaces(h.model().project).map(surface => surface.id)).toEqual(['other', 'target'])
    expect(h.model().project.logic!.navigationGuards).toEqual([])
    expect(blocked('other')).toBe(false)
    expect(await navigation.execute({ type: 'scene.go', sceneId: 'target' })).toBe(true)
    await h.bridge.undo()
    expect(h.model().project.logic!.navigationGuards).toEqual([originalGuard])
    expect(blocked('source')).toBe(true); expect(blocked('other')).toBe(false)
    await h.bridge.redo()
    await h.api.save(h.first.documentId, 'deleted-source.glx')
    await h.api.close(h.first.documentId, true)
    const cold = await h.api.open('deleted-source.glx')
    if (cold.model.kind !== 'course-v10') throw new Error('Expected V10 cold open')
    expect(cold.model.project.logic!.navigationGuards).toEqual([])
    expect(componentSurfaces(cold.model.project).map(surface => surface.id)).toEqual(['other', 'target'])
  } finally { navigation.dispose(); h.bridge.dispose() }
})

it('retains all-source historical meaning, narrows surviving restrictions, and canonicalizes new command and direct formal logic writes', async () => {
  const project = createBlankCourseProjectV10('guard source semantics')
  setRootContainers(project, ['a', 'b', 'c', 'target'].map(id => ({ id, title: id, kind: 'slide', childIds: [] })))
  const base = { effect: 'block' as const, toSurfaceIds: ['target'], match: 'all' as const,
    conditions: [{ type: 'exists' as const, key: 'blocked', exists: true }], message: 'blocked' }
  project.logic = { courseState: [{ key: 'blocked', valueType: 'boolean', defaultValue: true }], navigationGuards: [
    { ...base, id: 'legacy-all', fromSurfaceIds: [] }, { ...base, id: 'only-two', fromSurfaceIds: ['a', 'b'] },
  ] }
  const h = await createV10StoreHost(project)
  const navigation = new ComponentNavigationOwner({ project: () => h.model().project, surfaceId: () => 'c', select() {}, courseState: { get: () => true as never } })
  const dispatch = async (operationId: string, edits: Parameters<typeof captureComponentOperation>[1]) => {
    const read = h.first.read()
    return h.api.dispatch({ documentId: read.documentId, epoch: read.epoch, baseRevision: read.revision, operationId, actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(h.model().project, edits) } })
  }
  try {
    expect(navigation.canExecute({ type: 'scene.go', sceneId: 'target' })).toBe(false)
    await dispatch('remove-a', [{ type: 'surface.remove', surfaceId: 'a' }])
    expect(h.model().project.logic!.navigationGuards).toEqual([{ ...base, id: 'legacy-all', fromSurfaceIds: [] }, { ...base, id: 'only-two', fromSurfaceIds: ['b'] }])
    expect(navigation.canExecute({ type: 'scene.go', sceneId: 'target' })).toBe(false)
    expect(await commitCourseLogicAuthoringCommand(h.kernel, h.first.documentId, { projectId: project.id, baseRevision: h.model().project.revision,
      kind: 'navigation-guard.add', guard: { ...base, id: 'new-all', fromSurfaceIds: [] } })).toMatchObject({ ok: true })
    expect(h.model().project.logic!.navigationGuards.every(guard => guard.fromSurfaceIds === undefined || guard.fromSurfaceIds.length > 0)).toBe(true)
    await dispatch('formal-all', [{ type: 'project.logic.set', logic: { ...h.model().project.logic!, navigationGuards: [{ ...base, id: 'direct-all', fromSurfaceIds: [] }] } }])
    expect(h.model().project.logic!.navigationGuards).toEqual([{ ...base, id: 'direct-all' }])
    expect(navigation.canExecute({ type: 'scene.go', sceneId: 'target' })).toBe(false)
  } finally { navigation.dispose(); h.bridge.dispose() }
})
