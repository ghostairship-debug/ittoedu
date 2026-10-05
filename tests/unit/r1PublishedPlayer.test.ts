import { afterEach, expect, it, vi } from 'vitest'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import { prepareComponentOutputRegion } from '../../src/player/componentPlatform/outputCapture'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import * as sandbox from '../../src/renderer/components/SandboxComponentImplementation'
import { componentFragmentStateKey } from '../../src/player/componentPlatform/fragments'
import { spatialTourSteps } from '../../src/player/surfaces/spatial/componentPlatform/graph'
import { createTeacherControllerData } from '../../src/components/teacher-controller'

const microtasks = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
const payload = (): PublishedCourseV3 => ({ schemaVersion: 3, id: 'r1', title: 'Player navigation',
  definitions: {}, instances: {}, assets: {}, global: { underlay: [], overlay: [] }, surfaces: [
    { id: 'slide', title: 'Slide', kind: 'slide', childIds: [], presentation: { states: [{ id: 'reveal', title: 'Reveal', overrides: {} }] } },
    { id: 'flow', title: 'Flow', kind: 'flow', childIds: [] },
    { id: 'spatial', title: 'Spatial', kind: 'spatial', childIds: [], designSize: { width: 640, height: 360 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'stop', pose: { x: 100, y: 200, zoom: 2 } }] } },
  ] })

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('includes fragments in instance-based spatial paths using the same instance and path order', () => {
  const stops = spatialTourSteps({ home: { x: 0, y: 0, zoom: 1 }, frames: [], paths: [{ id: 'tour', frameIds: [], instanceIds: ['a', 'b'] }] }, 'tour', { width: 640, height: 360 },
    ['a', 'b'].map((instanceId, index) => ({ instanceId, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, index * 500, 0] }, parentToSurface: [1, 0, 0, 1, 0, 0] })), new Map([['a', 2], ['b', 1]]))
  expect(stops.map(stop => [stop.instanceId, stop.fragmentInstanceId, stop.fragmentStep])).toEqual([
    ['a', 'a', 0], ['a', 'a', 1], ['a', 'a', 2], ['b', 'b', 0], ['b', 'b', 1],
  ])
})

it('routes scene keys past remaining slide steps while ordinary arrows advance a step and input keeps its keys', async () => {
  const root = document.createElement('section'); document.body.append(root)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 80, right: 840, bottom: 680, width: 800, height: 600 } as DOMRect)
  const player = await mountPublishedCourseV3(payload(), root)
  const send = (target: HTMLElement, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true, ...init })
    target.dispatchEvent(event); return event
  }
  try {
    expect(player.navigation.viewportBounds()).toEqual({ left: 40, top: 80, right: 840, bottom: 680 })
    const input = document.createElement('input'); root.append(input)
    expect(send(input).defaultPrevented).toBe(false)
    expect(player.navigation.read().locationId).toBe('slide')
    expect(send(root).defaultPrevented).toBe(true); await microtasks()
    expect(player.navigation.read().locationId).toBe('slide')
    expect(player.navigation.currentStateId()).toBe('reveal')
    await player.go('slide')
    expect(send(root, { shiftKey: true }).defaultPrevented).toBe(true); await microtasks()
    expect(player.navigation.read().locationId).toBe('flow')
    expect(send(root, { shiftKey: true, key: 'ArrowLeft' }).defaultPrevented).toBe(true); await microtasks()
    expect(player.navigation.read().locationId).toBe('slide')
    expect(player.navigation.currentStateId()).toBeNull()
  } finally { await player.dispose() }
})

