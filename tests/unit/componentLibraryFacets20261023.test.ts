import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import type { AvailableComponentCatalogPackage, ComponentCatalogV1 } from '../../src/shared/componentCatalog'
import type { ComponentInstance } from '../../src/shared/contracts/component-platform/project'
import type { ComponentRuntimeContext, ComponentRuntimeImplementation } from '../../src/shared/contracts/component-platform/runtime'
import { BUILTIN_DISCOVERY_ENTRIES, COMPONENT_LIBRARY_CATEGORIES, createCatalogDiscoveryEntry, createWorkAssetDiscoveryEntry, searchDiscoveryEntries } from '../../src/shared/componentDiscovery'
import { builtInWorkAsset, builtInWorkAssetMetadata } from '../../src/core/components/library/workAssets'
import { componentFieldPresentation } from '../../src/renderer/ui/properties/componentDefinitionPresentation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

const catalog = JSON.parse(readFileSync('resources/built-in-components/catalog.json', 'utf8')) as ComponentCatalogV1
const available = (entry = catalog.packages[0]!): AvailableComponentCatalogPackage => ({ ...entry, sourceId: 'builtin', sourceLabel: '内置', sourceTrust: 'built-in' })
const workEntries = () => builtInWorkAssetMetadata().map(createWorkAssetDiscoveryEntry)

it('puts all 19 existing entries in five purpose categories and includes the teacher controller', () => {
  const teacher = BUILTIN_DISCOVERY_ENTRIES.find(entry => entry.id === 'navigation')!
  const entries = [...workEntries(), ...catalog.packages.map(entry => createCatalogDiscoveryEntry(available(entry))), teacher]
  expect(entries).toHaveLength(19)
  expect(COMPONENT_LIBRARY_CATEGORIES.map(category => category.label)).toEqual(['内容与展示', '布局与容器', '互动与导航', '背景与效果', '页面与组合模板'])
  expect(Object.fromEntries(COMPONENT_LIBRARY_CATEGORIES.map(category => [category.id, entries.filter(entry => entry.library?.category === category.id).length])))
    .toEqual({ content: 5, layout: 3, interaction: 5, effects: 4, templates: 2 })
  expect(teacher.library).toMatchObject({ category: 'interaction', itemType: 'component', subjects: ['通用'], schoolStages: ['通用'] })
  for (const query of ['教师台', '控制台', '翻页']) expect(searchDiscoveryEntries(entries, query).some(entry => entry.id === 'navigation')).toBe(true)
})

it('preserves catalog metadata and classifies unfamiliar packages without depending on package identities', () => {
  for (const original of catalog.packages) {
    expect(createCatalogDiscoveryEntry(available({ ...original, packageId: 'example.renamed' })).library)
      .toMatchObject({ category: 'content', itemType: 'component', subjects: original.subject, schoolStages: original.schoolStage, version: original.version })
  }
  expect(createCatalogDiscoveryEntry(available({ ...catalog.packages[0]!, category: '未知用途', subject: [], schoolStage: [] })).library)
    .toMatchObject({ category: 'content', itemType: 'component', subjects: [], schoolStages: [] })
  expect(createCatalogDiscoveryEntry(available({ ...catalog.packages[0]!, category: '交互导航' })).library?.category).toBe('interaction')
})

it('distinguishes sample pages, templates, containers and transitions and keeps former names searchable', () => {
  const entries = workEntries()
  const entry = (id: string) => entries.find(value => value.id === `guoling.work.${id}`)!
  expect(entry('presentation')).toMatchObject({ title: '状态切换示例页', library: { itemType: 'example-page' } })
  expect(entry('camera')).toMatchObject({ title: '镜头导航示例页', library: { itemType: 'example-page' } })
  expect(entry('transition.source-control')).toMatchObject({ title: '带转场的导航按钮', library: { category: 'interaction', itemType: 'component' } })
  expect(entry('flow').library?.itemType).toBe('container')
  expect(entry('template.mixed-program').library?.itemType).toBe('template')
  expect(entry('transition.fade').library?.itemType).toBe('transition')
  for (const query of ['局部状态与原生触发', '镜头聚焦与返回', '源码编排转场控件']) expect(searchDiscoveryEntries(entries, query)).toHaveLength(1)
})

