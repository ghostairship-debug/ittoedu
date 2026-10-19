import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { prepareCourseTeacherControllerEdits } from '../../src/core/course/courseElementInsertion'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentRuleEdits, interactionRules, interactionBehavior } from '../../src/shared/componentInteractionData'
import { componentInteractionView, componentNavigationScene } from '../../src/renderer/interactions/componentInteractionAuthoring'
import type { ComponentSpatialPose } from '../../src/shared/contracts/component-platform'

function project() {
  const blank = createBlankCourseProjectV10('Spatial sequence')
  const value = applyComponentOperation(blank, captureComponentOperation(blank, prepareCourseTeacherControllerEdits(blank, blank.surfaces[0].id, 'slide-authoring').edits))
  value.surfaces = [
    { id: 'A', kind: 'slide', title: 'Before', childIds: [] },
    { id: 'B', kind: 'spatial', title: 'World', childIds: [], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [
      { id: 'first', title: 'First', pose: { x: 100, y: 0, zoom: 1 } }, { id: 'last', title: 'Last', pose: { x: 200, y: 0, zoom: 1 } }] } },
    { id: 'C', kind: 'flow', title: 'After', childIds: [] },
  ]
  return value
}
function owner(value = project(), surfaceId = 'A') {
  let active = surfaceId, frameId: string | null = null, index: number | null = null
  const camera = createComponentSpatialCameraPort(value.surfaces.find(surface => surface.id === 'B')!.spatial!.home)
  const navigation = new ComponentNavigationOwner({ project: () => value, surfaceId: () => active, select: id => { active = id } })
  navigation.registerCamera('B', camera, { frameId: () => frameId, selectFrame: id => { frameId = id }, stepIndex: () => index, selectStep: next => { index = next } })
  return { navigation, camera, active: () => active, frame: () => frameId, dispose: () => { navigation.dispose(); camera.dispose() } }
}
it('enters the first authored camera from either scene direction, crosses only real first/last steps, and replays without ending at home', async () => {
  const value = project(), before = structuredClone(value), h = owner(value)
  try {
    expect(await h.navigation.execute({ type: 'step.next' })).toBe(true)
    expect(h.active()).toBe('B'); expect(h.camera.read().x).toBe(100)
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 0, stepCount: 2, stepName: 'First' })
    await h.navigation.execute({ type: 'step.next' }); expect(h.camera.read().x).toBe(200)
    await h.navigation.execute({ type: 'step.next' }); expect(h.active()).toBe('C')
    await h.navigation.execute({ type: 'step.previous' }); expect(h.camera.read().x).toBe(200)
    await h.navigation.execute({ type: 'step.previous' }); expect(h.camera.read().x).toBe(100)
    await h.navigation.execute({ type: 'step.previous' }); expect(h.active()).toBe('A')
    await h.navigation.execute({ type: 'scene.go', sceneId: 'C' })
    await h.navigation.execute({ type: 'scene.previous' }); expect(h.camera.read().x).toBe(100)
    h.camera.set({ x: 999, y: 9, zoom: 2 })
    h.navigation.forInstance(value.global.overlay[0]).moveBy(20, 30)
    await h.navigation.replayCurrentSurface(); expect(h.camera.read()).toEqual(value.surfaces[1].spatial!.frames[0].pose)
    expect(h.navigation.placement()).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 0, stepCount: 2 })
    expect(value).toEqual(before)
  } finally { h.dispose() }
})
it('uses the selected formal path and keeps an explicit first panoramic home frame; no-frame spaces remain runnable at home', async () => {
  const value = project(), spatial = value.surfaces[1].spatial!
  spatial.frames[0].pose = { ...spatial.home }
  const h = owner(value, 'B')
  try { await h.navigation.initializeSpatialPlayback(); expect(h.frame()).toBe('first'); expect(h.camera.read()).toEqual(spatial.home); expect(h.navigation.read().progress!.stepCount).toBe(2) }
  finally { h.dispose() }
  spatial.frames = []
  const empty = owner(value, 'B')
  try { expect(await empty.navigation.initializeSpatialPlayback()).toBe(true); expect(empty.camera.read()).toEqual(spatial.home); expect(empty.navigation.read().progress).toMatchObject({ stepIndex: 0, stepCount: 1 }); expect(await empty.navigation.execute({ type: 'step.next' })).toBe(true); expect(empty.active()).toBe('C') }
  finally { empty.dispose() }
})
it('starts on fragment zero, advances fragments without replacing current pan, and only crosses after the authored last stop', async () => {
  const value = project(), surface = value.surfaces[1]
  value.definitions.html = { id: 'html', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  value.instances.html = { id: 'html', definitionId: 'html', frame: { width: 80, height: 40, transform: [1, 0, 0, 1, 0, 0] }, data: { html: '<b class="fragment">one</b><b class="fragment">two</b>', css: '' } }
  surface.childIds.push('html'); surface.spatial!.frames[0].targetInstanceId = 'html'
  const state = new Map<string, number>(), camera = createComponentSpatialCameraPort(surface.spatial!.home)
  let index: number | null = null, frame: string | null = null, active = 'B'
  const nav = new ComponentNavigationOwner({ project: () => value, surfaceId: () => active, select: id => { active = id },
    courseState: { get: key => state.get(key) as never, set: (key, count) => { state.set(key, count) } } })
  nav.connectRuntime({ read: id => id === 'html' ? { status: 'ready', generation: 1, document: 'web', html: (value.instances.html.data as { html: string }).html } : { status: 'unprepared' }, prepare: async () => true })
  nav.registerCamera('B', camera, { frameId: () => frame, selectFrame: next => { frame = next }, stepIndex: () => index, selectStep: next => { index = next } })
  try {
    await nav.initializeSpatialPlayback(); expect(index).toBe(0); expect(nav.read().progress!.stepCount).toBe(4); expect([...state.values()]).toEqual([0])
    camera.set({ x: 77, y: 88, zoom: 1.4 }); await nav.execute({ type: 'step.next' })
    expect(index).toBe(1); expect(camera.read()).toEqual({ x: 77, y: 88, zoom: 1.4 }); expect([...state.values()]).toEqual([1])
    await nav.execute({ type: 'step.next' }); expect(index).toBe(2); expect(active).toBe('B')
    await nav.execute({ type: 'step.next' }); expect(frame).toBe('last'); expect(camera.read().x).toBe(200)
    await nav.execute({ type: 'step.next' }); expect(active).toBe('C')
  } finally { nav.dispose(); camera.dispose() }
})
it('a cancelled initial camera request cannot finish later or overwrite a replacement navigation', async () => {
  const value = project(), shown: ComponentSpatialPose[] = [], queued: Array<{ signal?: AbortSignal; resolve(accepted: boolean): void; pose: ComponentSpatialPose }> = []
  const nav = new ComponentNavigationOwner({ project: () => value, surfaceId: () => 'B', select() {} })
  nav.registerCamera('B', { read: () => ({ x: 0, y: 0, zoom: 1 }), set: pose => shown.push(pose), subscribe: () => () => {}, dispose() {},
    present: (pose, options) => new Promise(resolve => queued.push({ pose, signal: options?.signal, resolve })) })
  const stop = new AbortController(), first = nav.initializeSpatialPlayback(stop.signal)
  stop.abort(); const replacement = nav.execute({ type: 'scene.go', sceneId: 'B', targetStateId: 'last' })
  await vi.waitFor(() => expect(queued).toHaveLength(2))
  queued[0].resolve(false); queued[1].resolve(true)
  expect(queued[0].signal!.aborted).toBe(true); expect(await first).toBe(false); expect(await replacement).toBe(true)
  expect(nav.read().progress).toMatchObject({ stepIndex: 1, stepCount: 2 })
  nav.forInstance(value.global.overlay[0]).moveBy(20, 30)
  const stopReplay = new AbortController(), replay = nav.replayCurrentSurface(stopReplay.signal)
  await vi.waitFor(() => expect(queued).toHaveLength(3))
  stopReplay.abort(); queued[2].resolve(false)
  expect(await replay).toBe(false)
  expect(nav.forInstance(value.global.overlay[0]).placement!()).toEqual({ x: 20, y: 30 }); expect(shown).toEqual([])
  nav.dispose()
})
it('retains Flow observation on cancelled replay and resets it only after accepted presentation', async () => {
  const value = project(), before = structuredClone(value), stop = new AbortController(), replayed = vi.fn()
  let cancelled = true, zoom = 2, scroll = 160
  const nav = new ComponentNavigationOwner({ project: () => value, surfaceId: () => 'C', select() {},
    selectState: () => { if (cancelled) stop.abort() } })
  nav.registerObservation('C', { readZoom: () => zoom, setZoom: next => { zoom = next }, reset: () => { zoom = 1; scroll = 0 } })
  nav.subscribeSceneReplay(replayed)
  nav.forInstance(value.global.overlay[0]).moveBy(20, 30)
  try {
    expect(await nav.replayCurrentSurface(stop.signal)).toBe(false)
    expect(zoom).toBe(2); expect(scroll).toBe(160); expect(nav.forInstance(value.global.overlay[0]).placement!()).toEqual({ x: 20, y: 30 })
    expect(replayed).not.toHaveBeenCalled()
    cancelled = false
    expect(await nav.replayCurrentSurface()).toBe(true)
    expect(zoom).toBe(1); expect(scroll).toBe(0); expect(nav.forInstance(value.global.overlay[0]).placement!()).toEqual({ x: 0, y: 0 })
    expect(replayed).toHaveBeenCalledExactlyOnceWith('C'); expect(value).toEqual(before)
  } finally { nav.dispose() }
})
it('specified-frame actions survive canonical Main save and cold open; navigation metadata keeps frames separate from presentation states', async () => {
  const value = project(), teacher = value.global.overlay[0], action = { type: 'scene.go' as const, sceneId: 'B', targetStateId: 'last' }
  ;(value.instances[teacher].data as any).buttons[0].action = action
  const rule = { id: 'click', name: 'Go camera', enabled: true, trigger: { type: 'node.click' as const, nodeId: teacher }, conditions: [],
    actions: [{ id: 'go', start: 'after-previous' as const, delayMs: 0, action }] }
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-spatial-start-'))
  const service = new DocumentHostService(path.join(folder, 'recovery'))
  try {
    const created = await service.internalAPI.create({ kind: 'course-v10', project: value, resources: { assets: {}, components: {} } }, 'Spatial')
    await service.internalAPI.dispatch({ documentId: created.documentId, epoch: created.epoch, operationId: 'add-click', baseRevision: created.revision,
      actor: 'human', mutation: { type: 'command', command: captureComponentOperation(value, componentRuleEdits(value, { kind: 'surface', surfaceId: 'B' }, [rule])) } })
    const target = path.join(folder, 'saved.glx'); await service.internalAPI.save(created.documentId, target)
    const reopened = await new DocumentHostService(path.join(folder, 'cold-recovery')).internalAPI.open(target)
    if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
    const cold = reopened.model.project
    expect((cold.instances[teacher].data as any).buttons[0].action).toEqual(action)
    expect(interactionRules(interactionBehavior(cold, { kind: 'surface', surfaceId: 'B' }))![0].actions[0].action).toEqual(action)
    const nav = owner(cold, 'B')
    try { expect(await nav.navigation.execute(action)).toBe(true); expect(nav.camera.read().x).toBe(200) } finally { nav.dispose() }
    const metadata = componentInteractionView(cold, 'B')
    expect(metadata.scenes[1].spatial!.frames.map(frame => frame.id)).toEqual(['first', 'last'])
    expect(metadata.scene.presentation).toBeUndefined(); expect(componentNavigationScene(cold.surfaces[1]).spatial!.frames).toHaveLength(2)
  } finally { await fs.rm(folder, { recursive: true, force: true }) }
})
