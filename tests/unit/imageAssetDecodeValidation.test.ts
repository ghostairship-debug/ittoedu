import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readImageDimensions } from '@/renderer/project/assetManager'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { mediaAssetTool } from '@/renderer/authoring/tools/mediaAssetTool'
import { executeAuthoringTool } from '@/renderer/authoring/tools/executeAuthoringTool'
import { validateDynamicCandidateFallbackAssets } from '@/renderer/authoring/tools/dynamicCandidateFallbackAssets'
import { runDynamicCandidateHostSmoke } from '@/renderer/authoring/tools/dynamicCandidateAdmission'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'

// jsdom has no image decoder. These explicit ports exercise the failure boundary;
// imageAssetDecodeValidation.spec.ts separately checks real Chromium decoders.
const close = vi.fn()
const decode = vi.fn(async (source: Blob | HTMLImageElement) => {
  if (source instanceof NodeBlob && new Uint8Array(await source.arrayBuffer())[0] === 0) throw new Error('invalid pixel stream')
  return { width: 220, height: 220, close }
})
const revoke = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:unit-decoder' }
    static revokeObjectURL = revoke
  })
  vi.stubGlobal('Image', class {
    naturalWidth = 220; naturalHeight = 220
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
})
afterEach(() => vi.unstubAllGlobals())

function fixture() {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected Slide')
  const resources = { assetFiles: { good: Uint8Array.of(1), bad: Uint8Array.of(0) }, componentPackages: {} }
  for (const id of ['good', 'bad'] as const) project.assets[id] = { id, kind: 'image', filename: `${id}.png`, path: `assets/${id}.png`, mimeType: 'image/png', byteLength: 1 }
  const runtime = (id: string, assetId: string): RuntimeLayerItem => ({ kind: 'runtime', layerItemId: id, label: id, order: 0,
    frame: { mode: 'absolute', x: 0, y: 0, width: 220, height: 220 }, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom', source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
      content: { values: {} }, assets: {}, staticFallback: { assetId, coverage: 'scene' } } })
  surface.scenes[0]!.layerItems = [runtime('one', 'good'), runtime('two', 'good'), runtime('unrelated', 'bad')]
  return { project, surface, resources }
}

describe('Complete image decode is required before importing', () => {
  it('rejects raster pixels even when Image.onload reports valid dimensions, and revokes its URL', async () => {
    await expect(readImageDimensions(Uint8Array.of(0), 'image/png')).rejects.toThrow('无法完整解码')
    expect(decode).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled()
  })
  it('uses decoded raster dimensions and releases the bitmap', async () => {
    await expect(readImageDimensions(Uint8Array.of(1), 'image/jpeg')).resolves.toEqual({ width: 220, height: 220 })
    expect(decode.mock.calls[0]![0]).toBeInstanceOf(NodeBlob)
    expect(close).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce()
  })
  it('retains SVG including viewBox-only dimensions without letting mislabeled PNG use the SVG route', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"/>')
    await expect(readImageDimensions(svg, 'image/svg+xml')).resolves.toEqual({ width: 220, height: 220 })
    expect(decode.mock.calls[0]![0]).not.toBeInstanceOf(NodeBlob)
    expect(decode).toHaveBeenCalledWith(expect.anything(), { resizeWidth: 220, resizeHeight: 220 })
    await expect(readImageDimensions(Uint8Array.of(0), 'image/svg+xml')).rejects.toThrow('无法完整解码')
    expect(decode).toHaveBeenCalledOnce()
  })
  it('fails asset.media.import during planning with no document, resource or history commit', async () => {
    const { project, surface, resources } = fixture(), before = structuredClone(project), commit = vi.fn(() => true)
    const receipt = await executeAuthoringTool({ version: 1, requestId: 'bad-image', tool: 'asset.media.import',
      destination: { kind: 'create', scope: { projectId: project.id, documentRevision: project.revision, revisionPolicy: { kind: 'exact' },
        sessionGeneration: 0, surfaceType: 'slide', surfaceId: surface.id, locationId: project.startLocationId, stateId: null,
        owner: 'global', ownerKey: 'global', parent: { kind: 'owner' }, insertion: { kind: 'append' } } },
      input: { kind: 'image', filename: 'bad.png', mimeType: 'image/png', base64: 'AA==' } }, mediaAssetTool,
    { readDocument: () => project, readResources: () => resources, validateDestination: () => null, commit })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('failed')
    expect(receipt.diagnostics[0]!.message).toContain('无法完整解码')
    expect(commit).not.toHaveBeenCalled(); expect(project).toEqual(before)
    expect(receipt.resources.assetIds).toEqual([])
  })
})

describe('Dynamic fallback bytes use the same complete decoder', () => {
  it('deduplicates the exact target fallback asset and leaves unrelated bad images outside this admission', async () => {
    const { project, resources } = fixture()
    await validateDynamicCandidateFallbackAssets(project, resources, ['one', 'two'])
    expect(decode).toHaveBeenCalledOnce()
  })
  it('rejects damaged bytes with the real fallback field path before host construction', async () => {
    const { project, resources } = fixture()
    await expect(runDynamicCandidateHostSmoke(project, resources, [{ locationId: project.startLocationId, instanceIds: ['unrelated'] }]))
      .rejects.toMatchObject({ diagnostics: [{ code: 'dynamic-fallback-image-invalid', path: ['surfaces', '0', 'scenes', '0', 'layerItems', '2', 'runtime', 'staticFallback', 'assetId'] }] })
    expect(decode).toHaveBeenCalledOnce()
  })
  it('rejects missing actual fallback bytes without trusting image metadata', async () => {
    const { project, resources } = fixture()
    await expect(validateDynamicCandidateFallbackAssets(project, { ...resources, assetFiles: {} }, ['one']))
      .rejects.toMatchObject({ diagnostics: [{ code: 'dynamic-fallback-image-invalid' }] })
    expect(decode).not.toHaveBeenCalled()
  })
  it('checks Component layer fallbacks through the canonical asset reference graph', async () => {
    const { project, surface, resources } = fixture(), original = surface.scenes[0]!.layerItems[0]!
    if (original.kind !== 'runtime') throw new Error('Expected Runtime')
    const { kind: _kind, runtime: _runtime, ...base } = original
    surface.scenes[0]!.layerItems = [{ ...base, kind: 'component', component: { packageId: 'test-package', version: '1.0.0' }, props: {}, staticFallbackAssetId: 'bad' }]
    await expect(validateDynamicCandidateFallbackAssets(project, resources, ['one']))
      .rejects.toMatchObject({ diagnostics: [{ code: 'dynamic-fallback-image-invalid' }] })
  })
  it('checks nested Flow Component block fallbacks using their block identity', async () => {
    const { project: source, resources } = fixture(), project = createBlankFlowCourseProject()
    project.assets = source.assets
    const surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Expected Flow')
    surface.blocks = [{ type: 'section', id: 'section', title: { inlines: [{ type: 'text', text: 'Nested' }] }, collapsedByDefault: true,
      blocks: [{ type: 'component', id: 'nested-component', component: { packageId: 'test-package', version: '1.0.0' }, props: {}, staticFallbackAssetId: 'bad' }] }]
    await expect(validateDynamicCandidateFallbackAssets(project, resources, ['nested-component']))
      .rejects.toMatchObject({ diagnostics: [{ code: 'dynamic-fallback-image-invalid', path: ['surfaces', '0', 'blocks', '0', 'blocks', '0', 'staticFallbackAssetId'] }] })
  })
})