it('cancels a direct spatial navigation on disposal and rejects later public requests', async () => {
  const root = document.createElement('section'); document.body.append(root)
  const player = await mountPublishedCourseV3(payload(), root, { initialSurfaceId: 'spatial' })
  let signal: AbortSignal | undefined
  vi.spyOn(player.camera('spatial')!, 'present').mockImplementation((_pose, options) => new Promise(resolve => {
    signal = options?.signal
    signal?.addEventListener('abort', () => resolve(false), { once: true })
  }))
  const pending = player.next()
  expect(signal?.aborted).toBe(false)
  const closing = player.dispose()
  expect(signal?.aborted).toBe(true)
  expect(await pending).toBe(false)
  await closing
  expect(await player.next()).toBe(false)
  expect(await player.go('slide')).toBe(false)
  expect(await player.navigation.execute({ type: 'scene.go', sceneId: 'slide' })).toBe(false)
  expect(root.children).toHaveLength(0)
})

it('initializes spatial fragments before a step and keeps one instance/state through in-station steps; capture remains author-initial', async () => {
  const mounts = vi.fn()
  vi.spyOn(sandbox, 'prepareSandboxComponent').mockResolvedValue({ implementation: { mount({ root, scope }) {
    mounts()
    const button = document.createElement('button'); button.textContent = 'Answer'
    button.onclick = () => scope.state.set('answer', 7); root!.append(button)
    return { update() {}, dispose() {} }
  } } })
  const input = payload()
  input.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  input.instances.web = { id: 'web', definitionId: 'web', data: { html: '<p class="fragment">First</p><p class="fragment">Second</p>' }, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  input.surfaces[2].childIds = ['web']; input.surfaces[2].spatial!.frames[0].targetInstanceId = 'web'
  const before = structuredClone(input), root = document.createElement('section'); document.body.append(root)
  const player = await mountPublishedCourseV3(input, root, { initialSurfaceId: 'spatial' })
  try {
    expect(player.stateSnapshot()[componentFragmentStateKey('web')]).toBe(0)
    const button = root.querySelector<HTMLButtonElement>('button')!; button.click()
    expect(await player.next()).toBe(true)
    const pose = { x: 120, y: 80, zoom: 1.5, rotation: 15 }
    player.camera('spatial')!.set(pose)
    expect(await player.next()).toBe(true)
    expect(player.stateSnapshot()).toMatchObject({ answer: 7, [componentFragmentStateKey('web')]: 1 })
    expect(player.camera('spatial')!.read()).toEqual(pose)
    expect(root.querySelector('button')).toBe(button); expect(mounts).toHaveBeenCalledTimes(1)
    expect(input).toEqual(before)
  } finally { await player.dispose() }
  const capture = await mountPublishedCourseV3(input, root, { initialSurfaceId: 'spatial', capture: true })
  try { expect(capture.stateSnapshot()[componentFragmentStateKey('web')]).toBeUndefined() }
  finally { await capture.dispose() }
})

it('removes the fitted Flow wrapper when capturing only a source group body in its local frame', async () => {
  const root = document.createElement('section'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  const target = document.createElement('div'), stage = document.createElement('div'), content = document.createElement('div'), children = document.createElement('div'), child = document.createElement('div')
  target.dataset.componentObject = 'group'; child.dataset.componentObject = 'child'
  const runtimeRoot = document.createElement('div'), childRuntimeRoot = document.createElement('div'), peer = document.createElement('div')
  runtimeRoot.dataset.componentInstanceId = 'group'; childRuntimeRoot.dataset.componentInstanceId = 'child'; peer.dataset.componentObject = 'peer'
  runtimeRoot.textContent = 'Selected source body'; content.append(runtimeRoot); child.append(childRuntimeRoot)
  Object.assign(stage.style, { position: 'relative', width: '100%', height: '45px', transform: 'scale(0.5)' })
  children.append(child); stage.append(content, children); target.append(stage); root.append(target, peer)
  const input = payload()
  input.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  input.instances.group = { id: 'group', definitionId: 'group', data: {}, frame: { width: 240, height: 120, transform: [0, 1, -1, 0, 40, 50] } }
  vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, width: 240, height: 120 }) as DOMRect)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queueMicrotask(() => callback(0)); return 1 })
  const player = { runtime: { contentElement: () => content, targetElement: () => target, beforeProjectionMutation() {}, afterProjectionMutation() {} } } as unknown as Awaited<ReturnType<typeof mountPublishedCourseV3>>
  expect(await prepareComponentOutputRegion({ payload: input, root, player, surfaceId: 'flow', instanceId: 'group' })).toEqual({ x: 0, y: 0, width: 240, height: 120 })
  expect(stage.style.height).toBe('100%'); expect(stage.style.transform).toBe('none')
  expect(target.style.transform).toBe('none'); expect(child.hidden).toBe(true)
  expect(runtimeRoot.hidden).toBe(false); expect(runtimeRoot.closest('[hidden]')).toBeNull()
  expect(childRuntimeRoot.hidden).toBe(true); expect(peer.hidden).toBe(true)
  expect(input.instances.group.frame?.transform).toEqual([0, 1, -1, 0, 40, 50])
})

