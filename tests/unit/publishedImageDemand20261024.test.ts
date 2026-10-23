import { expect, it, vi } from 'vitest'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import type { ComponentAsset } from '../../src/shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../src/shared/contracts/component-platform/frame'
import type { ImageDerivativeDemand } from '../../src/shared/imageDerivative'

const frame = (width: number, height: number, transform: ComponentFrame['transform'] = [1, 0, 0, 1, 0, 0]): ComponentFrame => ({ width, height, transform })
function sample() {
  const asset = (id: string): ComponentAsset => ({ id, path: `assets/${id}.png`, mimeType: 'image/png', kind: 'image', width: 4000, height: 2000 })
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'demand', revision: 0, title: '展示需求',
    definitions: { image: { ...IMAGE_DEFINITION, id: 'image' }, group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } } },
    instances: { picture: { id: 'picture', definitionId: 'image', data: { ...createImageData('current'), originalAssetId: 'original' }, frame: frame(200, 100) } },
    assets: { current: asset('current'), original: asset('original') }, global: { underlay: [], overlay: [] },
    surfaces: [{ id: 'slide', title: 'Slide', kind: 'slide', childIds: ['picture'], designSize: { width: 1280, height: 720 } }] })
  return { project, bytes: { current: new Uint8Array([1, 2, 3]), original: new Uint8Array([9, 8, 7]) } }
}

it('derives the largest real crop/display requirement across presentation states without touching author originals', async () => {
  const { project, bytes } = sample(), before = structuredClone(project)
  project.instances.picture.data = { ...createImageData('current'), originalAssetId: 'original', fit: 'cover', crop: { left: .25, right: .25, top: 0, bottom: 0 } }
  project.instances.slide.container!.presentation = { states: [{ id: 'large', title: 'Large', overrides: { picture: { frame: frame(600, 300) } } }] }
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, source: Uint8Array, _demand?: ImageDerivativeDemand) => ({ bytes: source, mimeType: 'image/webp', width: 2400, height: 1200 }))
  const saved = structuredClone(project)
  const result = await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode).toHaveBeenCalledOnce()
  expect(encode.mock.calls[0]![2]).toEqual({ width: 2400, height: 1200, dpr: 1, fit: 'cover' })
  expect(result.payload.assets.current).toMatchObject({ width: 2400, height: 1200, mimeType: 'image/webp' })
  expect(result.payload.assets.original).toBeUndefined()
  expect(project).toEqual(saved); expect(bytes.original).toEqual(new Uint8Array([9, 8, 7]))
  expect(before.instances.picture.frame).toEqual(frame(200, 100))
})

it('does not downsample an asset also requested by an unknown local program', async () => {
  const { project, bytes } = sample()
  project.definitions.code = { id: 'code', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(ctx){ctx.resources.url("current")}}' } }
  project.instances.code = { id: 'code', definitionId: 'code', data: {}, frame: frame(100, 100) }
  project.instances.slide.childIds!.push('code')
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode.mock.calls.find(([asset]) => asset.id === 'current')?.[2]).toBeUndefined()
})

it('includes ancestor affine scale before choosing a shared derivative', async () => {
  const { project, bytes } = sample()
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, frame: frame(300, 300, [.2, 0, 0, 2, 0, 0]), childIds: ['picture'] }
  project.instances.picture.frame = frame(200, 100, [0, 1, -1, 0, 0, 0])
  project.instances.slide.childIds = ['group']
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  // Fit is local, then the source x axis stretches to 400 CSS px. Retain its
  // 800 physical pixels even though the other axis becomes only 20 CSS px.
  expect(encode.mock.calls[0]![2]).toEqual({ width: 800, height: 400, dpr: 1, fit: 'cover' })
})

it('uses the shared Flow lane/assembly projection and preserves unbounded media', async () => {
  const { project, bytes } = sample()
  project.assets.current.height = 4000
  project.instances.picture.frame = frame(100, 100)
  project.instances.slide.container = { ...project.instances.slide.container!, kind: 'flow', presentation: undefined,
    flow: { layout: { readingWidth: 860, wideContentWidth: 1100 } } }
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode.mock.calls[0]![2]).toEqual({ width: 1720, height: 1720, dpr: 1, fit: 'cover' })
  encode.mockClear(); project.instances.picture.flowLayout = { width: 'wide' }
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode.mock.calls[0]![2]).toEqual({ width: 2200, height: 2200, dpr: 1, fit: 'cover' })
  encode.mockClear(); project.instances.picture.flowLayout = { width: 'full-width' }
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode.mock.calls[0]![2]).toBeUndefined()
})

