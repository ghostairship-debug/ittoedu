// @vitest-environment node
import { createTestProjectFromLegacy, testContainerInstance } from '../helpers/glxWorkFixture'
import { beforeEach, expect, it, vi } from 'vitest'
import { parse } from '@babel/parser'
import { createComponentReferenceCapture } from '../../src/core/components/library/references'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import { liveSourceOwners } from '../../src/core/components/compilation/liveSourceReferences'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { resolveComponentPresentation, type ComponentImplementation, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentResources } from '../../src/shared/workbench/document'

vi.mock('@babel/parser', async importOriginal => {
  const actual = await importOriginal<typeof import('@babel/parser')>()
  return { ...actual, parse: vi.fn(actual.parse) }
})
vi.mock('../../src/core/components/compilation/liveSourceReferences', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/components/compilation/liveSourceReferences')>()
  return { ...actual, liveSourceOwners: vi.fn(actual.liveSourceOwners) }
})

const entryText = 'import "./helper"; export default { mount(ctx) { ctx.resources.url("photo") } }'
const helperText = 'export const icon = ctx => ctx.resources.url("icon")'
const source = (text: string): Extract<ComponentImplementation, { kind: 'source' }> => ({ kind: 'source', language: 'javascript', source: text })
function fixture(): { project: CourseProjectV10; resources: DocumentResources } {
  const project: CourseProjectV10 = createTestProjectFromLegacy({ schemaVersion: 10, id: 'capture', revision: 0, title: 'Source capture',
    definitions: {}, instances: {}, assets: {}, surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: [] }],
    global: { underlay: [], overlay: [] } })
  const resources: DocumentResources = { assets: {}, components: {} }
  for (const id of ['a', 'b']) {
    project.definitions[id] = { id, role: 'content', professionalBuiltinKey: 'guoling.image', implementation: {
      ...source(entryText), moduleBindings: { './helper': `helper-${id}` }, resourceBindings: { photo: `photo-${id}` },
    } }
    project.definitions[`helper-${id}`] = { id: `helper-${id}`, role: 'content', implementation: {
      ...source(helperText), resourceBindings: { icon: `icon-${id}` },
    } }
  }
  for (const [id, definitionId] of [['a1', 'a'], ['a2', 'a'], ['b', 'b']]) project.instances[id] = {
    id, definitionId, data: { assetId: 'data-image' }, authoring: { resourceBindings: { authored: 'authored-base' } },
  }
  testContainerInstance(project, 0).childIds = ['a1', 'a2', 'b']
  testContainerInstance(project, 0).container.presentation = { states: [{ id: 'alternate', title: 'Alternate', overrides: {
    a2: { authoring: { resourceBindings: { authored: 'authored-state' } } },
  } }] }
  for (const id of ['photo-a', 'photo-b', 'icon-a', 'icon-b', 'data-image', 'authored-base', 'authored-state', 'unused']) {
    project.assets[id] = { id, path: `assets/${id}.png`, mimeType: 'image/png' }
    resources.assets[id] = Uint8Array.of(1)
  }
  return { project, resources }
}
const callsFor = (text: string) => vi.mocked(parse).mock.calls.filter(([value]) => value === text)
const expectSourceOwnerReuse = () => {
  const implementations = vi.mocked(liveSourceOwners).mock.calls.map(([, implementation]) => implementation)
  expect(implementations.filter(implementation => implementation.kind === 'source')).toHaveLength(2)
  expect(implementations.filter(implementation => implementation.kind === 'builtin')).toEqual([{ kind: 'builtin', key: 'guoling.container.slide' }])
}
beforeEach(() => { vi.mocked(parse).mockClear(); vi.mocked(liveSourceOwners).mockClear() })

it('shares import/resource syntax and each Source closure across instances and states without sharing owner bindings', () => {
  const { project, resources } = fixture(), references = createComponentReferenceCapture(project, resources)
  for (const id of ['a1', 'a2', 'b']) {
    const instance = project.instances[id], suffix = instance.definitionId
    expect(references.componentAssetIds(instance, project.definitions[suffix])).toEqual([
      'data-image', 'authored-base', `photo-${suffix}`, `icon-${suffix}`,
    ])
  }
  const effective = resolveComponentPresentation(project, 'page', 'alternate')
  expect(references.componentAssetIds(effective.instances.a2, effective.definitions.a, effective)).toEqual([
    'data-image', 'authored-state', 'photo-a', 'icon-a',
  ])
  expect(liveSourceOwners).toHaveBeenCalledTimes(2)
  expect(callsFor(entryText)).toHaveLength(1)
  expect(callsFor(helperText)).toHaveLength(1)
})

