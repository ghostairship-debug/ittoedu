import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { useEditorStore } from '@/renderer/store/editorStore'
import { TEXT_DEFINITION, createTextData } from '@/components/text'
import { WEB_DEFINITION } from '@/components/web/data'
import { INTERACTIONS_DEFINITION, interactionRules } from '@/shared/componentInteractionData'
import type { CourseProjectV10 } from '@/shared/contracts/component-platform/project'
import type { InteractionRule } from '@/shared/interactionTypes'

beforeEach(() => { vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor) })
afterEach(() => { useEditorStore.getState().courseBridge.dispose(); vi.unstubAllGlobals() })
const rule = (id: string, trigger: InteractionRule['trigger'], action: InteractionRule['actions'][number]['action']): InteractionRule => ({
  id, enabled: true, trigger, conditions: [], actions: [{ id: `${id}-action`, start: 'after-previous', delayMs: 0, action }],
})
function fixture(): CourseProjectV10 {
  const frame = { width: 160, height: 80, transform: [1, 0, 0, 1, 20, 40] as [number, number, number, number, number, number] }
  const root = rule('root', { type: 'node.click', nodeId: 'slide-object' }, { type: 'scene.next' })
  const follower = rule('follower', { type: 'animation.completed', actionId: 'root-action' }, { type: 'scene.next' })
  const last = rule('last', { type: 'animation.completed', actionId: 'follower-action' }, { type: 'scene.next' })
  const keep = rule('keep', { type: 'node.click', nodeId: 'kept' }, { type: 'node.enter', nodeId: 'spatial-object', effect: 'fade', durationMs: 200, easing: 'ease-out' })
  keep.actions.push({ id: 'remaining-action', start: 'with-previous', delayMs: 0, action: { type: 'node.exit', nodeId: 'kept', effect: 'fade', durationMs: 200, easing: 'ease-out' } })
  const rules = [root, follower, last, keep]
  return { schemaVersion: 10, id: 'delete-project', revision: 0, title: '一次删除',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [WEB_DEFINITION.id]: WEB_DEFINITION, [INTERACTIONS_DEFINITION.id]: INTERACTIONS_DEFINITION },
    instances: {
      'slide-object': { id: 'slide-object', definitionId: WEB_DEFINITION.id, data: { html: '删除的演示对象' }, frame },
      'flow-object': { id: 'flow-object', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('删除的正文'))) },
      'spatial-object': { id: 'spatial-object', definitionId: WEB_DEFINITION.id, data: { html: '删除的空间对象' }, frame },
      'global-object': { id: 'global-object', definitionId: WEB_DEFINITION.id, data: { html: '删除的全局对象' }, frame },
      kept: { id: 'kept', definitionId: WEB_DEFINITION.id, data: { html: '<img src="picture">', resourceBindings: { picture: 'image' } }, frame },
      floating: { id: 'floating', definitionId: WEB_DEFINITION.id, data: { html: '保留的浮层' }, frame,
        flowPlacement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'flow-object', offsetY: 12, xRatio: .5 } } },
      behavior: { id: 'behavior', definitionId: INTERACTIONS_DEFINITION.id, data: JSON.parse(JSON.stringify({ rules })),
        attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId: 'slide' } }] },
      attached: { id: 'attached', definitionId: INTERACTIONS_DEFINITION.id, data: { rules: [] }, attachments: [
        { instanceId: 'attached', target: { kind: 'instance', instanceId: 'slide-object' } },
        { instanceId: 'attached', target: { kind: 'instance', instanceId: 'kept' } }] },
    },
    surfaces: [
      { id: 'slide', kind: 'slide', title: '演示', childIds: ['slide-object', 'behavior'], presentation: { states: [{ id: 'answer', title: '答案',
        order: ['slide-object', 'behavior'], overrides: { 'slide-object': { visible: false }, behavior: { data: JSON.parse(JSON.stringify({ rules })) } } }] } },
      { id: 'flow', kind: 'flow', title: '正文', childIds: ['flow-object', 'floating'] },
      { id: 'spatial', kind: 'spatial', title: '空间', childIds: ['spatial-object', 'kept'], spatial: { home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: 'place', pose: { x: 0, y: 0, zoom: 1 }, targetInstanceId: 'spatial-object' }],
        paths: [{ id: 'path', frameIds: ['place'], instanceIds: ['spatial-object', 'kept'] }],
        relations: [{ id: 'relation', sourceInstanceId: 'spatial-object', targetInstanceId: 'kept', kind: 'arrow' }],
        semanticZoom: [{ id: 'zoom', instanceIds: ['spatial-object', 'kept'], minZoom: .5, maxZoom: 2, visible: true }] } },
    ], global: { underlay: ['attached'], overlay: ['global-object'] }, assets: { image: { id: 'image', path: 'assets/image.png', mimeType: 'image/png' } } }
}
async function harness(project = fixture()) {
  useEditorStore.getState().courseBridge.dispose()
  const h = await createV10StoreHost(project, { assets: { image: Uint8Array.of(1, 2, 3) }, components: {} }, false)
  await useEditorStore.getState().connectCourseDocuments(h.api)
  return h
}