it('keeps both logical IDs and lets an explicit quality exception reach the same encoder', async () => {
  const { project, bytes } = sample()
  project.instances.other = { ...project.instances.picture, id: 'other', data: createImageData('duplicate'), frame: frame(400, 200) }
  project.instances.slide.childIds!.push('other')
  project.assets.duplicate = { ...project.assets.current, id: 'duplicate', path: 'assets/duplicate.png' }
  const encoded = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  const result = await buildPublishedCourseV4({ project, assetBytes: { ...bytes, duplicate: new Uint8Array(bytes.current) } },
    { deliveryAsset: encoded, imageDemands: { duplicate: { width: 500, height: 250, quality: 'detail' } } })
  expect(result.payload.assets.current.url).toBe(result.payload.assets.duplicate.url)
  expect(Object.keys(result.payload.assets).sort()).toEqual(['current', 'duplicate'])
  expect(encoded.mock.calls.find(([asset]) => asset.id === 'duplicate')?.[2]?.quality).toBe('detail')
})

it('retains resolution when nested independently active presentation states can combine geometry', async () => {
  const { project, bytes } = sample()
  project.instances.nested = { ...structuredClone(project.instances.slide), id: 'nested', frame: frame(1280, 720) }
  project.instances.slide.childIds = ['nested']
  project.instances.slide.container!.presentation = { states: [{ id: 'outer', title: 'Outer', overrides: {
    nested: { frame: frame(1280, 720, [2, 0, 0, 2, 0, 0]) },
  } }] }
  project.instances.nested.container!.presentation = { states: [{ id: 'inner', title: 'Inner', overrides: { picture: { frame: frame(400, 200) } } }] }
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  // Model/compiled Players compose both owners. Individual snapshots alone
  // would choose 800px although the combined display requires 1600px.
  expect(encode.mock.calls.find(([asset]) => asset.id === 'current')?.[2]).toBeUndefined()
})

it('uses the bounded native Slide design viewport for its background', async () => {
  const { project, bytes } = sample()
  project.instances.slide.childIds = []
  delete project.instances.picture
  project.instances.slide.frame = frame(200, 100, [2, 0, 0, .2, 0, 0])
  project.instances.slide.container!.designSize = { width: 200, height: 100 }
  project.instances.slide.container!.background = { assetId: 'current', fit: 'contain' }
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  // Root viewport placement ignores a free-object frame on the root container.
  expect(encode.mock.calls[0]![2]).toEqual({ width: 400, height: 200, dpr: 1, fit: 'cover' })
})

it('preserves nested viewport fit and Spatial camera uses whose display scale is not measured', async () => {
  const { project, bytes } = sample()
  project.instances.nested = { ...structuredClone(project.instances.slide), id: 'nested', frame: frame(2560, 1440) }
  project.instances.slide.childIds = ['nested']
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode.mock.calls.find(([asset]) => asset.id === 'current')?.[2]).toBeUndefined()
  delete project.instances.nested
  project.instances.slide.childIds = ['picture']
  project.instances.slide.container = { ...project.instances.slide.container!, kind: 'spatial' }
  encode.mockClear()
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode.mock.calls.find(([asset]) => asset.id === 'current')?.[2]).toBeUndefined()
})

it('does not shrink a native image also exposed as a theme resource with unknown display use', async () => {
  const { project, bytes } = sample()
  project.theme = { css: '.scene{background:var(--course-asset-hero)}', assets: { hero: { assetId: 'current' } } }
  const encode = vi.fn(async (_asset: Readonly<ComponentAsset>, _bytes: Uint8Array, _demand?: ImageDerivativeDemand) => undefined)
  await buildPublishedCourseV4({ project, assetBytes: bytes }, { deliveryAsset: encode })
  expect(encode.mock.calls.find(([asset]) => asset.id === 'current')?.[2]).toBeUndefined()
})
