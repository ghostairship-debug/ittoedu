import { afterEach, expect, it, vi } from 'vitest'
import { appendRootContainers } from '../helpers/glxWorkFixture'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DOCUMENT_BLOCK_DEFINITION } from '../../src/components/document-block'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createFlowReadingNavigation } from '../../src/shared/flowReading'
import { teacherControllerActionSchema } from '../../src/shared/contracts/component-platform/teacherController'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

function fixture() {
  const project = createBlankCourseProjectV10(), ids = ['one', 'two', 'three', 'four', 'five']
  project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
  for (const id of ids) project.instances[id] = { id, definitionId: DOCUMENT_BLOCK_DEFINITION.id,
    data: { type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: id }] } } }
  appendRootContainers(project, { id: 'flow', title: 'Flow', kind: 'flow', childIds: ids })
  const scroll = document.createElement('div'), body = document.createElement('article')
  scroll.append(body); document.body.append(scroll)
  let top = 0, now = 0, frameId = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.spyOn(window.performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  Object.defineProperties(scroll, { clientHeight: { value: 400 }, clientTop: { value: 0 }, scrollHeight: { value: 3600 },
    scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(3200, value)) } } })
  Object.defineProperty(body, 'offsetWidth', { value: 600 })
  scroll.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400)
  body.getBoundingClientRect = () => new DOMRect(0, -top, 600, 3600)
  const targets = new Map(ids.map((id, index) => {
    const element = document.createElement('h2'); body.append(element)
    element.getBoundingClientRect = () => new DOMRect(0, index * 600 - top, 600, 50)
    return [id, element] as const
  }))
  const navigation = createFlowReadingNavigation(() => ({ scroll, body }), id => targets.get(id))
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'flow', select: () => true })
  const listeners = new Set<() => void>(), releases: Array<ReturnType<typeof vi.fn>> = []
  const cancel = vi.fn(navigation.cancel)
  const unregister = owner.registerObservation('flow', { readZoom: () => 1, setZoom() {}, reset() {},
    goToInstance: navigation.goToInstance, readReading: navigation.readReading, readMotion: navigation.readMotion, cancel,
    subscribe(listener) {
      listeners.add(listener)
      const off = navigation.subscribe(listener), release = vi.fn(() => { off(); listeners.delete(listener) })
      releases.push(release); return release
    } })
  const advance = (ms: number) => { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)) }
  return { project, owner, navigation, scroll, ids, frames, listeners, releases, cancel, unregister, advance,
    dispose() { owner.dispose(); navigation.dispose() } }
}

it('shares one live motion snapshot while reading continues to report the actual intermediate chapter', async () => {
  const h = fixture(), saved = structuredClone(h.project), changed = vi.fn()
  h.owner.subscribe(changed)
  try {
    expect(h.owner.read().reading?.activeInstanceId).toBe('one')
    const pending = h.owner.execute({ type: 'scene.go', sceneId: 'flow', targetInstanceId: 'five' })
    expect(h.owner.read().flowMotion).toMatchObject({ containerId: 'flow', kind: 'chapter', status: 'running', fromInstanceId: 'one', targetInstanceId: 'five', progress: 0 })
    expect(changed).toHaveBeenCalled()
    h.advance(150)
    const intermediate = h.owner.read()
    expect(intermediate.reading?.activeInstanceId).toBe('three')
    expect(intermediate.flowMotion).toMatchObject({ status: 'running', targetInstanceId: 'five', scrollTop: h.scroll.scrollTop })
    expect(intermediate.flowMotion!.progress).toBeGreaterThan(0)
    expect(intermediate.flowMotion!.progress).toBeLessThan(1)
    expect(intermediate.progress?.stepIndex).toBe(2)
    h.advance(1000)
    expect(await pending).toBe(true)
    expect(h.owner.read().reading?.activeInstanceId).toBe('five')
    expect(h.owner.read().flowMotion).toMatchObject({ status: 'completed', progress: 1, targetInstanceId: 'five' })
    expect(h.frames.size).toBe(0)
    expect(h.project).toEqual(saved)
  } finally { h.dispose() }
})

