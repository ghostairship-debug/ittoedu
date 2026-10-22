import { afterEach, expect, it } from 'vitest'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import { createImageRuntimeImplementation } from '../../src/components/image/runtime'
import { imageDataSchema } from '../../src/components/image/data'
import type { ComponentRuntimeContext, ComponentRuntimeScope, CourseProjectV10 } from '../../src/shared/contracts/component-platform'

afterEach(() => document.body.replaceChildren())

it('releases CSS-owned media height on removal while retaining later measured Flow height', async () => {
  const input: CourseProjectV10 = {
    schemaVersion: 11, id: 'flow-height-exit', revision: 0, title: 'Flow height exit',
    rootIds: ['flow'], entry: { rootInstanceId: 'flow' },
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
      image: { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } },
    },
    instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: ['group'] },
      group: { id: 'group', definitionId: 'group', data: {}, style: { display: 'flex' }, childIds: ['photo'] },
      photo: { id: 'photo', definitionId: 'image', data: {}, style: { height: '340px' } },
    },
    global: { underlay: [], overlay: [] }, assets: {},
  }
  const outer = document.createElement('div'), target = document.createElement('div')
  outer.append(target); document.body.append(outer)
  target.dataset.componentPlacement = 'flow'
  Object.defineProperties(target, { clientWidth: { value: 390 }, clientHeight: { value: 340 } })
  let context: ComponentRuntimeContext | undefined
  const world = new ComponentRuntimeWorld('flow-height-exit', {
    builtins: new Map([['guoling.image', { mount(next: ComponentRuntimeContext) { context = next; return { update() {}, dispose() {} } } }]]),
  })
  world.bind('photo', target); world.bindTarget('photo', target)
  try {
    await world.sync(input, { assets: {}, components: {} })
    expect(context?.layout?.read().mode).toBe('flow-content')
    const projection = [target, ...target.querySelectorAll<HTMLElement>('*')].find(e => e.style.getPropertyValue('--component-flow-height') === '100%')!
    expect(projection).toBeDefined()
    const natural = structuredClone(input); natural.revision++; natural.instances.photo.style = { height: 'auto' }
    await world.sync(natural, { assets: {}, components: {} })
    expect(projection.style.getPropertyValue('--component-flow-height')).toBe('')
    context!.layout!.reportSize({ inlineSize: 390, blockSize: 487.2 })
    expect(projection.style.getPropertyValue('--component-flow-height')).toBe('488px')
    const contentOnly = structuredClone(natural); contentOnly.revision++; contentOnly.instances.photo.name = 'Still natural'
    await world.sync(contentOnly, { assets: {}, components: {} })
    expect(projection.style.getPropertyValue('--component-flow-height')).toBe('488px')
    const logical = structuredClone(contentOnly); logical.revision++; logical.instances.photo.style = { height: 'auto', blockSize: '220px' }
    await world.sync(logical, { assets: {}, components: {} })
    expect(projection.style.getPropertyValue('--component-flow-height')).toBe('100%')
  } finally { await world.dispose() }
})

it('uses the same logical block-size precedence for image cropping and keeps frame dimensions authoritative', async () => {
  const root = document.createElement('div'); document.body.append(root)
  Object.defineProperty(root, 'clientHeight', { value: 220 })
  const scope: ComponentRuntimeScope = {
    instanceId: 'photo', runScopeId: 'height-crop', generation: 1, signal: new AbortController().signal,
    isActive: () => true, cleanup() {}, target: () => null,
    events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} },
  }
  const data = imageDataSchema.parse({ assetId: 'photo', originalAssetId: 'photo' })
  const instance = { id: 'photo', definitionId: 'guoling.image', data, style: { height: 'auto', blockSize: '220px' } }
  const runtime = await createImageRuntimeImplementation(() => ({ url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' }))
    .mount({ root, instance, scope })
  const host = root.firstElementChild as HTMLElement, img = host.querySelector('img')!
  Object.defineProperty(host, 'clientWidth', { value: 390 })
  Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 100 }, naturalHeight: { value: 100 } })
  img.dispatchEvent(new Event('load'))
  expect(host.style.height).toBe('220px')
  await runtime.update?.({ ...instance, style: { height: 'auto' } })
  expect(host.style.height).toBe('390px')
  await runtime.update?.({ ...instance, frame: { width: 390, height: 180, transform: [1, 0, 0, 1, 0, 0] } })
  expect(host.style.height).toBe('180px')
  await runtime.dispose?.()
})