const load = (code: string): ComponentRuntimeImplementation => new Function(code.replace('export default', 'return'))() as ComponentRuntimeImplementation
function mountSource(assetId: string, instanceId: string) {
  const asset = builtInWorkAsset(`guoling.work.${assetId}`)!, instance = asset.example.instances[instanceId]!
  const definition = asset.definitions[instance.definitionId]!
  if (definition.implementation.kind !== 'source' || !definition.implementation.source) throw new Error('Expected an inline program')
  const root = document.createElement('div'); document.body.append(root)
  const state = new Map<string, unknown>(), set = vi.fn((key: string, value: unknown) => state.set(key, value)), execute = vi.fn(async () => true)
  const context = { root, instance, scope: { cleanup: vi.fn(), state: { get: (key: string) => state.get(key), set, subscribe: () => () => {} } },
    teacherController: { execute }, interactions: { currentSurfaceId: () => 'current-container' } } as unknown as ComponentRuntimeContext
  return { root, instance, definition, context, set, execute, mount: () => load(definition.implementation.kind === 'source' ? definition.implementation.source! : '').mount(context) }
}
function prepareDrawing() {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const stops = vi.fn<(stop: number, color: string) => void>(), drawing = { fillStyle: '', globalAlpha: 1, clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn<(x: number, y: number, radius: number, start: number, end: number) => void>(), fill: vi.fn(), createLinearGradient: () => ({ addColorStop: stops }) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D)
  return { drawing, stops, tick: () => frames.shift()!(0) }
}
const nextData = (instance: ComponentInstance, data: Record<string, string | number>) => ({ ...instance, data: { ...(instance.data as Record<string, string | number>), ...data } })

it('uses the existing property metadata and applies edited program title, speed and color to the running program', async () => {
  const { drawing, tick } = prepareDrawing(), source = mountSource('program', 'program')
  expect(componentFieldPresentation(source.definition, ['title']).label).toBe('程序标题')
  expect(componentFieldPresentation(source.definition, ['speed'])).toMatchObject({ label: '运动速度', minimum: 0, step: .1 })
  expect(componentFieldPresentation(source.definition, ['color']).color).toBe(true)
  const mounted = await source.mount()
  await mounted.update(nextData(source.instance, { title: '新的标题', speed: 0, color: '#ef4444' }))
  expect(source.root.querySelector('h2')?.textContent).toBe('新的标题')
  expect(source.root.querySelector('input')?.value).toBe('0')
  tick(); const position = drawing.arc.mock.calls.at(-1)
  tick(); expect(drawing.arc.mock.calls.at(-1)).toEqual(position)
  expect(drawing.fillStyle).toBe('#ef4444')
  await mounted.dispose()
})

it('applies current camera and transition parameters after updating instead of keeping their mounted values', async () => {
  const camera = mountSource('camera', 'camera-control'), mountedCamera = await camera.mount()
  expect(componentFieldPresentation(camera.definition, ['durationMs']).label).toBe('镜头移动时长（毫秒）')
  await mountedCamera.update(nextData(camera.instance, { label: '继续观察', durationMs: 900 }))
  camera.root.querySelector('button')!.click()
  expect(camera.root.querySelector('button')?.textContent).toBe('继续观察')
  expect(camera.execute).toHaveBeenCalledWith(expect.objectContaining({ camera: expect.objectContaining({ durationMs: 900 }) }))
  const transition = mountSource('transition.source-control', 'transition-control'), mountedTransition = await transition.mount()
  await mountedTransition.update(nextData(transition.instance, { label: '继续演示', distance: 40, durationMs: 700 }))
  transition.root.querySelector('button')!.click()
  expect(transition.root.querySelector('button')?.textContent).toBe('继续演示')
  expect(transition.execute).toHaveBeenCalledWith(expect.objectContaining({ transition: expect.objectContaining({ durationMs: 700, incoming: expect.objectContaining({ keyframes: expect.arrayContaining([expect.objectContaining({ transform: 'translateY(40px)' })]) }) }) }))
  await mountedCamera.dispose(); await mountedTransition.dispose()
})

it('applies background parameter edits and keeps ambient settings independent of unrelated shared energy', async () => {
  const { drawing, stops, tick } = prepareDrawing(), ambient = mountSource('background.ambient', 'background')
  const mountedAmbient = await ambient.mount()
  await mountedAmbient.update(nextData(ambient.instance, { energy: .1, speed: 0, color: '#112233', accent: '#445566' }))
  tick()
  expect(stops).toHaveBeenLastCalledWith(1, '#f0fdfa')
  expect(stops).toHaveBeenCalledWith(0, '#112233')
  expect(drawing.fillStyle).toBe('#445566')
  expect(drawing.arc.mock.calls.at(-1)?.[2]).toBeCloseTo(5.4)
  await mountedAmbient.dispose()
  const linked = mountSource('background.scene', 'background'), mountedLinked = await linked.mount()
  await mountedLinked.update(nextData(linked.instance, { energy: .4 }))
  expect(linked.set).toHaveBeenCalledWith('environmentEnergy', .4)
  await mountedLinked.dispose()
})

it('provides named editable fields for the state example and mixed program template', () => {
  const presentation = mountSource('presentation', 'source-control'), mixed = mountSource('template.mixed-program', 'program')
  expect(componentFieldPresentation(presentation.definition, ['gap']).label).toBe('按钮间距（像素）')
  expect(componentFieldPresentation(presentation.definition, ['detailLabel']).label).toBe('细节按钮文字')
  expect(componentFieldPresentation(mixed.definition, ['color']).color).toBe(true)
})
