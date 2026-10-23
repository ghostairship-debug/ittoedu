import { afterEach, expect, it, vi } from 'vitest'
import { measureComponentGeometry, projectComponentGeometry } from '../../src/player/components/runtime/componentGeometry'
import { ComponentRuntimeHost } from '../../src/player/components/runtime/ComponentRuntimeHost'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import type { ComponentRuntimeContext, ComponentTarget } from '../../src/shared/contracts/component-platform'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function box(element: HTMLElement, initial: { x: number; y: number; width: number; height: number }, scale = 1) {
  const value = { ...initial }
  element.style.width = `${value.width}px`; element.style.height = `${value.height}px`
  if (scale !== 1) element.style.transform = `matrix(${scale},0,0,${scale},0,0)`
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: () => value.width }, offsetHeight: { configurable: true, get: () => value.height },
    clientWidth: { configurable: true, get: () => value.width }, clientHeight: { configurable: true, get: () => value.height },
  })
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => ({ x: value.x, y: value.y, left: value.x, top: value.y,
    width: value.width * scale, height: value.height * scale, right: value.x + value.width * scale, bottom: value.y + value.height * scale, toJSON() {} }))
  return value
}

const reference = (instanceId: string): ComponentTarget => ({ kind: 'instance', instanceId })
function fixture(scale = 1) {
  const root = document.createElement('section'), scroll = document.createElement('div'), first = document.createElement('div'), second = document.createElement('div')
  scroll.dataset.flowPaperScroll = 'true'; scroll.style.overflowY = 'auto'; scroll.append(first, second); root.append(scroll); document.body.append(root)
  box(scroll, { x: 30, y: 40, width: 800, height: 500 }, scale)
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 2500 }, scrollWidth: { configurable: true, value: 800 } })
  const a = box(first, { x: 50, y: 180, width: 100, height: 80 }), b = box(second, { x: 50, y: 1800, width: 200, height: 160 })
  const elements: Record<string, HTMLElement> = { first, second }
  const ports = { target: (ref: ComponentTarget) => ({ element: elements[ref.kind === 'instance' ? ref.instanceId : ''] }), flows: () => [{ containerId: 'flow', root }] }
  return { root, scroll, first, second, a, b, ports }
}

it('samples offscreen mounted targets in one batch and keeps Flow content coordinates stable through scroll', () => {
  const h = fixture(), ids = [reference('first'), reference('second')]
  const before = measureComponentGeometry(ids, h.ports)
  expect(before.sampleTime).toBeGreaterThan(0)
  expect(before.targets[1].viewportFrame?.transform).toEqual([1, 0, 0, 1, 50, 1800])
  expect(before.targets[0].flow?.contentFrame.transform).toEqual([1, 0, 0, 1, 20, 140])
  h.scroll.scrollTop = 120; h.a.y -= 120; h.b.y -= 120
  const after = measureComponentGeometry(ids, h.ports)
  expect(after.targets.map(value => value.flow?.contentFrame)).toEqual(before.targets.map(value => value.flow?.contentFrame))
  expect(after.targets[0].flow?.viewport).toEqual({ x: 0, y: 120, width: 800, height: 500 })
  expect(after.targets[0].flow?.contentToViewport).toEqual([1, 0, 0, 1, 30, -80])
})

it('uses unscaled Flow content pixels and projects the same batch into a transformed source iframe', () => {
  const h = fixture(.5)
  const sample = measureComponentGeometry([reference('first')], h.ports)
  expect(sample.targets[0].flow?.contentFrame).toEqual({ width: 100, height: 80, transform: [1, 0, 0, 1, 40, 280] })
  const projected = projectComponentGeometry(sample, [2, 0, 0, 2, -60, -80])
  expect(projected.sampleTime).toBe(sample.sampleTime)
  expect(projected.targets[0].viewportFrame?.transform).toEqual([1, 0, 0, 1, 40, 280])
  expect(projected.targets[0].flow?.contentFrame).toEqual(sample.targets[0].flow?.contentFrame)
  expect(projected.targets[0].flow?.contentToViewport).toEqual([1, 0, 0, 1, 0, 0])
})

