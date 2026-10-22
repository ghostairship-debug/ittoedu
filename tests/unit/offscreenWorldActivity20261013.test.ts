import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { afterEach, expect, it, vi } from 'vitest'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import type { ComponentRuntimeContext, CourseProjectV10, TeacherControllerPort } from '../../src/shared/contracts/component-platform'

const worlds: ComponentRuntimeWorld[] = []
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.dispose())); document.body.replaceChildren(); vi.unstubAllGlobals() })

function harness() {
  const project: CourseProjectV10 = createTestProjectFromLegacy({ schemaVersion: 10, revision: 0, id: 'offscreen', title: 'Offscreen',
    definitions: { source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export function mount() {}' } } },
    instances: Object.fromEntries(['one', 'two'].map(id => [id, { id, definitionId: 'source', data: {} }])),
    surfaces: ['one', 'two'].map(id => ({ id, title: id, kind: 'slide' as const, childIds: [id], designSize: { width: 800, height: 600 } })),
    assets: {}, global: { underlay: [], overlay: [] } })
  // The old fixture reused the same ID for a page and its content. Canonical
  // containers have distinct identities; the tested content IDs remain stable.
  let surface = project.rootIds[0]!
  const listeners = new Set<() => void>(), execute = vi.fn(async () => true)
  const teacher: TeacherControllerPort = { readLocation: () => surface,
    read: () => ({ locationId: surface, scenes: [], progress: null, zoom: 1, muted: false, fullscreen: false }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    canExecute: () => true, execute, setCollapsed() {}, moveBy() {}, setZoom() {}, resetView() {} }
  const contexts = new Map<string, ComponentRuntimeContext>(), mounts = vi.fn(), updates = vi.fn(), suspended = vi.fn(), resumed = vi.fn(), disposed = vi.fn()
  const world = new ComponentRuntimeWorld('offscreen-world', { teacherController: teacher, studentNavigation: teacher, authoring: false,
    resolveSource: async () => ({ implementation: { mount(context) {
      contexts.set(context.instance.id, context); mounts(context.instance.id)
      let count = 0
      const button = document.createElement('button'); button.textContent = '0'
      button.onclick = () => { button.textContent = String(++count) }; context.root!.append(button)
      return { update(next) { updates(next.id, next.data); button.dataset.label = String((next.data as { label?: string }).label ?? '') },
        suspend: () => suspended(context.instance.id), resume: () => resumed(context.instance.id), dispose: () => disposed(context.instance.id) }
    } } }) })
  worlds.push(world)
  const elements = new Map<string, HTMLElement>()
  for (const id of ['one', 'two']) {
    const element = document.createElement('div'); document.body.append(element); elements.set(id, element)
    world.bind(id, element); world.bindTarget(id, element)
  }
  return { project, world, contexts, elements, mounts, updates, suspended, resumed, disposed, execute,
    select(id: string) { surface = project.rootIds.find(root => project.instances[root]?.childIds?.includes(id)) ?? id; for (const listener of listeners) listener() },
    sync: () => world.sync(project, { assets: {}, components: {} }) }
}

it('loads on first scene use and returns to the same clicked DOM and live scope', async () => {
  const run = harness(); await run.sync()
  expect(run.mounts.mock.calls).toEqual([['one']])
  const button = run.elements.get('one')!.querySelector('button')!
  button.click(); expect(button.textContent).toBe('1')
  const first = run.contexts.get('one')!, events: unknown[] = []
  first.scope.events.subscribe('__runtime.activity', value => events.push(value))
  expect(events.at(-1)).toEqual({ active: true, visible: true, playing: true })
  run.select('two'); await run.sync()
  expect(events.at(-1)).toEqual({ active: false, visible: false, playing: true })
  expect(run.suspended).toHaveBeenCalledWith('one')
  expect(first.scope.isActive()).toBe(true); expect(button.isConnected).toBe(true)
  expect(run.disposed).not.toHaveBeenCalled()
  expect(run.mounts.mock.calls).toEqual([['one'], ['two']])
  expect(first.teacherController!.canExecute({ type: 'scene.next' })).toBe(false)
  expect(await first.teacherController!.execute({ type: 'scene.next' })).toBe(false)
  expect(await first.interactions!.executeAction({ type: 'location.go', locationId: 'one' },
    { signal: first.scope.signal, ruleId: 'old-scene', stepId: 'navigate', restartFromBeginning: false })).toBe(false)
  first.scope.state.set('wrong-page', 1); expect(run.world.getState('wrong-page')).toBeUndefined()
  first.scope.events.emit('__runtime.activity', { active: true, visible: true, playing: true })
  expect(events.at(-1)).toEqual({ active: false, visible: false, playing: true })
  expect(run.execute).not.toHaveBeenCalled()
  run.select('one'); await run.sync()
  expect(run.elements.get('one')!.querySelector('button')).toBe(button)
  expect(button.textContent).toBe('1'); button.click(); expect(button.textContent).toBe('2')
  expect(run.mounts).toHaveBeenCalledTimes(2); expect(run.resumed).toHaveBeenCalledWith('one')
  await run.world.dispose(); expect(run.disposed).toHaveBeenCalledTimes(2)
  expect(first.scope.isActive()).toBe(false)
})

it('uses actual viewport notifications to postpone first load and suspend without resetting', async () => {
  let notify!: IntersectionObserverCallback
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { notify = callback } observe = observe; unobserve = unobserve; disconnect = disconnect })
  const run = harness(), element = run.elements.get('one')!
  const entry = (isIntersecting: boolean): IntersectionObserverEntry => ({ target: element, isIntersecting,
    boundingClientRect: element.getBoundingClientRect(), intersectionRect: new DOMRect(), intersectionRatio: isIntersecting ? 1 : 0, rootBounds: null, time: 0 })
  notify([entry(false)], {} as IntersectionObserver)
  await run.sync(); expect(run.mounts).not.toHaveBeenCalled()
  notify([entry(true)], {} as IntersectionObserver)
  await run.sync(); expect(run.mounts).toHaveBeenCalledOnce()
  const button = element.querySelector('button')!; button.click()
  notify([entry(false)], {} as IntersectionObserver)
  await vi.waitFor(() => expect(run.suspended).toHaveBeenCalledWith('one'))
  expect(button.textContent).toBe('1'); expect(run.disposed).not.toHaveBeenCalled()
  notify([entry(true)], {} as IntersectionObserver)
  await run.sync(); expect(element.querySelector('button')).toBe(button)
  expect(run.resumed).toHaveBeenCalledWith('one'); expect(run.mounts).toHaveBeenCalledOnce()
})


