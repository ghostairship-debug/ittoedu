import { afterEach, expect, it, vi } from 'vitest'
import { ComponentRuntimeWorld } from '@/player/components/ComponentRuntimeWorld'
import type { ComponentLayoutInput, ComponentRuntimeContext, CourseProjectV10 } from '@/shared/contracts/component-platform'

class LayoutObserver {
  static current = new Map<Element, LayoutObserver>()
  constructor(readonly callback: ResizeObserverCallback) {}
  observe(target: Element) { LayoutObserver.current.set(target, this) }
  disconnect() { for (const [target, observer] of LayoutObserver.current) if (observer === this) LayoutObserver.current.delete(target) }
  static deliver(target: Element) {
    const observer = this.current.get(target)
    expect(observer).toBeDefined()
    observer!.callback([], observer as unknown as ResizeObserver)
  }
}
afterEach(() => { vi.unstubAllGlobals(); LayoutObserver.current.clear(); document.body.replaceChildren() })
const frame = (width: number, height: number) => ({ width, height, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] })
const project = (framed = false): CourseProjectV10 => ({
  schemaVersion: 11, id: 'layout-locality', revision: 0, title: 'Layout locality', rootIds: ['card'], entry: { rootInstanceId: 'card' },
  definitions: { card: { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'test.layout' } } },
  instances: { card: { id: 'card', definitionId: 'card', data: {}, ...(framed ? { frame: frame(300, 180) } : {}) } },
  global: { underlay: [], overlay: [] }, assets: {},
})
async function mounted(input: CourseProjectV10, placement = 'free-frame', observe = true) {
  vi.stubGlobal('ResizeObserver', observe ? LayoutObserver : undefined)
  let width = 390, height = 240, widthReads = 0, heightReads = 0
  const target = document.createElement('div'); target.dataset.componentPlacement = placement; document.body.append(target)
  Object.defineProperties(target, { clientWidth: { get: () => { widthReads++; return width } }, clientHeight: { get: () => { heightReads++; return height } } })
  let context: ComponentRuntimeContext | undefined
  const notifications: ComponentLayoutInput[] = []
  const world = new ComponentRuntimeWorld('layout-locality', { mode: 'edit', authoring: false,
    builtins: new Map([['test.layout', { mount(value: ComponentRuntimeContext) {
      context = value; const off = value.layout!.subscribe(next => notifications.push(next)); value.scope.cleanup(off)
      return { update() {}, dispose() {} }
    } }]]) })
  world.bind('card', target); world.bindTarget('card', target)
  const resources = { assets: {}, components: {} }
  await world.sync(input, resources)
  expect(context).toBeDefined()
  return { world, target, resources, notifications, layout: context!.layout!, reset() { widthReads = heightReads = 0; notifications.length = 0 },
    size(nextWidth: number, nextHeight = height) { width = nextWidth; height = nextHeight }, reads: () => ({ width: widthReads, height: heightReads }) }
}

it('uses author frame and child extent without forcing DOM geometry, including same-object author edits', async () => {
  const input = project(true), host = await mounted(input)
  try {
    host.reset()
    expect(host.layout.read()).toEqual({ mode: 'free-frame', inlineSize: 300, blockSize: 180 })
    await host.world.sync(input, host.resources)
    expect(host.reads()).toEqual({ width: 0, height: 0 })
    input.instances.card.frame!.width = 420
    await host.world.sync(input, host.resources)
    expect(host.notifications).toEqual([{ mode: 'free-frame', inlineSize: 420, blockSize: 180 }])
    delete input.instances.card.frame
    input.instances.card.childIds = ['child']
    input.instances.child = { id: 'child', definitionId: 'card', data: {}, frame: frame(250, 120) }
    await host.world.sync(input, host.resources)
    expect(host.layout.read()).toEqual({ mode: 'free-frame', inlineSize: 250, blockSize: 120 })
    input.instances.child.frame!.width = 280
    await host.world.sync(input, host.resources)
    expect(host.notifications.at(-1)).toEqual({ mode: 'free-frame', inlineSize: 280, blockSize: 120 })
    expect(host.reads()).toEqual({ width: 0, height: 0 })
  } finally { await host.world.dispose() }
})

it('lets real target observations own natural Flow changes while public reads remain live before delivery', async () => {
  const input = project(), host = await mounted(input, 'flow')
  try {
    host.reset()
    await host.world.sync(input, host.resources)
    expect(host.reads()).toEqual({ width: 0, height: 0 })
    // Ancestor CSS/font reflow may change the box without changing author data.
    host.size(470, 320)
    expect(host.layout.read()).toEqual({ mode: 'flow-content', inlineSize: 470 })
    host.reset()
    LayoutObserver.deliver(host.target)
    expect(host.notifications).toEqual([{ mode: 'flow-content', inlineSize: 470 }])
    expect(host.reads()).toEqual({ width: 1, height: 0 })
    host.reset()
    host.target.dataset.componentPlacement = 'program'; host.size(610, 410)
    await host.world.sync(input, host.resources)
    expect(host.notifications).toEqual([{ mode: 'program-viewport', inlineSize: 610, blockSize: 410 }])
    host.size(620, 430)
    expect(host.layout.read()).toEqual({ mode: 'program-viewport', inlineSize: 620, blockSize: 430 })
  } finally { await host.world.dispose() }
})

it('forces a restored projection to resample and preserves live sampling when ResizeObserver is unavailable', async () => {
  const input = project(), host = await mounted(input, 'flow')
  try {
    host.reset(); host.size(510)
    host.world.bind('card', null)
    host.world.bind('card', host.target)
    expect(host.notifications.at(-1)).toEqual({ mode: 'flow-content', inlineSize: 510 })
    expect(host.reads().width).toBeGreaterThan(0)
  } finally { await host.world.dispose() }
  const fallback = await mounted(input, 'flow', false)
  try {
    fallback.reset(); fallback.size(540)
    await fallback.world.sync(input, fallback.resources)
    expect(fallback.notifications).toEqual([{ mode: 'flow-content', inlineSize: 540 }])
    expect(fallback.reads().width).toBeGreaterThan(0)
  } finally { await fallback.world.dispose() }
})

it('resamples parent fallback dimensions and never lets a public read advance the accepted notification baseline', async () => {
  const input = project(), host = await mounted(input, 'flow')
  try {
    let parentWidth = 400
    const parent = document.createElement('div'); document.body.append(parent); parent.append(host.target)
    Object.defineProperty(parent, 'clientWidth', { get: () => parentWidth })
    host.size(0)
    LayoutObserver.deliver(host.target)
    expect(host.notifications.at(-1)).toEqual({ mode: 'flow-content', inlineSize: 400 })
    host.reset(); parentWidth = 500
    // The hidden target stays zero; its observer has no target-size change to deliver.
    await host.world.sync(input, host.resources)
    expect(host.notifications).toEqual([{ mode: 'flow-content', inlineSize: 500 }])
    host.reset(); host.size(700)
    expect(host.layout.read()).toEqual({ mode: 'flow-content', inlineSize: 700 })
    expect(host.notifications).toEqual([])
    await host.world.sync(input, host.resources)
    expect(host.notifications).toEqual([{ mode: 'flow-content', inlineSize: 700 }])
  } finally { await host.world.dispose() }
})
