import { expect, it, vi } from 'vitest'
import { createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentPlatform/camera'
import { teacherControllerActionSchema } from '../../src/shared/contracts/component-platform/teacherController'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

it('honors an explicit Stop during the asynchronous realm reset owned by course restart', async () => {
  const project = createBlankCourseProjectV10('Stop during restart')
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export function mount(){}' } }
  project.instances.source = { id: 'source', definitionId: 'source', data: {}, frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  project.surfaces[0].childIds = ['source']
  let release!: () => void, disposing = false, first = true
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => project.surfaces[0].id, select() {} })
  const cancel = vi.spyOn(navigation, 'cancel')
  const runtime = new ComponentPlatformRuntime('r06-stop-reset', { mode: 'play', studentNavigation: navigation, resolveSource: async () => ({ implementation: {
    mount: () => ({ update() {}, dispose: () => { if (!first) return; first = false; disposing = true; return new Promise<void>(done => { release = done }) } }),
  } }) })
  const element = document.createElement('div'); document.body.append(element); runtime.bind('source', element)
  try {
    await runtime.sync(project, { assets: {}, components: {} })
    const resetting = runtime.resetPlayback(true, { preserveNavigation: true })
    await vi.waitFor(() => expect(disposing).toBe(true))
    expect(runtime.isPlaying()).toBe(false); expect(cancel).not.toHaveBeenCalled()
    runtime.setPlaying(false)
    expect(cancel).toHaveBeenCalledOnce()
    release(); await resetting
    expect(runtime.isPlaying()).toBe(false)
  } finally { release?.(); await runtime.dispose(); navigation.dispose(); element.remove() }
})

it('samples intermediate camera poses and stops old writes after pan, replacement and abort', async () => {
  let now = 0, sequence = 0
  const callbacks = new Map<number, (time: number) => void>()
  const camera = createComponentSpatialCameraPort({ x: 0, y: 0, zoom: 1 }, {
    now: () => now, request: callback => { const id = ++sequence; callbacks.set(id, callback); return id }, cancel: id => { callbacks.delete(id) },
  })
  const tick = (time: number) => { now = time; const current = [...callbacks.values()]; callbacks.clear(); current.forEach(callback => callback(time)) }
  const move = camera.present({ x: 100, y: 0, zoom: 1 }, { durationMs: 100, easing: 'linear', keyframes: [{ offset: .5, pose: { x: 20, y: 40, zoom: 4 } }] })
  tick(25); expect(camera.read()).toMatchObject({ x: 10, y: 20, zoom: 2 })
  const stale = [...callbacks.values()][0]!
  camera.set({ x: 7, y: 8, zoom: 1 }); stale(100)
  expect(await move).toBe(false); expect(camera.read()).toMatchObject({ x: 7, y: 8, zoom: 1 })
  const earlier = camera.present({ x: 200, y: 0, zoom: 1 }, { durationMs: 100, easing: 'linear' })
  const latest = camera.present({ x: 30, y: 0, zoom: 1 }, { durationMs: 100, easing: 'linear' })
  tick(125); expect(await earlier).toBe(false); expect(await latest).toBe(true); expect(camera.read().x).toBe(30)
  const controller = new AbortController(), stopped = camera.present({ x: 99, y: 0, zoom: 1 }, { signal: controller.signal, durationMs: 100 })
  tick(145); const pose = camera.read(); controller.abort(); tick(300)
  expect(await stopped).toBe(false); expect(camera.read()).toEqual(pose); expect(callbacks.size).toBe(0)
  camera.dispose()
})

it('accepts source-generated navigation keyframes and camera trajectory through the real wire schema', () => {
  expect(teacherControllerActionSchema.parse({ type: 'scene.next', transition: {
    outgoing: { keyframes: [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-25%)', opacity: 0 }], timing: { duration: 500, easing: 'cubic-bezier(.2,0,.1,1)' } },
    incoming: { keyframes: [{ transform: 'scale(.9)' }, { transform: 'scale(1)' }], timing: { delay: 80, duration: 420 } },
  }, camera: { durationMs: 700, easing: 'linear(0, .1, .85, 1)', keyframes: [{ offset: .5, pose: { x: 10, y: 20, zoom: 2 } }] } }).type).toBe('scene.next')
  expect(teacherControllerActionSchema.safeParse({ type: 'camera.present', pose: { x: 0, y: 0, zoom: -1 } }).success).toBe(false)
})