it('advances rapid next requests from the intended destination without replacing geometric reading facts', async () => {
  const h = fixture()
  try {
    h.owner.read()
    const first = h.owner.execute({ type: 'step.next' })
    expect(h.owner.read().flowMotion?.targetInstanceId).toBe('two')
    const second = h.owner.execute({ type: 'step.next' })
    expect(h.owner.read().reading?.activeInstanceId).toBe('one')
    expect(h.owner.read().flowMotion?.targetInstanceId).toBe('three')
    const reverse = h.owner.execute({ type: 'step.previous' })
    expect(h.owner.read().flowMotion?.targetInstanceId).toBe('two')
    h.advance(1000)
    expect(await Promise.all([first, second, reverse])).toEqual([false, false, true])
    expect(h.owner.read().reading?.activeInstanceId).toBe('two')
    expect(h.frames.size).toBe(0)
  } finally { h.dispose() }
})

it('keeps the same rapid-step destination semantics through keyboard navigation tasks', async () => {
  const h = fixture(), tasks = h.owner.createKeyTasks()
  try {
    h.owner.read()
    const first = tasks.request({ kind: 'step', direction: 'next' })!
    await Promise.resolve()
    expect(h.owner.read().flowMotion?.targetInstanceId).toBe('two')
    const second = tasks.request({ kind: 'step', direction: 'next' })!
    await Promise.resolve()
    expect(h.owner.read().flowMotion?.targetInstanceId).toBe('three')
    h.advance(1000)
    expect(await first.finished).toEqual({ status: 'cancelled' })
    expect(await second.finished).toEqual({ status: 'completed' })
  } finally { tasks.dispose(); h.dispose() }
})

it('publishes chapter intent in directory actions and permits an explicit object reveal using the same target', async () => {
  const h = fixture()
  try {
    const action = h.owner.read().scenes.find(scene => scene.id === 'flow')!.targets![1].action
    expect(action).toEqual({ type: 'scene.go', sceneId: 'flow', targetInstanceId: 'two', targetKind: 'chapter' })
    expect(teacherControllerActionSchema.parse(action)).toEqual(action)
    const pending = h.owner.execute({ ...action, targetKind: 'object' })
    expect(h.owner.read().flowMotion).toMatchObject({ kind: 'object', targetInstanceId: 'two' })
    h.advance(1000)
    expect(await pending).toBe(true)
  } finally { h.dispose() }
})

it('cancels mounted motion and releases observation subscriptions on unregister and disposal', async () => {
  const h = fixture(), changed = vi.fn()
  h.owner.subscribe(changed)
  try {
    h.owner.read()
    const pending = h.owner.execute({ type: 'scene.go', sceneId: 'flow', targetInstanceId: 'five' })
    expect(h.frames.size).toBe(1)
    h.owner.cancel('flow')
    expect(await pending).toBe(false)
    expect(h.owner.read().flowMotion?.status).toBe('cancelled')
    expect(h.frames.size).toBe(0)
    expect(h.cancel).toHaveBeenCalled()
    expect(h.listeners.size).toBe(1)
    h.unregister()
    expect(h.listeners.size).toBe(0)
    expect(h.releases[0]).toHaveBeenCalledOnce()
    expect(h.owner.read().flowMotion).toBeUndefined()
    expect(h.owner.read().reading).toBeUndefined()
    changed.mockClear()
    h.navigation.goToInstance('two', undefined, { behavior: 'instant' })
    expect(changed).not.toHaveBeenCalled()
  } finally { h.dispose() }
  expect(h.frames.size).toBe(0)
  expect(h.releases[0]).toHaveBeenCalledOnce()
})

it.each(['unregister', 'dispose'] as const)('releases a still-running mounted Flow on %s', async operation => {
  const h = fixture()
  try {
    h.owner.read()
    const pending = h.owner.execute({ type: 'scene.go', sceneId: 'flow', targetInstanceId: 'five' })
    expect(h.frames.size).toBe(1)
    if (operation === 'unregister') h.unregister()
    else h.owner.dispose()
    expect(await pending).toBe(false)
    expect(h.navigation.readMotion()?.status).toBe('cancelled')
    expect(h.frames.size).toBe(0)
    expect(h.listeners.size).toBe(0)
    expect(h.releases[0]).toHaveBeenCalledOnce()
  } finally { h.dispose() }
  expect(h.releases[0]).toHaveBeenCalledOnce()
})