it('applies the latest edits on viewport return without another document sync or resetting live state', async () => {
  let notify!: IntersectionObserverCallback
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notify = callback }
    observe() {} unobserve() {} disconnect() {}
  })
  const run = harness(), element = run.elements.get('one')!
  const entry = (isIntersecting: boolean): IntersectionObserverEntry => ({ target: element, isIntersecting,
    boundingClientRect: element.getBoundingClientRect(), intersectionRect: new DOMRect(), intersectionRatio: isIntersecting ? 1 : 0, rootBounds: null, time: 0 })
  notify([entry(true)], {} as IntersectionObserver)
  await run.sync()
  const button = element.querySelector('button')!; button.click()
  notify([entry(false)], {} as IntersectionObserver)
  for (const label of ['intermediate', 'latest']) {
    run.project.instances.one = { ...run.project.instances.one!, data: { label } }
    await run.sync()
  }
  expect(run.updates).not.toHaveBeenCalled()
  expect(run.disposed).not.toHaveBeenCalled()
  notify([entry(true)], {} as IntersectionObserver)
  await vi.waitFor(() => expect(button.dataset.label).toBe('latest'))
  expect(run.updates).toHaveBeenLastCalledWith('one', { label: 'latest' })
  expect(element.querySelector('button')).toBe(button)
  expect(button.textContent).toBe('1')
  expect(run.mounts).toHaveBeenCalledOnce()
  expect(run.disposed).not.toHaveBeenCalled()
})