it('deletes a mixed surface/global selection, repairs formal references and saves it in one History item that Undo restores', async () => {
  const h = await harness(), state = useEditorStore.getState(), before = h.first.read()
  const ids = ['global-object', 'slide-object', 'flow-object', 'spatial-object']
  state.selectNodes(ids)
  expect(state.routeEditorAction('delete').ok).toBe(true)
  await state.drainCourseDocument()
  const after = h.first.read()
  if (after.model.kind !== 'course-v10' || before.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(after.revision).toBe(before.revision + 1); expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual([])
  ids.forEach(id => expect(after.model.kind === 'course-v10' && after.model.project.instances[id]).toBeUndefined())
  const project = after.model.project
  expect(project.instances.attached.attachments).toEqual([{ instanceId: 'attached', target: { kind: 'instance', instanceId: 'kept' } }])
  expect(project.instances.floating.flowPlacement?.paragraphAnchor).toBeUndefined()
  const stateView = project.surfaces[0].presentation!.states[0]
  expect(stateView.order).toEqual(['behavior']); expect(stateView.overrides['slide-object']).toBeUndefined()
  for (const data of [project.instances.behavior.data, stateView.overrides.behavior.data!]) {
    const rules = interactionRules({ ...project.instances.behavior, data })
    expect(rules.map(value => value.id)).toEqual(['keep'])
    expect(rules[0].actions).toEqual([{ id: 'remaining-action', start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: 'kept', effect: 'fade', durationMs: 200, easing: 'ease-out' } }])
  }
  expect(project.surfaces[2].spatial).toMatchObject({ frames: [{ id: 'place', pose: { x: 0, y: 0, zoom: 1 } }],
    paths: [{ instanceIds: ['kept'] }], relations: [], semanticZoom: [{ instanceIds: ['kept'] }] })
  expect(project.surfaces[2].spatial!.frames[0].targetInstanceId).toBeUndefined()
  expect(project.instances.kept).toEqual(before.model.project.instances.kept)
  expect(after.model.resources).toEqual(before.model.resources)
  await state.saveCourseDocument()
  const reopened = h.driver.load(h.disk.get('saved.glx')!)
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10 archive')
  expect(reopened.project).toEqual(after.model.project)
  expect(Object.keys(reopened.resources.assets)).toEqual(['image'])
  expect(Array.from(reopened.resources.assets.image)).toEqual(Array.from(after.model.resources.assets.image))
  expect(reopened.resources.components).toEqual(after.model.resources.components)
  await state.undo(); await state.drainCourseDocument()
  const undone = h.first.read()
  if (undone.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect({ ...undone.model.project, revision: 0 }).toEqual({ ...before.model.project, revision: 0 })
  expect(undone.model.resources).toEqual(before.model.resources); expect(undone.undoDepth).toBe(before.undoDepth)
})

it('rejects stale or mixed locked selections without changing formal content, resources, History or the held selection', async () => {
  const h = await harness(), state = useEditorStore.getState()
  state.selectNodes(['slide-object'])
  const stale = state.createLiveEditorSelectionSnapshot()
  await state.courseKernel.edit([{ type: 'data.set', instanceId: 'slide-object', path: ['html'], value: '新的正文' }])
  const beforeStale = h.first.read(), selected = [...useEditorStore.getState().courseView.selectedInstanceIds]
  expect(state.routeEditorAction('delete', stale)).toMatchObject({ ok: false, adapter: 'none' })
  expect(h.first.read()).toEqual(beforeStale); expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual(selected)
  await state.courseKernel.edit([{ type: 'instance.patch', instanceId: 'global-object', patch: { locked: true } }])
  state.selectNodes(['slide-object', 'global-object'])
  const beforeLocked = h.first.read(), lockedSelection = [...useEditorStore.getState().courseView.selectedInstanceIds]
  expect(state.routeEditorAction('delete')).toMatchObject({ ok: false, adapter: 'none' })
  expect(h.first.read()).toEqual(beforeLocked); expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual(lockedSelection)
  const capturedDelete = state.courseKernel.capture([{ type: 'instance.remove', instanceId: 'slide-object' }])
  const behavior = h.model().project.instances.behavior
  await state.courseKernel.edit([{ type: 'data.set', instanceId: 'behavior', path: ['rules'], value: JSON.parse(JSON.stringify([
    ...interactionRules(behavior), rule('new-rule', { type: 'node.click', nodeId: 'kept' }, { type: 'scene.next' }),
  ])) }])
  const beforeConflict = h.first.read()
  await expect(state.courseKernel.editCaptured(capturedDelete)).rejects.toThrow(/已变化/)
  expect(h.first.read()).toEqual(beforeConflict); expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual(lockedSelection)
  state.courseBridge.discardDraft()
  await state.courseKernel.edit([{ type: 'instance.patch', instanceId: 'behavior', patch: { locked: true } }])
  const beforeLockedDependency = h.first.read()
  await expect(state.courseKernel.edit([{ type: 'instance.remove', instanceId: 'slide-object' }])).rejects.toThrow('关联互动已锁定')
  expect(h.first.read()).toEqual(beforeLockedDependency); expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual(lockedSelection)
  state.courseBridge.discardDraft()
  await state.courseKernel.edit([{ type: 'instance.patch', instanceId: 'behavior', patch: { locked: false } }])
  expect(await state.courseKernel.edit([{ type: 'instance.remove', instanceId: 'slide-object' }])).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances['slide-object']).toBeUndefined()
  expect(h.model().resources).toEqual(beforeLockedDependency.model.resources)
})