it('uses one syntax capture through library Source copying, dependency filtering and state resources', () => {
  const { project, resources } = fixture()
  const result = extractComponentLibraryEntry(project, resources, { id: 'library', title: 'Library', surfaceIds: ['page'], kind: 'page' })
  expect(result.diagnostics).toEqual([])
  expect(Object.keys(result.entry.assets).sort()).toEqual(Object.keys(project.assets).filter(id => id !== 'unused').sort())
  expect(result.entry.definitions.a.implementation).toMatchObject({ moduleBindings: { './helper': 'helper-a' }, resourceBindings: { photo: 'photo-a' } })
  expect(result.entry.definitions.b.implementation).toMatchObject({ moduleBindings: { './helper': 'helper-b' }, resourceBindings: { photo: 'photo-b' } })
  expect(callsFor(entryText)).toHaveLength(1)
  expect(callsFor(helperText)).toHaveLength(1)
})

it('shares removal scanning and protects Source dependencies, image data and authoring-only states', () => {
  const { project, resources } = fixture()
  const removed = applyComponentOperation(project, captureComponentOperation(project, [{ type: 'asset.remove', assetId: 'unused' }]), resources)
  expect(removed.assets.unused).toBeUndefined()
  expect(callsFor(entryText)).toHaveLength(1)
  expect(callsFor(helperText)).toHaveLength(1)
  expectSourceOwnerReuse()
  for (const assetId of ['icon-b', 'data-image', 'authored-state']) expect(() => applyComponentOperation(project,
    captureComponentOperation(project, [{ type: 'asset.remove', assetId }]), resources)).toThrow('素材仍被工程内容使用')
  expect(project.assets.unused).toBeDefined()
})

it('reuses Source analysis while checking locked replacement candidates and their presentation versions', () => {
  const { project, resources } = fixture()
  for (const instance of Object.values(project.instances)) instance.locked = true
  const result = applyComponentOperation(project, captureComponentOperation(project, [{ type: 'asset.replace',
    asset: { ...project.assets.unused, filename: 'replacement.png' }, bytes: Uint8Array.of(2), expectedBytes: resources.assets.unused }]), resources)
  expect(result.assets.unused.filename).toBe('replacement.png')
  expect(callsFor(entryText)).toHaveLength(1)
  expect(callsFor(helperText)).toHaveLength(1)
  expectSourceOwnerReuse()
  expect(() => applyComponentOperation(project, captureComponentOperation(project, [{ type: 'asset.replace',
    asset: { ...project.assets['authored-state'], filename: 'replacement.png' }, bytes: Uint8Array.of(2),
    expectedBytes: resources.assets['authored-state'] }]), resources)).toThrow('对象已锁定')
})

it('captures updated bindings, project definitions and workspace bytes afresh', () => {
  const { project, resources } = fixture()
  const implementation = project.definitions.a.implementation as Extract<ComponentImplementation, { kind: 'source' }>
  implementation.workspace = { ownerId: 'code', entry: 'index.js' }
  delete implementation.source
  resources.components.code = { 'index.js': new TextEncoder().encode(entryText) }
  const read = () => createComponentReferenceCapture(project, resources).sourceResourceReferences(implementation).assetIds
  expect(read()).toEqual(['photo-a', 'icon-a'])
  implementation.resourceBindings!.photo = 'photo-b'
  implementation.moduleBindings!['./helper'] = 'helper-b'
  expect(read()).toEqual(['photo-b', 'icon-b'])
  project.definitions['helper-b'].implementation = { ...source(helperText), resourceBindings: { icon: 'data-image' } }
  expect(read()).toEqual(['photo-b', 'data-image'])
  resources.components.code['index.js'] = new TextEncoder().encode('export default {}')
  expect(read()).toEqual(['photo-b'])
})

it('refreshes a mutable operation candidate after an earlier definition edit in the same batch', () => {
  const { project, resources } = fixture()
  const definition = { ...project.definitions.a, implementation: { ...source('export default {}'), resourceBindings: { image: 'unused' } } }
  expect(() => applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'asset.remove', assetId: 'photo-b' },
  ]), resources)).toThrow('素材仍被工程内容使用')
  const result = applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'definition.set', definition }, { type: 'asset.remove', assetId: 'photo-a' },
  ]), resources)
  expect(result.assets['photo-a']).toBeUndefined()
  expect(() => applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'definition.set', definition }, { type: 'asset.remove', assetId: 'unused' },
  ]), resources)).toThrow('素材仍被工程内容使用')
})

it.each([
  'export default { mount(ctx) { const resources = ctx.resources; resources.url(name) } }',
  'export default { document: "web", mount() {} }',
  'export const =',
])('keeps existing dynamic or unfinished Source resource scope: %s', text => {
  const { project, resources } = fixture()
  project.definitions.a.implementation = source(text)
  const references = createComponentReferenceCapture(project, resources)
  const first = references.sourceResourceReferences(project.definitions.a.implementation)
  expect(first.dynamic).toBe(true)
  expect(first.assetIds.sort()).toEqual(Object.keys(project.assets).sort())
  references.componentAssetIds(project.instances.a2, project.definitions.a)
  expect(callsFor(text)).toHaveLength(text === 'export const =' ? 2 : 1)
})
