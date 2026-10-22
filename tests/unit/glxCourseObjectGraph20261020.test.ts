// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { componentSurface, type ComponentEdit, type ComponentInstance, type CourseProjectV11 } from '../../src/shared/contracts/component-platform'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { assertCourseSurfaceRemoval, duplicateSurfaceEdits } from '../../src/core/course/courseSurfaceStructure'
import { courseObjectMoveEdits, prepareCourseObjectPaste, sameContainer } from '../../src/core/course/courseObjectEdits'
import { courseGeometryEdits } from '../../src/core/course/courseGeometryEdits'
import { spatialWorldInstance, updateSpatialCameraFrameTargetEdit } from '../../src/core/course/courseSpatialEdits'
import { interactionRules } from '../../src/shared/componentInteractionData'

const frame = (x = 0, y = 0) => ({ width: 100, height: 60, transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number] })
const item = (id: string, x = 0): ComponentInstance => ({ id, definitionId: 'item', data: { text: id }, frame: frame(x) })
const container = (id: string, childIds: string[], kind: 'slide' | 'flow' | 'spatial' = 'slide'): ComponentInstance => ({
  id, definitionId: 'container', name: id, data: { retained: id }, childIds,
  container: { kind, ...(kind === 'spatial' ? { spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } : {}) },
})
function project(instances: ComponentInstance[], rootIds: string[]): CourseProjectV11 {
  return { schemaVersion: 11, id: 'work', revision: 0, title: '原作品', rootIds, entry: { rootInstanceId: rootIds[0] },
    instances: Object.fromEntries(instances.map(instance => [instance.id, instance])),
    definitions: {
      container: { id: 'container', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      item: { id: 'item', role: 'content', implementation: { kind: 'builtin', key: 'fixture.item' } },
      interactions: { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } },
    }, global: { underlay: [], overlay: [] }, assets: {} }
}
const apply = (value: CourseProjectV11, edits: ComponentEdit[]) => applyComponentOperation(value, captureComponentOperation(value, edits))
const resources = { assets: {}, components: {} }
const rule = (id: string, nodeId: string) => ({ id, enabled: true, trigger: { type: 'node.click' as const, nodeId }, conditions: [],
  actions: [{ id: `${id}-action`, start: 'after-previous' as const, delayMs: 0, action: { type: 'presentation.set' as const, stateId: 'local' } }] })