it('observes Slide and Flow content through their view owner while Teacher remains fixed and reset preserves the current step', async () => {
  const input = payload(), frame = { width: 100, height: 50, transform: [1, 0, 0, 1, 30, 40] as [number, number, number, number, number, number] }
  input.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  input.definitions.teacher = { id: 'teacher', role: 'content', implementation: { kind: 'builtin', key: 'guoling.navigation' } }
  for (const id of ['slideBody', 'flowBody', 'decoration']) input.instances[id] = { id, definitionId: 'group', data: {}, frame }
  input.instances.teacher = { id: 'teacher', definitionId: 'teacher', data: JSON.parse(JSON.stringify(createTeacherControllerData())), frame }
  input.global = { underlay: ['decoration'], overlay: ['teacher'] }
  input.surfaces[0].childIds = ['slideBody']; input.surfaces[0].designSize = { width: 640, height: 360 }
  input.surfaces[1].childIds = ['flowBody']
  const before = structuredClone(input), root = document.createElement('section'); document.body.append(root)
  const player = await mountPublishedCourseV3(input, root)
  const shell = root.querySelector<HTMLElement>('[data-component-model-player]')!, teacher = player.runtime.targetElement('teacher')!
  Object.defineProperty(shell, 'offsetWidth', { value: 640 })
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 450 } as DOMRect)
  try {
    await player.next()
    const shellTransform = shell.style.transform, teacherTransform = teacher.style.transform
    player.navigation.setZoom(2)
    expect(player.navigation.read().zoom).toBe(2)
    expect(root.style.zoom).toBe('')
    expect(shell.style.transform).toBe(shellTransform); expect(teacher.style.transform).toBe(teacherTransform)
    expect(teacher.closest('[data-playback-content]')).toBeNull()
    expect(root.querySelector<HTMLElement>('[data-component-surface="slide"] [data-playback-content]')!.style.transform).toContain('scale(2)')
    expect(player.runtime.targetElement('decoration')!.style.transform).toContain('scale(2)')
    player.navigation.moveBy(15, 20)
    expect(teacher.style.translate).toBe('12px 16px')
    player.navigation.resetView()
    expect(player.navigation.read().zoom).toBe(1); expect(player.navigation.currentStateId()).toBe('reveal')
    expect(teacher.style.translate).toBe('0px 0px')
    await player.go('flow')
    player.navigation.setZoom(1.5)
    const flowContent = root.querySelector<HTMLElement>('[data-component-surface="flow"] [data-playback-content]')!
    expect(flowContent.style.transform).toContain('scale(1.5)')
    expect(flowContent.querySelector('[data-flow-paper-scroll]')).not.toBeNull()
    expect(player.navigation.read().zoom).toBe(1.5); expect(teacher.closest('[data-playback-content]')).toBeNull()
    expect(input).toEqual(before)
  } finally { await player.dispose() }
  expect(root.children).toHaveLength(0)
})