it('reads layout changes fresh and explicitly returns null for unmounted targets', () => {
  const h = fixture()
  h.a.x = 150; h.a.width = 220
  expect(measureComponentGeometry([reference('first')], h.ports).targets[0].viewportFrame).toEqual({ width: 220, height: 80, transform: [1, 0, 0, 1, 150, 180] })
  h.first.remove()
  expect(measureComponentGeometry([reference('first')], h.ports).targets[0]).toEqual({ reference: reference('first'), viewportFrame: null })
})

it('uses the outer actual scroll owner when an inner natural-height Flow does not scroll', () => {
  const h = fixture(), inner = document.createElement('div'), innerScroll = document.createElement('div')
  h.scroll.append(inner); inner.append(innerScroll); innerScroll.dataset.flowPaperScroll = 'true'; innerScroll.style.overflowY = 'visible'; innerScroll.append(h.first)
  const ports = { ...h.ports, flows: () => [{ containerId: 'inner', root: inner }, { containerId: 'outer', root: h.root }] }
  expect(measureComponentGeometry([reference('first')], ports).targets[0].flow?.containerId).toBe('outer')
})

it('retires an in-flight measurement with its mount and does not write state or author data', async () => {
  let context!: ComponentRuntimeContext, release!: (value: ReturnType<typeof measureComponentGeometry>) => void
  const set = vi.fn(), emit = vi.fn(), instance = { id: 'one', definitionId: 'probe', data: { preserved: true } }
  const host = new ComponentRuntimeHost({ resolveImplementation: () => ({ mount(value) { context = value; return { update() {}, dispose() {} } } }),
    ports: () => ({ target: () => null, measure: () => new Promise(resolve => { release = resolve }),
      state: { get: () => undefined, set, subscribe: () => () => {} }, events: { emit, subscribe: () => () => {} } }) })
  await host.sync({ runScopeId: 'geometry', instance, definition: { id: 'probe', role: 'content', implementation: { kind: 'builtin', key: 'probe' } } })
  const pending = context.scope.measure!([reference('one')])
  await host.disposeScope('geometry')
  release({ sampleTime: 10, targets: [] })
  expect(await pending).toBeNull(); expect(await context.scope.measure!([])).toBeNull()
  expect(set).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled(); expect(instance.data).toEqual({ preserved: true })
})

it('connects real World formal targets and Flow ownership to a native mounted consumer', async () => {
  const h = fixture(), reader = document.createElement('div'); h.root.append(reader)
  let context!: ComponentRuntimeContext
  const project = { schemaVersion: 11 as const, id: 'geometry-world', revision: 0, title: 'Geometry', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
    definitions: { flow: { id: 'flow', role: 'content' as const, implementation: { kind: 'builtin' as const, key: 'guoling.container.flow' } },
      reader: { id: 'reader', role: 'content' as const, implementation: { kind: 'builtin' as const, key: 'probe' } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' as const }, childIds: ['first', 'second', 'reader'] },
      first: { id: 'first', definitionId: 'reader', data: {} }, second: { id: 'second', definitionId: 'reader', data: {} }, reader: { id: 'reader', definitionId: 'reader', data: {} } } }
  const world = new ComponentRuntimeWorld('geometry-world', { mode: 'edit', builtins: new Map([['probe', { mount(value) {
    if (value.instance.id === 'reader') context = value
    return { update() {}, dispose() {} }
  } }]]) })
  world.bindTarget('flow', h.root); world.bindTarget('first', h.first); world.bindTarget('second', h.second); world.bind('reader', reader)
  try {
    await world.sync(project, { assets: {}, components: {} })
    const snapshot = await context.scope.measure!([reference('first'), reference('second')])
    expect(snapshot?.targets.map(target => target.flow?.containerId)).toEqual(['flow', 'flow'])
    expect(snapshot?.targets[1].flow?.contentFrame.transform).toEqual([1, 0, 0, 1, 20, 1760])
  } finally { await world.dispose() }
  expect(await context.scope.measure!([reference('first')])).toBeNull()
})