describe('canonical course graph authoring preserves ownership and local capabilities', () => {
  it('duplicates the actual container after its root and rebinds nested state/spatial references', () => {
    const root = container('page', ['nested', 'world']), nested = container('nested', ['a', 'b', 'localBehavior'], 'slide'), world = container('world', ['c', 'd'], 'spatial')
    root.frame = frame(80, 40)
    root.container!.presentation = { initialStateId: 'local', states: [{ id: 'local', title: '外部状态', overrides: { nested: { visible: false } } }] }
    nested.container!.presentation = { initialStateId: 'local', states: [{ id: 'local', title: '局部状态', overrides: { a: { data: { text: '局部正文' } } }, order: ['b', 'a'] }] }
    world.container!.spatial = { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'camera', pose: { x: 0, y: 0, zoom: 1 }, targetInstanceId: 'c' }],
      paths: [{ id: 'route', frameIds: ['camera'], instanceIds: ['c', 'd'] }], defaultPathId: 'route',
      relations: [{ id: 'edge', sourceInstanceId: 'c', targetInstanceId: 'd', kind: 'arrow' }],
      semanticZoom: [{ id: 'zoom', instanceIds: ['c'], minZoom: 0, maxZoom: 2, visible: true }] }
    const localBehavior: ComponentInstance = { id: 'localBehavior', definitionId: 'interactions',
      data: { rules: [{ ...rule('local-rule', 'a'), trigger: { type: 'presentation.enter', stateId: 'local' },
        actions: [{ id: 'local-action', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'local', containerId: 'nested' } }] }] },
      attachments: [{ instanceId: 'localBehavior', target: { kind: 'instance', instanceId: 'nested' } }] }
    const globalBehavior: ComponentInstance = { id: 'globalBehavior', definitionId: 'interactions', data: { rules: [{ ...rule('global-rule', 'a'),
      conditions: [{ type: 'scene.in', sceneIds: ['page'] }, { type: 'presentation.in', stateIds: ['local'] }] }] } }
    const before = project([root, nested, world, item('a'), item('b'), item('c'), item('d'), localBehavior, globalBehavior, container('second', []), item('program')], ['page', 'second', 'program'])
    before.global.underlay.push('globalBehavior')
    const original = structuredClone(before)
    let sequence = 0
    const plan = duplicateSurfaceEdits(before, 'page', () => `copy-${++sequence}`), after = apply(before, plan.edits)
    expect(after.rootIds).toEqual(['page', plan.surfaceId, 'second', 'program'])
    const copied = after.instances[plan.surfaceId], nestedId = plan.ids.get('nested')!, a = plan.ids.get('a')!, b = plan.ids.get('b')!
    expect(copied.data).toEqual(root.data); expect(copied.frame).toEqual(root.frame)
    expect(copied.childIds).toEqual([nestedId, plan.ids.get('world')]); expect(copied.container?.presentation?.states[0].overrides).toEqual({ [nestedId]: { visible: false } })
    const configuration = after.instances[nestedId].container!
    expect(configuration.presentation).toMatchObject({ initialStateId: 'local', states: [{ id: 'local', overrides: { [a]: { data: { text: '局部正文' } } }, order: [b, a] }] })
    const c = plan.ids.get('c')!, d = plan.ids.get('d')!
    expect(after.instances[plan.ids.get('world')!].container!.spatial).toMatchObject({ defaultPathId: 'route', frames: [{ id: 'camera', targetInstanceId: c }],
      paths: [{ id: 'route', frameIds: ['camera'], instanceIds: [c, d] }], relations: [{ sourceInstanceId: c, targetInstanceId: d }], semanticZoom: [{ instanceIds: [c] }] })
    expect(interactionRules(after.instances[plan.ids.get('localBehavior')!])[0]).toMatchObject({ trigger: { type: 'presentation.enter', stateId: 'local' },
      actions: [{ action: { type: 'presentation.set', stateId: 'local', containerId: nestedId } }] })
    expect(interactionRules(after.instances.globalBehavior)[1]).toMatchObject({ conditions: [{ type: 'scene.in', sceneIds: [plan.surfaceId] },
      { type: 'presentation.in', stateIds: [copied.container!.presentation!.states[0].id] }], actions: [{ action: { stateId: copied.container!.presentation!.states[0].id } }] })
    expect(plan.surface.childIds).toEqual(copied.childIds)
    expect(before).toEqual(original)
  })

  it('duplicates a nested container within its actual parent and permits removing it under a sole root', () => {
    const value = project([container('page', ['a', 'nested', 'b']), item('a'), container('nested', ['inside']), item('inside'), item('b')], ['page'])
    const plan = duplicateSurfaceEdits(value, 'nested'), after = apply(value, plan.edits)
    expect(after.rootIds).toEqual(['page'])
    expect(after.instances.page.childIds).toEqual(['a', 'nested', plan.surfaceId, 'b'])
    expect(() => assertCourseSurfaceRemoval(value, 'nested')).not.toThrow()
    value.instances.program = item('program'); value.rootIds.push('program')
    expect(() => assertCourseSurfaceRemoval(value, 'page')).not.toThrow()
    const removed = apply(value, [{ type: 'surface.remove', surfaceId: 'page' }])
    expect(removed.rootIds).toEqual(['program']); expect(removed.entry).toEqual({ rootInstanceId: 'program' })
  })

  it('pastes a container into a program-only work without inventing a Slide or promoting its states', () => {
    const local = container('nested', ['inside'], 'slide')
    local.container!.presentation = { initialStateId: 'local', states: [{ id: 'local', title: '本地状态', overrides: { inside: { visible: false } } }] }
    const source = project([local, item('inside')], ['nested']), target = project([item('program')], ['program'])
    const plan = prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['nested'], resources },
      { capturedTarget: { documentId: 'target', project: target, resources, surfaceId: null }, container: { kind: 'project' }, index: 1 })
    const after = apply(target, plan.edits), id = plan.rootIds[0], child = plan.idMap.get('inside')!
    expect(after.rootIds).toEqual(['program', id]); expect(after.entry).toEqual(target.entry)
    expect(after.instances[id].container).toMatchObject({ kind: 'slide', presentation: { initialStateId: 'local', states: [{ id: 'local', overrides: { [child]: { visible: false } } }] } })
    expect(after.instances.program.container).toBeUndefined()
    expect(after).not.toHaveProperty('surfaces')
    expect(() => prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['inside'], resources },
      { capturedTarget: { documentId: 'target', project: target, resources, surfaceId: null }, container: { kind: 'project' }, index: 1 })).toThrow('复制整个原容器')
  })

  it('copies an external local behavior into the actual Source root scope through an ordinary group', () => {
    const sourceRoot: ComponentInstance = { id: 'source-root', definitionId: 'source', data: { html: '<main>原来源程序</main>' }, childIds: ['a', 'behavior'] }
    const targetRoot: ComponentInstance = { id: 'target-root', definitionId: 'source', data: { html: '<main>保留目标程序</main>' }, childIds: ['group'] }
    const group = { ...item('group'), childIds: [] }
    const behavior: ComponentInstance = { id: 'behavior', definitionId: 'interactions', data: { rules: [{ id: 'local', enabled: true,
      trigger: { type: 'node.click', nodeId: 'a' }, conditions: [], actions: [{ id: 'next', start: 'after-previous', delayMs: 0,
        action: { type: 'step.next', containerId: sourceRoot.id } }] }] },
      attachments: [{ instanceId: 'behavior', target: { kind: 'instance', instanceId: sourceRoot.id } }] }
    const value = project([sourceRoot, targetRoot, group, item('a'), behavior], [sourceRoot.id, targetRoot.id])
    value.definitions.source = { id: 'source', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() { return { dispose() {} } } }' } }
    const plan = prepareCourseObjectPaste({ documentId: 'same', project: value, roots: ['a'], resources },
      { capturedTarget: { documentId: 'same', project: value, resources, surfaceId: null }, container: { kind: 'instance', instanceId: group.id }, index: 0 })
    const after = apply(value, plan.edits), copiedBehavior = Object.values(after.instances).find(instance => instance.id !== behavior.id
      && instance.attachments?.some(attachment => attachment.target.kind === 'instance' && attachment.target.instanceId === targetRoot.id))!
    expect(copiedBehavior).toBeDefined()
    expect(after.instances[group.id].childIds).toEqual(plan.rootIds)
    expect(after.instances[targetRoot.id].childIds).toEqual([group.id, copiedBehavior.id])
    expect(interactionRules(copiedBehavior)[0].trigger).toEqual({ type: 'node.click', nodeId: plan.rootIds[0] })
    expect(interactionRules(copiedBehavior)[0].actions[0].action).toEqual({ type: 'step.next', containerId: targetRoot.id })
    expect(after.instances[behavior.id]).toEqual(behavior)
    expect(after.global).toEqual(value.global)
    expect(after.rootIds).toEqual(value.rootIds)
    expect(after.instances[targetRoot.id].container).toBeUndefined()
    expect(after.instances[group.id].container).toBeUndefined()
    expect(after.instances[targetRoot.id].data).toEqual(targetRoot.data)
    expect(after.instances[sourceRoot.id]).toEqual(sourceRoot)
  })

  it('keeps equally named states distinct in a Slide and refuses merging them into Flow without discarding content', () => {
    const left = container('left', ['a', 'ba']), right = container('right', ['b', 'bb'])
    left.container!.presentation = { states: [{ id: 'local', title: '左侧状态', overrides: { a: { data: { text: '左状态' } } } }] }
    right.container!.presentation = { states: [{ id: 'local', title: '右侧状态', overrides: { b: { data: { text: '右状态' } } } }] }
    const ba: ComponentInstance = { id: 'ba', definitionId: 'interactions', data: { rules: [rule('ra', 'a')] }, attachments: [{ instanceId: 'ba', target: { kind: 'instance', instanceId: 'left' } }] }
    const bb: ComponentInstance = { id: 'bb', definitionId: 'interactions', data: { rules: [rule('rb', 'b')] }, attachments: [{ instanceId: 'bb', target: { kind: 'instance', instanceId: 'right' } }] }
    const source = project([left, right, item('a'), item('b'), ba, bb], ['left', 'right']), flow = container('flow', [], 'slide')
    flow.container!.presentation = { states: [{ id: 'local', title: '原状态', overrides: {} }] }
    const target = project([flow], ['flow'])
    const reading = project([container('reading', [], 'flow')], ['reading']), readingBefore = structuredClone(reading)
    expect(() => prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['a', 'b', 'ba', 'bb'], resources },
      { capturedTarget: { documentId: 'reading', project: reading, resources, surfaceId: 'reading' }, container: { kind: 'instance', instanceId: 'reading' }, index: 0 })).toThrow('复制整个原容器')
    expect(reading).toEqual(readingBefore)
    const plan = prepareCourseObjectPaste({ documentId: 'source', project: source, roots: ['a', 'b', 'ba', 'bb'], resources },
      { capturedTarget: { documentId: 'target', project: target, resources, surfaceId: 'flow' }, container: { kind: 'instance', instanceId: 'flow' }, index: 0 })
    const after = apply(target, plan.edits), states = after.instances.flow.container!.presentation!.states
    expect(states).toHaveLength(3); expect(new Set(states.map(state => state.id)).size).toBe(3)
    expect(states[0]).toEqual(flow.container!.presentation!.states[0])
    for (const [object, behavior, title] of [['a', 'ba', '左侧状态'], ['b', 'bb', '右侧状态']]) {
      const state = states.find(state => state.title === title)!
      expect(state.overrides[plan.idMap.get(object)!]).toBeDefined()
      expect(interactionRules(after.instances[plan.idMap.get(behavior)!])[0].actions[0].action).toEqual({ type: 'presentation.set', stateId: state.id })
    }
  })

  it('preserves world coordinates and state frames when moving through equivalent owner aliases', () => {
    const root = container('page', ['group', 'a']), group = item('group', 100)
    group.childIds = []; root.container!.presentation = { states: [{ id: 'local', title: '状态', overrides: { a: { frame: frame(40) } } }] }
    const value = project([root, group, item('a', 20)], ['page'])
    expect(sameContainer({ kind: 'surface', surfaceId: 'page' }, { kind: 'instance', instanceId: 'page' })).toBe(true)
    const after = apply(value, courseObjectMoveEdits(value, 'a', { kind: 'instance', instanceId: 'group' }, 0))
    expect(after.instances.a.frame!.transform[4]).toBe(-80)
    expect(componentSurface(after, 'page')!.presentation!.states[0].overrides.a.frame!.transform[4]).toBe(-60)
  })

  it('keeps Flow alignment rules and Spatial membership scoped to the nearest nested container', () => {
    const root = container('page', ['flow', 'world']), flow = container('flow', ['a', 'b'], 'flow'), world = container('world', ['c', 'nested'], 'spatial')
    const nested = container('nested', ['d'], 'spatial')
    world.container!.spatial!.frames = [{ id: 'camera', pose: { x: 0, y: 0, zoom: 1 } }]
    const value = project([root, flow, world, nested, item('a'), item('b', 80), item('c'), item('d')], ['page'])
    expect(() => courseGeometryEdits(value, ['a', 'b'], { kind: 'align', alignment: 'left' })).toThrow('讲义浮层')
    value.instances.a.flowPlacement = { space: 'paper', plane: 'overlay' }; value.instances.b.flowPlacement = { space: 'paper', plane: 'overlay' }
    const aligned = apply(value, courseGeometryEdits(value, ['a', 'b'], { kind: 'align', alignment: 'left' }))
    expect(aligned.instances.b.frame!.transform[4]).toBe(0)
    expect(spatialWorldInstance(value, 'world', 'c')).toBe(true)
    expect(spatialWorldInstance(value, 'world', 'd')).toBe(false)
    expect(spatialWorldInstance(value, 'nested', 'd')).toBe(true)
    expect(() => updateSpatialCameraFrameTargetEdit(value, 'world', 'camera', 'd')).toThrow('当前世界')
    const followed = apply(value, [updateSpatialCameraFrameTargetEdit(value, 'world', 'camera', 'c')])
    expect(followed.instances.world.container!.spatial!.frames[0].targetInstanceId).toBe('c')
  })
})
