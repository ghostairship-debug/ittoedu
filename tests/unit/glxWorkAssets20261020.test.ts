import { afterEach, expect, it, vi } from 'vitest'
import { builtInWorkAssets, builtInWorkAsset, WORK_BACKGROUND_SOURCE, WORK_PROGRAM_SOURCE, WORK_TRANSITION_CONTROL_SOURCE } from '../../src/core/components/library/workAssets'
import { courseProjectV11Schema } from '../../src/shared/contracts/component-platform/schema'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentRuntimeContext, ComponentRuntimeImplementation } from '../../src/shared/contracts/component-platform/runtime'
import { defaultBuiltinRuntimeImplementations } from '../../src/player/components/defaultBuiltinRuntimeImplementations'
import { filterBuiltInWorkAssets } from '../../src/renderer/components/componentLibraryModel'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })
const projectFor = (id: string): CourseProjectV11 => {
  const asset = builtInWorkAsset(id)!
  return { schemaVersion: 11, id: asset.id, title: asset.title, revision: 0, definitions: asset.definitions, instances: asset.example.instances,
    assets: asset.assets, rootIds: asset.example.rootIds, entry: { rootInstanceId: asset.example.rootIds[0]! }, global: asset.global ?? { underlay: [], overlay: [] },
    ...(asset.logic ? { logic: asset.logic } : {}) }
}

it('delivers every base category as one canonical owned example, including two executable backgrounds', async () => {
  await loadBuiltinComponentSource('guoling.shape')
  const assets = builtInWorkAssets()
  expect(new Set(assets.map(asset => asset.usage!.kind))).toEqual(new Set(['container', 'program', 'presentation', 'camera', 'background', 'transition', 'template', 'content']))
  expect(assets.filter(asset => asset.usage?.kind === 'container')).toHaveLength(3)
  expect(assets.filter(asset => asset.usage?.kind === 'background')).toHaveLength(2)
  for (const asset of assets) {
    expect(courseProjectV11Schema.safeParse(projectFor(asset.id)), asset.id).toMatchObject({ success: true })
    expect(asset).not.toHaveProperty('surfaces')
  }
  expect(filterBuiltInWorkAssets(assets, '空间')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'guoling.work.spatial' })]))
})

it('registers the three builtin container boundaries without mounting a second child runtime', () => {
  const implementations = defaultBuiltinRuntimeImplementations({ assetUrl: () => undefined, reportImage: () => {} })
  for (const kind of ['flow', 'slide', 'spatial']) expect(implementations.get(`guoling.container.${kind}`)?.mount).toBeTypeOf('function')
})

function sourceContext(id: string) {
  const asset = builtInWorkAsset(id)!, root = document.createElement('div'); document.body.append(root)
  const get = vi.fn(() => .8), set = vi.fn(), off = vi.fn(), cleanup: Array<() => void> = []
  const execute = vi.fn(async () => true)
  const context = { instance: asset.example.instances[asset.example.rootIds[0]], root,
    scope: { cleanup: (callback: () => void) => cleanup.push(callback), state: { get, set, subscribe: vi.fn(() => off) } },
    teacherController: { execute }, interactions: { currentSurfaceId: () => 'actual-container' },
  } as unknown as ComponentRuntimeContext
  return { root, context, get, set, off, execute, cleanup }
}
const load = (code: string): ComponentRuntimeImplementation => new Function(code.replace('export default', 'return'))() as ComponentRuntimeImplementation
const prepareCanvas = () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const drawing = { clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), createLinearGradient: () => ({ addColorStop: vi.fn() }) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D)
  return drawing
}

it('runs the autonomous program input and redraw while retaining author parameters across update', async () => {
  prepareCanvas()
  const { root, context, set } = sourceContext('guoling.work.program')
  const mounted = await load(WORK_PROGRAM_SOURCE).mount(context)
  root.querySelector('button')!.click()
  expect(root.querySelector('output')!.textContent).toContain('1')
  expect(set).toHaveBeenCalledWith('count', 1)
  await mounted.update({ ...context.instance, data: { title: '已修改标题', speed: 2 } })
  expect(root.querySelector('h2')!.textContent).toBe('已修改标题')
  await mounted.dispose()
  expect(root.children).toHaveLength(0)
})

it('executes background drawing from shared parameters and cleans its loop/subscription', async () => {
  const drawing = prepareCanvas()
  const { context, root, get, off } = sourceContext('guoling.work.background.scene')
  const mounted = await load(WORK_BACKGROUND_SOURCE).mount(context)
  expect(get).toHaveBeenCalledWith(context.instance.stateBindings?.energy ?? 'energy')
  expect(drawing.arc).toHaveBeenCalledTimes(12)
  expect(root.style.pointerEvents).toBe('none')
  await mounted.suspend?.(); expect(cancelAnimationFrame).toHaveBeenCalled()
  await mounted.resume?.(); expect(drawing.arc).toHaveBeenCalledTimes(24)
  await mounted.dispose(); expect(off).toHaveBeenCalledOnce(); expect(root.children).toHaveLength(0)
})

it('source-authored keyframes enter the real navigation port rather than mutate a second state', async () => {
  const { context, root, execute } = sourceContext('guoling.work.transition.source-control')
  const mounted = await load(WORK_TRANSITION_CONTROL_SOURCE).mount(context)
  root.querySelector('button')!.click()
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'step.next', transition: expect.objectContaining({ outgoing: expect.objectContaining({ keyframes: expect.any(Array) }) }) }))
  await mounted.dispose()
})

